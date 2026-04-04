import { ethers } from "ethers";
import Market from "../models/Markets";
import Position from "../models/Positions";
import {
    placeMarketOrder,
    fetchMidpoint,
    fetchBestPrice,
    fetchNegRisk,
    getPolymarketWalletBalance,
    getConditionalTokenBalance,
    getNativeUsdcBalance,
    swapNativeUsdcToUsdcE,
    ensureExchangeApproval,
    ensureConditionalTokenApproval,
} from "./polymarket-clob";
import {
    getUserMargin,
    lockMargin,
    releaseMargin,
    borrowFromPool,
    repayToPool,
    fundPolymarketWallet,
} from "./vault";
import { getPoolStats } from "./pool";
import { openPosition as nettingOpen } from "./netting";
import { broadcastPositionUpdate } from "../socket/broadcast";

const MAX_SLIPPAGE_BPS = 200;
const USDC_DECIMALS = 6;
const USDC_SCALE = 10 ** USDC_DECIMALS;

function applySlippage(price: number): number {
    const adj = price * (MAX_SLIPPAGE_BPS / 10_000);
    return Math.min(0.999, price + adj);
}

function toMicro(usd: number): bigint {
    return BigInt(Math.round(usd * USDC_SCALE));
}

function usd(micro: bigint | string): string {
    const n = Number(BigInt(micro)) / USDC_SCALE;
    return `$${n.toFixed(2)}`;
}

/* ---------- Per-user trade lock ---------- */

const _locks = new Map<string, Promise<unknown>>();

/* ---------- Pending settlement tracker ---------- */

const _pendingSettlements = new Map<string, Promise<void>>();

function settlementKey(wallet: string, conditionId: string): string {
    return `${wallet}:${conditionId}`;
}

async function withUserLock<T>(wallet: string, fn: () => Promise<T>): Promise<T> {
    const prev = _locks.get(wallet) ?? Promise.resolve();
    const current = prev.then(fn, fn);
    _locks.set(wallet, current);
    try {
        return await current;
    } finally {
        if (_locks.get(wallet) === current) _locks.delete(wallet);
    }
}

/* ---------- Public API ---------- */

export interface TradeParams {
    wallet: string;
    conditionId: string;
    outcome: "Yes" | "No";
    amount: number;
    leverage: number;
}

export interface TradeResult {
    position: typeof Position.prototype;
    orderId: string;
}

export async function executeTrade(params: TradeParams): Promise<TradeResult> {
    return withUserLock(params.wallet, () => _executeTrade(params));
}

async function _executeTrade(params: TradeParams): Promise<TradeResult> {
    const { wallet, conditionId, outcome, amount, leverage } = params;
    console.log(`[trade] START wallet=${wallet} condition=${conditionId} outcome=${outcome} amount=${amount} leverage=${leverage}x`);

    /* --- 1. Fetch market --- */
    const market = await Market.findOne({ conditionId }).lean();
    if (!market) throw new Error("Market not found");

    const isYes = outcome === "Yes";
    const tokenId = isYes ? market.tokens.Yes.tokenId : market.tokens.No.tokenId;

    /* --- 2. CLOB data --- */
    const [midpoint, bestPrice] = await Promise.all([
        fetchMidpoint(tokenId),
        fetchBestPrice(tokenId, "BUY"),
    ]);
    if (midpoint <= 0 || midpoint >= 1) throw new Error("Invalid midpoint price");

    const price = bestPrice;
    const shares = Math.floor((amount / price) * USDC_SCALE) / USDC_SCALE;

    /* --- 3. Compute margin & borrow amounts --- */
    const amountMicro = toMicro(amount);
    const marginMicro = toMicro(amount / leverage);
    const borrowedMicro = amountMicro - marginMicro;
    const totalSettlement = marginMicro + borrowedMicro;

    const liqPrice = isYes
        ? price * (1 - 1 / leverage)
        : Math.min(1, price * (1 + 1 / leverage));

    console.log(`[trade] === TRADE PLAN ===`);
    console.log(`[trade]   Market:       "${market.question}"`);
    console.log(`[trade]   Side:         ${outcome} @ $${price.toFixed(4)}`);
    console.log(`[trade]   Total cost:   ${usd(amountMicro)} (${amountMicro} micro)`);
    console.log(`[trade]   User margin:  ${usd(marginMicro)} (from Vault)`);
    console.log(`[trade]   LP borrow:    ${usd(borrowedMicro)} (from LPPool)`);
    console.log(`[trade]   Leverage:     ${leverage}x`);
    console.log(`[trade]   Shares:       ${shares}`);
    console.log(`[trade]   Liq price:    $${liqPrice.toFixed(4)}`);

    /* --- 4. Validate margin --- */
    const margin = await getUserMargin(wallet);
    const availableMicro = BigInt(margin.available);

    console.log(`[trade] === BALANCES BEFORE ===`);
    console.log(`[trade]   Vault margin: available=${usd(margin.available)} locked=${usd(margin.locked)} total=${usd(margin.total)}`);

    if (availableMicro < marginMicro) {
        throw new Error(
            `Insufficient margin: need ${usd(marginMicro)}, available ${usd(availableMicro)}`,
        );
    }

    /* --- 5. Validate LP pool liquidity (skip if 1x) --- */
    let poolLiquidity = "N/A (1x)";
    if (borrowedMicro > 0n) {
        const poolStats = await getPoolStats(conditionId);
        poolLiquidity = usd(poolStats.availableLiquidity);
        console.log(`[trade]   LP pool:      available=${poolLiquidity}`);
        if (BigInt(poolStats.availableLiquidity) < borrowedMicro) {
            throw new Error(`Insufficient LP pool liquidity: need ${usd(borrowedMicro)}, available ${poolLiquidity}`);
        }
    } else {
        console.log(`[trade]   LP pool:      not needed (1x leverage)`);
    }

    /* --- 6. Decide path --- */
    const negRisk = await fetchNegRisk(tokenId);
    const orderPrice = applySlippage(price);
    const polyBalance = await getPolymarketWalletBalance();
    const isOptimistic = polyBalance >= amountMicro;

    console.log(`[trade]   Poly wallet:  ${usd(polyBalance)} (USDC.e)`);

    if (isOptimistic) {
        console.log(`[trade] === PATH: OPTIMISTIC ===`);
        console.log(`[trade]   Poly wallet (${usd(polyBalance)}) >= total cost (${usd(amountMicro)})`);
        console.log(`[trade]   Order placed FIRST, settlement runs in background`);
    } else {
        console.log(`[trade] === PATH: SETTLEMENT-FIRST ===`);
        console.log(`[trade]   Poly wallet (${usd(polyBalance)}) < total cost (${usd(amountMicro)})`);
        console.log(`[trade]   Must fund wallet before placing order`);
    }

    await ensureExchangeApproval();

    let orderId: string;

    if (isOptimistic) {
        console.log("[trade] Placing CLOB order (using existing Poly wallet balance)...");
        const clobResult = await placeMarketOrder({
            tokenId,
            price: orderPrice,
            amount,
            side: 0,
            negRisk,
        });
        orderId = clobResult.orderID;
        console.log(`[trade] CLOB order placed: ${orderId}`);

        const key = settlementKey(wallet, conditionId);
        const settlePromise = settle(wallet, conditionId, marginMicro, borrowedMicro, totalSettlement, isYes, shares)
            .catch((err) => console.error("[trade] Background settlement failed:", err))
            .finally(() => _pendingSettlements.delete(key));
        _pendingSettlements.set(key, settlePromise);
    } else {
        const steps = (borrowedMicro > 0n ? 4 : 3);
        let step = 0;

        step++;
        console.log(`[trade] [${step}/${steps}] Lock margin: ${usd(marginMicro)} from user vault`);
        await lockMargin(wallet, marginMicro.toString());

        if (borrowedMicro > 0n) {
            step++;
            console.log(`[trade] [${step}/${steps}] Borrow LP: ${usd(borrowedMicro)} from LPPool (conditionId=${conditionId.slice(0, 10)}...)`);
            await borrowFromPool(conditionId, borrowedMicro.toString());
        }

        if (totalSettlement > 0n) {
            step++;
            console.log(`[trade] [${step}/${steps}] Fund poly: ${usd(totalSettlement)} Vault -> Polymarket wallet (native USDC)`);
            await fundPolymarketWallet(totalSettlement.toString());

            const nativeBal = await getNativeUsdcBalance();
            console.log(`[trade] Post-fund native USDC balance on poly wallet: ${nativeBal} (need ${totalSettlement})`);

            step++;
            console.log(`[trade] [${step}/${steps}] Swap: ${usd(totalSettlement)} native USDC -> USDC.e via Uniswap`);
            await swapNativeUsdcToUsdcE(totalSettlement);
            await ensureExchangeApproval();
        }

        try {
            console.log("[trade] Placing CLOB order...");
            const clobResult = await placeMarketOrder({
                tokenId,
                price: orderPrice,
                amount,
                side: 0,
                negRisk,
            });
            orderId = clobResult.orderID;
            console.log(`[trade] CLOB order placed: ${orderId}`);
        } catch (err) {
            console.error("[trade] CLOB order FAILED, rolling back...", err);
            await rollback(wallet, conditionId, marginMicro, borrowedMicro);
            throw err;
        }

        nettingOpen(wallet, conditionId, isYes, toMicro(shares).toString()).catch((err) =>
            console.error("[trade] Netting openPosition failed:", err),
        );
    }

    /* --- 7. Save position --- */
    const position = await Position.create({
        wallet,
        conditionId,
        outcome,
        leverage: leverage.toString(),
        shares,
        entryPrice: price,
        positionValue: amount,
        marginAmount: Number(marginMicro) / USDC_SCALE,
        borrowedAmount: Number(borrowedMicro) / USDC_SCALE,
        liqPrice,
        status: "open",
        settled: !isOptimistic,
        question: market.question,
        slug: market.slug,
        orderId,
    });

    console.log(`[trade] === TRADE COMPLETE ===`);
    console.log(`[trade]   Market:    "${market.question}"`);
    console.log(`[trade]   Side:      ${outcome} @ $${price.toFixed(4)}`);
    console.log(`[trade]   Shares:    ${shares}`);
    console.log(`[trade]   Margin:    ${usd(marginMicro)} (from Vault)`);
    console.log(`[trade]   Borrowed:  ${usd(borrowedMicro)} (from LPPool)`);
    console.log(`[trade]   Total:     ${usd(amountMicro)}`);
    console.log(`[trade]   Liq price: $${liqPrice.toFixed(4)}`);
    console.log(`[trade]   Path:      ${isOptimistic ? "optimistic (settlement in background)" : "settlement-first"}`);
    console.log(`[trade]   OrderId:   ${orderId}`);

    broadcastPositionUpdate(wallet).catch(() => {});
    return { position, orderId };
}

/* ---------- Background settlement (optimistic path) ---------- */

async function settle(
    wallet: string,
    conditionId: string,
    marginMicro: bigint,
    borrowedMicro: bigint,
    totalSettlement: bigint,
    isYes: boolean,
    shares: number,
): Promise<void> {
    const steps = (borrowedMicro > 0n ? 4 : 3);
    let step = 0;

    console.log(`[trade] === BACKGROUND SETTLEMENT START (wallet=${wallet.slice(0, 10)}...) ===`);

    step++;
    console.log(`[trade] [${step}/${steps}] Lock margin: ${usd(marginMicro)} from user vault`);
    await lockMargin(wallet, marginMicro.toString());

    if (borrowedMicro > 0n) {
        step++;
        console.log(`[trade] [${step}/${steps}] Borrow LP: ${usd(borrowedMicro)} from LPPool`);
        await borrowFromPool(conditionId, borrowedMicro.toString());
    }

    if (totalSettlement > 0n) {
        step++;
        console.log(`[trade] [${step}/${steps}] Fund poly: ${usd(totalSettlement)} Vault -> Polymarket wallet`);
        await fundPolymarketWallet(totalSettlement.toString());

        const nativeBal = await getNativeUsdcBalance();
        console.log(`[trade] Post-fund native USDC balance on poly wallet: ${nativeBal} (need ${totalSettlement})`);

        step++;
        console.log(`[trade] [${step}/${steps}] Swap: ${usd(totalSettlement)} native USDC -> USDC.e`);
        await swapNativeUsdcToUsdcE(totalSettlement);
        await ensureExchangeApproval();
    }

    console.log(`[trade] Registering netting position...`);
    await nettingOpen(wallet, conditionId, isYes, toMicro(shares).toString());

    await Position.updateOne(
        { wallet, conditionId, settled: false, status: "open" },
        { $set: { settled: true } },
    );

    console.log(`[trade] === BACKGROUND SETTLEMENT DONE ===`);
}

/* ---------- Close position ---------- */

export async function closePosition(positionId: string, wallet: string) {
    return withUserLock(wallet, () => _closePosition(positionId, wallet));
}

async function _closePosition(positionId: string, wallet: string) {
    console.log(`[trade] === CLOSE POSITION ===`);
    console.log(`[trade]   positionId: ${positionId}`);
    console.log(`[trade]   wallet:     ${wallet}`);

    const position = await Position.findOne({ _id: positionId, wallet, status: "open" });
    if (!position) throw new Error("Position not found or already closed");

    /* --- Await any pending background settlement before proceeding --- */
    const key = settlementKey(wallet, position.conditionId);
    const pendingSettle = _pendingSettlements.get(key);
    if (pendingSettle) {
        console.log(`[trade] Pending background settlement detected, awaiting...`);
        await pendingSettle;
        console.log(`[trade] Background settlement finished, proceeding with close`);
    }

    const market = await Market.findOne({ conditionId: position.conditionId }).lean();
    if (!market) throw new Error("Market not found");

    const isYes = position.outcome === "Yes";
    const tokenId = isYes ? market.tokens.Yes.tokenId : market.tokens.No.tokenId;
    const marginMicro = toMicro(position.marginAmount);
    const borrowedMicro = toMicro(position.borrowedAmount);

    console.log(`[trade]   Market:     "${market.question}"`);
    console.log(`[trade]   Side:       ${position.outcome} | shares=${position.shares}`);
    console.log(`[trade]   Margin:     ${usd(marginMicro)} (locked in Vault)`);
    console.log(`[trade]   Borrowed:   ${usd(borrowedMicro)} (from LPPool)`);

    /* --- Fetch CLOB data in parallel --- */
    const [actualBalance, midpoint, negRisk] = await Promise.all([
        getConditionalTokenBalance(tokenId),
        fetchMidpoint(tokenId),
        fetchNegRisk(tokenId),
    ]);

    const sellShares = Math.min(position.shares, actualBalance);
    if (sellShares <= 0) throw new Error("No conditional tokens to sell");

    const sellPrice = Math.max(0.001, midpoint * (1 - MAX_SLIPPAGE_BPS / 10_000));

    console.log(`[trade]   On-chain:   ${actualBalance} tokens (stored ${position.shares}), selling ${sellShares}`);
    console.log(`[trade]   Midpoint:   $${midpoint.toFixed(4)} | sell @ $${sellPrice.toFixed(4)}`);

    await ensureExchangeApproval();
    await ensureConditionalTokenApproval();

    console.log("[trade] Placing SELL order on CLOB...");
    const clobResult = await placeMarketOrder({
        tokenId,
        price: sellPrice,
        amount: sellShares,
        side: 1,
        negRisk,
    });
    console.log(`[trade] SELL order placed: ${clobResult.orderID}`);

    /* --- Mark closed immediately, settle on-chain in background --- */
    position.status = "closed";
    await position.save();

    console.log(`[trade] === POSITION CLOSED ===`);
    console.log(`[trade]   OrderId: ${clobResult.orderID}`);

    closeSettle(wallet, position.conditionId, marginMicro, borrowedMicro).catch((err) =>
        console.error("[trade] Background close-settlement failed:", err),
    );

    broadcastPositionUpdate(wallet).catch(() => {});
    return position;
}

async function closeSettle(
    wallet: string,
    conditionId: string,
    marginMicro: bigint,
    borrowedMicro: bigint,
): Promise<void> {
    console.log(`[trade] === CLOSE SETTLEMENT START ===`);

    try {
        if (marginMicro > 0n) {
            console.log(`[trade]   Releasing margin: ${usd(marginMicro)} back to user vault`);
            await releaseMargin(wallet, marginMicro.toString());
            console.log(`[trade]   Margin released`);
        }
    } catch (err) {
        console.error("[trade]   releaseMargin on close FAILED:", err);
    }

    try {
        if (borrowedMicro > 0n) {
            console.log(`[trade]   Repaying LP: ${usd(borrowedMicro)} back to LPPool`);
            await repayToPool(conditionId, borrowedMicro.toString());
            console.log(`[trade]   LP repaid`);
        }
    } catch (err) {
        console.error("[trade]   repayToPool on close FAILED:", err);
    }

    console.log(`[trade] === CLOSE SETTLEMENT DONE ===`);
    console.log(`[trade]   Margin ${usd(marginMicro)} returned to Vault`);
    if (borrowedMicro > 0n) console.log(`[trade]   LP ${usd(borrowedMicro)} repaid to LPPool`);
}

/* ---------- Rollback (settlement-first path, CLOB failed) ---------- */

async function rollback(
    wallet: string,
    conditionId: string,
    marginMicro: bigint,
    borrowedMicro: bigint,
): Promise<void> {
    console.log(`[trade] === ROLLBACK START ===`);

    try {
        console.log(`[trade]   Releasing margin: ${usd(marginMicro)} back to user vault`);
        await releaseMargin(wallet, marginMicro.toString());
        console.log(`[trade]   Margin released`);
    } catch (err) {
        console.error("[trade]   releaseMargin rollback FAILED:", err);
    }

    if (borrowedMicro > 0n) {
        try {
            console.log(`[trade]   Repaying LP: ${usd(borrowedMicro)} back to LPPool`);
            await repayToPool(conditionId, borrowedMicro.toString());
            console.log(`[trade]   LP repaid`);
        } catch (err) {
            console.error("[trade]   repayToPool rollback FAILED:", err);
        }
    }

    console.log(`[trade] === ROLLBACK DONE ===`);
}

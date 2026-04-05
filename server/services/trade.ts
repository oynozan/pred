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

/* ---------- Separate locks for open / close ---------- */

const _openLocks = new Map<string, Promise<unknown>>();
const _closeLocks = new Map<string, Promise<unknown>>();

async function withLock<T>(locks: Map<string, Promise<unknown>>, key: string, fn: () => Promise<T>): Promise<T> {
    const prev = locks.get(key) ?? Promise.resolve();
    const current = prev.then(fn, fn);
    locks.set(key, current);
    try {
        return await current;
    } finally {
        if (locks.get(key) === current) locks.delete(key);
    }
}

/* ---------- Pending settlement tracker ---------- */

const _pendingSettlements = new Map<string, Promise<void>>();

function settlementKey(wallet: string, conditionId: string): string {
    return `${wallet}:${conditionId}`;
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
    return withLock(_openLocks, params.wallet, () => _executeTrade(params));
}

async function _executeTrade(params: TradeParams): Promise<TradeResult> {
    const { wallet, conditionId, outcome, amount, leverage } = params;
    console.log(`[trade] START wallet=${wallet} condition=${conditionId} outcome=${outcome} amount=${amount} leverage=${leverage}x`);

    /* --- 1. Fetch market --- */
    const market = await Market.findOne({ conditionId }).lean();
    if (!market) throw new Error("Market not found");

    const isYes = outcome === "Yes";
    const yesTokenId = market.tokens.Yes.tokenId;
    const noTokenId = market.tokens.No.tokenId;
    const primaryTokenId = isYes ? yesTokenId : noTokenId;

    /* --- 2. CLOB data --- */
    const [midpoint, bestPrice] = await Promise.all([
        fetchMidpoint(primaryTokenId),
        fetchBestPrice(primaryTokenId, "BUY"),
    ]);
    if (midpoint <= 0 || midpoint >= 1) throw new Error("Invalid midpoint price");
    if (midpoint < 0.10 || midpoint > 0.90) {
        throw new Error("Trading disabled for markets with odds below 10% or above 90%");
    }

    const price = bestPrice;
    const shares = Math.floor((amount / price) * USDC_SCALE) / USDC_SCALE;

    /* --- 3. Compute margin & borrow amounts (2x cost for YES+NO hedge) --- */
    const amountMicro = toMicro(amount);
    const hedgeCost = amountMicro * 2n;
    const marginMicro = toMicro(amount / leverage);
    const borrowedMicro = hedgeCost - marginMicro;
    const totalSettlement = hedgeCost;

    const liqPrice = isYes
        ? price * (1 - 1 / leverage)
        : Math.min(1, price * (1 + 1 / leverage));

    console.log(`[trade] === TRADE PLAN (HEDGED) ===`);
    console.log(`[trade]   Market:       "${market.question}"`);
    console.log(`[trade]   Side:         ${outcome} @ $${price.toFixed(4)}`);
    console.log(`[trade]   User amount:  ${usd(amountMicro)}`);
    console.log(`[trade]   Hedge cost:   ${usd(hedgeCost)} (YES + NO)`);
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

    /* --- 5. Validate LP pool liquidity --- */
    const poolStats = await getPoolStats(conditionId);
    const poolLiquidity = usd(poolStats.availableLiquidity);
    console.log(`[trade]   LP pool:      available=${poolLiquidity}`);
    if (BigInt(poolStats.availableLiquidity) < borrowedMicro) {
        throw new Error(`Insufficient LP pool liquidity: need ${usd(borrowedMicro)}, available ${poolLiquidity}`);
    }

    /* --- 6. Decide path & place orders --- */
    const negRisk = await fetchNegRisk(primaryTokenId);
    const primaryOrderPrice = applySlippage(price);
    const oppositePrice = 1 - price;
    const oppositeOrderPrice = applySlippage(oppositePrice);
    const polyBalance = await getPolymarketWalletBalance();
    const isOptimistic = polyBalance >= hedgeCost;

    console.log(`[trade]   Poly wallet:  ${usd(polyBalance)} (USDC.e)`);

    if (isOptimistic) {
        console.log(`[trade] === PATH: OPTIMISTIC ===`);
        console.log(`[trade]   Poly wallet (${usd(polyBalance)}) >= hedge cost (${usd(hedgeCost)})`);
    } else {
        console.log(`[trade] === PATH: SETTLEMENT-FIRST ===`);
        console.log(`[trade]   Poly wallet (${usd(polyBalance)}) < hedge cost (${usd(hedgeCost)})`);
    }

    await ensureExchangeApproval();

    let orderId: string;

    if (isOptimistic) {
        console.log("[trade] Placing HEDGED CLOB orders (primary + opposite)...");
        const [primaryResult, oppositeResult] = await Promise.all([
            placeMarketOrder({ tokenId: primaryTokenId, price: primaryOrderPrice, amount, side: 0, negRisk }),
            placeMarketOrder({ tokenId: isYes ? noTokenId : yesTokenId, price: oppositeOrderPrice, amount, side: 0, negRisk }),
        ]);
        orderId = primaryResult.orderID;
        console.log(`[trade] Primary order: ${orderId}`);
        console.log(`[trade] Hedge order:   ${oppositeResult.orderID}`);

        const key = settlementKey(wallet, conditionId);
        const settlePromise = settle(wallet, conditionId, marginMicro, borrowedMicro, totalSettlement)
            .catch((err) => console.error("[trade] Background settlement failed:", err))
            .finally(() => _pendingSettlements.delete(key));
        _pendingSettlements.set(key, settlePromise);
    } else {
        const steps = 4;
        let step = 0;

        step++;
        console.log(`[trade] [${step}/${steps}] Lock margin: ${usd(marginMicro)} from user vault`);
        await lockMargin(wallet, marginMicro.toString());

        step++;
        console.log(`[trade] [${step}/${steps}] Borrow LP: ${usd(borrowedMicro)} from LPPool`);
        await borrowFromPool(conditionId, borrowedMicro.toString());

        step++;
        console.log(`[trade] [${step}/${steps}] Fund poly: ${usd(totalSettlement)} Vault -> Polymarket wallet`);
        await fundPolymarketWallet(totalSettlement.toString());
        const nativeBal = await getNativeUsdcBalance();
        console.log(`[trade] Post-fund native USDC balance: ${nativeBal}`);

        step++;
        console.log(`[trade] [${step}/${steps}] Swap: ${usd(totalSettlement)} native USDC -> USDC.e`);
        await swapNativeUsdcToUsdcE(totalSettlement);
        await ensureExchangeApproval();

        try {
            console.log("[trade] Placing HEDGED CLOB orders (primary + opposite)...");
            const [primaryResult, oppositeResult] = await Promise.all([
                placeMarketOrder({ tokenId: primaryTokenId, price: primaryOrderPrice, amount, side: 0, negRisk }),
                placeMarketOrder({ tokenId: isYes ? noTokenId : yesTokenId, price: oppositeOrderPrice, amount, side: 0, negRisk }),
            ]);
            orderId = primaryResult.orderID;
            console.log(`[trade] Primary order: ${orderId}`);
            console.log(`[trade] Hedge order:   ${oppositeResult.orderID}`);
        } catch (err) {
            console.error("[trade] CLOB order FAILED, rolling back...", err);
            await rollback(wallet, conditionId, marginMicro, borrowedMicro);
            throw err;
        }
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
    console.log(`[trade]   Hedge:     ${usd(hedgeCost)} (YES+NO)`);
    console.log(`[trade]   Liq price: $${liqPrice.toFixed(4)}`);
    console.log(`[trade]   Path:      ${isOptimistic ? "optimistic" : "settlement-first"}`);
    console.log(`[trade]   OrderId:   ${orderId}`);

    broadcastPositionUpdate(wallet).catch(() => {});
    return { position, orderId };
}

/* ---------- Background settlement (optimistic path) ---------- */

const STEP_TIMEOUT_MS = 60_000;

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
    return Promise.race([
        promise,
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`[trade] ${label} timed out after ${STEP_TIMEOUT_MS / 1000}s`)), STEP_TIMEOUT_MS),
        ),
    ]);
}

async function settle(
    wallet: string,
    conditionId: string,
    marginMicro: bigint,
    borrowedMicro: bigint,
    totalSettlement: bigint,
): Promise<void> {
    console.log(`[trade] === BACKGROUND SETTLEMENT START (wallet=${wallet.slice(0, 10)}...) ===`);

    let step = 0;

    step++;
    console.log(`[trade] [${step}/4] Lock margin: ${usd(marginMicro)} from user vault`);
    await withTimeout(lockMargin(wallet, marginMicro.toString()), "lockMargin");

    step++;
    console.log(`[trade] [${step}/4] Borrow LP: ${usd(borrowedMicro)} from LPPool`);
    await withTimeout(borrowFromPool(conditionId, borrowedMicro.toString()), "borrowFromPool");

    step++;
    console.log(`[trade] [${step}/4] Fund poly: ${usd(totalSettlement)} Vault -> Polymarket wallet`);
    await withTimeout(fundPolymarketWallet(totalSettlement.toString()), "fundPolymarketWallet");

    const nativeBal = await getNativeUsdcBalance();
    console.log(`[trade] Post-fund native USDC balance: ${nativeBal}`);

    step++;
    console.log(`[trade] [${step}/4] Swap: ${usd(totalSettlement)} native USDC -> USDC.e`);
    await withTimeout(swapNativeUsdcToUsdcE(totalSettlement), "swapNativeUsdcToUsdcE");
    await withTimeout(ensureExchangeApproval(), "ensureExchangeApproval");

    await Position.updateOne(
        { wallet, conditionId, settled: false, status: "open" },
        { $set: { settled: true } },
    );

    console.log(`[trade] === BACKGROUND SETTLEMENT DONE ===`);
}

/* ---------- Close position ---------- */

export async function closePosition(positionId: string, wallet: string) {
    return withLock(_closeLocks, wallet, () => _closePosition(positionId, wallet));
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
        console.log(`[trade] Pending background settlement detected, awaiting (30s timeout)...`);
        const timeout = new Promise<void>(r => setTimeout(r, 30_000));
        await Promise.race([pendingSettle, timeout]);
        _pendingSettlements.delete(key);
        console.log(`[trade] Settlement await done`);
    }

    const freshPosition = await Position.findById(positionId).lean();
    const wasSettled = freshPosition?.settled ?? false;
    console.log(`[trade]   settled=${wasSettled} (margin ${wasSettled ? "WAS" : "was NOT"} locked on-chain)`);

    const market = await Market.findOne({ conditionId: position.conditionId }).lean();
    if (!market) throw new Error("Market not found");

    const isYes = position.outcome === "Yes";
    const yesTokenId = market.tokens.Yes.tokenId;
    const noTokenId = market.tokens.No.tokenId;
    const marginMicro = toMicro(position.marginAmount);
    const borrowedMicro = toMicro(position.borrowedAmount);

    console.log(`[trade]   Market:     "${market.question}"`);
    console.log(`[trade]   Side:       ${position.outcome} | shares=${position.shares}`);
    console.log(`[trade]   Margin:     ${usd(marginMicro)} (${wasSettled ? "locked in Vault" : "NOT locked"})`);
    console.log(`[trade]   Borrowed:   ${usd(borrowedMicro)} (${wasSettled ? "from LPPool" : "NOT borrowed"})`);

    /* --- Fetch balances & CLOB data for BOTH sides --- */
    const [yesBal, noBal, negRisk] = await Promise.all([
        getConditionalTokenBalance(yesTokenId),
        getConditionalTokenBalance(noTokenId),
        fetchNegRisk(yesTokenId),
    ]);

    console.log(`[trade]   YES tokens: ${yesBal} | NO tokens: ${noBal}`);

    await ensureExchangeApproval();
    await ensureConditionalTokenApproval();

    const sellPromises: Promise<{ orderID: string }>[] = [];

    if (yesBal > 0) {
        const yesMid = await fetchMidpoint(yesTokenId);
        const yesSellPrice = Math.max(0.001, yesMid * (1 - MAX_SLIPPAGE_BPS / 10_000));
        console.log(`[trade] Selling YES: ${yesBal} tokens @ $${yesSellPrice.toFixed(4)}`);
        sellPromises.push(placeMarketOrder({ tokenId: yesTokenId, price: yesSellPrice, amount: yesBal, side: 1, negRisk }));
    }

    if (noBal > 0) {
        const noMid = await fetchMidpoint(noTokenId);
        const noSellPrice = Math.max(0.001, noMid * (1 - MAX_SLIPPAGE_BPS / 10_000));
        console.log(`[trade] Selling NO:  ${noBal} tokens @ $${noSellPrice.toFixed(4)}`);
        sellPromises.push(placeMarketOrder({ tokenId: noTokenId, price: noSellPrice, amount: noBal, side: 1, negRisk }));
    }

    if (sellPromises.length === 0) throw new Error("No conditional tokens to sell");

    const sellResults = await Promise.all(sellPromises);
    sellResults.forEach((r, i) => console.log(`[trade] SELL order #${i + 1}: ${r.orderID}`));

    /* --- Mark closed immediately, settle on-chain in background --- */
    position.status = "closed";
    await position.save();

    console.log(`[trade] === POSITION CLOSED ===`);
    console.log(`[trade]   OrderIds: ${sellResults.map(r => r.orderID).join(", ")}`);

    if (wasSettled) {
        closeSettle(wallet, position.conditionId, marginMicro, borrowedMicro).catch((err) =>
            console.error("[trade] Background close-settlement failed:", err),
        );
    } else {
        console.log(`[trade] Skipping close-settlement (open settlement never completed)`);
    }

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
        await Position.updateOne(
            { wallet, conditionId, status: "closed" },
            { $set: { settled: false } },
        ).catch(() => {});
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

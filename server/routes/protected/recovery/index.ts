import { Router } from "express";
import { reconcileAll, reconcileWallet, sweepFundsToVault } from "../../../services/recovery";
import { getUserMargin, clearMarginCache } from "../../../services/vault";
import {
    getConditionalTokenBalance,
    fetchMidpoint,
    fetchNegRisk,
    placeMarketOrder,
    swapUsdcEToNativeUsdc,
    returnFundsToVault,
    getPolymarketWalletBalance,
    ensureExchangeApproval,
    ensureConditionalTokenApproval,
} from "../../../services/polymarket-clob";
import { repayToPool } from "../../../services/vault";
import Position from "../../../models/Positions";
import Market from "../../../models/Markets";
import { getVaultContract } from "../../../lib/contracts";

const router = Router();

router.post("/reconcile", async (_req, res) => {
    try {
        const result = await reconcileAll();
        res.json(result);
    } catch (err: any) {
        console.error("[recovery] reconcile route error:", err);
        res.status(500).json({ error: err.message || "Reconciliation failed" });
    }
});

router.post("/sweep", async (_req, res) => {
    try {
        const result = await sweepFundsToVault();
        res.json(result);
    } catch (err: any) {
        console.error("[recovery] sweep route error:", err);
        res.status(500).json({ error: err.message || "Sweep failed" });
    }
});

router.post("/reconcile/:wallet", async (req, res) => {
    try {
        const result = await reconcileWallet(req.params.wallet);
        res.json(result);
    } catch (err: any) {
        console.error("[recovery] reconcile wallet route error:", err);
        res.status(500).json({ error: err.message || "Wallet reconciliation failed" });
    }
});

router.get("/positions", async (_req, res) => {
    try {
        const allWallets: string[] = await Position.distinct("wallet");
        const openPositions = await Position.find({ status: "open" }).lean();

        const byWallet: Record<string, { wallet: string; totalLockedMargin: number; positions: typeof openPositions }> = {};

        for (const w of allWallets) {
            byWallet[w] = { wallet: w, totalLockedMargin: 0, positions: [] };
        }

        for (const pos of openPositions) {
            if (!byWallet[pos.wallet]) {
                byWallet[pos.wallet] = { wallet: pos.wallet, totalLockedMargin: 0, positions: [] };
            }
            byWallet[pos.wallet].totalLockedMargin += pos.marginAmount;
            byWallet[pos.wallet].positions.push(pos);
        }

        res.json({ wallets: Object.values(byWallet), totalPositions: openPositions.length });
    } catch (err: any) {
        console.error("[recovery] positions route error:", err);
        res.status(500).json({ error: err.message || "Failed to fetch positions" });
    }
});

router.get("/stale-borrows", async (_req, res) => {
    try {
        const positions = await Position.find({
            status: "closed",
            borrowedAmount: { $gt: 0 },
            settled: { $ne: true },
        }).lean();

        const byCondition: Record<string, { conditionId: string; totalBorrowed: number; positionIds: string[] }> = {};
        for (const pos of positions) {
            const cid = pos.conditionId;
            if (!byCondition[cid]) {
                byCondition[cid] = { conditionId: cid, totalBorrowed: 0, positionIds: [] };
            }
            byCondition[cid].totalBorrowed += pos.borrowedAmount;
            byCondition[cid].positionIds.push(String(pos._id));
        }

        res.json({ borrows: Object.values(byCondition), totalPositions: positions.length });
    } catch (err: any) {
        console.error("[recovery] stale-borrows route error:", err);
        res.status(500).json({ error: err.message || "Failed to fetch stale borrows" });
    }
});

router.get("/diagnose/:wallet", async (req, res) => {
    try {
        const wallet = req.params.wallet;
        clearMarginCache(wallet);
        const margin = await getUserMargin(wallet);

        const openPositions = await Position.find({ wallet, status: "open" }).lean();
        const closedUnsettled = await Position.find({
            wallet,
            status: "closed",
            settled: { $ne: true },
            borrowedAmount: { $gt: 0 },
        }).lean();
        const allPositions = await Position.find({ wallet }).lean();

        const expectedLockedMicro = openPositions.reduce(
            (sum, p) => sum + BigInt(Math.round(p.marginAmount * 1e6)),
            0n,
        );

        const vault = getVaultContract();
        let contractUsdcBalance = "unknown";
        try {
            const usdcAddr = await vault.usdc();
            const { ethers } = await import("ethers");
            const usdc = new ethers.Contract(
                usdcAddr,
                ["function balanceOf(address) view returns (uint256)"],
                vault.runner as any,
            );
            contractUsdcBalance = (await usdc.balanceOf(await vault.getAddress())).toString();
        } catch {}

        const excess = BigInt(margin.locked) - expectedLockedMicro;

        res.json({
            wallet,
            onChain: {
                total: margin.total,
                locked: margin.locked,
                available: margin.available,
                vaultUsdcBalance: contractUsdcBalance,
            },
            database: {
                expectedLocked: expectedLockedMicro.toString(),
                openPositions: openPositions.length,
                closedUnsettled: closedUnsettled.length,
                totalPositions: allPositions.length,
            },
            analysis: {
                excessLocked: excess > 0n ? excess.toString() : "0",
                zombieLocks: excess > 0n,
                canTrade: BigInt(margin.available) > 0n,
            },
        });
    } catch (err: any) {
        console.error("[recovery] diagnose route error:", err);
        res.status(500).json({ error: err.message || "Diagnosis failed" });
    }
});

router.post("/sell-stranded/:conditionId", async (req, res) => {
    try {
        const { conditionId } = req.params;
        console.log(`[recovery] === SELL STRANDED TOKENS ===`);
        console.log(`[recovery]   conditionId: ${conditionId}`);

        const market = await Market.findOne({ conditionId }).lean();
        if (!market) return res.status(404).json({ error: "Market not found" });

        const yesTokenId = market.tokens.Yes.tokenId;
        const noTokenId = market.tokens.No.tokenId;

        console.log(`[recovery]   market:   "${market.question}"`);
        console.log(`[recovery]   YES tokenId: ${yesTokenId.slice(0, 20)}...`);
        console.log(`[recovery]   NO  tokenId: ${noTokenId.slice(0, 20)}...`);

        const [yesBal, noBal, negRisk] = await Promise.all([
            getConditionalTokenBalance(yesTokenId),
            getConditionalTokenBalance(noTokenId),
            fetchNegRisk(yesTokenId),
        ]);

        console.log(`[recovery]   YES balance: ${yesBal}`);
        console.log(`[recovery]   NO  balance: ${noBal}`);
        console.log(`[recovery]   negRisk:     ${negRisk}`);

        if (yesBal === 0 && noBal === 0) {
            return res.json({ message: "No stranded tokens found", sold: [] });
        }

        await ensureExchangeApproval();
        await ensureConditionalTokenApproval();

        const sold: { side: string; amount: number; orderId: string }[] = [];
        const MIN_SELL_AMOUNT = 0.01;

        if (yesBal >= MIN_SELL_AMOUNT) {
            const mid = await fetchMidpoint(yesTokenId);
            const sellPrice = Math.round(Math.max(0.01, mid * 0.95) * 100) / 100;
            const sellAmount = Math.floor(yesBal * 100) / 100;
            console.log(`[recovery]   Selling YES: amount=${sellAmount} price=${sellPrice} mid=${mid}`);
            if (sellAmount >= MIN_SELL_AMOUNT) {
                const result = await placeMarketOrder({
                    tokenId: yesTokenId, price: sellPrice, amount: sellAmount,
                    side: 1, negRisk, orderType: "GTC",
                });
                sold.push({ side: "Yes", amount: sellAmount, orderId: result.orderID });
            }
        } else if (yesBal > 0) {
            console.log(`[recovery]   YES balance ${yesBal} too small to sell (min ${MIN_SELL_AMOUNT})`);
        }

        if (noBal >= MIN_SELL_AMOUNT) {
            const mid = await fetchMidpoint(noTokenId);
            const sellPrice = Math.round(Math.max(0.01, mid * 0.95) * 100) / 100;
            const sellAmount = Math.floor(noBal * 100) / 100;
            console.log(`[recovery]   Selling NO:  amount=${sellAmount} price=${sellPrice} mid=${mid}`);
            if (sellAmount >= MIN_SELL_AMOUNT) {
                const result = await placeMarketOrder({
                    tokenId: noTokenId, price: sellPrice, amount: sellAmount,
                    side: 1, negRisk, orderType: "GTC",
                });
                sold.push({ side: "No", amount: sellAmount, orderId: result.orderID });
            }
        } else if (noBal > 0) {
            console.log(`[recovery]   NO balance ${noBal} too small to sell (min ${MIN_SELL_AMOUNT})`);
        }

        console.log(`[recovery] Sold ${sold.length} token batch(es). Sweeping to vault...`);
        await new Promise((r) => setTimeout(r, 3_000));

        const usdceBal = await getPolymarketWalletBalance();
        if (usdceBal > 0n) {
            await swapUsdcEToNativeUsdc(usdceBal);
            await returnFundsToVault(usdceBal);
            console.log(`[recovery] Swept ${usdceBal} back to vault`);
        }

        const stalePositions = await Position.find({
            conditionId, status: "closed", settled: { $ne: true }, borrowedAmount: { $gt: 0 },
        });
        let lpRepaid = 0;
        for (const pos of stalePositions) {
            const borrowedMicro = BigInt(Math.round(pos.borrowedAmount * 1e6));
            try {
                await repayToPool(conditionId, borrowedMicro.toString());
                await Position.updateOne({ _id: pos._id }, { $set: { settled: true } });
                lpRepaid++;
                console.log(`[recovery] Repaid LP ${borrowedMicro} for position ${pos._id}`);
            } catch (err: any) {
                if (err.message?.includes("repay exceeds borrowed")) {
                    await Position.updateOne({ _id: pos._id }, { $set: { settled: true } });
                    lpRepaid++;
                } else {
                    console.error(`[recovery] repayToPool failed for ${pos._id}:`, err.message?.slice(0, 100));
                }
            }
        }

        res.json({ sold, swept: usdceBal.toString(), lpRepaid });
    } catch (err: any) {
        console.error("[recovery] sell-stranded error:", err);
        res.status(500).json({ error: err.message || "Failed to sell stranded tokens" });
    }
});

export default router;

import { Router } from "express";
import axios from "axios";
import { getDepositConfig, buildDepositTx } from "../../../services/deposit";
import { getBridgeQuote, getBridgeTransactionData } from "../../../services/bridge";
import { getUserMargin } from "../../../services/vault";

const router = Router();

router.get("/config", (_req, res) => {
    try {
        const config = getDepositConfig();
        res.json(config);
    } catch (err: any) {
        console.error("[deposit/config] Error:", err);
        res.status(500).json({ error: err.message || "Failed to get deposit config" });
    }
});

router.get("/quote", async (req, res) => {
    try {
        const { tokenIn, amountIn, slippageBps } = req.query;

        if (!tokenIn || !amountIn) {
            res.status(400).json({ error: "tokenIn and amountIn query params required" });
            return;
        }

        const result = await buildDepositTx(
            tokenIn as string,
            amountIn as string,
            slippageBps ? parseInt(slippageBps as string, 10) : undefined,
        );

        res.json(result);
    } catch (err: any) {
        console.error("[deposit/quote] Error:", err);
        res.status(500).json({ error: err.message || "Failed to build deposit transaction" });
    }
});

router.get("/margin/:address", async (req, res) => {
    try {
        const margin = await getUserMargin(req.params.address);
        res.json(margin);
    } catch (err: any) {
        console.error("[deposit/margin] Error:", err);
        res.status(500).json({ error: err.message || "Failed to fetch margin" });
    }
});

router.get("/bridge-quote", async (req, res) => {
    try {
        const { fromChainId, fromTokenAddress, fromAmount, userAddress, sort } = req.query;

        if (!fromChainId || !fromTokenAddress || !fromAmount || !userAddress) {
            res.status(400).json({
                error: "fromChainId, fromTokenAddress, fromAmount, and userAddress are required",
            });
            return;
        }

        const quote = await getBridgeQuote({
            fromChainId: parseInt(fromChainId as string, 10),
            fromTokenAddress: fromTokenAddress as string,
            toChainId: 137,
            toTokenAddress: process.env.USDC_ADDRESS || "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
            fromAmount: fromAmount as string,
            userAddress: userAddress as string,
            sort: (sort as "output" | "gas" | "time") || "output",
        });

        res.json(quote);
    } catch (err: any) {
        console.error("[deposit/bridge-quote] Error:", err);
        res.status(500).json({ error: err.message || "Failed to get bridge quote" });
    }
});

router.post("/bridge-tx", async (req, res) => {
    try {
        const { route } = req.body;

        if (!route) {
            res.status(400).json({ error: "route is required in request body" });
            return;
        }

        const txData = await getBridgeTransactionData(route);
        res.json(txData);
    } catch (err: any) {
        console.error("[deposit/bridge-tx] Error:", err);
        res.status(500).json({ error: err.message || "Failed to build bridge transaction" });
    }
});

router.get("/bridge-status", async (req, res) => {
    try {
        const { txHash, fromChain, toChain, bridge } = req.query;

        if (!txHash) {
            res.status(400).json({ error: "txHash is required" });
            return;
        }

        const { data } = await axios.get("https://li.quest/v1/status", {
            params: {
                txHash,
                fromChain,
                toChain: toChain || 137,
                bridge,
            },
        });

        res.json({
            status: data.status,
            substatus: data.substatus || null,
            receiving: data.receiving
                ? {
                      amount: data.receiving.amount,
                      token: data.receiving.token
                          ? {
                                address: data.receiving.token.address,
                                decimals: data.receiving.token.decimals,
                                symbol: data.receiving.token.symbol,
                            }
                          : null,
                      txHash: data.receiving.txHash || null,
                  }
                : null,
        });
    } catch (err: any) {
        console.error("[deposit/bridge-status] Error:", err.message);
        res.status(500).json({ error: err.message || "Failed to check bridge status" });
    }
});

export default router;

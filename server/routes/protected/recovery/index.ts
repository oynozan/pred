import { Router } from "express";
import { reconcileAll, reconcileWallet } from "../../../services/recovery";

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

router.post("/reconcile/:wallet", async (req, res) => {
    try {
        const result = await reconcileWallet(req.params.wallet);
        res.json(result);
    } catch (err: any) {
        console.error("[recovery] reconcile wallet route error:", err);
        res.status(500).json({ error: err.message || "Wallet reconciliation failed" });
    }
});

export default router;

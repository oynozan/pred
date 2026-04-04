import { Router } from "express";
import { getAllPools, getPoolState, getUserPositions } from "../../../services/lp";

const router = Router();

router.get("/pools", async (req, res) => {
    try {
        const all = await getAllPools();
        const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 20, 1), 100);
        const offset = Math.max(parseInt(req.query.offset as string, 10) || 0, 0);
        const pools = all.slice(offset, offset + limit);
        res.json({ pools, total: all.length, limit, offset });
    } catch (err) {
        console.error("[lp/pools] Error:", err);
        res.status(500).json({ error: "Failed to fetch LP pools" });
    }
});

router.get("/pools/:conditionId", async (req, res) => {
    try {
        const pool = await getPoolState(req.params.conditionId);
        if (!pool) {
            res.status(404).json({ error: "Pool not found" });
            return;
        }
        res.json(pool);
    } catch (err) {
        console.error("[lp/pool] Error:", err);
        res.status(500).json({ error: "Failed to fetch pool state" });
    }
});

router.get("/user/:address", async (req, res) => {
    try {
        const summary = await getUserPositions(req.params.address);
        res.json(summary);
    } catch (err) {
        console.error("[lp/user] Error:", err);
        res.status(500).json({ error: "Failed to fetch user LP positions" });
    }
});

export default router;

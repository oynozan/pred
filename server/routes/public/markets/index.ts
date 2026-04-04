import { Router } from "express";
import Market from "../../../models/Markets";
import { fetchMergedBook, fetchPriceHistory } from "../../../services/polymarket";

const router = Router();

router.get("/", async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 20, 1), 100);
        const offset = Math.max(parseInt(req.query.offset as string, 10) || 0, 0);

        const [markets, total] = await Promise.all([
            Market.find({}, { __v: 0 }).sort({ syncedAt: -1 }).skip(offset).limit(limit).lean(),
            Market.countDocuments(),
        ]);

        res.json({ markets, total, limit, offset });
    } catch (err) {
        console.error("[markets] Error fetching markets:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.get("/:conditionId", async (req, res) => {
    try {
        const market = await Market.findOne(
            { conditionId: req.params.conditionId },
            { __v: 0 },
        ).lean();

        if (!market) {
            res.status(404).json({ error: "Market not found" });
            return;
        }

        res.json(market);
    } catch (err) {
        console.error("[markets] Error fetching market:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.get("/:conditionId/prices", async (req, res) => {
    try {
        const { interval = "all", fidelity = "60" } = req.query;
        const data = await fetchPriceHistory(
            req.params.conditionId,
            interval as string,
            Number(fidelity),
        );

        if (!data) {
            res.status(404).json({ error: "Market not found" });
            return;
        }

        res.json(data);
    } catch (err) {
        console.error("[markets] Error fetching price history:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.get("/:conditionId/book", async (req, res) => {
    try {
        const book = await fetchMergedBook(req.params.conditionId);

        if (!book) {
            res.status(404).json({ error: "Market not found" });
            return;
        }

        res.json(book);
    } catch (err) {
        console.error("[markets] Error fetching order book:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

export default router;

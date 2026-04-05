import { Router } from "express";
import { authRequired } from "../../middleware";
import Position from "../../../models/Positions";
import { closePosition } from "../../../services/trade";

const router = Router();

router.get("/", authRequired, async (req, res) => {
    try {
        const statusParam = (req.query.status as string) || "open";

        const filter: Record<string, unknown> = { wallet: req.user!.wallet };
        if (statusParam !== "all") {
            filter.status = statusParam;
        }

        const positions = await Position.find(filter).sort({ createdAt: -1 }).lean();
        res.json(positions);
    } catch (err) {
        console.error("[positions] Error fetching positions:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.post("/:id/close", authRequired, async (req, res) => {
    try {
        const position = await closePosition(req.params.id as string, req.user!.wallet);
        res.json(position);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to close position";
        console.error("[positions] Close error:", msg);
        res.status(500).json({ error: msg });
    }
});

export default router;

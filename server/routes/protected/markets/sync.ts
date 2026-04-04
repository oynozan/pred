import { Router } from "express";
import Market from "../../../models/Markets";

const router = Router();

interface SyncToken {
    tokenId: string;
    outcome: string;
    price: number;
}

interface SyncMarket {
    conditionId: string;
    question: string;
    slug: string;
    endDate: string;
    tokens: SyncToken[];
}

function toTokensObject(tokens: SyncToken[]) {
    const yes = tokens.find((t) => t.outcome === "Yes")!;
    const no = tokens.find((t) => t.outcome === "No")!;
    return {
        Yes: { tokenId: yes.tokenId, price: yes.price },
        No: { tokenId: no.tokenId, price: no.price },
    };
}

interface SyncPayload {
    syncedAt: number;
    marketCount: number;
    markets: SyncMarket[];
}

router.post("/", async (req, res) => {
    try {
        const payload = req.body as SyncPayload;

        if (!payload.markets || !Array.isArray(payload.markets)) {
            res.status(400).json({ error: "Invalid payload: missing markets array" });
            return;
        }

        const syncedAt = new Date(payload.syncedAt * 1000);

        console.log(
            `[market-sync] Received ${payload.marketCount} markets (synced at ${syncedAt.toISOString()})`,
        );

        const ops = payload.markets.map((m) => ({
            updateOne: {
                filter: { conditionId: m.conditionId },
                update: {
                    $set: {
                        question: m.question,
                        slug: m.slug,
                        endDate: new Date(m.endDate),
                        tokens: toTokensObject(m.tokens),
                        syncedAt,
                    },
                },
                upsert: true,
            },
        }));

        const result = await Market.bulkWrite(ops);

        console.log(
            `[market-sync] Upserted ${result.upsertedCount} new, modified ${result.modifiedCount} existing`,
        );

        res.status(200).json({
            ok: true,
            received: payload.marketCount,
            upserted: result.upsertedCount,
            modified: result.modifiedCount,
        });
    } catch (err) {
        console.error("[market-sync] Error processing payload:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

export default router;

import type { Server } from "socket.io";
import Position from "../models/Positions";
import { getUserMargin } from "../services/vault";

let _io: Server | null = null;

export function setIO(io: Server) {
    _io = io;
}

export async function broadcastPositionUpdate(wallet: string): Promise<void> {
    if (!_io) return;

    try {
        const positions = await Position.find({ wallet, status: "open" })
            .sort({ createdAt: -1 })
            .lean();
        _io.to(`wallet:${wallet}`).emit("positions:update", positions);
    } catch (err) {
        console.error("[broadcast] Failed to broadcast position update:", err);
    }
}

export async function broadcastMarginUpdate(wallet: string): Promise<void> {
    if (!_io) return;

    try {
        const margin = await getUserMargin(wallet);
        _io.to(`wallet:${wallet}`).emit("margin:update", margin);
    } catch (err) {
        console.error("[broadcast] Failed to broadcast margin update:", err);
    }
}

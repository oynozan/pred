"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { Position } from "@/lib/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL!;

const tabs = ["Positions", "Open Orders", "Trade History", "Order History"];

export function PositionsTable() {
    const [positions, setPositions] = useState<Position[]>([]);

    useEffect(() => {
        async function fetchPositions() {
            try {
                const res = await fetch(`${API_URL}/positions`, {
                    credentials: "include",
                });
                if (res.ok) setPositions(await res.json());
            } catch {
                /* ignore */
            }
        }
        fetchPositions();
    }, []);

    return (
        <div className="h-full bg-(--surface) overflow-auto">
            <div className="flex items-center gap-1 px-3 pt-1.5 border-b border-border">
                {tabs.map((tab) => (
                    <button
                        key={tab}
                        className={cn(
                            "px-3 py-1.5 text-xs transition-colors",
                            tab === "Positions"
                                ? "text-foreground border-b-2 border-primary"
                                : "text-muted-foreground hover:text-foreground",
                        )}
                    >
                        {tab}
                    </button>
                ))}
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                    <thead>
                        <tr className="text-muted-foreground border-b border-border">
                            <th className="text-left px-3 py-1.5 font-normal">Outcome</th>
                            <th className="text-left px-3 py-1.5 font-normal">Market</th>
                            <th className="text-right px-3 py-1.5 font-normal">Shares</th>
                            <th className="text-right px-3 py-1.5 font-normal">Position Value</th>
                            <th className="text-right px-3 py-1.5 font-normal">Entry Price</th>
                            <th className="text-right px-3 py-1.5 font-normal">Liq. Price</th>
                            <th className="text-right px-3 py-1.5 font-normal">Close</th>
                        </tr>
                    </thead>
                    <tbody>
                        {positions.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={7}
                                    className="px-3 py-6 text-center text-muted-foreground"
                                >
                                    No open positions
                                </td>
                            </tr>
                        ) : (
                            positions.map((pos) => (
                                <tr
                                    key={pos._id}
                                    className="border-b border-border hover:bg-card/50 transition-colors"
                                >
                                    <td className="px-3 py-1.5">
                                        <span
                                            className={cn(
                                                "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium",
                                                pos.outcome === "Yes"
                                                    ? "bg-success/15 text-success"
                                                    : "bg-loss/15 text-loss",
                                            )}
                                        >
                                            {pos.outcome}{" "}
                                            <span className="text-[9px]">{pos.leverage}</span>
                                        </span>
                                    </td>
                                    <td className="px-3 py-1.5 text-foreground max-w-[200px] truncate">
                                        {pos.conditionId.slice(0, 10)}...
                                    </td>
                                    <td className="px-3 py-1.5 text-right text-foreground">
                                        {pos.shares.toLocaleString("en-US", {
                                            minimumFractionDigits: 2,
                                        })}
                                    </td>
                                    <td className="px-3 py-1.5 text-right text-foreground">
                                        ${pos.positionValue.toFixed(2)}
                                    </td>
                                    <td className="px-3 py-1.5 text-right text-foreground">
                                        {pos.entryPrice}¢
                                    </td>
                                    <td className="px-3 py-1.5 text-right text-foreground">
                                        {pos.liqPrice}¢
                                    </td>
                                    <td className="px-3 py-1.5 text-right">
                                        <div className="flex items-center justify-end gap-1">
                                            <button className="px-2 py-0.5 text-[10px] rounded bg-primary/15 text-primary hover:bg-primary/25 transition-colors">
                                                Market
                                            </button>
                                            <button className="px-2 py-0.5 text-[10px] rounded bg-card text-muted-foreground hover:text-foreground transition-colors">
                                                Limit
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

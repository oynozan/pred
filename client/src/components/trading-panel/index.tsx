"use client";

import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { useMarketData } from "@/contexts/market-data";
import type { Market } from "@/lib/types";

interface TradingPanelProps {
    market: Market;
}

export function TradingPanel({ market }: TradingPanelProps) {
    const [sliderValue, setSliderValue] = useState(50);
    const { book } = useMarketData();

    const liveYes = book?.last_trade_price ? parseFloat(book.last_trade_price) : null;
    const yesPrice = liveYes !== null ? Math.round(liveYes * 100) : Math.round(market.tokens.Yes.price * 100);
    const noPrice = 100 - yesPrice;

    return (
        <div className="flex flex-col h-full bg-(--surface) overflow-y-auto">
            <div className="flex items-center gap-0 border-b border-border">
                <div className="flex items-center gap-1 px-2 py-2">
                    <span className="text-[10px] font-semibold text-primary bg-primary/15 px-5 py-0.5 rounded">
                        5x
                    </span>
                </div>
            </div>

            <div className="p-3 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                    <button className="py-2 text-xs rounded bg-success text-white font-medium">
                        Yes {yesPrice}¢
                    </button>
                    <button className="py-2 text-xs rounded bg-card text-muted-foreground border border-border hover:text-foreground transition-colors">
                        No {noPrice}¢
                    </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <label className="text-[10px] text-muted-foreground mb-1 block">
                            Buy Amount
                        </label>
                        <input
                            type="text"
                            defaultValue="2,370"
                            className="w-full bg-card border border-border rounded px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary/50 transition-colors"
                        />
                    </div>
                    <div>
                        <label className="text-[10px] text-muted-foreground mb-1 block">
                            Contract
                        </label>
                        <input
                            type="text"
                            defaultValue="2,925"
                            className="w-full bg-card border border-border rounded px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary/50 transition-colors"
                        />
                    </div>
                </div>

                <div className="space-y-2">
                    <div className="relative h-1.5 bg-card rounded-full">
                        <div
                            className="absolute h-full bg-primary rounded-full"
                            style={{ width: `${sliderValue}%` }}
                        />
                        <input
                            type="range"
                            min={0}
                            max={100}
                            value={sliderValue}
                            onChange={(e) => setSliderValue(Number(e.target.value))}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        />
                        <div
                            className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-primary border-2 border-(--surface) pointer-events-none"
                            style={{ left: `calc(${sliderValue}% - 7px)` }}
                        />
                    </div>
                    <div className="flex justify-between text-[9px] text-muted-foreground">
                        {["0%", "25%", "50%", "75%", "100%"].map((label) => (
                            <span key={label}>{label}</span>
                        ))}
                    </div>
                </div>

                <div className="space-y-1.5">
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Checkbox className="w-3.5 h-3.5 border-muted-foreground data-checked:bg-primary data-checked:border-primary" />
                        TP/SL
                    </label>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Checkbox className="w-3.5 h-3.5 border-muted-foreground data-checked:bg-primary data-checked:border-primary" />
                        Fluctuation Guard
                    </label>
                </div>

                <button className="w-full py-2.5 text-sm font-medium rounded bg-success hover:bg-success/90 text-white transition-colors">
                    Trade
                </button>

                <div className="space-y-1 text-[11px]">
                    {[
                        ["Estimated Liquidation", "65¢"],
                        ["Order Value", "$2,370"],
                        ["Margin Requirement", "$475"],
                        ["Collateral Insurance", "$29"],
                        ["Fees", "$11.85"],
                        ["Margin Fees", "0.00019% / hour"],
                    ].map(([label, value]) => (
                        <div key={label} className="flex justify-between">
                            <span className="text-muted-foreground">{label}</span>
                            <span className="text-foreground">{value}</span>
                        </div>
                    ))}
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1">
                    <button className="py-1.5 text-xs rounded border border-border text-muted-foreground hover:text-foreground transition-colors">
                        Spot ⇄ Margin
                    </button>
                    <button className="py-1.5 text-xs rounded border border-border text-muted-foreground hover:text-foreground transition-colors">
                        Withdraw
                    </button>
                </div>

                <div className="space-y-1 text-[11px] pt-1">
                    {[
                        ["Available Margin", "$700"],
                        ["Current Position", "$303"],
                        ["Margin Account Value", "$1,093"],
                        ["Spot Account Value", "$2,512"],
                    ].map(([label, value]) => (
                        <div key={label} className="flex justify-between">
                            <span className="text-muted-foreground">{label}</span>
                            <span className="text-foreground">{value}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createChart, AreaSeries, type IChartApi, type UTCTimestamp } from "lightweight-charts";
import { cn } from "@/lib/utils";
import type { PricePoint } from "@/lib/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL!;

const periods = ["1H", "6H", "1D", "1W", "1M", "ALL"] as const;

const intervalMap: Record<string, string> = {
    "1H": "1h",
    "6H": "6h",
    "1D": "1d",
    "1W": "1w",
    "1M": "1m",
    ALL: "all",
};

interface PriceChartProps {
    conditionId: string;
}

export function PriceChart({ conditionId }: PriceChartProps) {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const [activePeriod, setActivePeriod] = useState<(typeof periods)[number]>("ALL");
    const [lastPrice, setLastPrice] = useState<number | null>(null);

    const fetchAndRender = useCallback(
        async (interval: string) => {
            if (!chartContainerRef.current) return;

            try {
                const res = await fetch(
                    `${API_URL}/markets/${conditionId}/prices?interval=${interval}&fidelity=60`,
                );
                if (!res.ok) return;

                const data = await res.json();
                const history: PricePoint[] = data.history ?? [];

                if (history.length === 0) return;

                if (chartRef.current) {
                    chartRef.current.remove();
                    chartRef.current = null;
                }

                const chart = createChart(chartContainerRef.current, {
                    layout: {
                        background: { color: "transparent" },
                        textColor: "#999",
                        fontSize: 10,
                        fontFamily: "inherit",
                    },
                    grid: {
                        vertLines: { color: "rgba(255,255,255,0.03)" },
                        horzLines: { color: "rgba(255,255,255,0.03)" },
                    },
                    crosshair: {
                        vertLine: { color: "rgba(255,255,255,0.1)", width: 1, style: 3 },
                        horzLine: { color: "rgba(255,255,255,0.1)", width: 1, style: 3 },
                    },
                    rightPriceScale: {
                        borderColor: "rgba(255,255,255,0.05)",
                        textColor: "#999",
                        minimumWidth: 50,
                    },
                    timeScale: {
                        borderColor: "rgba(255,255,255,0.05)",
                        timeVisible: interval === "1h" || interval === "6h",
                    },
                    handleScroll: true,
                    handleScale: true,
                });

                const areaSeries = chart.addSeries(AreaSeries, {
                    lineColor: "#82d173",
                    topColor: "rgba(130,209,115,0.3)",
                    bottomColor: "rgba(130,209,115,0.0)",
                    lineWidth: 2,
                    priceFormat: {
                        type: "custom",
                        formatter: (p: number) => `${Math.round(p)}%`,
                    },
                });

                const mapped = history.map((d) => ({
                    time: d.t as UTCTimestamp,
                    value: d.p * 100,
                }));

                areaSeries.setData(mapped);
                chart.timeScale().fitContent();
                chartRef.current = chart;

                const last = mapped[mapped.length - 1];
                if (last) setLastPrice(Math.round(last.value));
            } catch (err) {
                console.error("[price-chart] fetch error:", err);
            }
        },
        [conditionId],
    );

    useEffect(() => {
        fetchAndRender(intervalMap[activePeriod]);
    }, [activePeriod, fetchAndRender]);

    useEffect(() => {
        if (!chartContainerRef.current || !chartRef.current) return;

        const observer = new ResizeObserver(() => {
            if (chartContainerRef.current && chartRef.current) {
                chartRef.current.applyOptions({
                    width: chartContainerRef.current.clientWidth,
                    height: chartContainerRef.current.clientHeight,
                });
            }
        });

        observer.observe(chartContainerRef.current);
        return () => observer.disconnect();
    }, [lastPrice]);

    return (
        <div className="flex flex-col h-full bg-(--surface)">
            <div className="flex items-center gap-1 px-3 pt-2 pb-1 border-b border-border">
                <button className="px-3 py-1 text-xs rounded bg-card text-foreground">
                    Chart
                </button>
            </div>

            <div className="flex-1 relative min-h-0">
                <div ref={chartContainerRef} className="absolute inset-0" />
            </div>

            <div className="flex items-center justify-between px-3 py-1.5 border-t border-border">
                <div className="flex items-center gap-1.5">
                    {lastPrice !== null && (
                        <>
                            <span className="w-2 h-2 rounded-full bg-success" />
                            <span className="text-xs text-muted-foreground">
                                {lastPrice}% chance
                            </span>
                        </>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    {periods.map((p) => (
                        <button
                            key={p}
                            onClick={() => setActivePeriod(p)}
                            className={cn(
                                "px-2 py-0.5 text-[10px] rounded transition-colors",
                                p === activePeriod
                                    ? "bg-card text-foreground"
                                    : "text-muted-foreground hover:text-foreground",
                            )}
                        >
                            {p}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}

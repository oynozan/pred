import Link from "next/link";
import type { Market } from "@/lib/types";

interface MarketCardProps {
    market: Market;
}

function formatEndDate(iso: string) {
    const date = new Date(iso);
    const now = new Date();
    const days = Math.ceil((date.getTime() - now.getTime()) / 86_400_000);

    if (days < 0) return "Ended";
    if (days === 0) return "Today";
    if (days === 1) return "Tomorrow";
    if (days <= 30) return `${days}d`;

    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function MarketCard({ market }: MarketCardProps) {
    const yesPrice = Math.round(market.tokens.Yes.price * 100);
    const noPrice = Math.round(market.tokens.No.price * 100);

    return (
        <Link
            href={`/trade/${market.slug}`}
            className="flex flex-col bg-card rounded-xl border border-white/6 p-4 transition-all hover:border-white/15 hover:bg-white/4"
        >
            <div className="flex items-start justify-between gap-4 mb-5">
                <h3 className="text-[13px] font-medium text-foreground leading-[1.4] line-clamp-2">
                    {market.question}
                </h3>
                <div className="shrink-0 text-right">
                    <div className="text-lg font-bold text-foreground tabular-nums leading-none">
                        {yesPrice}%
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">chance</div>
                </div>
            </div>

            <div className="mt-auto">
                <div className="flex items-center gap-2 mb-3">
                    <div className="flex-1 h-1 rounded-full bg-white/6 overflow-hidden">
                        <div
                            className="h-full rounded-full bg-success transition-all"
                            style={{ width: `${yesPrice}%` }}
                        />
                    </div>
                </div>

                <div className="flex items-center gap-1.5">
                    <span className="inline-flex items-center justify-center h-7 px-3 rounded-md bg-success/10 text-success text-[11px] font-semibold tabular-nums">
                        Yes {yesPrice}¢
                    </span>
                    <span className="inline-flex items-center justify-center h-7 px-3 rounded-md bg-loss/10 text-loss text-[11px] font-semibold tabular-nums">
                        No {noPrice}¢
                    </span>
                    <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
                        {formatEndDate(market.endDate)}
                    </span>
                </div>
            </div>
        </Link>
    );
}

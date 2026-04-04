"use client";

import { useMarketData } from "@/contexts/market-data";

interface BookRow {
    price: number;
    size: number;
    total: number;
}

function formatPrice(price: number) {
    return `${Math.round(price * 100)}¢`;
}

function formatSize(n: number) {
    return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatTotal(n: number) {
    return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function toRows(levels: { price: string; size: string }[]): BookRow[] {
    let cumulative = 0;
    return levels.map((l) => {
        const price = parseFloat(l.price);
        const size = parseFloat(l.size);
        cumulative += price * size;
        return { price, size, total: cumulative };
    });
}

export function OrderBook() {
    const { book, connected } = useMarketData();

    const rawAsks = book ? book.asks.slice(0, 8) : [];
    const asks = toRows(rawAsks);

    const rawBids = book ? book.bids.slice(0, 8) : [];
    const bids = toRows(rawBids);

    const maxAskTotal = Math.max(...asks.map((r) => r.total), 1);
    const maxBidTotal = Math.max(...bids.map((r) => r.total), 1);

    return (
        <div className="flex flex-col h-full bg-(--surface)">
            <div className="flex items-center gap-4 px-3 pt-2 pb-1 border-b border-border">
                <button className="text-xs text-foreground border-b-2 border-primary pb-1">
                    Order Book
                </button>
                <button className="text-xs text-muted-foreground hover:text-foreground transition-colors pb-1">
                    Trades
                </button>
                {!connected && (
                    <span className="ml-auto text-[10px] text-yellow-500">reconnecting…</span>
                )}
            </div>

            <div className="flex-1 overflow-auto min-h-0">
                <div className="grid grid-cols-3 px-3 py-1 text-[10px] text-muted-foreground sticky top-0 bg-(--surface) z-10">
                    <span>Price</span>
                    <span className="text-right">Size</span>
                    <span className="text-right">Total</span>
                </div>

                {asks
                    .slice()
                    .reverse()
                    .map((entry, i) => {
                        const fillPercent = (entry.total / maxAskTotal) * 100;
                        return (
                            <div
                                key={`ask-${i}`}
                                className="grid grid-cols-3 px-3 py-[3px] text-[11px] relative"
                            >
                                <div
                                    className="absolute inset-0 bg-loss/8 origin-right"
                                    style={{ width: `${fillPercent}%`, marginLeft: "auto" }}
                                />
                                <span className="relative text-loss">
                                    {formatPrice(entry.price)}
                                </span>
                                <span className="relative text-right text-foreground">
                                    {formatSize(entry.size)}
                                </span>
                                <span className="relative text-right text-muted-foreground">
                                    {formatTotal(entry.total)}
                                </span>
                            </div>
                        );
                    })}

                {book && (
                    <div className="grid grid-cols-3 px-3 py-1.5 text-[10px] border-y border-border bg-card">
                        <span className="text-foreground">
                            {book.last_trade_price
                                ? `${Math.round(parseFloat(book.last_trade_price) * 100)}¢`
                                : "—"}
                        </span>
                        <span className="text-right text-muted-foreground">Last</span>
                        <span className="text-right text-muted-foreground" />
                    </div>
                )}

                {bids.map((entry, i) => {
                    const fillPercent = (entry.total / maxBidTotal) * 100;
                    return (
                        <div
                            key={`bid-${i}`}
                            className="grid grid-cols-3 px-3 py-[3px] text-[11px] relative"
                        >
                            <div
                                className="absolute inset-0 bg-success/8 origin-right"
                                style={{ width: `${fillPercent}%`, marginLeft: "auto" }}
                            />
                            <span className="relative text-success">
                                {formatPrice(entry.price)}
                            </span>
                            <span className="relative text-right text-foreground">
                                {formatSize(entry.size)}
                            </span>
                            <span className="relative text-right text-muted-foreground">
                                {formatTotal(entry.total)}
                            </span>
                        </div>
                    );
                })}
            </div>

            <div className="flex items-center gap-2 px-3 py-1.5 border-t border-border">
                <button className="flex-1 py-1 text-xs rounded bg-success/15 text-success hover:bg-success/25 transition-colors">
                    Yes
                </button>
                <button className="flex-1 py-1 text-xs rounded bg-loss/15 text-loss hover:bg-loss/25 transition-colors">
                    No
                </button>
            </div>
        </div>
    );
}

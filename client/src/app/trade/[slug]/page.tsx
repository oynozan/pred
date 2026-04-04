import { notFound } from "next/navigation";
import { getMarketBySlug } from "@/lib/api";
import { MarketHeader } from "@/components/market-header";
import { TradingLayout } from "@/components/trading-layout";

interface TradePageProps {
    params: Promise<{ slug: string }>;
}

export default async function TradePage({ params }: TradePageProps) {
    const { slug } = await params;
    const market = await getMarketBySlug(slug);

    if (!market) notFound();

    return (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <MarketHeader market={market} />
            <TradingLayout market={market} />
        </div>
    );
}

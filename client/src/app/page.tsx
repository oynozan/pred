import { getMarkets } from "@/lib/api";
import { MarketCard } from "@/components/market-card";

export default async function Home() {
    const markets = await getMarkets();

    if (markets.length === 0) {
        return (
            <div className="flex flex-1 items-center justify-center">
                <p className="text-sm text-muted-foreground">No markets available.</p>
            </div>
        );
    }

    return (
        <div className="flex-1 w-full max-w-[1440px] mx-auto px-5 py-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
                {markets.map((market) => (
                    <MarketCard key={market._id} market={market} />
                ))}
            </div>
        </div>
    );
}

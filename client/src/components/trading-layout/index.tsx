"use client";

import { useMediaQuery } from "@/hooks/use-media-query";
import {
    ResizablePanelGroup,
    ResizablePanel,
    ResizableHandle,
} from "@/components/ui/resizable";
import { PriceChart } from "@/components/price-chart";
import { OrderBook } from "@/components/order-book";
import { TradingPanel } from "@/components/trading-panel";
import { PositionsTable } from "@/components/positions-table";
import { MarketDataProvider } from "@/contexts/market-data";
import type { Market } from "@/lib/types";

interface TradingLayoutProps {
    market: Market;
}

function DesktopLayout({ market }: TradingLayoutProps) {
    return (
        <ResizablePanelGroup orientation="vertical" className="flex-1">
            <ResizablePanel defaultSize={75} minSize={40}>
                <ResizablePanelGroup orientation="horizontal">
                    <ResizablePanel defaultSize={50} minSize={30}>
                        <PriceChart conditionId={market.conditionId} />
                    </ResizablePanel>
                    <ResizableHandle />
                    <ResizablePanel defaultSize={22} minSize={15}>
                        <OrderBook />
                    </ResizablePanel>
                    <ResizableHandle />
                    <ResizablePanel defaultSize={28} minSize={20}>
                        <TradingPanel market={market} />
                    </ResizablePanel>
                </ResizablePanelGroup>
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel defaultSize={25} minSize={15}>
                <PositionsTable />
            </ResizablePanel>
        </ResizablePanelGroup>
    );
}

function TabletLayout({ market }: TradingLayoutProps) {
    return (
        <ResizablePanelGroup orientation="vertical" className="flex-1">
            <ResizablePanel defaultSize={45} minSize={25}>
                <PriceChart conditionId={market.conditionId} />
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel defaultSize={30} minSize={20}>
                <ResizablePanelGroup orientation="horizontal">
                    <ResizablePanel defaultSize={45} minSize={30}>
                        <OrderBook />
                    </ResizablePanel>
                    <ResizableHandle />
                    <ResizablePanel defaultSize={55} minSize={35}>
                        <TradingPanel market={market} />
                    </ResizablePanel>
                </ResizablePanelGroup>
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel defaultSize={25} minSize={15}>
                <PositionsTable />
            </ResizablePanel>
        </ResizablePanelGroup>
    );
}

function MobileLayout({ market }: TradingLayoutProps) {
    return (
        <div className="flex-1 flex flex-col overflow-y-auto">
            <div className="h-[300px] shrink-0">
                <PriceChart conditionId={market.conditionId} />
            </div>
            <div className="h-[350px] shrink-0">
                <OrderBook />
            </div>
            <div className="shrink-0">
                <TradingPanel market={market} />
            </div>
            <div className="shrink-0">
                <PositionsTable />
            </div>
        </div>
    );
}

export function TradingLayout({ market }: TradingLayoutProps) {
    const isDesktop = useMediaQuery("(min-width: 1024px)");
    const isTablet = useMediaQuery("(min-width: 768px)");

    if (isDesktop === undefined || isTablet === undefined) {
        return <div className="flex-1 bg-(--surface)" />;
    }

    return (
        <MarketDataProvider conditionId={market.conditionId}>
            {isDesktop ? (
                <DesktopLayout market={market} />
            ) : isTablet ? (
                <TabletLayout market={market} />
            ) : (
                <MobileLayout market={market} />
            )}
        </MarketDataProvider>
    );
}

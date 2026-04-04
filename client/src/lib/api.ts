import type { Market, PricePoint, OrderBookData, Position } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL!;

export async function getMarkets(): Promise<Market[]> {
    try {
        const res = await fetch(`${API_URL}/markets`, {
            next: { revalidate: 60 },
        });

        if (!res.ok) return [];

        return res.json();
    } catch (error) {
        console.error("Failed to fetch markets:", error);
        return [];
    }
}

export async function getMarketBySlug(slug: string): Promise<Market | null> {
    try {
        const markets = await getMarkets();
        return markets.find((m) => m.slug === slug) ?? null;
    } catch {
        return null;
    }
}

export async function getPriceHistory(
    conditionId: string,
    interval: string = "all",
    fidelity: number = 60,
): Promise<PricePoint[]> {
    try {
        const res = await fetch(
            `${API_URL}/markets/${conditionId}/prices?interval=${interval}&fidelity=${fidelity}`,
            { next: { revalidate: 30 } },
        );

        if (!res.ok) return [];

        const data = await res.json();
        return data.history ?? [];
    } catch {
        return [];
    }
}

export async function getOrderBook(conditionId: string): Promise<OrderBookData | null> {
    try {
        const res = await fetch(`${API_URL}/markets/${conditionId}/book`, {
            cache: "no-store",
        });

        if (!res.ok) return null;

        return res.json();
    } catch {
        return null;
    }
}

export async function getPositions(): Promise<Position[]> {
    try {
        const res = await fetch(`${API_URL}/positions`, {
            cache: "no-store",
            credentials: "include",
        });

        if (!res.ok) return [];

        return res.json();
    } catch {
        return [];
    }
}

export interface TokenSide {
    tokenId: string;
    price: number;
}

export interface Market {
    _id: string;
    conditionId: string;
    question: string;
    slug: string;
    endDate: string;
    tokens: {
        Yes: TokenSide;
        No: TokenSide;
    };
    syncedAt: string;
    createdAt: string;
    updatedAt: string;
}

export interface PricePoint {
    t: number;
    p: number;
}

export interface OrderBookLevel {
    price: string;
    size: string;
}

export interface OrderBookData {
    market: string;
    asset_id: string;
    bids: OrderBookLevel[];
    asks: OrderBookLevel[];
    last_trade_price: string;
    spread: string;
}

export interface Position {
    _id: string;
    conditionId: string;
    outcome: "Yes" | "No";
    leverage: string;
    shares: number;
    entryPrice: number;
    positionValue: number;
    liqPrice: number;
    status: "open" | "closed";
    createdAt: string;
    updatedAt: string;
}

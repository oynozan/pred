"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import type { OrderBookData } from "@/lib/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL!;

interface MarketDataContextValue {
    book: OrderBookData | null;
    connected: boolean;
}

const MarketDataContext = createContext<MarketDataContextValue>({
    book: null,
    connected: false,
});

export function useMarketData() {
    return useContext(MarketDataContext);
}

interface MarketDataProviderProps {
    conditionId: string;
    children: ReactNode;
}

export function MarketDataProvider({ conditionId, children }: MarketDataProviderProps) {
    const socketRef = useRef<Socket | null>(null);
    const [book, setBook] = useState<OrderBookData | null>(null);
    const [connected, setConnected] = useState(false);

    useEffect(() => {
        const socket = io(`${API_URL}/markets`, {
            transports: ["websocket"],
        });

        socketRef.current = socket;

        socket.on("connect", () => {
            console.log("[market-data] socket connected:", socket.id);
            setConnected(true);
            socket.emit("subscribe:book", conditionId);
        });

        socket.on("book:update", (data: OrderBookData) => {
            setBook(data);
        });

        socket.on("disconnect", () => {
            console.log("[market-data] socket disconnected");
            setConnected(false);
        });

        socket.on("connect_error", (err) => {
            console.error("[market-data] connect error:", err.message);
        });

        return () => {
            socket.emit("unsubscribe:book");
            socket.disconnect();
            socketRef.current = null;
        };
    }, [conditionId]);

    return (
        <MarketDataContext.Provider value={{ book, connected }}>
            {children}
        </MarketDataContext.Provider>
    );
}

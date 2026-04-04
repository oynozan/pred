import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean | undefined {
    const [matches, setMatches] = useState<boolean | undefined>(undefined);

    useEffect(() => {
        const mql = window.matchMedia(query);
        setMatches(mql.matches);

        const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
        mql.addEventListener("change", handler);
        return () => mql.removeEventListener("change", handler);
    }, [query]);

    return matches;
}

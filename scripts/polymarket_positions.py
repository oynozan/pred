"""
Query Polymarket positions (YES/NO tokens) for a wallet on a specific market or event.

Usage:
    python polymarket_positions.py <wallet_address> <slug_or_condition_id>

Requires: pip install requests
"""

import sys

try:
    import requests
except ImportError:
    print("Missing dependency: requests\nInstall with: pip install requests")
    sys.exit(1)

DATA_API = "https://data-api.polymarket.com"
GAMMA_API = "https://gamma-api.polymarket.com"


def is_condition_id(value: str) -> bool:
    return value.startswith("0x") and len(value) == 66


def resolve_slug(slug: str) -> dict:
    """
    Resolve a slug to either a single market (condition ID) or an event (event ID).
    Returns {"type": "market", "conditionId": ...} or {"type": "event", "eventId": ..., "markets": [...]}.
    """
    resp = requests.get(f"{GAMMA_API}/markets", params={"slug": slug})
    resp.raise_for_status()
    markets = resp.json()
    if markets:
        m = markets[0]
        return {
            "type": "market",
            "conditionId": m["conditionId"],
            "title": m.get("question", slug),
            "clobTokenIds": m.get("clobTokenIds"),
            "outcomes": m.get("outcomes"),
        }

    resp = requests.get(f"{GAMMA_API}/events", params={"slug": slug})
    resp.raise_for_status()
    events = resp.json()
    if events:
        event = events[0]
        return {
            "type": "event",
            "eventId": event["id"],
            "title": event.get("title", slug),
            "markets": event.get("markets", []),
        }

    print(f"Error: No market or event found for slug '{slug}'")
    sys.exit(1)


def fetch_positions_by_market(wallet: str, condition_id: str) -> list:
    resp = requests.get(
        f"{DATA_API}/positions",
        params={"user": wallet, "market": condition_id, "sizeThreshold": 0},
    )
    resp.raise_for_status()
    return resp.json()


def fetch_positions_by_event(wallet: str, event_id: str) -> list:
    resp = requests.get(
        f"{DATA_API}/positions",
        params={"user": wallet, "eventId": event_id, "sizeThreshold": 0},
    )
    resp.raise_for_status()
    return resp.json()


def parse_json_field(val):
    if isinstance(val, str):
        import json
        try:
            return json.loads(val)
        except Exception:
            return []
    return val or []


def display_positions(positions: list, wallet: str, event_markets: list | None = None) -> None:
    if not positions:
        print(f"\nNo positions found for wallet {wallet} on this market/event.")
        return

    token_id_map = {}
    if event_markets:
        for m in event_markets:
            clob_ids = parse_json_field(m.get("clobTokenIds"))
            outcomes = parse_json_field(m.get("outcomes"))
            cond = m.get("conditionId", "")
            question = m.get("question", "")
            for i, tid in enumerate(clob_ids):
                token_id_map[cond + "_" + (outcomes[i] if i < len(outcomes) else "?")] = tid

    grouped: dict[str, list] = {}
    for pos in positions:
        title = pos.get("title", "Unknown Market")
        grouped.setdefault(title, []).append(pos)

    print(f"\n{'=' * 80}")
    print(f"  Wallet: {wallet}")
    print(f"{'=' * 80}")

    for title, market_positions in grouped.items():
        cond_id = market_positions[0].get("conditionId", "")
        print(f"\n  Market: {title}")
        print(f"  Condition ID: {cond_id}")
        print()

        header = f"    {'Outcome':<6} {'Tokens':>12} {'Avg Price':>10} {'Cur Price':>10} {'Value':>10}   Token ID"
        print(header)
        print(f"    {'-' * 74}")

        for pos in market_positions:
            outcome = pos.get("outcome", "?")
            size = pos.get("size", 0)
            avg_price = pos.get("avgPrice", 0)
            cur_price = pos.get("curPrice", 0)
            current_value = pos.get("currentValue", 0)
            asset = pos.get("asset", "N/A")

            print(
                f"    {outcome:<6} {size:>12.4f} {avg_price:>9.4f}c {cur_price:>9.4f}c ${current_value:>9.2f}   {asset}"
            )

    print(f"\n{'=' * 80}\n")


def main() -> None:
    if len(sys.argv) >= 3:
        wallet = sys.argv[1]
        market_input = sys.argv[2]
    else:
        wallet = input("Wallet address: ").strip()
        market_input = input("Market (condition ID or slug): ").strip()

    if not wallet:
        print("Error: Wallet address is required.")
        sys.exit(1)
    if not market_input:
        print("Error: Market identifier is required.")
        sys.exit(1)

    if is_condition_id(market_input):
        positions = fetch_positions_by_market(wallet, market_input)
        display_positions(positions, wallet)
    else:
        resolved = resolve_slug(market_input)
        if resolved["type"] == "market":
            positions = fetch_positions_by_market(wallet, resolved["conditionId"])
            display_positions(positions, wallet)
        else:
            positions = fetch_positions_by_event(wallet, resolved["eventId"])
            display_positions(positions, wallet, event_markets=resolved.get("markets"))


if __name__ == "__main__":
    main()

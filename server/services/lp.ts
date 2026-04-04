import { ethers } from "ethers";
import { getLPPoolAddress, lpPoolAbi, multicall } from "../lib/contracts";
import Market from "../models/Markets";

const lpIface = new ethers.Interface(lpPoolAbi as ethers.InterfaceAbi);

export interface PoolState {
    conditionId: string;
    question: string;
    slug: string;
    endDate: string;
    totalDeposited: string;
    totalBorrowed: string;
    availableLiquidity: string;
    totalShares: string;
    utilizationBps: string;
    interestRateBps: string;
    sharePrice: string;
}

export interface LPPosition {
    conditionId: string;
    question: string;
    slug: string;
    shares: string;
    currentValue: string;
    poolSharePct: string;
    apyBps: string;
}

export interface UserLPSummary {
    positions: LPPosition[];
    totalCurrentValue: string;
    weightedApyBps: string;
}

const BPS = 10000n;
const SHARE_PRECISION = BigInt(1e18);

interface RateParams {
    baseRate: bigint;
    kinkRate: bigint;
    maxRate: bigint;
    kinkUtilization: bigint;
}

let _rateParams: RateParams | null = null;
let _rateParamsTs = 0;

async function getRateParams(): Promise<RateParams> {
    if (_rateParams && Date.now() - _rateParamsTs < 300_000) return _rateParams;
    const target = getLPPoolAddress();
    const fns = ["baseRate", "kinkRate", "maxRate", "kinkUtilization"] as const;
    const calls = fns.map(fn => ({
        target,
        callData: lpIface.encodeFunctionData(fn),
    }));
    const raw = await multicall(calls);
    const vals = raw.map((r, i) => {
        if (!r.success) throw new Error(`Failed to read ${fns[i]}`);
        return BigInt(lpIface.decodeFunctionResult(fns[i], r.returnData)[0]);
    });
    _rateParams = {
        baseRate: vals[0],
        kinkRate: vals[1],
        maxRate: vals[2],
        kinkUtilization: vals[3],
    };
    _rateParamsTs = Date.now();
    return _rateParams;
}

function computeUtilizationBps(totalDeposited: bigint, totalBorrowed: bigint): bigint {
    if (totalDeposited === 0n) return 0n;
    return (totalBorrowed * BPS) / totalDeposited;
}

function computeInterestRate(utilBps: bigint, params: RateParams): bigint {
    if (utilBps <= params.kinkUtilization) {
        return params.baseRate + ((params.kinkRate - params.baseRate) * utilBps) / params.kinkUtilization;
    }
    return params.kinkRate
        + ((params.maxRate - params.kinkRate) * (utilBps - params.kinkUtilization))
        / (BPS - params.kinkUtilization);
}

function computeSharePrice(totalDeposited: bigint, totalShares: bigint): bigint {
    if (totalShares === 0n) return SHARE_PRECISION;
    return (totalDeposited * SHARE_PRECISION) / totalShares;
}

const POOLS_CACHE_TTL = 30_000; // 30 seconds
let _poolsCache: PoolState[] | null = null;
let _poolsCacheTs = 0;
let _poolsCachePromise: Promise<PoolState[]> | null = null;

function defaultPoolState(
    market: { conditionId: string; question: string; slug: string; endDate: Date },
    rateParams: RateParams,
): PoolState {
    return {
        conditionId: market.conditionId,
        question: market.question,
        slug: market.slug,
        endDate: market.endDate.toISOString(),
        totalDeposited: "0",
        totalBorrowed: "0",
        availableLiquidity: "0",
        totalShares: "0",
        utilizationBps: "0",
        interestRateBps: rateParams.baseRate.toString(),
        sharePrice: SHARE_PRECISION.toString(),
    };
}

function buildPoolState(
    market: { conditionId: string; question: string; slug: string; endDate: Date },
    state: { totalDeposited: bigint; totalBorrowed: bigint; availableLiquidity: bigint; totalShares: bigint },
    rateParams: RateParams,
): PoolState {
    const totalDeposited = BigInt(state.totalDeposited);
    const totalBorrowed = BigInt(state.totalBorrowed);
    const totalShares = BigInt(state.totalShares);

    const utilBps = computeUtilizationBps(totalDeposited, totalBorrowed);
    const rateBps = computeInterestRate(utilBps, rateParams);
    const price = computeSharePrice(totalDeposited, totalShares);

    return {
        conditionId: market.conditionId,
        question: market.question,
        slug: market.slug,
        endDate: market.endDate.toISOString(),
        totalDeposited: state.totalDeposited.toString(),
        totalBorrowed: state.totalBorrowed.toString(),
        availableLiquidity: state.availableLiquidity.toString(),
        totalShares: state.totalShares.toString(),
        utilizationBps: utilBps.toString(),
        interestRateBps: rateBps.toString(),
        sharePrice: price.toString(),
    };
}

async function fetchAllPoolsFromChain(): Promise<PoolState[]> {
    const target = getLPPoolAddress();
    const markets = await Market.find({}, { __v: 0 }).sort({ syncedAt: -1 }).lean();
    if (markets.length === 0) return [];

    let rateParams: RateParams;
    try {
        rateParams = await getRateParams();
    } catch {
        return markets.map(m => defaultPoolState(m, {
            baseRate: 200n, kinkRate: 2000n, maxRate: 10000n, kinkUtilization: 8000n,
        }));
    }

    const calls = markets.map(m => ({
        target,
        callData: lpIface.encodeFunctionData("getPoolState", [m.conditionId]),
    }));

    const raw = await multicall(calls);

    return markets.map((market, i) => {
        const r = raw[i];
        if (!r.success) return defaultPoolState(market, rateParams);
        try {
            const decoded = lpIface.decodeFunctionResult("getPoolState", r.returnData);
            return buildPoolState(market, {
                totalDeposited: decoded.totalDeposited,
                totalBorrowed: decoded.totalBorrowed,
                availableLiquidity: decoded.availableLiquidity,
                totalShares: decoded.totalShares,
            }, rateParams);
        } catch {
            return defaultPoolState(market, rateParams);
        }
    });
}

export async function getAllPools(): Promise<PoolState[]> {
    // Return cached data if fresh
    if (_poolsCache && Date.now() - _poolsCacheTs < POOLS_CACHE_TTL) {
        return _poolsCache;
    }

    if (!_poolsCachePromise) {
        _poolsCachePromise = fetchAllPoolsFromChain()
            .then(pools => {
                _poolsCache = pools;
                _poolsCacheTs = Date.now();
                _poolsCachePromise = null;
                return pools;
            })
            .catch(err => {
                _poolsCachePromise = null;
                // Return stale cache if available
                if (_poolsCache) return _poolsCache;
                throw err;
            });
    }

    return _poolsCachePromise;
}

export async function getPoolState(conditionId: string): Promise<PoolState | null> {
    const pools = await getAllPools();
    return pools.find(p => p.conditionId === conditionId) ?? null;
}

export function prewarmPoolsCache(): void {
    getAllPools().catch(err => console.error("[lp] Pre-warm failed:", err));
}

const USER_POS_CACHE_TTL = 10_000;
const _userPosCache = new Map<string, { data: UserLPSummary; ts: number }>();

export async function getUserPositions(address: string): Promise<UserLPSummary> {
    const cached = _userPosCache.get(address);
    if (cached && Date.now() - cached.ts < USER_POS_CACHE_TTL) return cached.data;

    const pools = await getAllPools();
    if (pools.length === 0) {
        return { positions: [], totalCurrentValue: "0", weightedApyBps: "0" };
    }

    let rateParams: RateParams;
    try {
        rateParams = await getRateParams();
    } catch {
        return { positions: [], totalCurrentValue: "0", weightedApyBps: "0" };
    }

    const target = getLPPoolAddress();
    const calls = pools.map(ps => ({
        target,
        callData: lpIface.encodeFunctionData("getUserPosition", [ps.conditionId, address]),
    }));

    const raw = await multicall(calls);

    const positions: LPPosition[] = [];
    let totalValue = 0n;
    let weightedRateSum = 0n;

    for (let i = 0; i < pools.length; i++) {
        const r = raw[i];
        if (!r.success) continue;
        try {
            const decoded = lpIface.decodeFunctionResult("getUserPosition", r.returnData);
            const userShares = BigInt(decoded.userShares);
            const usdcValue = BigInt(decoded.usdcValue);
            if (userShares === 0n) continue;

            const poolState = pools[i];
            const totalSharesBig = BigInt(poolState.totalShares);
            const utilBps = BigInt(poolState.utilizationBps);
            const rateBps = computeInterestRate(utilBps, rateParams);

            const poolSharePct =
                totalSharesBig > 0n
                    ? ((userShares * 10000n) / totalSharesBig).toString()
                    : "0";

            positions.push({
                conditionId: poolState.conditionId,
                question: poolState.question,
                slug: poolState.slug,
                shares: userShares.toString(),
                currentValue: usdcValue.toString(),
                poolSharePct,
                apyBps: rateBps.toString(),
            });

            totalValue += usdcValue;
            weightedRateSum += usdcValue * rateBps;
        } catch {
            continue;
        }
    }

    const weightedApyBps =
        totalValue > 0n ? (weightedRateSum / totalValue).toString() : "0";

    const result: UserLPSummary = {
        positions,
        totalCurrentValue: totalValue.toString(),
        weightedApyBps,
    };

    _userPosCache.set(address, { data: result, ts: Date.now() });
    return result;
}


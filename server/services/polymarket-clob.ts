import crypto from "crypto";
import { ethers } from "ethers";
import { proxyAxios } from "../lib/proxy-axios";

const CTF_EXCHANGE = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E";
const NEG_RISK_CTF_EXCHANGE = "0xC5d563A36AE78145C45a50134d48A1215220f80a";
const NEG_RISK_ADAPTER = "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296";

const COLLATERAL_DECIMALS = 6;

const CLOB_API = process.env.CLOB_API_URL || "https://clob.polymarket.com";

const EIP712_DOMAIN = {
    name: "Polymarket CTF Exchange",
    version: "1",
    chainId: 137,
    verifyingContract: CTF_EXCHANGE,
};

const NEG_RISK_EIP712_DOMAIN = {
    ...EIP712_DOMAIN,
    verifyingContract: NEG_RISK_CTF_EXCHANGE,
};

const ORDER_TYPES = {
    Order: [
        { name: "salt", type: "uint256" },
        { name: "maker", type: "address" },
        { name: "signer", type: "address" },
        { name: "taker", type: "address" },
        { name: "tokenId", type: "uint256" },
        { name: "makerAmount", type: "uint256" },
        { name: "takerAmount", type: "uint256" },
        { name: "expiration", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "feeRateBps", type: "uint256" },
        { name: "side", type: "uint8" },
        { name: "signatureType", type: "uint8" },
    ],
};

/* ---------- helpers ---------- */

const ROUNDING_CONFIG: Record<string, { price: number; size: number; amount: number }> = {
    "0.1": { price: 1, size: 2, amount: 3 },
    "0.01": { price: 2, size: 2, amount: 4 },
    "0.001": { price: 3, size: 2, amount: 5 },
    "0.0001": { price: 4, size: 2, amount: 6 },
};

function roundDown(num: number, decimals: number): number {
    if (Number.isInteger(num)) return num;
    return Math.floor(num * 10 ** decimals) / 10 ** decimals;
}

function roundUp(num: number, decimals: number): number {
    if (Number.isInteger(num)) return num;
    return Math.ceil(num * 10 ** decimals) / 10 ** decimals;
}

function decimalPlaces(num: number): number {
    if (Number.isInteger(num)) return 0;
    const arr = num.toString().split(".");
    return arr.length <= 1 ? 0 : arr[1].length;
}

/* ---------- L2 HMAC-SHA256 authentication ---------- */

function getWallet(): ethers.Wallet {
    return new ethers.Wallet(process.env.POLY_WALLET_PK!);
}

function buildL2Headers(
    method: string,
    requestPath: string,
    body: string,
    timestamp: string,
): Record<string, string> {
    const apiKey = process.env.POLY_API_KEY!;
    const apiSecret = process.env.POLY_API_SECRET!;
    const passphrase = process.env.POLY_PASSPHRASE!;
    const wallet = getWallet();

    const secret = Buffer.from(apiSecret, "base64");
    const msg = timestamp + method + requestPath + body;
    const sig = crypto.createHmac("sha256", secret).update(msg).digest("base64");
    const sigUrlSafe = sig.replace(/\+/g, "-").replace(/\//g, "_");

    return {
        POLY_ADDRESS: wallet.address,
        POLY_SIGNATURE: sigUrlSafe,
        POLY_TIMESTAMP: timestamp,
        POLY_API_KEY: apiKey,
        POLY_PASSPHRASE: passphrase,
    };
}

/* ---------- Order helpers ---------- */

const Side = { BUY: 0, SELL: 1 } as const;
type SideValue = (typeof Side)[keyof typeof Side];

function generateSalt(): string {
    return Math.round(Math.random() * Date.now()).toString();
}

function getMarketOrderRawAmounts(
    side: SideValue,
    amount: number,
    price: number,
    roundConfig: { price: number; size: number; amount: number },
): { rawMakerAmt: number; rawTakerAmt: number } {
    const rawPrice = roundDown(price, roundConfig.price);

    if (side === Side.BUY) {
        const rawMakerAmt = roundDown(amount, roundConfig.size);
        let rawTakerAmt = rawMakerAmt / rawPrice;
        if (decimalPlaces(rawTakerAmt) > roundConfig.amount) {
            rawTakerAmt = roundUp(rawTakerAmt, roundConfig.amount + 4);
            if (decimalPlaces(rawTakerAmt) > roundConfig.amount) {
                rawTakerAmt = roundDown(rawTakerAmt, roundConfig.amount);
            }
        }
        return { rawMakerAmt, rawTakerAmt };
    }

    const rawMakerAmt = roundDown(amount, roundConfig.size);
    let rawTakerAmt = rawMakerAmt * rawPrice;
    if (decimalPlaces(rawTakerAmt) > roundConfig.amount) {
        rawTakerAmt = roundUp(rawTakerAmt, roundConfig.amount + 4);
        if (decimalPlaces(rawTakerAmt) > roundConfig.amount) {
            rawTakerAmt = roundDown(rawTakerAmt, roundConfig.amount);
        }
    }
    return { rawMakerAmt, rawTakerAmt };
}

async function buildAndSignOrder(params: {
    tokenId: string;
    price: number;
    amount: number;
    side: SideValue;
    feeRateBps: number;
    negRisk: boolean;
    tickSize: string;
}): Promise<{
    salt: string;
    maker: string;
    signer: string;
    taker: string;
    tokenId: string;
    makerAmount: string;
    takerAmount: string;
    expiration: string;
    nonce: string;
    feeRateBps: string;
    side: SideValue;
    signatureType: number;
    signature: string;
}> {
    const wallet = getWallet();
    const addr = wallet.address; // checksummed

    const salt = generateSalt();
    const roundConfig = ROUNDING_CONFIG[params.tickSize] || ROUNDING_CONFIG["0.01"];

    const { rawMakerAmt, rawTakerAmt } = getMarketOrderRawAmounts(
        params.side,
        params.amount,
        params.price,
        roundConfig,
    );

    const makerAmount = ethers.parseUnits(rawMakerAmt.toString(), COLLATERAL_DECIMALS).toString();
    const takerAmount = ethers.parseUnits(rawTakerAmt.toString(), COLLATERAL_DECIMALS).toString();

    const feeRateBps = params.feeRateBps.toString();
    const nonce = "0";
    const expiration = "0";

    const orderMessage = {
        salt,
        maker: addr,
        signer: addr,
        taker: ethers.ZeroAddress,
        tokenId: params.tokenId,
        makerAmount,
        takerAmount,
        expiration,
        nonce,
        feeRateBps,
        side: params.side,
        signatureType: 0,
    };

    const domain = params.negRisk ? NEG_RISK_EIP712_DOMAIN : EIP712_DOMAIN;
    const signature = await wallet.signTypedData(domain, ORDER_TYPES, orderMessage);

    return {
        salt,
        maker: addr,
        signer: addr,
        taker: ethers.ZeroAddress,
        tokenId: params.tokenId,
        makerAmount,
        takerAmount,
        expiration,
        nonce,
        feeRateBps,
        side: params.side,
        signatureType: 0,
        signature,
    };
}

/* ---------- CLOB API fetchers ---------- */

export async function fetchTickSize(tokenId: string): Promise<string> {
    try {
        const resp = await proxyAxios.get(`${CLOB_API}/tick-size`, {
            params: { token_id: tokenId },
        });
        return resp.data.minimum_tick_size?.toString() || "0.01";
    } catch {
        return "0.01";
    }
}

export async function fetchNegRisk(tokenId: string): Promise<boolean> {
    try {
        const resp = await proxyAxios.get(`${CLOB_API}/neg-risk`, {
            params: { token_id: tokenId },
        });
        return resp.data.neg_risk === true;
    } catch {
        return false;
    }
}

export async function fetchFeeRate(tokenId: string): Promise<number> {
    try {
        const ts = Math.floor(Date.now() / 1000).toString();
        const headers = buildL2Headers("GET", "/fee-rate", "", ts);
        const resp = await proxyAxios.get(`${CLOB_API}/fee-rate`, {
            params: { token_id: tokenId },
            headers,
        });
        return typeof resp.data.base_fee === "number" ? resp.data.base_fee : 0;
    } catch {
        return 0;
    }
}

export async function fetchMidpoint(tokenId: string): Promise<number> {
    const resp = await proxyAxios.get(`${CLOB_API}/midpoint`, {
        params: { token_id: tokenId },
    });
    return parseFloat(resp.data.mid);
}

export async function fetchBestPrice(tokenId: string, side: "BUY" | "SELL"): Promise<number> {
    const resp = await proxyAxios.get(`${CLOB_API}/book`, {
        params: { token_id: tokenId },
    });
    if (side === "BUY") {
        const asks: { price: string; size: string }[] = resp.data.asks ?? [];
        if (asks.length === 0) throw new Error("No asks in order book");
        return parseFloat(asks[0].price);
    }
    const bids: { price: string; size: string }[] = resp.data.bids ?? [];
    if (bids.length === 0) throw new Error("No bids in order book");
    return parseFloat(bids[0].price);
}

/* ---------- Public API ---------- */

export interface PlaceOrderResult {
    success: boolean;
    orderID: string;
    status: string;
    errorMsg: string;
}

export async function placeMarketOrder(params: {
    tokenId: string;
    price: number;
    amount: number;
    side: SideValue;
    negRisk: boolean;
    tickSize?: string;
    feeRateBps?: number;
}): Promise<PlaceOrderResult> {
    console.log(`[CLOB] placeMarketOrder tokenId=${params.tokenId} price=${params.price} amount=${params.amount} side=${params.side} negRisk=${params.negRisk}`);
    const tickSize = params.tickSize || await fetchTickSize(params.tokenId);
    const feeRateBps = params.feeRateBps ?? await fetchFeeRate(params.tokenId);
    console.log(`[CLOB] tickSize=${tickSize} feeRateBps=${feeRateBps}`);

    const signedOrder = await buildAndSignOrder({
        tokenId: params.tokenId,
        price: params.price,
        amount: params.amount,
        side: params.side,
        feeRateBps,
        negRisk: params.negRisk,
        tickSize,
    });

    const apiKey = process.env.POLY_API_KEY!;
    const sideStr = signedOrder.side === Side.BUY ? "BUY" : "SELL";

    const orderPayload = {
        order: {
            salt: parseInt(signedOrder.salt, 10),
            maker: signedOrder.maker,
            signer: signedOrder.signer,
            taker: signedOrder.taker,
            tokenId: signedOrder.tokenId,
            makerAmount: signedOrder.makerAmount,
            takerAmount: signedOrder.takerAmount,
            side: sideStr,
            expiration: signedOrder.expiration,
            nonce: signedOrder.nonce,
            feeRateBps: signedOrder.feeRateBps,
            signatureType: signedOrder.signatureType,
            signature: signedOrder.signature,
        },
        owner: apiKey,
        orderType: "FOK",
    };

    const path = "/order";
    const body = JSON.stringify(orderPayload);

    const ts = Math.floor(Date.now() / 1000).toString();
    const headers = buildL2Headers("POST", path, body, ts);

    console.log(`[CLOB] Sending order to ${CLOB_API}${path}...`);
    const resp = await proxyAxios.post(`${CLOB_API}${path}`, body, {
        headers: { ...headers, "Content-Type": "application/json" },
    });

    console.log(`[CLOB] Order response:`, resp.data);
    return resp.data as PlaceOrderResult;
}

const USDC_E = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const NATIVE_USDC = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const SWAP_ROUTER = "0xE592427A0AEce92De3Edee1F18E0157C05861564";
const CTF_CONTRACT = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045";

export async function getPolymarketWalletBalance(): Promise<bigint> {
    const wallet = getWallet();
    const rpc = process.env.POLYGON_RPC_URL;
    if (!rpc) return 0n;
    const provider = new ethers.JsonRpcProvider(rpc);
    const usdc = new ethers.Contract(
        USDC_E,
        ["function balanceOf(address) view returns (uint256)"],
        provider,
    );
    const bal: bigint = await usdc.balanceOf(wallet.address);
    console.log(`[CLOB] getPolymarketWalletBalance(${wallet.address}) = ${bal}`);
    return bal;
}

export async function getConditionalTokenBalance(tokenId: string): Promise<number> {
    const wallet = getWallet();
    const rpc = process.env.POLYGON_RPC_URL;
    if (!rpc) return 0;
    const provider = new ethers.JsonRpcProvider(rpc);
    const ctf = new ethers.Contract(
        CTF_CONTRACT,
        ["function balanceOf(address,uint256) view returns (uint256)"],
        provider,
    );
    const bal: bigint = await ctf.balanceOf(wallet.address, tokenId);
    const balNum = Number(bal) / 10 ** COLLATERAL_DECIMALS;
    console.log(`[CLOB] getConditionalTokenBalance(${tokenId.slice(0, 12)}...) = ${bal} (${balNum})`);
    return balNum;
}

/* ---------- Swap native USDC → USDC.e on polymarket wallet ---------- */

let _polymarketSigner: ethers.NonceManager | null = null;
let _polymarketSignerAddress: string | null = null;

function getPolymarketSigner(): ethers.NonceManager {
    if (_polymarketSigner) return _polymarketSigner;
    const rpc = process.env.POLYGON_RPC_URL;
    if (!rpc) throw new Error("POLYGON_RPC_URL not set");
    const provider = new ethers.JsonRpcProvider(rpc);
    const wallet = getWallet().connect(provider);
    _polymarketSignerAddress = wallet.address;
    _polymarketSigner = new ethers.NonceManager(wallet);
    return _polymarketSigner;
}

function getPolymarketSignerAddress(): string {
    if (!_polymarketSignerAddress) getPolymarketSigner();
    return _polymarketSignerAddress!;
}

export async function getNativeUsdcBalance(): Promise<bigint> {
    const wallet = getWallet();
    const rpc = process.env.POLYGON_RPC_URL;
    if (!rpc) return 0n;
    const provider = new ethers.JsonRpcProvider(rpc);
    const usdc = new ethers.Contract(
        NATIVE_USDC,
        ["function balanceOf(address) view returns (uint256)"],
        provider,
    );
    const bal: bigint = await usdc.balanceOf(wallet.address);
    console.log(`[CLOB] getNativeUsdcBalance(${wallet.address}) = ${bal}`);
    return bal;
}

/**
 * Swaps native USDC to USDC.e via Uniswap V3 using the Polymarket wallet.
 * Called after the Vault sends native USDC to this wallet.
 */
export async function swapNativeUsdcToUsdcE(amountMicro: bigint): Promise<void> {
    console.log(`[CLOB] swapNativeUsdcToUsdcE requested=${amountMicro}`);
    const signer = getPolymarketSigner();

    const nativeBalance = await getNativeUsdcBalance();
    if (nativeBalance === 0n) {
        throw new Error(
            `[CLOB] Polymarket wallet has 0 native USDC — cannot swap. Expected ${amountMicro}. ` +
            `fundPolymarketWallet may have failed or sent to a different address.`,
        );
    }

    const swapAmount = nativeBalance < amountMicro ? nativeBalance : amountMicro;
    if (swapAmount < amountMicro) {
        console.warn(`[CLOB] Native USDC balance (${nativeBalance}) < requested (${amountMicro}), swapping available balance only`);
    }

    const nativeUsdc = new ethers.Contract(
        NATIVE_USDC,
        [
            "function approve(address,uint256) returns (bool)",
            "function allowance(address,address) view returns (uint256)",
        ],
        signer,
    );

    const currentAllowance: bigint = await nativeUsdc.allowance(getPolymarketSignerAddress(), SWAP_ROUTER);
    if (currentAllowance < swapAmount) {
        console.log("[CLOB] Approving SwapRouter for native USDC...");
        const approveTx = await nativeUsdc.approve(SWAP_ROUTER, ethers.MaxUint256);
        await approveTx.wait();
        console.log("[CLOB] SwapRouter approved");
    }

    const router = new ethers.Contract(
        SWAP_ROUTER,
        [
            "function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256)",
        ],
        signer,
    );

    console.log(`[CLOB] Swapping ${swapAmount} native USDC → USDC.e on Uniswap V3...`);
    const tx = await router.exactInputSingle({
        tokenIn: NATIVE_USDC,
        tokenOut: USDC_E,
        fee: 100,
        recipient: getPolymarketSignerAddress(),
        deadline: Math.floor(Date.now() / 1000) + 300,
        amountIn: swapAmount,
        amountOutMinimum: (swapAmount * 99n) / 100n,
        sqrtPriceLimitX96: 0n,
    });
    console.log(`[CLOB] Swap tx=${tx.hash}`);
    await tx.wait();
    console.log(`[CLOB] Swap confirmed. ${swapAmount} native USDC → USDC.e`);
}

/* ---------- CTF Exchange approval ---------- */

let _exchangeApproved = false;
let _ctfApproved = false;

/**
 * One-time max-approval of USDC.e for both CTF Exchange contracts.
 */
export async function ensureExchangeApproval(): Promise<void> {
    if (_exchangeApproved) return;
    console.log("[CLOB] Checking CTF Exchange approvals...");

    const signer = getPolymarketSigner();
    const usdce = new ethers.Contract(
        USDC_E,
        [
            "function approve(address,uint256) returns (bool)",
            "function allowance(address,address) view returns (uint256)",
        ],
        signer,
    );

    const THRESHOLD = ethers.parseUnits("1000000", 6);

    for (const spender of [CTF_EXCHANGE, NEG_RISK_CTF_EXCHANGE, NEG_RISK_ADAPTER]) {
        const allowance: bigint = await usdce.allowance(getPolymarketSignerAddress(), spender);
        if (allowance < THRESHOLD) {
            console.log(`[CLOB] Approving ${spender} for USDC.e...`);
            const tx = await usdce.approve(spender, ethers.MaxUint256);
            await tx.wait();
            console.log(`[CLOB] Approved ${spender}`);
        } else {
            console.log(`[CLOB] ${spender} already approved (allowance=${allowance})`);
        }
    }

    _exchangeApproved = true;
    console.log("[CLOB] Exchange approvals OK");
}

/**
 * One-time setApprovalForAll on the CTF contract so CTF Exchange
 * contracts can transfer conditional tokens (needed for SELL orders).
 */
export async function ensureConditionalTokenApproval(): Promise<void> {
    if (_ctfApproved) return;
    console.log("[CLOB] Checking conditional token (ERC1155) approvals...");

    const signer = getPolymarketSigner();
    const ctf = new ethers.Contract(
        CTF_CONTRACT,
        [
            "function isApprovedForAll(address,address) view returns (bool)",
            "function setApprovalForAll(address,bool)",
        ],
        signer,
    );

    for (const spender of [CTF_EXCHANGE, NEG_RISK_CTF_EXCHANGE, NEG_RISK_ADAPTER]) {
        const approved: boolean = await ctf.isApprovedForAll(getPolymarketSignerAddress(), spender);
        if (!approved) {
            console.log(`[CLOB] setApprovalForAll ${spender} on CTF contract...`);
            const tx = await ctf.setApprovalForAll(spender, true);
            await tx.wait();
            console.log(`[CLOB] CTF approval granted to ${spender}`);
        } else {
            console.log(`[CLOB] ${spender} already approved for CTF tokens`);
        }
    }

    _ctfApproved = true;
    console.log("[CLOB] Conditional token approvals OK");
}

export function checkClobEnv(): void {
    const required = ["POLY_API_KEY", "POLY_API_SECRET", "POLY_PASSPHRASE", "POLY_WALLET_PK"];
    const missing = required.filter((k) => !process.env[k]);
    if (missing.length > 0) {
        console.warn(`[CLOB] Missing env vars: ${missing.join(", ")}`);
    }
}

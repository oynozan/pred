import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";

function loadABI(name: string): ethers.InterfaceAbi {
    const abiPath = path.join(__dirname, "..", "abis", `${name}.json`);
    return JSON.parse(fs.readFileSync(abiPath, "utf-8"));
}

export const lpPoolAbi = loadABI("LPPool");
const vaultAbi = loadABI("Vault");
const nettingEngineAbi = loadABI("NettingEngine");
const circuitBreakerAbi = loadABI("CircuitBreaker");
const feeDistributorAbi = loadABI("FeeDistributor");

const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";
const MULTICALL3_ABI = [
    "function tryAggregate(bool requireSuccess, tuple(address target, bytes callData)[] calls) public payable returns (tuple(bool success, bytes returnData)[])",
] as const;

let provider: ethers.JsonRpcProvider;
let operatorWallet: ethers.Wallet;
let managedSigner: ethers.NonceManager;
let lpPool: ethers.Contract;
let vault: ethers.Contract;
let nettingEngine: ethers.Contract;
let circuitBreaker: ethers.Contract;
let feeDistributor: ethers.Contract;
let lpPoolAddress: string;

export function initContracts() {
    const rpcUrl = process.env.POLYGON_RPC_URL;
    if (!rpcUrl) throw new Error("POLYGON_RPC_URL is not set");

    provider = new ethers.JsonRpcProvider(rpcUrl);

    const pk = process.env.OPERATOR_PRIVATE_KEY;
    if (!pk) throw new Error("OPERATOR_PRIVATE_KEY is not set");
    operatorWallet = new ethers.Wallet(pk, provider);
    managedSigner = new ethers.NonceManager(operatorWallet);

    lpPoolAddress = requireEnv("LPPOOL_ADDRESS");
    lpPool = new ethers.Contract(lpPoolAddress, lpPoolAbi, managedSigner);
    vault = new ethers.Contract(requireEnv("VAULT_ADDRESS"), vaultAbi, managedSigner);
    nettingEngine = new ethers.Contract(requireEnv("NETTING_ENGINE_ADDRESS"), nettingEngineAbi, managedSigner);
    circuitBreaker = new ethers.Contract(requireEnv("CIRCUIT_BREAKER_ADDRESS"), circuitBreakerAbi, managedSigner);
    feeDistributor = new ethers.Contract(requireEnv("FEE_DISTRIBUTOR_ADDRESS"), feeDistributorAbi, managedSigner);

    console.log("[contracts] Initialized contract instances on", rpcUrl, "(with NonceManager)");
}

function requireEnv(key: string): string {
    const val = process.env[key];
    if (!val) throw new Error(`${key} is not set`);
    return val;
}

export function getProvider() {
    return provider;
}

export function getOperatorWallet() {
    return operatorWallet;
}

export function getLPPoolContract() {
    return lpPool;
}

export function getVaultContract() {
    return vault;
}

export function getNettingEngineContract() {
    return nettingEngine;
}

export function getCircuitBreakerContract() {
    return circuitBreaker;
}

export function getFeeDistributorContract() {
    return feeDistributor;
}

export function getLPPoolAddress(): string {
    return lpPoolAddress;
}

export interface MulticallRequest {
    target: string;
    callData: string;
}

export interface MulticallResult {
    success: boolean;
    returnData: string;
}

export async function multicall(calls: MulticallRequest[]): Promise<MulticallResult[]> {
    if (calls.length === 0) return [];
    const mc = new ethers.Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider);
    const raw: { success: boolean; returnData: string }[] = await mc.tryAggregate.staticCall(
        false,
        calls.map(c => ({ target: c.target, callData: c.callData })),
    );
    return raw.map(r => ({ success: r.success, returnData: r.returnData }));
}

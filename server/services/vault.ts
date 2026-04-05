import { ethers } from "ethers";
import { getVaultContract } from "../lib/contracts";
import { broadcastMarginUpdate } from "../socket/broadcast";

export interface MarginInfo {
    total: string;
    locked: string;
    available: string;
}

const MARGIN_CACHE_TTL = 10_000;
const _marginCache = new Map<string, { data: MarginInfo; ts: number }>();

export async function getUserMargin(address: string): Promise<MarginInfo> {
    const cached = _marginCache.get(address);
    if (cached && Date.now() - cached.ts < MARGIN_CACHE_TTL) return cached.data;

    const vault = getVaultContract();
    if (!vault) {
        return { total: "0", locked: "0", available: "0" };
    }
    const [total, locked, available] = await vault.getMargin(address);

    const data: MarginInfo = {
        total: total.toString(),
        locked: locked.toString(),
        available: available.toString(),
    };
    _marginCache.set(address, { data, ts: Date.now() });
    return data;
}

export async function lockMargin(user: string, amount: string): Promise<ethers.TransactionReceipt> {
    console.log(`[vault] lockMargin user=${user} amount=${amount}`);
    const vault = getVaultContract();
    const tx = await vault.lockMargin(user, BigInt(amount));
    console.log(`[vault] lockMargin tx=${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`[vault] lockMargin confirmed block=${receipt.blockNumber}`);
    _marginCache.delete(user);
    broadcastMarginUpdate(user).catch(() => {});
    return receipt;
}

export async function releaseMargin(user: string, amount: string): Promise<ethers.TransactionReceipt> {
    console.log(`[vault] releaseMargin user=${user} amount=${amount}`);
    const vault = getVaultContract();
    const tx = await vault.releaseMargin(user, BigInt(amount));
    console.log(`[vault] releaseMargin tx=${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`[vault] releaseMargin confirmed block=${receipt.blockNumber}`);
    _marginCache.delete(user);
    broadcastMarginUpdate(user).catch(() => {});
    return receipt;
}

export async function borrowFromPool(conditionId: string, amount: string): Promise<ethers.TransactionReceipt> {
    console.log(`[vault] borrowFromPool conditionId=${conditionId} amount=${amount}`);
    const vault = getVaultContract();
    const tx = await vault.borrowFromPool(conditionId, BigInt(amount));
    console.log(`[vault] borrowFromPool tx=${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`[vault] borrowFromPool confirmed block=${receipt.blockNumber}`);
    return receipt;
}

export async function repayToPool(conditionId: string, amount: string): Promise<ethers.TransactionReceipt> {
    console.log(`[vault] repayToPool conditionId=${conditionId} amount=${amount}`);
    const vault = getVaultContract();
    const tx = await vault.repayToPool(conditionId, BigInt(amount));
    console.log(`[vault] repayToPool tx=${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`[vault] repayToPool confirmed block=${receipt.blockNumber}`);
    return receipt;
}

export async function fundPolymarketWallet(amount: string): Promise<ethers.TransactionReceipt> {
    console.log(`[vault] fundPolymarketWallet amount=${amount}`);
    const vault = getVaultContract();
    const tx = await vault.fundPolymarketWallet(BigInt(amount));
    console.log(`[vault] fundPolymarketWallet tx=${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`[vault] fundPolymarketWallet confirmed block=${receipt.blockNumber}`);
    return receipt;
}

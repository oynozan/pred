import { ethers } from "hardhat";

async function main() {
    const vaultAddress = process.env.VAULT_ADDRESS;
    if (!vaultAddress) throw new Error("Set VAULT_ADDRESS env var");

    const polyWalletPk = process.env.POLYMARKET_WALLET_PK;
    if (!polyWalletPk) throw new Error("Set POLYMARKET_WALLET_PK env var");

    const polyWallet = new ethers.Wallet(polyWalletPk);
    console.log(`Setting polymarketWallet to actual wallet: ${polyWallet.address}`);

    const [deployer] = await ethers.getSigners();
    console.log(`Calling from admin: ${deployer.address}`);

    const vault = await ethers.getContractAt("Vault", vaultAddress);
    const tx = await vault.setPolymarketWallet(polyWallet.address);
    console.log(`tx: ${tx.hash}`);
    await tx.wait();
    console.log("Done.");
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});

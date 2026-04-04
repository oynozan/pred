import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import axios from "axios";

// Polygon mainnet external addresses
const MAINNET = {
    USDC: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    SWAP_ROUTER: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
    WETH: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
};

// Polygon Amoy testnet external addresses
const AMOY = {
    USDC: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
    SWAP_ROUTER: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
    WETH: "0x360ad4f9a9A8EFe9A8DCB5f461c4Cc1047E1Dcf9",
};

// Sepolia testnet external addresses
const SEPOLIA = {
    USDC: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", // Circle USDC on Sepolia
    SWAP_ROUTER: "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E", // Uniswap V3 SwapRouter on Sepolia
    WETH: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14", // WETH on Sepolia
};

const CHAIN_DEFAULTS: Record<number, typeof MAINNET> = {
    137: MAINNET,
    80002: AMOY,
    11155111: SEPOLIA,
};

function getExternalAddresses(chainId: number) {
    const defaults = CHAIN_DEFAULTS[chainId] || MAINNET;
    return {
        USDC: process.env.USDC_ADDRESS || defaults.USDC,
        SWAP_ROUTER: process.env.SWAP_ROUTER_ADDRESS || defaults.SWAP_ROUTER,
        WETH: process.env.WETH_ADDRESS || defaults.WETH,
    };
}

async function main() {
    const [deployer] = await ethers.getSigners();
    const network = await ethers.provider.getNetwork();
    const chainId = Number(network.chainId);
    const networkName = network.name === "unknown" ? `chain-${chainId}` : network.name;

    const addrs = getExternalAddresses(chainId);

    console.log(`Deploying contracts with account: ${deployer.address}`);
    console.log(`Network: ${networkName} (chainId: ${chainId})`);
    console.log(`External: USDC=${addrs.USDC}  SwapRouter=${addrs.SWAP_ROUTER}  WETH=${addrs.WETH}`);

    const OPERATOR_ADDRESS = process.env.OPERATOR_ADDRESS || deployer.address;
    const REBALANCER_ADDRESS = process.env.REBALANCER_ADDRESS || deployer.address;
    const CB_WORKFLOW_ADDRESS = process.env.CB_WORKFLOW_ADDRESS || deployer.address;
    const BRIDGE_MONITOR_ADDRESS = process.env.BRIDGE_MONITOR_ADDRESS || deployer.address;
    const POLYMARKET_WALLET_ADDRESS = process.env.POLYMARKET_WALLET_ADDRESS;

    // 1. CircuitBreaker
    const CircuitBreaker = await ethers.getContractFactory("CircuitBreaker");
    const cb = await CircuitBreaker.deploy();
    await cb.waitForDeployment();
    console.log(`CircuitBreaker deployed at: ${await cb.getAddress()}`);

    // 2. NettingEngine
    const NettingEngine = await ethers.getContractFactory("NettingEngine");
    const engine = await NettingEngine.deploy(await cb.getAddress());
    await engine.waitForDeployment();
    console.log(`NettingEngine deployed at: ${await engine.getAddress()}`);

    // 3. LPPool
    const LPPool = await ethers.getContractFactory("LPPool");
    const pool = await LPPool.deploy(addrs.USDC);
    await pool.waitForDeployment();
    console.log(`LPPool deployed at: ${await pool.getAddress()}`);

    // 4. Vault
    const Vault = await ethers.getContractFactory("Vault");
    const vault = await Vault.deploy(
        addrs.USDC,
        await pool.getAddress(),
        addrs.SWAP_ROUTER,
        addrs.WETH,
        await cb.getAddress(),
    );
    await vault.waitForDeployment();
    console.log(`Vault deployed at: ${await vault.getAddress()}`);

    // 5. FeeDistributor
    const FeeDistributor = await ethers.getContractFactory("FeeDistributor");
    const feeDist = await FeeDistributor.deploy(addrs.USDC, await pool.getAddress());
    await feeDist.waitForDeployment();
    console.log(`FeeDistributor deployed at: ${await feeDist.getAddress()}`);

    // Roles
    const BORROWER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BORROWER_ROLE"));
    const OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"));
    const REBALANCER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("REBALANCER_ROLE"));
    const CB_ROLE = ethers.keccak256(ethers.toUtf8Bytes("CIRCUIT_BREAKER_ROLE"));
    const BRIDGE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BRIDGE_ROLE"));
    const VAULT_ROLE = ethers.keccak256(ethers.toUtf8Bytes("VAULT_ROLE"));
    const FEE_DISTRIBUTOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("FEE_DISTRIBUTOR_ROLE"));

    console.log("Granting roles (waiting for each tx to be mined)...");

    await (await pool.grantRole(BORROWER_ROLE, await vault.getAddress())).wait();
    console.log("  BORROWER_ROLE on LPPool -> Vault");

    await (await pool.grantRole(FEE_DISTRIBUTOR_ROLE, await feeDist.getAddress())).wait();
    console.log("  FEE_DISTRIBUTOR_ROLE on LPPool -> FeeDistributor");

    await (await vault.grantRole(OPERATOR_ROLE, OPERATOR_ADDRESS)).wait();
    console.log("  OPERATOR_ROLE on Vault -> operator");

    await (await engine.grantRole(OPERATOR_ROLE, OPERATOR_ADDRESS)).wait();
    console.log("  OPERATOR_ROLE on NettingEngine -> operator");

    await (await engine.grantRole(REBALANCER_ROLE, REBALANCER_ADDRESS)).wait();
    console.log("  REBALANCER_ROLE on NettingEngine -> rebalancer");

    await (await cb.grantRole(CB_ROLE, CB_WORKFLOW_ADDRESS)).wait();
    console.log("  CIRCUIT_BREAKER_ROLE on CircuitBreaker -> CB workflow");

    await (await vault.grantRole(BRIDGE_ROLE, BRIDGE_MONITOR_ADDRESS)).wait();
    console.log("  BRIDGE_ROLE on Vault -> bridge monitor");

    await (await feeDist.grantRole(VAULT_ROLE, await vault.getAddress())).wait();
    console.log("  VAULT_ROLE on FeeDistributor -> Vault");

    const POLYMARKET_WALLET_PK = process.env.POLYMARKET_WALLET_PK;
    if (POLYMARKET_WALLET_PK) {
        const polyWallet = new ethers.Wallet(POLYMARKET_WALLET_PK);
        console.log(`  Polymarket wallet: ${polyWallet.address}`);
        console.log("  Fetching Bridge deposit address from Polymarket...");
        const bridgeResp = await axios.post("https://bridge.polymarket.com/deposit", {
            address: polyWallet.address,
        });
        const depositAddress: string | undefined = bridgeResp.data?.address?.evm;
        if (!depositAddress) throw new Error("Bridge API did not return an EVM deposit address");
        await (await vault.setPolymarketWallet(depositAddress)).wait();
        console.log(`  Vault polymarketWallet set to Bridge deposit address: ${depositAddress}`);
    } else if (POLYMARKET_WALLET_ADDRESS) {
        await (await vault.setPolymarketWallet(POLYMARKET_WALLET_ADDRESS)).wait();
        console.log(`  Polymarket wallet set to ${POLYMARKET_WALLET_ADDRESS}`);
    }

    console.log("All roles granted.");

    // Save addresses
    const deployments = {
        network: networkName,
        chainId,
        deployer: deployer.address,
        timestamp: new Date().toISOString(),
        contracts: {
            CircuitBreaker: await cb.getAddress(),
            NettingEngine: await engine.getAddress(),
            LPPool: await pool.getAddress(),
            Vault: await vault.getAddress(),
            FeeDistributor: await feeDist.getAddress(),
        },
        externalAddresses: {
            USDC: addrs.USDC,
            SwapRouter: addrs.SWAP_ROUTER,
            WETH: addrs.WETH,
        },
        roles: {
            operator: OPERATOR_ADDRESS,
            rebalancer: REBALANCER_ADDRESS,
            circuitBreakerWorkflow: CB_WORKFLOW_ADDRESS,
            bridgeMonitor: BRIDGE_MONITOR_ADDRESS,
        },
    };

    const deployDir = path.join(__dirname, "..", "deployments");
    if (!fs.existsSync(deployDir)) {
        fs.mkdirSync(deployDir, { recursive: true });
    }
    const outFile = path.join(deployDir, `${networkName}.json`);
    fs.writeFileSync(outFile, JSON.stringify(deployments, null, 2));
    console.log(`Deployment addresses saved to ${outFile}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

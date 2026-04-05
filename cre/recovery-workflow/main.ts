import {
    HTTPCapability,
    HTTPClient,
    EVMClient,
    handler,
    ok,
    getNetwork,
    hexToBase64,
    bytesToHex,
    encodeCallMsg,
    TxStatus,
    consensusIdenticalAggregation,
    LAST_FINALIZED_BLOCK_NUMBER,
    type Runtime,
    type NodeRuntime,
    type HTTPPayload,
    Runner,
} from "@chainlink/cre-sdk";
import {
    encodeFunctionData,
    decodeFunctionResult,
    encodeAbiParameters,
    zeroAddress,
} from "viem";
import { z } from "zod";
import { vaultAbi, RecoveryReportParams } from "../contracts/abi";

const configSchema = z.object({
    chainSelectorName: z.string(),
    vaultAddress: z.string(),
    recoveryReceiverAddress: z.string(),
    backendPositionsUrl: z.string(),
    gasLimit: z.string(),
});

type Config = z.infer<typeof configSchema>;

type WalletSummary = {
    wallet: string;
    totalLockedMargin: number;
};

type PositionsResponse = {
    wallets: WalletSummary[];
    totalPositions: number;
};

type RecoveryAction = {
    wallet: string;
    onChainLocked: bigint;
    expectedLocked: bigint;
    excess: bigint;
};

const USDC_DECIMALS = 6;
const USDC_SCALE = 10 ** USDC_DECIMALS;

function fetchPositions(
    nodeRuntime: NodeRuntime<Config>,
    accessToken: string,
): PositionsResponse {
    const httpClient = new HTTPClient();

    const resp = httpClient
        .sendRequest(nodeRuntime, {
            url: nodeRuntime.config.backendPositionsUrl,
            method: "GET" as const,
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        })
        .result();

    if (!ok(resp)) {
        throw new Error(`Backend positions returned ${resp.statusCode}`);
    }

    return JSON.parse(new TextDecoder().decode(resp.body)) as PositionsResponse;
}

function readOnChainMargin(
    evmClient: EVMClient,
    runtime: Runtime<Config>,
    wallet: `0x${string}`,
): { total: bigint; locked: bigint; available: bigint } {
    const data = encodeFunctionData({
        abi: vaultAbi,
        functionName: "getMargin",
        args: [wallet],
    });

    const raw = evmClient
        .callContract(runtime, {
            call: encodeCallMsg({
                from: zeroAddress,
                to: runtime.config.vaultAddress as `0x${string}`,
                data,
            }),
            blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
        })
        .result();

    const [total, locked, available] = decodeFunctionResult({
        abi: vaultAbi,
        functionName: "getMargin",
        data: bytesToHex(raw.data) as `0x${string}`,
    }) as [bigint, bigint, bigint];

    return { total, locked, available };
}

const onHttpTrigger = (runtime: Runtime<Config>, payload: HTTPPayload): string => {
    const config = runtime.config;

    runtime.log("Recovery workflow triggered");

    const accessToken = runtime.getSecret({ id: "BACKEND_ACCESS_TOKEN" }).result().value;

    const positions = runtime
        .runInNodeMode(fetchPositions, consensusIdenticalAggregation<PositionsResponse>())(
            accessToken,
        )
        .result();

    runtime.log(`Fetched ${positions.totalPositions} open positions across ${positions.wallets.length} wallet(s)`);

    if (positions.wallets.length === 0) {
        runtime.log("No open positions — nothing to recover.");
        return "Nothing to recover";
    }

    const network = getNetwork({
        chainFamily: "evm",
        chainSelectorName: config.chainSelectorName,
    });
    if (!network) throw new Error(`Network not found: ${config.chainSelectorName}`);

    const evmClient = new EVMClient(network.chainSelector.selector);

    const actions: RecoveryAction[] = [];

    for (const ws of positions.wallets) {
        const wallet = ws.wallet as `0x${string}`;
        const margin = readOnChainMargin(evmClient, runtime, wallet);
        const expectedLocked = BigInt(Math.round(ws.totalLockedMargin * USDC_SCALE));

        runtime.log(
            `Wallet ${ws.wallet}: on-chain locked=${margin.locked}, expected=${expectedLocked}`,
        );

        if (margin.locked > expectedLocked) {
            const excess = margin.locked - expectedLocked;
            actions.push({
                wallet: ws.wallet,
                onChainLocked: margin.locked,
                expectedLocked,
                excess,
            });
        }
    }

    if (actions.length === 0) {
        runtime.log("All wallets match — nothing to recover.");
        return "Nothing to recover";
    }

    let totalRecovered = 0n;
    let walletsRecovered = 0;

    for (const action of actions) {
        runtime.log(
            `Recovering ${action.excess} (${Number(action.excess) / USDC_SCALE} USDC) for ${action.wallet}`,
        );

        const reportData = encodeAbiParameters(RecoveryReportParams, [
            action.wallet as `0x${string}`,
            action.excess,
        ]);

        const reportResponse = runtime
            .report({
                encodedPayload: hexToBase64(reportData),
                encoderName: "evm",
                signingAlgo: "ecdsa",
                hashingAlgo: "keccak256",
            })
            .result();

        const writeResult = evmClient
            .writeReport(runtime, {
                receiver: config.recoveryReceiverAddress,
                report: reportResponse,
                gasConfig: { gasLimit: config.gasLimit },
            })
            .result();

        if (writeResult.txStatus === TxStatus.SUCCESS) {
            const txHash = bytesToHex(writeResult.txHash || new Uint8Array(32));
            runtime.log(`Recovery tx for ${action.wallet}: ${txHash}`);
            totalRecovered += action.excess;
            walletsRecovered++;
        } else {
            runtime.log(`Recovery tx FAILED for ${action.wallet}: status=${writeResult.txStatus}`);
        }
    }

    const usdRecovered = (Number(totalRecovered) / USDC_SCALE).toFixed(2);
    const summary = `Recovered $${usdRecovered} for ${walletsRecovered} wallet(s)`;
    runtime.log(summary);
    return summary;
};

const initWorkflow = (config: Config) => {
    const http = new HTTPCapability();
    return [handler(http.trigger({}), onHttpTrigger)];
};

export async function main() {
    const runner = await Runner.newRunner<Config>({ configSchema });
    await runner.run(initWorkflow);
}

main();

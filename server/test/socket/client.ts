import { config as loadEnv } from "dotenv";
import { io, type Socket } from "socket.io-client";

// Ensure the shared .env.test file is loaded once per test process.
loadEnv({ path: ".env.test" });

export interface SocketClientOptions {
    url?: string;
    namespace?: string;
    token?: string;
}

function resolveNamespace(namespace?: string) {
    if (!namespace) return "";
    return namespace.startsWith("/") ? namespace : `/${namespace}`;
}

/**
 * Provides a preconfigured socket.io client for integration tests.
 */
export function createSocketClient(options: SocketClientOptions = {}): Socket {
    const { url, namespace, token } = options;

    const resolvedUrl = url ?? process.env.SERVER_URL;
    if (!resolvedUrl) {
        throw new Error("Missing SERVER_URL. Provide a url option or set the env var.");
    }

    const resolvedToken = token ?? process.env.SERVER_AUTH_TOKEN;

    return io(`${resolvedUrl}${resolveNamespace(namespace)}`, {
        transports: ["websocket"],
        forceNew: true,
        auth: resolvedToken ? { token: resolvedToken } : undefined,
    });
}

export const socketClient = createSocketClient();

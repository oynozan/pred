import "dotenv/config";
import { afterAll, beforeAll, test } from "@jest/globals";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, type Server as HTTPServer } from "node:http";
import type { AddressInfo } from "node:net";
import jwt from "jsonwebtoken";
import type { Server as IOServer } from "socket.io";
import type { Socket as ClientSocket } from "socket.io-client";

import { socketServer } from "../../socket";
import { SocketListeners } from "../../socket/listeners";
import { createSocketClient, type SocketClientOptions } from "./client";

/**
 * Minimal integration tests for the socket listeners.
 * Spins up an in-memory HTTP + socket.io stack and reuses the user's .env values.
 */

let httpServer: HTTPServer;
let io: IOServer;
let baseUrl: string;

const REQUIRED_ENV = ["JWT_SECRET", "JWT_ISSUER", "PUBLIC_KEY_PATH"];
// Fail fast if the host environment misses core JWT settings.
REQUIRED_ENV.forEach((name) => requireEnv(name));

beforeAll(async () => {
    httpServer = createServer();
    io = socketServer(httpServer);
    new SocketListeners(io);

    await new Promise<void>((resolve) => httpServer.listen(0, resolve));

    const address = httpServer.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
    await new Promise((resolve) => io.close(resolve));
    await new Promise((resolve) => httpServer.close(resolve));
});

test("public listener responds with pong for authenticated clients", async () => {
    const client = createSocketClient({
        url: baseUrl,
        token: issueUserToken(),
    });

    await waitForPong(client);
});

test("protected listener responds with pong for server tokens", async () => {
    const client = createSocketClient({
        url: baseUrl,
        namespace: "/protected",
        token: getServerToken(),
    });

    await waitForPong(client);
});

test("public listener rejects missing credentials", async () => {
    await expectUnauthorizedConnection({ url: baseUrl });
});

function waitForPong(client: ClientSocket) {
    return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => cleanup(new Error("Timed out waiting for pong")), 4000);

        // Emit ping right after connect; resolve once pong arrives.
        const onConnect = () => client.emit("ping");
        const onPong = (payload: { message: string }) => {
            try {
                assert.equal(payload.message, "Pong!");
                cleanup();
            } catch (error) {
                cleanup(error as Error);
            }
        };
        const onError = (error: Error) => cleanup(error);

        function cleanup(error?: Error) {
            clearTimeout(timeout);
            client.off("connect", onConnect);
            client.off("pong", onPong);
            client.off("connect_error", onError);
            client.close();
            error ? reject(error) : resolve();
        }

        client.once("connect", onConnect);
        client.once("pong", onPong);
        client.once("connect_error", onError);
    });
}

async function expectUnauthorizedConnection(
    options: SocketClientOptions,
    message: RegExp = /Unauthorized|Forbidden/,
) {
    await new Promise<void>((resolve, reject) => {
        const client = createSocketClient(options);
        const timeout = setTimeout(
            () => cleanup(new Error("Expected connection to be rejected")),
            4000,
        );

        const onConnect = () => cleanup(new Error("Client connected unexpectedly"));
        const onError = (error: Error) => {
            try {
                assert.match(error.message, message);
                cleanup();
            } catch (assertionError) {
                cleanup(assertionError as Error);
            }
        };

        function cleanup(error?: Error) {
            clearTimeout(timeout);
            client.off("connect", onConnect);
            client.off("connect_error", onError);
            client.close();
            error ? reject(error) : resolve();
        }

        client.once("connect", onConnect);
        client.once("connect_error", onError);
    });
}

function issueUserToken() {
    const secret = requireEnv("JWT_SECRET");

    return jwt.sign({ username: "socket-test-user" }, secret, {
        expiresIn: "1m",
    });
}

function getServerToken() {
    const explicitToken = process.env.PROTECTED_SOCKET_TOKEN ?? process.env.SERVER_AUTH_TOKEN;
    if (explicitToken) return explicitToken;

    // As a fallback, sign a short-lived token from a locally stored private key.
    const privateKeyPath = process.env.SERVER_PRIVATE_KEY_PATH;
    if (!privateKeyPath) {
        throw new Error(
            "Set PROTECTED_SOCKET_TOKEN, SERVER_AUTH_TOKEN, or SERVER_PRIVATE_KEY_PATH for tests.",
        );
    }

    const issuer = requireEnv("JWT_ISSUER");
    const privateKey = readFileSync(privateKeyPath, "utf8");

    return jwt.sign({}, privateKey, {
        issuer,
        algorithm: "ES256",
        expiresIn: "1m",
    });
}

function requireEnv(name: string) {
    const value = process.env[name];
    if (!value) throw new Error(`Missing ${name} env var required for socket tests.`);
    return value;
}


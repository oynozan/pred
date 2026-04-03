import { join } from "path";
import { homedir } from "os";
import { readFileSync } from "fs";

export function getKeyPath(): string {
    let keyPath = process.env.PUBLIC_KEY_PATH!;

    // Expand ~ to the home directory
    if (keyPath.startsWith("~")) {
        keyPath = join(homedir(), keyPath.slice(1));
    }

    return keyPath;
}

export function getKey(): string {
    const keyPath = getKeyPath();
    return readFileSync(keyPath, "utf8");
}

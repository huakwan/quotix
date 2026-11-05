import { execFile, execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

export type CredentialFailure =
  | "unsupported-platform"
  | "not-found"
  | "keychain-unavailable"
  | "corrupt"
  | "expired";

export type GoogleCredential =
  | { kind: "daemon"; httpPort: number; csrfToken: string }
  | { kind: "token"; accessToken: string; expiresAt: number };

export type GoogleCredentialResult =
  | { ok: true; credential: GoogleCredential }
  | { ok: false; reason: CredentialFailure };

export interface GoogleKeyProvider {
  get(): Promise<GoogleCredentialResult>;
  invalidate(): void;
}

const KEYCHAIN_SERVICE = "gemini";
const KEYCHAIN_ACCOUNT = "antigravity";
const ITEM_NOT_FOUND_EXIT = 44;
const DEFAULT_REREAD_MS = 30_000;
const EXPIRY_SKEW_MS = 60_000;
const execFileAsync = promisify(execFile);

export function parseKeychainSecret(raw: string): GoogleCredentialResult {
  try {
    let jsonStr = raw.trim();
    if (jsonStr.startsWith("go-keyring-base64:")) {
      jsonStr = Buffer.from(jsonStr.slice("go-keyring-base64:".length), "base64").toString("utf8");
    }
    const data = JSON.parse(jsonStr) as Record<string, unknown>;
    const tokenObj = (data.token && typeof data.token === "object" ? data.token : data) as Record<string, unknown>;
    const accessToken = typeof tokenObj.access_token === "string" ? tokenObj.access_token : "";
    if (!accessToken) {
      return { ok: false, reason: "corrupt" };
    }
    let expiresAt = 0;
    if (typeof tokenObj.expiry === "string") {
      const parsed = Date.parse(tokenObj.expiry);
      if (!Number.isNaN(parsed)) { expiresAt = parsed; }
    } else if (typeof tokenObj.expiry_date === "number") {
      expiresAt = tokenObj.expiry_date;
    }
    if (expiresAt > 0 && expiresAt - Date.now() < EXPIRY_SKEW_MS) {
      return { ok: false, reason: "expired" };
    }
    return {
      ok: true,
      credential: { kind: "token", accessToken, expiresAt },
    };
  } catch {
    return { ok: false, reason: "corrupt" };
  }
}

export function parseFileToken(content: string): GoogleCredentialResult {
  try {
    const data = JSON.parse(content) as Record<string, unknown>;
    const tokenObj = (data.token && typeof data.token === "object" ? data.token : data) as Record<string, unknown>;
    const accessToken = typeof tokenObj.access_token === "string" ? tokenObj.access_token : "";
    if (!accessToken) {
      return { ok: false, reason: "corrupt" };
    }
    let expiresAt = 0;
    if (typeof tokenObj.expiry_date === "number") {
      expiresAt = tokenObj.expiry_date;
    } else if (typeof tokenObj.expiry === "string") {
      const parsed = Date.parse(tokenObj.expiry);
      if (!Number.isNaN(parsed)) { expiresAt = parsed; }
    }
    if (expiresAt > 0 && expiresAt - Date.now() < EXPIRY_SKEW_MS) {
      return { ok: false, reason: "expired" };
    }
    return {
      ok: true,
      credential: { kind: "token", accessToken, expiresAt },
    };
  } catch {
    return { ok: false, reason: "corrupt" };
  }
}

function findDaemonHubSync(homeDir: string): GoogleCredential | null {
  const daemonDirs = [
    path.join(homeDir, ".gemini", "antigravity", "daemon"),
    path.join(homeDir, ".gemini", "daemon"),
  ];

  for (const dir of daemonDirs) {
    try {
      const entries = readdirSync(dir)
        .filter((file) => file.startsWith("hub_") && file.endsWith(".json"))
        .map((file) => {
          const fullPath = path.join(dir, file);
          try {
            return { fullPath, mtime: statSync(fullPath).mtimeMs };
          } catch {
            return null;
          }
        })
        .filter((item): item is { fullPath: string; mtime: number } => item !== null)
        .sort((a, b) => b.mtime - a.mtime);

      for (const entry of entries) {
        try {
          const info = JSON.parse(readFileSync(entry.fullPath, "utf8")) as Record<string, unknown>;
          const httpPort = typeof info.httpPort === "number" ? info.httpPort : 0;
          const csrfToken = typeof info.csrfToken === "string" ? info.csrfToken : "";
          const pid = typeof info.pid === "number" ? info.pid : 0;
          if (httpPort > 0 && csrfToken && pid > 0) {
            try {
              process.kill(pid, 0);
              return { kind: "daemon", httpPort, csrfToken };
            } catch {
              // process is not alive
            }
          }
        } catch {
          // ignore invalid json
        }
      }
    } catch {
      // directory missing or inaccessible
    }
  }
  return null;
}

async function findDaemonHubAsync(homeDir: string): Promise<GoogleCredential | null> {
  const daemonDirs = [
    path.join(homeDir, ".gemini", "antigravity", "daemon"),
    path.join(homeDir, ".gemini", "daemon"),
  ];

  for (const dir of daemonDirs) {
    try {
      const files = await readdir(dir);
      const hubFiles = files.filter((f) => f.startsWith("hub_") && f.endsWith(".json"));
      const entries = await Promise.all(
        hubFiles.map(async (file) => {
          const fullPath = path.join(dir, file);
          try {
            const s = await stat(fullPath);
            return { fullPath, mtime: s.mtimeMs };
          } catch {
            return null;
          }
        }),
      );
      const sorted = entries
        .filter((item): item is { fullPath: string; mtime: number } => item !== null)
        .sort((a, b) => b.mtime - a.mtime);

      for (const entry of sorted) {
        try {
          const content = await readFile(entry.fullPath, "utf8");
          const info = JSON.parse(content) as Record<string, unknown>;
          const httpPort = typeof info.httpPort === "number" ? info.httpPort : 0;
          const csrfToken = typeof info.csrfToken === "string" ? info.csrfToken : "";
          const pid = typeof info.pid === "number" ? info.pid : 0;
          if (httpPort > 0 && csrfToken && pid > 0) {
            try {
              process.kill(pid, 0);
              return { kind: "daemon", httpPort, csrfToken };
            } catch {
              // process not alive
            }
          }
        } catch {
          // ignore
        }
      }
    } catch {
      // directory missing
    }
  }
  return null;
}

export function readGoogleCredentialsSync(homeDir = os.homedir()): GoogleCredentialResult {
  if (process.platform !== "darwin") { return { ok: false, reason: "unsupported-platform" }; }

  // 1. Check local running daemon
  const daemon = findDaemonHubSync(homeDir);
  if (daemon) {
    return { ok: true, credential: daemon };
  }

  // 2. Check macOS Keychain
  try {
    const raw = execFileSync(
      "security",
      ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT, "-w"],
      { encoding: "utf8" },
    );
    const parsed = parseKeychainSecret(raw);
    if (parsed.ok) { return parsed; }
    if (parsed.reason === "expired") { return parsed; }
  } catch (error: unknown) {
    const status = (error as { status?: number })?.status;
    if (status !== ITEM_NOT_FOUND_EXIT) {
      // Keychain unavailable or error; try file fallback before giving up
    }
  }

  // 3. Fallback to oauth files
  const filePaths = [
    path.join(homeDir, ".gemini", "oauth_creds.json"),
    path.join(homeDir, ".gemini", "jetski-standalone-oauth-token"),
  ];

  for (const fpath of filePaths) {
    try {
      const content = readFileSync(fpath, "utf8");
      const parsed = parseFileToken(content);
      if (parsed.ok) { return parsed; }
      if (parsed.reason === "expired") { return parsed; }
    } catch {
      // continue
    }
  }

  return { ok: false, reason: "not-found" };
}

export async function readGoogleCredentialsAsync(homeDir = os.homedir()): Promise<GoogleCredentialResult> {
  if (process.platform !== "darwin") { return { ok: false, reason: "unsupported-platform" }; }

  // 1. Check local running daemon
  const daemon = await findDaemonHubAsync(homeDir);
  if (daemon) {
    return { ok: true, credential: daemon };
  }

  // 2. Check macOS Keychain
  try {
    const { stdout } = await execFileAsync(
      "security",
      ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT, "-w"],
      { encoding: "utf8" },
    );
    const parsed = parseKeychainSecret(stdout);
    if (parsed.ok) { return parsed; }
    if (parsed.reason === "expired") { return parsed; }
  } catch (error: unknown) {
    const status = (error as { status?: number })?.status;
    if (status !== ITEM_NOT_FOUND_EXIT) {
      // try fallback
    }
  }

  // 3. Fallback to oauth files
  const filePaths = [
    path.join(homeDir, ".gemini", "oauth_creds.json"),
    path.join(homeDir, ".gemini", "jetski-standalone-oauth-token"),
  ];

  for (const fpath of filePaths) {
    try {
      const content = await readFile(fpath, "utf8");
      const parsed = parseFileToken(content);
      if (parsed.ok) { return parsed; }
      if (parsed.reason === "expired") { return parsed; }
    } catch {
      // continue
    }
  }

  return { ok: false, reason: "not-found" };
}

export function createCachedGoogleKeyProvider(
  readFn: () => Promise<GoogleCredentialResult> = readGoogleCredentialsAsync,
  nowFn: () => number = Date.now,
  reReadMs: number = DEFAULT_REREAD_MS,
): GoogleKeyProvider {
  let cached: GoogleCredentialResult | null = null;
  let cachedAt = 0;
  let inFlight: Promise<GoogleCredentialResult> | null = null;

  return {
    async get(): Promise<GoogleCredentialResult> {
      const now = nowFn();
      if (cached && cached.ok && now - cachedAt < reReadMs) {
        if (cached.credential.kind === "token" && cached.credential.expiresAt > 0) {
          if (cached.credential.expiresAt - now < EXPIRY_SKEW_MS) {
            cached = { ok: false, reason: "expired" };
            return cached;
          }
        }
        return cached;
      }

      if (inFlight) { return inFlight; }

      inFlight = (async () => {
        try {
          const result = await readFn();
          cached = result;
          cachedAt = nowFn();
          return result;
        } finally {
          inFlight = null;
        }
      })();

      return inFlight;
    },

    invalidate(): void {
      cached = null;
      cachedAt = 0;
    },
  };
}


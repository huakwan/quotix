import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";

export interface CodexPathOptions {
  platform?: NodeJS.Platform;
  arch?: string;
  home?: string;
  env?: NodeJS.ProcessEnv;
  extensionRoots?: string[];
  exists?: (candidate: string) => boolean;
  listDirectories?: (directory: string) => string[];
}

function platformDirectory(platform: NodeJS.Platform, arch: string): string | undefined {
  if (platform === "darwin") { return arch === "arm64" ? "macos-aarch64" : "macos-x86_64"; }
  if (platform === "linux") { return arch === "arm64" ? "linux-aarch64" : "linux-x86_64"; }
  if (platform === "win32") { return arch === "arm64" ? "windows-aarch64" : "windows-x86_64"; }
  return undefined;
}

export function resolveCodexExecutable(options: CodexPathOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const home = options.home ?? homedir();
  const env = options.env ?? process.env;
  const join = platform === "win32" ? path.win32.join : path.posix.join;
  const exists = options.exists ?? existsSync;
  const listDirectories = options.listDirectories ?? ((directory: string) => {
    try {
      return readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch { return []; }
  });
  const executableNames = platform === "win32" ? ["codex.exe", "codex.cmd", "codex"] : ["codex"];
  const configured = env.CODEX_PATH?.trim();
  if (configured) {
    return configured === "~" ? home
      : configured.startsWith("~/") || configured.startsWith("~\\")
        ? join(home, configured.slice(2)) : configured;
  }
  const roots = options.extensionRoots ?? [
    join(home, ".vscode", "extensions"),
    join(home, ".vscode-insiders", "extensions"),
    join(home, ".cursor", "extensions"),
    join(home, ".windsurf", "extensions"),
  ];
  const bundle = platformDirectory(platform, arch);
  const extensionCandidates = bundle ? roots.flatMap((root) =>
    listDirectories(root)
      .filter((name) => name.startsWith("openai.chatgpt-"))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      .flatMap((name) => executableNames.map((exe) => join(root, name, "bin", bundle, exe)))) : [];
  const pathValue = env.PATH ?? env.Path ?? "";
  const delimiter = platform === "win32" ? ";" : ":";
  const pathCandidates = pathValue.split(delimiter).filter(Boolean)
    .flatMap((directory) => executableNames.map((exe) => join(directory, exe)));
  const common = [
    join(home, ".local", "bin", executableNames[0]),
    join(home, ".codex", "bin", executableNames[0]),
    join(home, ".npm-global", "bin", executableNames[0]),
    join(home, ".local", "share", "pnpm", executableNames[0]),
    join(home, ".bun", "bin", executableNames[0]),
    join(home, ".volta", "bin", executableNames[0]),
    platform === "darwin" ? `/opt/homebrew/bin/${executableNames[0]}` : undefined,
    platform === "darwin" ? `/usr/local/bin/${executableNames[0]}` : undefined,
  ];
  return [...extensionCandidates, ...pathCandidates, ...common]
    .find((candidate): candidate is string => Boolean(candidate && exists(candidate))) ?? "codex";
}

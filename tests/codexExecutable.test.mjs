import assert from "node:assert/strict";
import test from "node:test";

import { resolveCodexExecutable } from "../out/src/quota/codex/executable.js";

test("CODEX_PATH has highest precedence and expands home", () => {
  assert.equal(resolveCodexExecutable({
    platform: "darwin", arch: "arm64", home: "/home/me",
    env: { CODEX_PATH: "~/.bin/codex", PATH: "/path" },
    exists: () => false, listDirectories: () => [],
  }), "/home/me/.bin/codex");
});

test("discovers bundled Codex in an OpenAI VS Code extension", () => {
  const target = "/home/me/.vscode/extensions/openai.chatgpt-2.0/bin/macos-aarch64/codex";
  assert.equal(resolveCodexExecutable({
    platform: "darwin", arch: "arm64", home: "/home/me", env: { PATH: "" },
    extensionRoots: ["/home/me/.vscode/extensions"],
    listDirectories: () => ["openai.chatgpt-1.0", "openai.chatgpt-2.0"],
    exists: (path) => path === target,
  }), target);
});

test("falls through to PATH and then the bare command", () => {
  assert.equal(resolveCodexExecutable({
    platform: "darwin", arch: "arm64", home: "/home/me", env: { PATH: "/tools:/bin" },
    extensionRoots: [], listDirectories: () => [], exists: (path) => path === "/tools/codex",
  }), "/tools/codex");
  assert.equal(resolveCodexExecutable({
    platform: "darwin", arch: "arm64", home: "/home/me", env: { PATH: "" },
    extensionRoots: [], listDirectories: () => [], exists: () => false,
  }), "codex");
});

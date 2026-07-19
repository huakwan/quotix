import assert from "node:assert/strict";
import test from "node:test";

import { createQuotaCache } from "../out/src/quota/cache.js";

const quota = {
  updatedAt: 123,
  session: { usedPct: 10, resetsAt: 456 },
  weekly: { usedPct: 20, resetsAt: null },
  weeklyModels: [
    { model: "Fable", window: { usedPct: 5, resetsAt: 999 } },
    { model: "Inactive", window: null },
  ],
  planDetected: true,
};

function memoryFs(initial = {}) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    deps: {
      readFile: (path) => {
        if (!files.has(path)) throw new Error("missing");
        return files.get(path);
      },
      writeFile: (path, value) => { files.set(path, value); },
    },
  };
}

test("provider cache paths and data are isolated", () => {
  const fs = memoryFs();
  const claude = createQuotaCache("/data", "claude", fs.deps);
  const codex = createQuotaCache("/data", "codex", fs.deps);
  assert.notEqual(claude.path, codex.path);
  claude.save(quota);
  assert.deepEqual(claude.load(), quota);
  assert.equal(codex.load(), null);
});

test("cache rejects corrupt normalized quota", () => {
  const fs = memoryFs({ "/data/quotix-quota-cache-codex.json": JSON.stringify({ updatedAt: "bad" }) });
  assert.equal(createQuotaCache("/data", "codex", fs.deps).load(), null);
});

test("Claude reads the legacy cache when its provider cache is absent", () => {
  const fs = memoryFs({ "/data/quotix-quota-cache.json": JSON.stringify(quota) });
  assert.deepEqual(createQuotaCache("/data", "claude", fs.deps).load(), quota);
});

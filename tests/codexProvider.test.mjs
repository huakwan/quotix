import assert from "node:assert/strict";
import test from "node:test";

import { quotaFromCodexRateLimits } from "../out/src/quota/model.js";
import { CodexAppServerError } from "../out/src/quota/codex/appServer.js";
import { CodexQuotaProvider } from "../out/src/quota/codex/provider.js";

test("maps the named Codex bucket before the legacy rateLimits field", () => {
  const quota = quotaFromCodexRateLimits({
    rateLimits: { primary: { usedPercent: 99, resetsAt: 1 } },
    rateLimitsByLimitId: { codex: {
      primary: { usedPercent: 11, resetsAt: 200 },
      secondary: { usedPercent: 22, resetsAt: 400 },
    } },
  }, 100);
  assert.equal(quota.session.usedPct, 11);
  assert.equal(quota.weekly.usedPct, 22);
});

test("provider maps success and disposes its client", async () => {
  let disposed = false;
  const client = { readRateLimits: async () => ({ rateLimits: { primary: { usedPercent: 10, resetsAt: 200 } } }), dispose: () => { disposed = true; } };
  const provider = new CodexQuotaProvider(client);
  const result = await provider.read(100);
  assert.equal(result.ok, true);
  assert.equal(result.quota.session.usedPct, 10);
  provider.dispose();
  assert.equal(disposed, true);
});

test("provider maps ENOENT and rate limiting safely", async () => {
  const missing = new Error("spawn codex ENOENT"); missing.code = "ENOENT";
  const missingProvider = new CodexQuotaProvider({ readRateLimits: async () => { throw missing; }, dispose() {} });
  assert.deepEqual(await missingProvider.read(100), {
    ok: false, kind: "missing", error: "Codex CLI executable was not found",
  });

  const limited = new CodexAppServerError("request failed 429", 429, { retryAfterSeconds: 75 });
  const limitedProvider = new CodexQuotaProvider({ readRateLimits: async () => { throw limited; }, dispose() {} });
  assert.deepEqual(await limitedProvider.read(100), {
    ok: false, kind: "rate-limited", error: "Codex rate limited", retryAfterSeconds: 75,
  });
});

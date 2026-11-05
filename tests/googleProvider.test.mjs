import assert from "node:assert/strict";
import test from "node:test";
import {
  parseKeychainSecret,
  parseFileToken,
  createCachedGoogleKeyProvider,
} from "../out/src/quota/google/credentials.js";
import { GoogleQuotaProvider } from "../out/src/quota/google/provider.js";
import { quotaFromGoogleQuotaSummary } from "../out/src/quota/model.js";

const sampleSummaryResponse = {
  response: {
    groups: [
      {
        displayName: "Gemini Models",
        description: "Models within this group: Gemini Flash, Gemini Pro",
        buckets: [
          {
            bucketId: "gemini-weekly",
            displayName: "Weekly Limit Remaining",
            window: "weekly",
            remainingFraction: 0.75,
            resetTime: "2026-11-09T12:00:00Z",
          },
          {
            bucketId: "gemini-5h",
            displayName: "Five Hour Limit Remaining",
            window: "5h",
            remainingFraction: 0.9,
            resetTime: "2026-11-05T16:00:00Z",
          },
        ],
      },
      {
        displayName: "Claude and GPT models",
        description: "Models within this group: Claude Opus, Claude Sonnet, GPT-OSS",
        buckets: [
          {
            bucketId: "3p-weekly",
            displayName: "Weekly Limit Remaining",
            window: "weekly",
            remainingFraction: 1,
            resetTime: "2026-11-12T13:00:00Z",
          },
          {
            bucketId: "3p-5h",
            displayName: "Five Hour Limit Remaining",
            window: "5h",
            remainingFraction: 0.8,
            resetTime: "2026-11-05T18:00:00Z",
          },
        ],
      },
      {
        displayName: "Gemini 4 Argon",
        description: "Argon quota is separate.",
        buckets: [
          {
            bucketId: "gemini-argon-wtu-weekly",
            displayName: "Gemini 4 Argon Weekly Limit",
            window: "weekly",
            remainingFraction: 0.7,
            resetTime: "2026-11-11T11:00:00Z",
          },
        ],
      },
    ],
  },
};

test("quotaFromGoogleQuotaSummary maps Gemini, 3P, and Argon buckets", () => {
  const quota = quotaFromGoogleQuotaSummary(sampleSummaryResponse, 1000);
  assert.equal(quota.updatedAt, 1000);
  assert.equal(quota.planDetected, true);

  // Primary windows for tray
  assert.deepEqual(quota.session, {
    usedPct: 10,
    resetsAt: Math.floor(new Date("2026-11-05T16:00:00Z").getTime() / 1000),
  });
  assert.deepEqual(quota.weekly, {
    usedPct: 25,
    resetsAt: Math.floor(new Date("2026-11-09T12:00:00Z").getTime() / 1000),
  });

  // All 5 rows
  assert.ok(quota.extraRows);
  assert.equal(quota.extraRows.length, 5);
  assert.deepEqual(quota.extraRows.map((r) => r.label), ["5H", "7D", "C 5H", "C 7D", "ARGON"]);

  assert.equal(quota.extraRows[0].window?.usedPct, 10);
  assert.equal(quota.extraRows[0].periodSeconds, 5 * 3600);

  assert.equal(quota.extraRows[1].window?.usedPct, 25);
  assert.equal(quota.extraRows[1].periodSeconds, 7 * 24 * 3600);

  assert.equal(quota.extraRows[2].window?.usedPct, 20);
  assert.equal(quota.extraRows[2].periodSeconds, 5 * 3600);

  assert.equal(quota.extraRows[3].window?.usedPct, 0);
  assert.equal(quota.extraRows[3].periodSeconds, 7 * 24 * 3600);

  assert.equal(quota.extraRows[4].window?.usedPct, 30);
  assert.equal(quota.extraRows[4].periodSeconds, 7 * 24 * 3600);
});

test("parseKeychainSecret decodes base64 go-keyring JSON and detects expiration", () => {
  const futureExpiry = new Date(Date.now() + 3600_000).toISOString();
  const validPayload = Buffer.from(
    JSON.stringify({ token: { access_token: "secret-token", expiry: futureExpiry } }),
  ).toString("base64");

  const valid = parseKeychainSecret(`go-keyring-base64:${validPayload}`);
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.credential.kind, "token");
    if (valid.credential.kind === "token") {
      assert.equal(valid.credential.accessToken, "secret-token");
    }
  }

  const pastExpiry = new Date(Date.now() - 1000).toISOString();
  const expiredPayload = Buffer.from(
    JSON.stringify({ token: { access_token: "old-token", expiry: pastExpiry } }),
  ).toString("base64");

  const expired = parseKeychainSecret(`go-keyring-base64:${expiredPayload}`);
  assert.deepEqual(expired, { ok: false, reason: "expired" });

  assert.deepEqual(parseKeychainSecret("bad:data"), { ok: false, reason: "corrupt" });
});

test("parseFileToken extracts access_token from file format", () => {
  const future = Date.now() + 3600_000;
  const json = JSON.stringify({ access_token: "file-token", expiry_date: future });
  const result = parseFileToken(json);
  assert.equal(result.ok, true);
  if (result.ok && result.credential.kind === "token") {
    assert.equal(result.credential.accessToken, "file-token");
  }

  const expiredJson = JSON.stringify({ access_token: "file-token", expiry_date: Date.now() - 1000 });
  assert.deepEqual(parseFileToken(expiredJson), { ok: false, reason: "expired" });
});

test("GoogleQuotaProvider polls daemon when available", async () => {
  let calledUrl = "";
  let calledHeaders = {};
  const mockFetch = async (url, init) => {
    calledUrl = url;
    calledHeaders = init?.headers ?? {};
    return new Response(JSON.stringify(sampleSummaryResponse), { status: 200 });
  };

  const provider = new GoogleQuotaProvider({
    keyProvider: {
      get: async () => ({
        ok: true,
        credential: { kind: "daemon", httpPort: 60169, csrfToken: "csrf-123" },
      }),
      invalidate: () => {},
    },
    fetchImpl: mockFetch,
  });

  const res = await provider.read(2000);
  assert.equal(res.ok, true);
  assert.match(calledUrl, /http:\/\/127\.0\.0\.1:60169\/exa\.language_server_pb\.LanguageServerService\/RetrieveUserQuotaSummary/);
  assert.equal(calledHeaders["X-Codeium-Csrf-Token"], "csrf-123");
  if (res.ok) {
    assert.equal(res.quota.extraRows?.length, 5);
  }
});

test("GoogleQuotaProvider falls back to direct API on daemon failure", async () => {
  let attempts = 0;
  let directCalled = false;

  const mockFetch = async (url, init) => {
    attempts += 1;
    if (url.includes("127.0.0.1")) {
      throw new Error("connect ECONNREFUSED");
    }
    directCalled = true;
    assert.equal(init?.headers?.["Authorization"], "Bearer direct-token");
    assert.match(init?.headers?.["User-Agent"], /Antigravity/);
    return new Response(JSON.stringify(sampleSummaryResponse), { status: 200 });
  };

  let credKind = "daemon";
  const provider = new GoogleQuotaProvider({
    keyProvider: {
      get: async () => {
        if (credKind === "daemon") {
          return {
            ok: true,
            credential: { kind: "daemon", httpPort: 60169, csrfToken: "csrf-123" },
          };
        }
        return {
          ok: true,
          credential: { kind: "token", accessToken: "direct-token", expiresAt: Date.now() + 3600_000 },
        };
      },
      invalidate: () => {
        credKind = "token";
      },
    },
    fetchImpl: mockFetch,
  });

  const res = await provider.read(3000);
  assert.equal(res.ok, true);
  assert.equal(directCalled, true);
});

test("GoogleQuotaProvider maps 401, 403, 429, and network error", async () => {
  let invalidated = false;
  const h = (status, body = "{}", retryAfter = null) => {
    return new GoogleQuotaProvider({
      keyProvider: {
        get: async () => ({
          ok: true,
          credential: { kind: "token", accessToken: "tok", expiresAt: Date.now() + 3600_000 },
        }),
        invalidate: () => { invalidated = true; },
      },
      fetchImpl: async () => new Response(body, {
        status,
        headers: retryAfter ? { "retry-after": retryAfter } : {},
      }),
    });
  };

  const p401 = h(401);
  const r401 = await p401.read(100);
  assert.equal(r401.ok, false);
  if (!r401.ok) {
    assert.equal(r401.kind, "auth");
    assert.equal(invalidated, true);
  }

  const p403 = h(403);
  const r403 = await p403.read(100);
  assert.equal(r403.ok, false);
  if (!r403.ok) {
    assert.equal(r403.kind, "missing");
  }

  const p429 = h(429, "{}", "60");
  const r429 = await p429.read(100);
  assert.equal(r429.ok, false);
  if (!r429.ok) {
    assert.equal(r429.kind, "rate-limited");
    assert.equal(r429.retryAfterSeconds, 60);
  }
});


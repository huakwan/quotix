import assert from "node:assert/strict";
import test from "node:test";

import {
  parseOAuthCredentials,
  refreshAccessToken,
  applyRefreshedTokens,
  createCachedTokenProvider,
} from "../out/src/quota/claude/credentials.js";

const BLOB = JSON.stringify({
  claudeAiOauth: {
    accessToken: "old-access",
    refreshToken: "old-refresh",
    expiresAt: 1000,
    refreshTokenExpiresAt: 9_000_000,
    scopes: ["user:inference"],
    subscriptionType: "team",
    rateLimitTier: "tier-x",
  },
});

test("parseOAuthCredentials extracts token fields and keeps raw blob", () => {
  const result = parseOAuthCredentials(BLOB);
  assert.equal(result.ok, true);
  assert.equal(result.raw, BLOB);
  assert.deepEqual(result.creds, {
    accessToken: "old-access",
    refreshToken: "old-refresh",
    expiresAt: 1000,
    refreshTokenExpiresAt: 9_000_000,
  });
});

test("parseOAuthCredentials rejects blob without access token", () => {
  const result = parseOAuthCredentials(JSON.stringify({ claudeAiOauth: { refreshToken: "x" } }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "corrupt");
});

test("refreshAccessToken posts refresh grant and maps the response", async () => {
  let captured;
  const result = await refreshAccessToken("old-refresh", {
    now: () => 5000,
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return new Response(JSON.stringify({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 3600,
      }), { status: 200 });
    },
  });
  assert.equal(captured.url, "https://console.anthropic.com/v1/oauth/token");
  assert.equal(captured.init.method, "POST");
  const body = JSON.parse(captured.init.body);
  assert.equal(body.grant_type, "refresh_token");
  assert.equal(body.refresh_token, "old-refresh");
  assert.equal(body.client_id, "9d1c250a-e61b-44d9-88ed-5944d1962f5e");
  assert.equal(result.ok, true);
  assert.deepEqual(result.creds, {
    accessToken: "new-access",
    refreshToken: "new-refresh",
    expiresAt: 5000 + 3600 * 1000,
    refreshTokenExpiresAt: null,
  });
});

test("refreshAccessToken maps non-2xx to a safe failure", async () => {
  const result = await refreshAccessToken("dead-refresh", {
    now: () => 0,
    fetchImpl: async () => new Response("", { status: 400 }),
  });
  assert.deepEqual(result, { ok: false, reason: "HTTP 400" });
});

test("refreshAccessToken never leaks token in network error", async () => {
  const result = await refreshAccessToken("secret", {
    now: () => 0,
    fetchImpl: async () => { throw new TypeError("secret in url"); },
  });
  assert.equal(result.ok, false);
  assert.ok(!result.reason.includes("secret"));
});

test("applyRefreshedTokens overwrites tokens but keeps other fields", () => {
  const merged = applyRefreshedTokens(BLOB, {
    accessToken: "new-access",
    refreshToken: "new-refresh",
    expiresAt: 8000,
    refreshTokenExpiresAt: null,
  });
  const oauth = JSON.parse(merged).claudeAiOauth;
  assert.equal(oauth.accessToken, "new-access");
  assert.equal(oauth.refreshToken, "new-refresh");
  assert.equal(oauth.expiresAt, 8000);
  // null from response keeps the previous refresh-token expiry
  assert.equal(oauth.refreshTokenExpiresAt, 9_000_000);
  assert.equal(oauth.subscriptionType, "team");
  assert.deepEqual(oauth.scopes, ["user:inference"]);
  assert.equal(oauth.rateLimitTier, "tier-x");
});

test("provider refreshes an expired access token and writes it back", async () => {
  let t = 100_000;
  const written = [];
  let refreshCalls = 0;
  const provider = createCachedTokenProvider({
    readSync: () => parseOAuthCredentials(BLOB),
    readAsync: async () => parseOAuthCredentials(BLOB),
    refresh: async (refreshToken) => {
      refreshCalls += 1;
      assert.equal(refreshToken, "old-refresh");
      return {
        ok: true,
        creds: {
          accessToken: "new-access",
          refreshToken: "new-refresh",
          expiresAt: t + 3600 * 1000,
          refreshTokenExpiresAt: null,
        },
      };
    },
    writeBlob: (blob) => written.push(blob),
    now: () => t,
    refreshMs: 30_000,
  });

  // access token expiresAt=1000 (ms) is far in the past -> refresh triggered
  provider.get();
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(refreshCalls, 1);
  assert.equal(written.length, 1);
  assert.equal(JSON.parse(written[0]).claudeAiOauth.accessToken, "new-access");
  assert.deepEqual(provider.get(), { ok: true, token: "new-access" });
});

test("provider does not refresh when refresh token is itself expired", async () => {
  const t = 10_000_000;
  let refreshCalls = 0;
  const provider = createCachedTokenProvider({
    readSync: () => parseOAuthCredentials(BLOB),
    readAsync: async () => parseOAuthCredentials(BLOB),
    refresh: async () => { refreshCalls += 1; return { ok: false, reason: "unused" }; },
    writeBlob: () => {},
    now: () => t, // past refreshTokenExpiresAt (9_000_000)
    refreshMs: 30_000,
  });

  provider.get();
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(refreshCalls, 0);
  assert.equal(provider.get().ok, false);
});

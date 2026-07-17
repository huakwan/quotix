import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import { CodexAppServerClient } from "../out/src/quota/codex/appServer.js";

function fakeChild(onMessage) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => { child.killed = true; };
  let pending = "";
  child.stdin.on("data", (chunk) => {
    pending += chunk.toString();
    for (;;) {
      const newline = pending.indexOf("\n");
      if (newline < 0) break;
      const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
      onMessage(JSON.parse(line), child);
    }
  });
  return child;
}

test("initializes once and reads account rate limits", async () => {
  const messages = [];
  const child = fakeChild((message, process) => {
    messages.push(message);
    if (message.method === "initialize") process.stdout.write(`${JSON.stringify({ id: message.id, result: {} })}\n`);
    if (message.method === "account/rateLimits/read") {
      process.stdout.write(`${JSON.stringify({ id: message.id, result: { rateLimits: { primary: null } } })}\n`);
    }
  });
  const client = new CodexAppServerClient(() => child, "1.2.3", 1000);
  assert.deepEqual(await client.readRateLimits(), { rateLimits: { primary: null } });
  assert.equal(messages.filter((m) => m.method === "initialize").length, 1);
  assert.equal(messages.some((m) => m.method === "initialized"), true);
  client.dispose();
  assert.equal(child.killed, true);
});

test("request timeout kills the failed app-server process", async () => {
  const child = fakeChild(() => {});
  const client = new CodexAppServerClient(() => child, "1.0.0", 10);
  await assert.rejects(client.readRateLimits(), /initialize timed out/);
  assert.equal(child.killed, true);
});

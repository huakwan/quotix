import assert from "node:assert/strict";
import test from "node:test";
import { promptPayPayload } from "../out/src/payment/promptPay.js";

test("creates a static PromptPay QR payload for a Thai mobile number", () => {
  assert.equal(
    promptPayPayload("090-281-1123"),
    "00020101021129370016A000000677010111011300669028111235802TH530376463044157",
  );
});

test("rejects malformed PromptPay phone numbers", () => {
  assert.throws(() => promptPayPayload("902811123"), /10 digits/);
  assert.throws(() => promptPayPayload("09028111234"), /10 digits/);
});

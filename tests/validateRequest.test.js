import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCompanyParam } from "../src/validateRequest.js";

test("accepts a normal company name", () => {
  const result = validateCompanyParam("SAP SE");
  assert.equal(result.valid, true);
  assert.equal(result.error, null);
});

test("rejects empty string", () => {
  const result = validateCompanyParam("");
  assert.equal(result.valid, false);
  assert.equal(result.error, "company is empty");
});

test("rejects whitespace-only", () => {
  const result = validateCompanyParam("   ");
  assert.equal(result.valid, false);
  assert.equal(result.error, "company is empty");
});

test("rejects null and undefined", () => {
  assert.equal(validateCompanyParam(null).valid, false);
  assert.equal(validateCompanyParam(undefined).valid, false);
});

test("rejects 'Unknown' (case-insensitive)", () => {
  assert.equal(validateCompanyParam("Unknown").valid, false);
  assert.equal(validateCompanyParam("UNKNOWN").valid, false);
  assert.equal(validateCompanyParam("unknown").valid, false);
  assert.equal(validateCompanyParam("Unknown Company").valid, false);
});

test("rejects 'N/A' variants", () => {
  assert.equal(validateCompanyParam("N/A").valid, false);
  assert.equal(validateCompanyParam("n.a.").valid, false);
  assert.equal(validateCompanyParam("na").valid, false);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePatch } from "../src/validatePatch.js";

// Valid IDs from data/resume.json (CLAUDE.md Entry ID Quick Reference)
const WORK_ID_1 = "286ca64e-9ab1-4d32-9905-0996d5d6a5c1";
const SKILL_ID_1 = "9a905d12-825c-4090-a90c-3ff010a9d8b4";

test("null patch is invalid", () => {
  const r = validatePatch(null);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes("plain object")));
});

test("string patch is invalid", () => {
  const r = validatePatch("hello");
  assert.equal(r.valid, false);
});

test("array patch is invalid", () => {
  const r = validatePatch([{ jobTitle: "Dev" }]);
  assert.equal(r.valid, false);
});

test("patch with _error is invalid", () => {
  const r = validatePatch({ _error: "AI parse failed: unexpected token" });
  assert.equal(r.valid, false);
  assert.ok(r.errors[0].includes("AI parse failed"));
});

test("completely empty object patch is invalid", () => {
  const r = validatePatch({});
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes("no actionable content")));
});

test("patch with only whitespace jobTitle is invalid", () => {
  const r = validatePatch({ jobTitle: "   " });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes("no actionable content")));
});

test("patch with valid jobTitle is valid", () => {
  const r = validatePatch({ jobTitle: "Salesforce Developer" });
  assert.equal(r.valid, true);
  assert.deepEqual(r.errors, []);
});

test("patch with valid work ID is valid with no warnings", () => {
  const r = validatePatch({
    work: [{ id: WORK_ID_1, description: "<ul><li><p>Did stuff</p></li></ul>" }],
  });
  assert.equal(r.valid, true);
  assert.equal(r.warnings.length, 0);
});

test("patch with unknown work ID produces warning not error", () => {
  const r = validatePatch({
    work: [{ id: "00000000-0000-0000-0000-000000000000", description: "<p>text</p>" }],
  });
  assert.equal(r.valid, true);
  assert.ok(r.warnings.some((w) => w.includes("unknown work id")));
});

test("patch with valid skill ID is valid with no warnings", () => {
  const r = validatePatch({
    skills: [{ id: SKILL_ID_1, infoHtml: "<p>Apex, LWC</p>" }],
  });
  assert.equal(r.valid, true);
  assert.equal(r.warnings.length, 0);
});

test("patch with unknown skill ID produces warning not error", () => {
  const r = validatePatch({
    skills: [{ id: "00000000-0000-0000-0000-000000000000", infoHtml: "<p>text</p>" }],
  });
  assert.equal(r.valid, true);
  assert.ok(r.warnings.some((w) => w.includes("unknown skill id")));
});

test("patch.work as non-array produces error", () => {
  const r = validatePatch({ work: "not an array" });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes("work must be an array")));
});

test("patch.skills as non-array produces error", () => {
  const r = validatePatch({ skills: 42 });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes("skills must be an array")));
});

test("work item missing id produces warning not error", () => {
  const r = validatePatch({
    work: [{ description: "<p>text</p>" }],
  });
  assert.equal(r.valid, true);
  assert.ok(r.warnings.some((w) => w.includes("missing id")));
});

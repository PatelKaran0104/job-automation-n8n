# Job Pipeline Phase 0 — Quick Wins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the highest-leverage quality fixes from the design spec without architectural changes, so the user can resume submitting applications at the end of Phase 0 with materially better outputs while Phases 1-3 land in parallel.

**Architecture:** No new pipeline structure. We touch one n8n workflow file (`data/Job_Application_Automator_v6.json`), three Express modules (`src/server.js`, `src/mergePatch.js`, `src/validatePatch.js`), two HTML builders (`src/buildResumeHtml.js`, `src/mergeCoverLetter.js`), the base resume content (`data/resume.json`), and add three new pure-logic modules under `src/` with unit tests.

**Tech Stack:** Node.js ES modules, Express 4.18.2, Playwright 1.43.0, `node:test`, n8n (workflow JSON editing — no n8n CLI), Google Sheets schema editing (manual).

**Spec reference:** [`docs/superpowers/specs/2026-05-06-job-pipeline-quality-overhaul-design.md`](../specs/2026-05-06-job-pipeline-quality-overhaul-design.md) §7 Phase 0.

---

## File Structure

**New files:**
- `src/jdQualityGate.js` — pure function `evaluateJdQuality(job)`; deterministic JD-quality checks. Inlined into n8n node after testing.
- `src/languageGate.js` — pure function `decideLanguage({ description, languageRequirements })`; deterministic DE/EN decision. Inlined into n8n node after testing.
- `src/validateRequest.js` — pure function `validateCompanyParam(company)`; reused by both PDF endpoints in `server.js`.
- `tests/jdQualityGate.test.js`
- `tests/languageGate.test.js`
- `tests/validateRequest.test.js`
- `tests/visibilityLists.test.js` (covers `mergePatch.js` + `validatePatch.js` visibility-list behavior)

**Modified files:**
- `data/Job_Application_Automator_v6.json` — multiple node edits (reasoning effort, match threshold, fallback flag, JD Quality Gate node, Language Gate node, banned phrase list, tailor-prompt visibility instruction).
- `data/resume.json` — manual AI-smell cleanup of profile + bullets.
- `src/server.js` — call `validateCompanyParam` in both endpoints; integrate `validateRequest.js`.
- `src/mergePatch.js` — enforce `visibleWorkIds`, `visibleSkillIds`, `visibleProjectIds` when present.
- `src/validatePatch.js` — allow optional visibility-list fields; warn (don't error) on unknown IDs in those lists.
- `src/buildResumeHtml.js` — `white-space: nowrap` on phone span to prevent line splits.
- `src/mergeCoverLetter.js` — `white-space: nowrap` on phone fragment in footer; ensure `<br/>` separation in header-contact.
- `package.json` — add new test files to `test:unit` script.

**Untouched (intentional):**
- All other `src/` files
- All Apify scrapers
- The Playwright PDF rendering itself (font, layout, page-break logic)

---

## Task 1: Bump `reasoning.effort` from `minimal` to `medium`

**Why:** Single highest-leverage change in Phase 0 per the spec. The current tailor call asks the model for a high-stakes nuanced rewrite under "minimal" reasoning effort.

**Files:**
- Modify: `data/Job_Application_Automator_v6.json` (node `13a. Build Tailor Prompt`)

- [ ] **Step 1: Locate the tailor prompt node**

Open `data/Job_Application_Automator_v6.json` in an editor that handles long lines. Find the node by name `"13a. Build Tailor Prompt"`. Inside its `jsCode` parameter (a JSON-string-escaped JavaScript blob), search for the substring:

```
reasoning: { effort: 'minimal' }
```

The exact context within the escaped JS is:
```
_openAIBody: {\n      model: $('1. Manual Configuration').first().json.openaiModel || 'gpt-5-mini',\n      reasoning: { effort: 'minimal' },\n
```

- [ ] **Step 2: Replace with `'medium'`**

Change `effort: 'minimal'` to `effort: 'medium'`. Save the file.

- [ ] **Step 3: Smoke-test in n8n**

Restart the n8n container if running, re-import the workflow if needed. Trigger node `1. Manual Configuration` → run a single job through. Verify in n8n's execution log that the OpenAI request body shows `"reasoning":{"effort":"medium"}`.

Expected: a generated CV+CL pair noticeably tighter and more on-language than previous runs. Subjective check; no automated assertion.

- [ ] **Step 4: Commit**

```bash
git add data/Job_Application_Automator_v6.json
git commit -m "feat(pipeline): bump tailor reasoning.effort minimal -> medium

Single highest-leverage quality fix per the Phase 0 design. Asking the
model to do controlled, high-stakes rewrites at 'minimal' effort was a
significant quality killer."
```

---

## Task 2: Match-threshold tiering 45 → 70 + 55–69 review band

**Why:** Today every job at confidence ≥45 enters tailoring, which is exactly where hallucination pressure is highest. Lift auto-pass to 70, route 55–69 to manual review.

**Files:**
- Modify: `data/Job_Application_Automator_v6.json` (node `12. Is Match?` IF node + downstream routing)

- [ ] **Step 1: Locate the IF node**

Find the node `"12. Is Match?"`. Its current condition:

```jsonc
{
  "conditions": [
    { "id": "match-check", "leftValue": "={{ $json.matchResult.match }}", "rightValue": true, "operator": { "type": "boolean", "operation": "true" } },
    { "id": "confidence-check", "leftValue": "={{ $json.matchResult.confidence }}", "rightValue": 45, "operator": { "type": "number", "operation": "gte" } },
    { "id": "2c3865cd-...", "leftValue": "={{ $json.matchResult?._apiError }}", "rightValue": "false", "operator": { "type": "boolean", "operation": "false" } }
  ],
  "combinator": "and"
}
```

- [ ] **Step 2: Change auto-pass threshold from 45 to 70**

In the `confidence-check` condition, change `"rightValue": 45` to `"rightValue": 70`.

- [ ] **Step 3: Add a review-band branch**

The IF node currently has two outputs: TRUE (matched, goes to `13a. Build Tailor Prompt`) and FALSE (skipped, goes to `18a. Prepare Skip Log`).

We need a third tier: confidence 55–69 → still tailor BUT mark `routingDecision.queue = "review"` downstream.

Simplest implementation: keep the IF node with threshold 70, but in `13a. Build Tailor Prompt`'s code add this check at the top:

```javascript
// Tier the match: confidence >=70 is auto, 55-69 is review band
const _confidence = item.matchResult?.confidence ?? 0;
const _tier = _confidence >= 70 ? "auto" : (_confidence >= 55 ? "review" : "skip");
if (_tier === "skip") {
  // Should not happen — IF node filters <70, but defensive
  return { json: { ...item, _routingTier: "skip" } };
}
```

But the IF node currently filters at 70 — so 55-69 jobs would be dropped before reaching the tailor.

Better: **split the IF node into two IF nodes in series.**
- IF #1: confidence ≥ 55 (gate to tailor at all)
- IF #2: confidence ≥ 70 (sets `_routingTier`)

Both pass-paths converge into the tailor; the IF #2 result is stored on the package object as `_routingTier`.

For Phase 0, the simpler change: keep ONE IF node at threshold 55 (was 45), and within `13a. Build Tailor Prompt`, compute `_routingTier = (confidence >= 70) ? "auto" : "review"` and pass it through. The `Auto-Apply Eligibility Gate` does not exist yet (Phase 2), so for Phase 0 we just record `_routingTier` and rely on it downstream.

Make these edits:

In node `12. Is Match?`, change `"rightValue": 70` (set in Step 2) back to **`"rightValue": 55`** (now serving as the floor, not auto-threshold).

In node `13a. Build Tailor Prompt`, at the very top of `jsCode` (right after `const item = $json;`), add:

```javascript
const _confidence = item.matchResult?.confidence ?? 0;
const _routingTier = _confidence >= 70 ? "auto" : "review";
```

Then in the final `return { json: { ...item, _openAIBody, ... } };` block, include `_routingTier`:

```javascript
return {
  json: {
    ...item,
    _routingTier,
    _openAIBody: { /* ... existing ... */ },
  },
};
```

- [ ] **Step 4: Propagate `_routingTier` into the Sheet log**

In node `16. Prepare Sheet Log`, find the return object that builds Sheet rows. Add a new column:

```javascript
'Routing Tier': patchData._routingTier || 'unknown',
```

The Sheet schema in node `17. Log to Google Sheets` needs the new column added to its `schema` array. Find the `"schema": [ ... ]` block and add (between `"Quality"` and the closing bracket):

```jsonc
{
  "id": "Routing Tier",
  "displayName": "Routing Tier",
  "required": false,
  "defaultMatch": false,
  "display": true,
  "type": "string",
  "canBeUsedToMatch": true
}
```

Also add a "Routing Tier" header to the Google Sheet manually before the next run (or let n8n auto-create it).

- [ ] **Step 5: Smoke-test**

Run a batch with mixed confidence scores. Verify the Sheet's "Routing Tier" column shows `auto` for confidence ≥70 and `review` for 55-69. Confidence <55 jobs should not reach the Sheet (they go to skip log).

- [ ] **Step 6: Commit**

```bash
git add data/Job_Application_Automator_v6.json
git commit -m "feat(pipeline): tier match confidence into auto / review bands

Lowest match threshold to enter tailoring is now 55 (was 45). Within the
tailoring flow, confidence >=70 marks _routingTier='auto'; 55-69 marks
'review'. The Sheet now logs which tier each row landed in. The full
Auto-Apply Eligibility Gate (Phase 2) will use this tier alongside other
signals."
```

---

## Task 3: Fallback-model output → Review Queue

**Why:** When the matcher uses `gemini-2.0-flash-lite` fallback, downstream output should be flagged for manual review regardless of confidence score (per spec §5.2 and §5.12).

**Files:**
- Modify: `data/Job_Application_Automator_v6.json` (nodes `10e. Fallback Gemini Call` → `11. Parse Match Result` → `13a. Build Tailor Prompt` → `16. Prepare Sheet Log`)

- [ ] **Step 1: Add `_fallbackModelUsed` flag to fallback path**

Find node `10e. Fallback Gemini Call`. After this node, the flow goes to `11. Parse Match Result`. We need a way to mark items that traversed the fallback path.

Easiest approach: in node `11. Parse Match Result`, detect whether the item came from the fallback by checking which previous node fed it. n8n exposes this via `$input.context` but it's brittle.

Cleaner: in node `10e. Fallback Gemini Call`, add a downstream code node that injects the flag.

Actually the simplest: modify node `11. Parse Match Result` (which currently parses Gemini's response) to detect the fallback path by reading from a new pseudo-flag set upstream.

Cleanest concrete change: between `10e. Fallback Gemini Call` and `11. Parse Match Result`, insert a tiny code node `10f. Mark Fallback`:

```javascript
// 10f. Mark Fallback — runs only on the fallback branch
return {
  json: {
    ...$json,
    _fallbackModelUsed: true,
  },
};
```

Wire `10e. Fallback Gemini Call` → `10f. Mark Fallback` → `11. Parse Match Result`.

Confirm via n8n UI: only the fallback branch passes through `10f`.

- [ ] **Step 2: Propagate flag into match result**

In node `11. Parse Match Result`, the `matchResult` object is constructed. Modify both the success and error branches to include `_fallbackModelUsed`:

```javascript
return {
  json: {
    ...cleanJobData,
    matchResult: { ...result, _apiError: false, _fallbackModelUsed: cleanJobData._fallbackModelUsed === true },
  },
};
```

Apply similarly to the error branch (where `matchResult: { match: false, ... }` is built).

- [ ] **Step 3: Force `_routingTier = "review"` when fallback was used**

In node `13a. Build Tailor Prompt` (added in Task 2), update the routing tier logic:

```javascript
const _confidence = item.matchResult?.confidence ?? 0;
const _fallbackUsed = item.matchResult?._fallbackModelUsed === true;
const _routingTier = (_fallbackUsed) ? "review" : (_confidence >= 70 ? "auto" : "review");
```

- [ ] **Step 4: Surface in Sheet log**

In node `16. Prepare Sheet Log`, add to the row builder:

```javascript
'Fallback Model Used': patchData.matchResult?._fallbackModelUsed === true ? 'Yes' : 'No',
```

And add the Sheet schema entry in node `17. Log to Google Sheets` (same pattern as Task 2 Step 4).

- [ ] **Step 5: Smoke-test**

Trigger the fallback by setting an invalid Gemini API key for the primary model, then a valid one for the fallback. Run one job. Verify:
- Sheet row shows `Fallback Model Used = Yes`
- Sheet row shows `Routing Tier = review` (regardless of confidence)

- [ ] **Step 6: Commit**

```bash
git add data/Job_Application_Automator_v6.json
git commit -m "feat(pipeline): route fallback-model outputs to review tier

Adds 10f. Mark Fallback node and propagates _fallbackModelUsed through
to Sheet log. Items that traversed the gemini-2.0-flash-lite fallback
path are flagged review regardless of confidence."
```

---

## Task 4: JD Quality Gate

**Why:** Cheap deterministic gate that drops broken scrapes (truncated text, missing company, navigation-only content) before spending LLM tokens on them.

**Files:**
- Create: `src/jdQualityGate.js`
- Create: `tests/jdQualityGate.test.js`
- Modify: `package.json` (add to `test:unit`)
- Modify: `data/Job_Application_Automator_v6.json` (insert new node after `4. Normalize & Merge Jobs`)

- [ ] **Step 1: Write failing test**

Create `tests/jdQualityGate.test.js`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateJdQuality } from "../src/jdQualityGate.js";

test("rejects when description is shorter than 600 chars", () => {
  const job = {
    title: "Software Developer",
    company: "Acme",
    description: "Short JD".repeat(10), // ~80 chars
  };
  const result = evaluateJdQuality(job);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "description_too_short");
});

test("rejects when company is empty", () => {
  const job = {
    title: "Software Developer",
    company: "",
    description: "x".repeat(700) + " responsibilities: build things",
  };
  const result = evaluateJdQuality(job);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "company_missing");
});

test("rejects when company is literally 'Unknown'", () => {
  const job = {
    title: "Software Developer",
    company: "Unknown",
    description: "x".repeat(700) + " responsibilities: build things",
  };
  const result = evaluateJdQuality(job);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "company_missing");
});

test("rejects when title is empty", () => {
  const job = {
    title: "",
    company: "Acme",
    description: "x".repeat(700) + " responsibilities: build things",
  };
  const result = evaluateJdQuality(job);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "title_missing");
});

test("rejects when JD has no responsibility/requirement signal", () => {
  const job = {
    title: "Software Developer",
    company: "Acme",
    description: "x".repeat(700), // 700 chars but no keyword
  };
  const result = evaluateJdQuality(job);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no_jd_structure");
});

test("rejects boilerplate-heavy text", () => {
  const job = {
    title: "Software Developer",
    company: "Acme",
    description:
      "responsibilities: build things. " +
      ("cookie privacy policy impressum equal opportunity employer datenschutz cookie ".repeat(30)),
  };
  const result = evaluateJdQuality(job);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "boilerplate_heavy");
});

test("accepts a normal-looking JD with English keywords", () => {
  const job = {
    title: "Software Developer",
    company: "Acme",
    description:
      "We are looking for a software developer. " +
      "Responsibilities: build features, write tests, review PRs. " +
      "Requirements: 2+ years JS, Node, React. ".repeat(8),
  };
  const result = evaluateJdQuality(job);
  assert.equal(result.ok, true);
  assert.equal(result.reason, null);
});

test("accepts a normal-looking JD with German keywords", () => {
  const job = {
    title: "Softwareentwickler",
    company: "Acme GmbH",
    description:
      "Wir suchen einen Softwareentwickler. " +
      "Deine Aufgaben: Features bauen, Tests schreiben. " +
      "Was du mitbringst: 2+ Jahre Erfahrung. ".repeat(8),
  };
  const result = evaluateJdQuality(job);
  assert.equal(result.ok, true);
  assert.equal(result.reason, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit`

Expected: failure because `tests/jdQualityGate.test.js` is not yet in the `test:unit` script (and the module doesn't exist). The error will be one of two: either "Cannot find module" if you ran the file directly, or "no such file" from Node test runner when included in `test:unit`.

- [ ] **Step 3: Add the test file to `package.json`**

In `package.json`, change `test:unit`:

```jsonc
"test:unit": "node --test tests/validatePatch.test.js tests/coverletterEmptyBody.test.js tests/validateCoverLetter.test.js tests/jdQualityGate.test.js"
```

Run again: `npm run test:unit`. Now it should fail because `src/jdQualityGate.js` does not exist.

- [ ] **Step 4: Implement the module**

Create `src/jdQualityGate.js`:

```javascript
// src/jdQualityGate.js
// Deterministic JD-quality gate. Rejects scrapes that are too broken to
// produce decent tailoring, before spending LLM tokens on them.

const JD_STRUCTURE_PATTERN = /responsibilities|requirements|qualifications|tasks|aufgaben|profil|anforderungen|qualifikation|deine aufgaben|das bringst du mit|womit du arbeitest|was du mitbringst|must.haves|nice.to.haves/i;
const BOILERPLATE_PATTERN = /cookie|datenschutz|privacy policy|impressum|equal opportunity employer|gleiche chancen|legal notice|terms of service|nutzungsbedingungen/gi;

const MIN_DESCRIPTION_CHARS = 600;
const MAX_BOILERPLATE_RATIO = 0.7;

/**
 * @param {{ title?: string, company?: string, description?: string }} job
 * @returns {{ ok: boolean, reason: string | null }}
 */
export function evaluateJdQuality(job) {
  const title = String(job?.title || "").trim();
  const company = String(job?.company || "").trim();
  const description = String(job?.description || "");

  if (!title) return { ok: false, reason: "title_missing" };

  if (!company || /^unknown$/i.test(company) || /^n\.?\s*a\.?$/i.test(company)) {
    return { ok: false, reason: "company_missing" };
  }

  if (description.length < MIN_DESCRIPTION_CHARS) {
    return { ok: false, reason: "description_too_short" };
  }

  if (!JD_STRUCTURE_PATTERN.test(description)) {
    return { ok: false, reason: "no_jd_structure" };
  }

  // Boilerplate density: count bytes matched by boilerplate pattern, divide by total.
  const boilerplateMatches = description.match(BOILERPLATE_PATTERN) || [];
  const boilerplateChars = boilerplateMatches.reduce((sum, m) => sum + m.length, 0);
  const ratio = boilerplateChars / description.length;
  // Heuristic: if 5%+ of the description is boilerplate keywords, the
  // surrounding navigation/footer/legal text is likely dominating.
  if (ratio > 0.05 && boilerplateMatches.length > 8) {
    return { ok: false, reason: "boilerplate_heavy" };
  }

  return { ok: true, reason: null };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:unit`

Expected: all 8 tests pass.

If the boilerplate-heavy test fails (it's a heuristic), tune the threshold inside `evaluateJdQuality` until it passes the test fixture without breaking the "accepts normal JD" tests.

- [ ] **Step 6: Add new n8n node `5 (gate). JD Quality Gate`**

In `data/Job_Application_Automator_v6.json`, add a new code node positioned between `4. Normalize & Merge Jobs` and `5. Sync Jobs + Sheet`. Name it `4a. JD Quality Gate`.

Inline the logic from `src/jdQualityGate.js` (n8n Code nodes don't import local modules). The node's `jsCode` (per-item mode):

```javascript
// 4a. JD Quality Gate — deterministic; rejects malformed scrapes before LLM spend.
// Source of truth: src/jdQualityGate.js (kept in sync manually).

const job = $json;
const title = String(job?.title || "").trim();
const company = String(job?.company || "").trim();
const description = String(job?.description || "");

const JD_STRUCTURE_PATTERN = /responsibilities|requirements|qualifications|tasks|aufgaben|profil|anforderungen|qualifikation|deine aufgaben|das bringst du mit|womit du arbeitest|was du mitbringst|must.haves|nice.to.haves/i;
const BOILERPLATE_PATTERN = /cookie|datenschutz|privacy policy|impressum|equal opportunity employer|gleiche chancen|legal notice|terms of service|nutzungsbedingungen/gi;

let reject_reason = null;
if (!title) reject_reason = "title_missing";
else if (!company || /^unknown$/i.test(company) || /^n\.?\s*a\.?$/i.test(company)) reject_reason = "company_missing";
else if (description.length < 600) reject_reason = "description_too_short";
else if (!JD_STRUCTURE_PATTERN.test(description)) reject_reason = "no_jd_structure";
else {
  const matches = description.match(BOILERPLATE_PATTERN) || [];
  const boilerplateChars = matches.reduce((s, m) => s + m.length, 0);
  if (boilerplateChars / description.length > 0.05 && matches.length > 8) {
    reject_reason = "boilerplate_heavy";
  }
}

return {
  json: {
    ...job,
    _jdQuality: {
      ok: reject_reason === null,
      reason: reject_reason,
    },
  },
};
```

Then add an IF node `4b. JD Quality OK?` after this:
- Condition: `={{ $json._jdQuality.ok }}` is true
- TRUE → continues to `5. Sync Jobs + Sheet`
- FALSE → goes to a new code node `4c. Log Bad JD` that prepares a row for the Rejected JDs sheet, then to a Google Sheets append node targeting a tab named "Rejected JDs"

`4c. Log Bad JD` jsCode:

```javascript
const job = $json;
const now = new Date();
return {
  json: {
    Date: now.toISOString().slice(0, 10),
    Company: job.company || '',
    Role: job.title || '',
    Source: job.source || '',
    'Job URL': job.url || '',
    'Reject Reason': 'jd_quality_low',
    'Reject Detail': job._jdQuality?.reason || 'unknown',
  },
};
```

Wire `4c. Log Bad JD` → a new Google Sheets node `4d. Log Bad JD Sheet` configured to append to a "Rejected JDs" sheet (create the sheet manually first; columns: Date, Company, Role, Source, Job URL, Reject Reason, Reject Detail).

- [ ] **Step 7: Smoke-test the n8n integration**

Run a batch including a known-bad scrape (e.g., manually inject an item with empty description). Verify:
- Bad item lands in "Rejected JDs" sheet with `Reject Reason: jd_quality_low` and a meaningful detail.
- Good items continue normally to `5. Sync Jobs + Sheet`.

- [ ] **Step 8: Commit**

```bash
git add src/jdQualityGate.js tests/jdQualityGate.test.js package.json data/Job_Application_Automator_v6.json
git commit -m "feat(quality): add deterministic JD quality gate

Drops scrapes with missing title/company, descriptions <600 chars, no
responsibility/requirement section, or boilerplate-dominated text. Saves
LLM tokens on garbage inputs and routes them to a Rejected JDs sheet.
Logic lives in src/jdQualityGate.js with unit tests; n8n node 4a inlines
the same logic (kept in sync manually)."
```

---

## Task 5: Language Decision Gate

**Why:** Currently the tailor prompt detects language as part of its output. That's a degree of freedom that can go wrong (mixed DE/EN bullets). A deterministic detector decides language before the tailor runs.

**Files:**
- Create: `src/languageGate.js`
- Create: `tests/languageGate.test.js`
- Modify: `package.json`
- Modify: `data/Job_Application_Automator_v6.json` (new node before `13a. Build Tailor Prompt`; tailor prompt accepts `outputLanguage` as input)

- [ ] **Step 1: Write failing test**

Create `tests/languageGate.test.js`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideLanguage } from "../src/languageGate.js";

test("majority-German JD returns 'de'", () => {
  const description =
    "Wir suchen einen Softwareentwickler für unser Team in München. " +
    "Deine Aufgaben umfassen die Entwicklung von Webanwendungen. " +
    "Du arbeitest mit modernen Technologien und einem agilen Team. ".repeat(5);
  const result = decideLanguage({ description, languageRequirements: [] });
  assert.equal(result, "de");
});

test("majority-English JD returns 'en'", () => {
  const description =
    "We are looking for a software developer to join our team in Berlin. " +
    "Your responsibilities include building web applications using modern " +
    "frameworks. You'll work with a friendly agile team. ".repeat(5);
  const result = decideLanguage({ description, languageRequirements: [] });
  assert.equal(result, "en");
});

test("English JD with hard German C1 still returns 'en' (Phase 0 behavior)", () => {
  const description =
    "We are looking for a developer. Responsibilities: build features. " +
    "Requirements: 2+ years experience. ".repeat(5);
  const result = decideLanguage({
    description,
    languageRequirements: [{ language: "de", level: "C1", hard: true }],
  });
  assert.equal(result, "en");
});

test("English JD with German nice-to-have returns 'en'", () => {
  const description =
    "We are looking for a developer. Responsibilities: build features. " +
    "Requirements: 2+ years experience. ".repeat(5);
  const result = decideLanguage({
    description,
    languageRequirements: [{ language: "de", level: "B1", hard: false }],
  });
  assert.equal(result, "en");
});

test("empty description defaults to 'en'", () => {
  const result = decideLanguage({ description: "", languageRequirements: [] });
  assert.equal(result, "en");
});

test("bilingual JD with German requirements section returns 'de'", () => {
  const description =
    "We are a Berlin-based startup looking for a developer. " +
    "Anforderungen: 2+ Jahre Erfahrung mit JavaScript. " +
    "Du solltest mit modernen Frameworks vertraut sein. " +
    "Deine Aufgaben umfassen die Entwicklung neuer Features. ".repeat(3);
  const result = decideLanguage({ description, languageRequirements: [] });
  // Heuristic: German tokens dominate when the requirements section is German.
  // If this assertion is wrong for the chosen heuristic, adjust the heuristic
  // to give extra weight to the requirements section (per spec §5.4 rule 4).
  assert.equal(result, "de");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit` (after adding the file to `package.json`).

Expected: tests fail because `src/languageGate.js` doesn't exist.

- [ ] **Step 3: Add to `package.json`**

```jsonc
"test:unit": "node --test tests/validatePatch.test.js tests/coverletterEmptyBody.test.js tests/validateCoverLetter.test.js tests/jdQualityGate.test.js tests/languageGate.test.js"
```

- [ ] **Step 4: Implement the module**

Create `src/languageGate.js`:

```javascript
// src/languageGate.js
// Deterministic language decision. Decides ONLY language, never eligibility.
// Hard German C1+ unsupported is handled by Claim Ledger as fatal_gap (Phase 2).

// Common German tokens unlikely to appear in English JDs. Used as a tie-breaker
// signal — count of these tokens vs total words approximates "German-ness".
const GERMAN_TOKENS = /\b(der|die|das|und|oder|für|mit|bei|von|zu|nach|über|unter|gegen|durch|ohne|aber|wenn|weil|dass|sind|haben|werden|wird|wurde|kann|muss|ist|war|nicht|auch|schon|noch|sehr|viel|mehr|weniger|gut|gute|guten|neuen|alle|jeden|deine|deiner|deinem|unser|unsere|unseren|aufgaben|anforderungen|kenntnisse|erfahrung|fähigkeiten|kollegen|team|umfeld|bereich|möglichkeiten|entwicklung|lösungen)\b/gi;

const HARD_GERMAN_PHRASES = /\b(fluent\s+german|c1\s+german|c2\s+german|native\s+german|verhandlungssicheres?\s+deutsch|sehr\s+gute\s+deutschkenntnisse|deutsch\s+auf\s+muttersprachniveau|deutsch\s+zwingend\s+erforderlich)\b/i;

/**
 * @param {{ description: string, languageRequirements?: Array<{language: string, level: string, hard: boolean}> }} input
 * @returns {"de" | "en"}
 */
export function decideLanguage({ description = "", languageRequirements = [] }) {
  const text = String(description);
  if (text.trim().length === 0) return "en";

  // Token-based German detection.
  const wordCount = (text.match(/\b\w+\b/g) || []).length || 1;
  const germanMatches = (text.match(GERMAN_TOKENS) || []).length;
  const germanRatio = germanMatches / wordCount;

  // Rule 1: majority-German JD body → de
  if (germanRatio > 0.08) return "de";

  // Rules 2-3: language is English by default at this point. Hard German
  // requirement does NOT switch language to de in Phase 0 — Claim Ledger
  // (Phase 2) handles fatal_gap; here we just decide output language.
  return "en";
}
```

(The 8% threshold is a deterministic heuristic that should pass the bilingual test fixture. If a real JD ever lands in the wrong language, tune `germanRatio > 0.08` first.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:unit`. Expected: all 6 language tests pass.

- [ ] **Step 6: Add n8n node `12a. Decide Language`**

Insert a code node between `12. Is Match?` (TRUE branch) and `13a. Build Tailor Prompt`. Name it `12a. Decide Language`. jsCode:

```javascript
// 12a. Decide Language — deterministic; sets outputLanguage as a hard variable
// Source of truth: src/languageGate.js

const item = $json;
const description = String(item.description || "");
const wordCount = (description.match(/\b\w+\b/g) || []).length || 1;

const GERMAN_TOKENS = /\b(der|die|das|und|oder|für|mit|bei|von|zu|nach|über|unter|gegen|durch|ohne|aber|wenn|weil|dass|sind|haben|werden|wird|wurde|kann|muss|ist|war|nicht|auch|schon|noch|sehr|viel|mehr|weniger|gut|gute|guten|neuen|alle|jeden|deine|deiner|deinem|unser|unsere|unseren|aufgaben|anforderungen|kenntnisse|erfahrung|fähigkeiten|kollegen|team|umfeld|bereich|möglichkeiten|entwicklung|lösungen)\b/gi;

const germanMatches = (description.match(GERMAN_TOKENS) || []).length;
const germanRatio = germanMatches / wordCount;
const outputLanguage = germanRatio > 0.08 ? "de" : "en";

return {
  json: {
    ...item,
    outputLanguage,
  },
};
```

- [ ] **Step 7: Make the tailor prompt respect `outputLanguage`**

In node `13a. Build Tailor Prompt`, find the section of the system prompt that handles language detection (the `========== LANGUAGE DETECTION ==========` block).

Replace the entire LANGUAGE DETECTION section in the system prompt with:

```
========================
LANGUAGE
========================

The output language is fixed by the upstream Language Decision Gate. You will receive `outputLanguage` ("de" or "en") in the input — use it exactly. Do NOT re-detect or override.

Write ALL text content (profile, work bullets, project bullets, cover letter) in the specified language.
```

In the same node, in the user message construction, add:

```javascript
const userMsg = `RESUME:
... [existing content] ...

OUTPUT LANGUAGE: ${item.outputLanguage}

JOB DETAILS:
... [existing content] ...`;
```

In the JSON output schema in the system prompt, REMOVE the `language` field from the expected output (it's now an input, not an output):

```jsonc
{
  "patch": { ... },
  "coverLetter": { "paragraph1": "...", "paragraph2": "...", "paragraph3": "..." }
}
```

In node `14. Parse AI Patch`, replace the `language` extraction line:

```javascript
// Old:
// language = result.language === 'en' ? 'en' : 'de';

// New:
const language = $('13a. Build Tailor Prompt').item.json.outputLanguage || 'de';
```

- [ ] **Step 8: Smoke-test**

Run two jobs: one with a clearly German JD and one with a clearly English JD. Verify:
- The Sheet log shows the correct language for each.
- The generated CV has German section headings (`PROFIL`, `BERUFSERFAHRUNG` etc.) for German jobs and English headings for English jobs.
- No mixed-language paragraphs.

- [ ] **Step 9: Commit**

```bash
git add src/languageGate.js tests/languageGate.test.js package.json data/Job_Application_Automator_v6.json
git commit -m "feat(quality): add deterministic Language Decision Gate

Decides outputLanguage upstream of tailor instead of letting the model
pick. Removes a degree of freedom that was causing mixed-language
output. Tailor system prompt now treats outputLanguage as a hard input,
not a re-detected output."
```

---

## Task 6: German Style Sanitizer ban-list extension

**Why:** The current `BANNED_PHRASES` list catches the worst offenders (`bringe ich`, `hochmotiviert`, etc.) but misses softer cliché phrases that still feel translated/generated.

**Files:**
- Modify: `data/Job_Application_Automator_v6.json` (node `14. Parse AI Patch`, `BANNED_PHRASES` array)

- [ ] **Step 1: Locate the banned-phrase list**

In node `14. Parse AI Patch`, find:

```javascript
const BANNED_PHRASES = [
  'bringe ich', 'hochmotiviert', 'teamplayer', 'hands-on-mentalität', 'mit großem interesse',
  'passionate', 'excited to', 'team player', 'fast learner', 'self-starter', 'hands-on'
];
```

- [ ] **Step 2: Extend the list per spec**

Replace with:

```javascript
const BANNED_PHRASES = [
  // Existing — generic AI/cliché openers
  'bringe ich', 'hochmotiviert', 'teamplayer', 'hands-on-mentalität', 'mit großem interesse',
  'passionate', 'excited to', 'team player', 'fast learner', 'self-starter', 'hands-on',
  // Phase 0 additions — soft German cliché ("brochure German")
  'fundierte kenntnisse', 'ausgeprägte fähigkeiten', 'spannende herausforderung',
  'dynamisches umfeld', 'innovative lösungen', 'mit großer begeisterung',
  'ich verfüge über eine hohe motivation', 'ich bin überzeugt, dass',
  'umfangreiche expertise', 'eine wertvolle ergänzung',
];
```

- [ ] **Step 3: Smoke-test**

Force the AI to produce a banned phrase by editing one of its existing outputs to include `fundierte Kenntnisse` and re-running node `14. Parse AI Patch`. Verify the resulting `_qualityFlag` is `Review` and `_qualityIssues` includes the banned phrase hit.

(Or simpler: write a tiny test fixture and call the node logic in isolation. But since the logic is embedded in n8n JSON, manual smoke is acceptable.)

- [ ] **Step 4: Commit**

```bash
git add data/Job_Application_Automator_v6.json
git commit -m "feat(quality): extend German style sanitizer ban-list

Adds soft cliché phrases (fundierte Kenntnisse, ausgeprägte Fähigkeiten,
spannende Herausforderung, dynamisches Umfeld, innovative Lösungen, etc.)
to the BANNED_PHRASES list. These phrases are technically grammatical but
mark the text as AI/template-generated rather than written."
```

---

## Task 7: AI-smell cleanup of `data/resume.json`

**Why:** The base resume itself contains buzzwords that get amplified by tailoring. Replace abstract phrasings with concrete technical ones.

**Files:**
- Modify: `data/resume.json` (manual edits to profile + 1-2 work bullets)

- [ ] **Step 1: Cleanup the profile paragraph**

Open `data/resume.json`, find `content.profile.entries[0].text`. Current value:

```
<p>Software Developer with 2+ years of professional experience building production systems across the Salesforce platform (Apex, LWC, Flows, AppExchange) and the modern web stack (React, TypeScript, Node.js). Shipped a managed AppExchange package through Salesforce's full security review. Personal projects include a real-time spatial communication platform (WebRTC, Socket.IO, Phaser.js), a production-grade cloud infrastructure stack (AWS, Terraform), and an AI-driven document generation pipeline (n8n, Playwright, OpenAI). Comfortable in AI-assisted engineering environments: I use AI tools to accelerate development while owning architecture, code review, and quality. Certified Platform Developer I (96 pts), Agentforce Specialist, and Data Cloud Consultant. Pursuing M.Sc. in Global Software Development in Germany.</p>
```

Replace with (keeps facts, removes "AI-friendly" abstractions):

```
<p>Software Developer with 2+ years of professional experience building production systems across the Salesforce platform (Apex, LWC, Flows, AppExchange) and the modern web stack (React, TypeScript, Node.js). Shipped a managed AppExchange package through Salesforce's full security review with 85%+ Apex test coverage. Personal projects include a real-time spatial communication platform (WebRTC, Socket.IO, Phaser.js), a Terraform-managed AWS infrastructure of 41 resources, and an n8n + OpenAI + Playwright document-generation pipeline. Certified Platform Developer I (96 pts), Agentforce Specialist, and Data Cloud Consultant. Pursuing M.Sc. Global Software Development at Hochschule Fulda.</p>
```

Changes:
- Removed "Comfortable in AI-assisted engineering environments..." sentence (vague AI-buzzword filler).
- Removed "production-grade" (cliché).
- Replaced "AI-driven document generation pipeline" with concrete tools.
- Made M.Sc. line specific to Hochschule Fulda (it's the anchor used downstream).
- Surfaced the 85% test coverage and 41 AWS resources metrics in the profile itself.

- [ ] **Step 2: Cleanup MV Clouds bullets**

In `data/resume.json`, find the work entry for `MV Clouds` (id `286ca64e-9ab1-4d32-9905-0996d5d6a5c1`). The `description` field is one big HTML string with `<ul><li><p>...</p></li></ul>`.

Inspect it for these problem phrases and rewrite them as concrete:

- "applying the same architectural review discipline to AI-generated outputs as to hand-written code" → cut the trailing clause; the bullet should end at the concrete action.
- "low-code-first thinking for system integration and workflow orchestration" → replace with "selecting Flows for rapid automation and Apex for complex logic in a single architecture".
- "AI-assisted engineering: Adopted AI coding assistants to accelerate Apex and LWC development cycles while taking full ownership..." → trim "while taking full ownership of architecture validation, performance review against Salesforce governor limits, and security best practices across all generated code." to "with code review against Salesforce governor limits and security guidelines."
- Any remaining "production-grade" phrasing → just say what was production (e.g., "the AWS infrastructure" not "the production-grade AWS infrastructure").

Edit each bullet inline. Preserve the `<ul><li><p>...</p></li></ul>` HTML structure — only change the prose inside `<p>` tags.

- [ ] **Step 3: Inspect for any other buzzwords**

Search `data/resume.json` for these strings and decide per-occurrence whether to keep, rephrase, or cut:
- "production-grade"
- "AI-assisted"
- "comfortable in"
- "applying the same"
- "low-code-first"
- "modern web stack" — actually fine to keep, it's concrete enough.

- [ ] **Step 4: Verify resume still parses and renders**

Run:

```bash
npm test
```

This invokes `scripts/test.js` which sends a flat patch through `/generate-resume` and writes a PDF to `output/`. Open the resulting PDF and verify:
- Profile paragraph reads naturally.
- MV Clouds bullets read concretely.
- No HTML/parse errors in the console.

- [ ] **Step 5: Commit**

```bash
git add data/resume.json
git commit -m "chore(content): strip AI-smell buzzwords from base resume

Removed 'production-grade', 'AI-assisted engineering', 'comfortable in',
'applying the same architectural review discipline', and 'low-code-first
thinking' from profile + MV Clouds bullets. Replaced with concrete
technical descriptions. Surfaced 85% test coverage and 41 AWS resources
metrics into the profile so they don't depend on the tailor for
visibility. M.Sc. line now names Hochschule Fulda directly."
```

---

## Task 8: Server-side company guards

**Why:** PDF generation should refuse to produce a CV/CL with empty or "Unknown" company, which is the source of the "Unknown Company" automation artifact in the rejection checklist.

**Files:**
- Create: `src/validateRequest.js`
- Create: `tests/validateRequest.test.js`
- Modify: `package.json`
- Modify: `src/server.js`

- [ ] **Step 1: Write failing test**

Create `tests/validateRequest.test.js`:

```javascript
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
```

- [ ] **Step 2: Add to `package.json`**

```jsonc
"test:unit": "node --test tests/validatePatch.test.js tests/coverletterEmptyBody.test.js tests/validateCoverLetter.test.js tests/jdQualityGate.test.js tests/languageGate.test.js tests/validateRequest.test.js"
```

- [ ] **Step 3: Run test to verify it fails**

`npm run test:unit` — expected: file-not-found error for `src/validateRequest.js`.

- [ ] **Step 4: Implement the module**

Create `src/validateRequest.js`:

```javascript
// src/validateRequest.js
// Request-level parameter validation shared between PDF endpoints.

const UNKNOWN_PATTERN = /^unknown( company)?$/i;
const NA_PATTERN = /^n\.?\s*\/?\s*a\.?$|^na$/i;

/**
 * @param {unknown} company
 * @returns {{ valid: boolean, error: string | null }}
 */
export function validateCompanyParam(company) {
  if (company === null || company === undefined) {
    return { valid: false, error: "company is empty" };
  }
  const s = String(company).trim();
  if (s.length === 0) {
    return { valid: false, error: "company is empty" };
  }
  if (UNKNOWN_PATTERN.test(s)) {
    return { valid: false, error: "company is 'Unknown'" };
  }
  if (NA_PATTERN.test(s)) {
    return { valid: false, error: "company is 'N/A'" };
  }
  return { valid: true, error: null };
}
```

- [ ] **Step 5: Run test to verify it passes**

`npm run test:unit` — expected: all `validateRequest` tests pass.

- [ ] **Step 6: Wire into `src/server.js`**

Add the import at the top of `src/server.js`:

```javascript
import { validateCompanyParam } from "./validateRequest.js";
```

In the `/generate-resume` handler, immediately after destructuring `req.body`, add:

```javascript
const companyCheck = validateCompanyParam(company);
if (!companyCheck.valid) {
  console.error("[/generate-resume] Invalid company:", companyCheck.error);
  return res.status(422).json({
    success: false,
    error: "Invalid company parameter",
    reason_code: "COMPANY_INVALID",
    detail: companyCheck.error,
  });
}
```

In the `/generate-coverletter` handler, immediately after destructuring `req.body`, add the same block (with the route name swapped in the log message).

- [ ] **Step 7: Smoke-test**

Run:

```bash
npm start
```

In another terminal:

```bash
curl -X POST http://localhost:3000/generate-resume -H "Content-Type: application/json" -d '{"patch":{"jobTitle":"Test","work":[{"id":"286ca64e-9ab1-4d32-9905-0996d5d6a5c1","description":"<ul><li><p>x</p></li></ul>"}],"skills":[{"id":"some-id","infoHtml":"<p>x</p>"}]},"company":""}'
```

Expected: `{"success":false,"error":"Invalid company parameter","reason_code":"COMPANY_INVALID",...}` with HTTP 422.

```bash
curl -X POST http://localhost:3000/generate-resume -H "Content-Type: application/json" -d '{...,"company":"Unknown"}'
```

Expected: same 422 response.

- [ ] **Step 8: Commit**

```bash
git add src/validateRequest.js tests/validateRequest.test.js package.json src/server.js
git commit -m "feat(server): reject empty / 'Unknown' / 'N/A' company params

Both PDF endpoints now return 422 COMPANY_INVALID when the company
parameter is empty, whitespace, 'Unknown', 'Unknown Company', or 'N/A'
variants. Prevents the 'Unknown Company' automation artifact from
reaching final PDFs."
```

---

## Task 9: Visibility lists in patch

**Why:** Today, work and skill entries not in the patch silently keep their base description. A "tailored" CV can quietly inherit irrelevant base content. Explicit visibility lists fix this.

**Files:**
- Create: `tests/visibilityLists.test.js`
- Modify: `package.json`
- Modify: `src/mergePatch.js`
- Modify: `src/validatePatch.js`
- Modify: `data/Job_Application_Automator_v6.json` (tailor system prompt instructs emission of visibility lists)

- [ ] **Step 1: Write failing test**

Create `tests/visibilityLists.test.js`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPatch } from "../src/mergePatch.js";
import { readFileSync } from "fs";

const baseResume = JSON.parse(
  readFileSync(new URL("../data/resume.json", import.meta.url))
);

const ALL_WORK_IDS = baseResume.content.work.entries.map(e => e.id);
const FIRST_WORK_ID = ALL_WORK_IDS[0];
const ALL_SKILL_IDS = baseResume.content.skill.entries.map(e => e.id);
const ALL_PROJECT_IDS = (baseResume.content.project?.entries || []).map(e => e.id);

test("visibleWorkIds filters to listed entries only", () => {
  const result = applyPatch({
    work: [{ id: FIRST_WORK_ID, description: "<ul><li><p>x</p></li></ul>" }],
    skills: [{ id: ALL_SKILL_IDS[0], infoHtml: "<p>x</p>" }],
    visibleWorkIds: [FIRST_WORK_ID],
  });
  assert.equal(result.content.work.entries.length, 1);
  assert.equal(result.content.work.entries[0].id, FIRST_WORK_ID);
});

test("visibleSkillIds filters to listed entries only", () => {
  const result = applyPatch({
    work: [{ id: FIRST_WORK_ID, description: "<ul><li><p>x</p></li></ul>" }],
    skills: [{ id: ALL_SKILL_IDS[0], infoHtml: "<p>x</p>" }],
    visibleSkillIds: [ALL_SKILL_IDS[0]],
  });
  assert.equal(result.content.skill.entries.length, 1);
  assert.equal(result.content.skill.entries[0].id, ALL_SKILL_IDS[0]);
});

test("visibleProjectIds filters to listed entries only", () => {
  if (ALL_PROJECT_IDS.length < 2) return; // Skip if base has <2 projects
  const result = applyPatch({
    work: [{ id: FIRST_WORK_ID, description: "<ul><li><p>x</p></li></ul>" }],
    skills: [{ id: ALL_SKILL_IDS[0], infoHtml: "<p>x</p>" }],
    projects: [{ id: ALL_PROJECT_IDS[0], description: "<ul><li><p>x</p></li></ul>" }],
    visibleProjectIds: [ALL_PROJECT_IDS[0]],
  });
  assert.equal(result.content.project.entries.length, 1);
});

test("absent visibility list preserves existing behavior (no filter)", () => {
  const result = applyPatch({
    work: [{ id: FIRST_WORK_ID, description: "<ul><li><p>x</p></li></ul>" }],
    skills: [{ id: ALL_SKILL_IDS[0], infoHtml: "<p>x</p>" }],
    // No visibleWorkIds/visibleSkillIds — base behavior: all entries kept
  });
  assert.equal(result.content.work.entries.length, ALL_WORK_IDS.length);
  assert.equal(result.content.skill.entries.length, ALL_SKILL_IDS.length);
});

test("empty visibility list filters out everything in that section", () => {
  // An explicitly empty array is a deliberate "hide all" signal
  const result = applyPatch({
    work: [{ id: FIRST_WORK_ID, description: "<ul><li><p>x</p></li></ul>" }],
    skills: [{ id: ALL_SKILL_IDS[0], infoHtml: "<p>x</p>" }],
    visibleWorkIds: [],
  });
  assert.equal(result.content.work.entries.length, 0);
});
```

- [ ] **Step 2: Add to `package.json`**

```jsonc
"test:unit": "node --test tests/validatePatch.test.js tests/coverletterEmptyBody.test.js tests/validateCoverLetter.test.js tests/jdQualityGate.test.js tests/languageGate.test.js tests/validateRequest.test.js tests/visibilityLists.test.js"
```

- [ ] **Step 3: Run tests to verify they fail**

`npm run test:unit` — expected: visibility-list tests fail because `mergePatch.js` doesn't enforce them yet.

- [ ] **Step 4: Modify `src/mergePatch.js`**

After all the existing patch-applying logic but before `return data;` at the bottom, add:

```javascript
  // Visibility lists: when the patch explicitly enumerates which IDs are visible,
  // drop unlisted entries from that section. Absent list = no filter (legacy behavior).
  if (Array.isArray(patch.visibleWorkIds) && data.content.work?.entries) {
    const visible = new Set(patch.visibleWorkIds);
    data.content.work.entries = data.content.work.entries.filter(e => visible.has(e.id));
  }

  if (Array.isArray(patch.visibleSkillIds) && data.content.skill?.entries) {
    const visible = new Set(patch.visibleSkillIds);
    data.content.skill.entries = data.content.skill.entries.filter(e => visible.has(e.id));
  }

  if (Array.isArray(patch.visibleProjectIds) && data.content.project?.entries) {
    const visible = new Set(patch.visibleProjectIds);
    data.content.project.entries = data.content.project.entries.filter(e => visible.has(e.id));
  }

  return data;
```

(Replace the existing `return data;` at the bottom with this block.)

Update the JSDoc at the top of `applyPatch` to document the new fields:

```javascript
/**
 * Merges an AI patch into the base resume JSON.
 *
 * AI patch shape:
 * {
 *   jobTitle?: string,
 *   profile?: string,           // HTML string
 *   showCertificates?: false,   // omit section when Salesforce certs are irrelevant
 *   showProjects?: false,       // omit projects section
 *   work?: [{ id, description }],
 *   skills?: [{ id, skill?, infoHtml }],
 *   projects?: [{ id, description?, techStack?, name? }],
 *   visibleWorkIds?: string[],     // explicit visibility filter; absent = keep all base entries
 *   visibleSkillIds?: string[],
 *   visibleProjectIds?: string[]
 * }
 */
```

- [ ] **Step 5: Modify `src/validatePatch.js`**

Allow the new optional array fields without erroring. After the existing array-type checks (around line 38-46 in the current file), add:

```javascript
  if (patch.visibleWorkIds !== undefined && !Array.isArray(patch.visibleWorkIds)) {
    errors.push("patch.visibleWorkIds must be an array if present");
  }
  if (patch.visibleSkillIds !== undefined && !Array.isArray(patch.visibleSkillIds)) {
    errors.push("patch.visibleSkillIds must be an array if present");
  }
  if (patch.visibleProjectIds !== undefined && !Array.isArray(patch.visibleProjectIds)) {
    errors.push("patch.visibleProjectIds must be an array if present");
  }
```

Add these to the `if (errors.length > 0)` early return (already exists at line 47-49).

After the per-section ID validation loops (work, skills, projects), add warnings for unknown visibility IDs:

```javascript
  if (Array.isArray(patch.visibleWorkIds)) {
    for (const id of patch.visibleWorkIds) {
      if (!VALID_WORK_IDS.has(id)) {
        warnings.push(`unknown id in visibleWorkIds "${id}" — will be silently dropped at merge`);
      }
    }
  }
  if (Array.isArray(patch.visibleSkillIds)) {
    for (const id of patch.visibleSkillIds) {
      if (!VALID_SKILL_IDS.has(id)) {
        warnings.push(`unknown id in visibleSkillIds "${id}" — will be silently dropped at merge`);
      }
    }
  }
  if (Array.isArray(patch.visibleProjectIds)) {
    for (const id of patch.visibleProjectIds) {
      if (!VALID_PROJECT_IDS.has(id)) {
        warnings.push(`unknown id in visibleProjectIds "${id}" — will be silently dropped at merge`);
      }
    }
  }
```

- [ ] **Step 6: Run tests**

`npm run test:unit` — expected: all visibility-list tests pass; existing tests still pass.

- [ ] **Step 7: Update tailor system prompt**

In `data/Job_Application_Automator_v6.json`, node `13a. Build Tailor Prompt`, find the `RESUME PATCH RULES` block in the system prompt. Add a new subsection after the GENERAL rules:

```
VISIBILITY LISTS (REQUIRED FIELDS):
- You MUST emit `visibleWorkIds`, `visibleSkillIds`, `visibleProjectIds` arrays as part of `patch`.
- Each list contains the entry IDs from the input RESUME that should appear in the rendered CV.
- For Salesforce roles: include all 2 work IDs (MV Clouds AND Independent Consultant).
- For non-Salesforce roles: include MV Clouds only; you MAY drop the Independent Consultant entry.
- Skills: include the IDs you want visible in display order. Categories not relevant to the role MAY be dropped.
- Projects: include only the 1-3 IDs whose tech stack or domain overlaps the JD. Empty list means no projects shown.
- The merge layer enforces these lists. Anything not listed is dropped from the rendered CV.
```

In the OUTPUT FORMAT JSON schema in the system prompt, add the three new fields:

```jsonc
{
  "language": "...",
  "patch": {
    "jobTitle": "...",
    "profile": "...",
    "showCertificates": ...,
    "showProjects": ...,
    "visibleWorkIds": ["existing-id"],
    "visibleSkillIds": ["existing-id"],
    "visibleProjectIds": ["existing-id"],
    "work": [...],
    "skills": [...],
    "projects": [...]
  },
  ...
}
```

- [ ] **Step 8: Update `14. Parse AI Patch` to forward visibility lists into the patch**

The current `14. Parse AI Patch` returns `patch` as-is from the AI response. No change needed if the AI emits the fields — they'll be forwarded automatically.

Add a defensive check: if any visibility list is missing, log a warning and default to `undefined` (legacy behavior — keep all entries). Find the validation block and add:

```javascript
// Visibility lists are expected from Phase 0 onward; missing them downgrades to legacy behavior
if (!Array.isArray(patch.visibleWorkIds)) {
  validationErrors.push('patch.visibleWorkIds is missing (will fall back to keeping all base work entries)');
}
if (!Array.isArray(patch.visibleSkillIds)) {
  validationErrors.push('patch.visibleSkillIds is missing (will fall back to keeping all base skill entries)');
}
```

(Add these to `validationErrors` so they surface as `_qualityIssues` for review, not as hard errors. The merge layer handles their absence gracefully.)

- [ ] **Step 9: Smoke-test end-to-end**

Run a job through the full pipeline. In the resulting Sheet row, check `Notes` column for any "missing visibility list" warnings. Open the rendered CV and verify:
- For a Salesforce job: both work entries visible.
- For a non-Salesforce backend job: only MV Clouds visible (if AI dropped Consultant) — no orphan section heading.
- Skills shown match the visibility list (count matches what AI emitted).

- [ ] **Step 10: Commit**

```bash
git add src/mergePatch.js src/validatePatch.js tests/visibilityLists.test.js package.json data/Job_Application_Automator_v6.json
git commit -m "feat(merge): enforce explicit visibleWorkIds/Skills/Projects in patch

Adds optional visibleWorkIds, visibleSkillIds, visibleProjectIds to the
patch schema. When present, mergePatch filters base entries to only
listed IDs; absent = legacy behavior (keep all base entries). Tailor
system prompt now instructs the AI to emit these lists. Fixes the silent
inheritance of irrelevant base content in tailored CVs."
```

---

## Task 10: Phone/footer rendering safeguards

**Why:** Per the rejection checklist: "phone number split across lines" is one of the automation artifacts. Add `white-space: nowrap` to phone elements so they never wrap.

**Files:**
- Modify: `src/buildResumeHtml.js` (CSS for `.contact-link` and a new class for phone)
- Modify: `src/mergeCoverLetter.js` (CSS for header phone + footer)

- [ ] **Step 1: Add `white-space: nowrap` in `src/buildResumeHtml.js`**

Find the `.contact-link` CSS rule (around line 262):

```css
    .contact-link { color: #1a5276; text-decoration: none; }
```

Replace with:

```css
    .contact-link { color: #1a5276; text-decoration: none; white-space: nowrap; }
    .contact-row { white-space: normal; }
    .contact-row > span,
    .contact-row > a { white-space: nowrap; }
```

(The first rule keeps each link as one unit. The second pair allows the row to wrap between links but not within a single link.)

Also find the contact line where phone is rendered (around line 211):

```javascript
    p.phone        && link(`tel:${p.phone.replace(/\s/g, "")}`, ICON.phone, p.phone),
```

No change to this line — the new CSS handles it. But if the phone display string contains a space, ensure it doesn't break: convert the literal space to a non-breaking space:

```javascript
    p.phone        && link(`tel:${p.phone.replace(/\s/g, "")}`, ICON.phone, p.phone.replace(/ /g, " ")),
```

- [ ] **Step 2: Add `white-space: nowrap` in `src/mergeCoverLetter.js`**

Find the `.header-contact` CSS (around line 101):

```css
    .header-contact {
      text-align: right;
      font-size: 9pt;
      color: #444;
      line-height: 1.7;
    }
```

No change here — `<br/>` separation handles the layout. But ensure the phone line itself doesn't break: in the JSX-like template (around line 188), change:

```html
        +49 15210894179<br/>
```

to:

```html
        <span style="white-space: nowrap;">+49&nbsp;15210894179</span><br/>
```

For the footer (around line 162-170), find:

```css
    .footer {
      margin-top: auto;
      padding-top: 10px;
      border-top: 1px solid #d1d5db;
      font-size: 8.5pt;
      color: #777;
      display: flex;
      justify-content: space-between;
    }
```

Add at the end of the rule:

```css
    .footer span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
```

(This keeps each footer span as one line and truncates with ellipsis if it gets too long, instead of wrapping.)

- [ ] **Step 3: Smoke-test rendering**

Run:

```bash
npm test
npm run test:coverletter
```

Open the resulting PDFs. Verify:
- Phone number renders on one continuous line with no break.
- Footer left/right elements stay on a single line each.

- [ ] **Step 4: Commit**

```bash
git add src/buildResumeHtml.js src/mergeCoverLetter.js
git commit -m "fix(render): prevent phone-number line splits and footer wrap

Adds white-space: nowrap to .contact-link and footer spans, plus a
non-breaking space inside the phone-number string. Rejection checklist
item 'phone number split across lines' is now structurally impossible
in the rendered PDF."
```

---

## Task 11: Phase 0 end-to-end smoke test

**Why:** Verify all 10 prior tasks work together on a real job. This is the exit criterion for Phase 0.

**Files:** None — this is a manual run.

- [ ] **Step 1: Set up a test job fixture**

Manually craft a synthetic job in n8n's "1. Manual Configuration" node — paste a simple input that bypasses scrapers:

```json
{
  "title": "Software Developer (Backend)",
  "company": "TestCo GmbH",
  "location": "Frankfurt, Germany",
  "url": "https://example.com/test-job",
  "applyUrl": "https://example.com/apply",
  "description": "We are looking for a backend developer to join our team in Frankfurt. Responsibilities: design and implement REST APIs, integrate third-party systems, write unit tests, participate in code reviews. Requirements: 2+ years of experience with Node.js, REST API design, SQL databases. Nice to have: AWS/Terraform exposure, CI/CD experience. We offer flexible hours, remote work options, and a friendly team."
}
```

(Or feed this into the Apify node mock output for one run.)

- [ ] **Step 2: Run the workflow end-to-end**

Trigger the manual run. Watch each node:
- `4a. JD Quality Gate`: should pass (description is >600 chars, has "Responsibilities" + "Requirements", company is set).
- `12. Is Match?`: should pass (Salesforce + backend overlap).
- `12a. Decide Language`: should output `outputLanguage: "en"`.
- `13a. Build Tailor Prompt`: receives `outputLanguage: "en"`; OpenAI body shows `reasoning: { effort: "medium" }`.
- `14. Parse AI Patch`: returns a patch with `visibleWorkIds`, `visibleSkillIds`, `visibleProjectIds` populated.
- `15a. POST Generate Resume PDF`: returns 200 with file path (because company is "TestCo GmbH", not empty/Unknown).
- `15b. POST Generate Cover Letter PDF`: returns 200.
- `17. Log to Google Sheets`: row appears with new columns `Routing Tier` (likely `auto`), `Fallback Model Used` (`No`).

- [ ] **Step 3: Inspect the rendered PDF**

Open the generated CV. Verify:
- Profile paragraph reads naturally and includes "Hochschule Fulda".
- Phone number on header doesn't break across lines.
- Section count is reasonable (not 2-3 pages).
- Skills section shows only relevant categories (not all 6).
- No "Senior" / "Specialist" titles invented.

Open the generated cover letter. Verify:
- Body is in English.
- No banned phrases (`fundierte Kenntnisse`, `passionate`, etc.).
- Footer renders one line each side.
- Date is current.

- [ ] **Step 4: Run a German-JD variant**

Repeat with a German JD fixture:

```json
{
  "title": "Softwareentwickler (Backend)",
  "company": "TestCo GmbH",
  "location": "Frankfurt am Main",
  "description": "Wir suchen einen Backend-Entwickler für unser Team in Frankfurt. Deine Aufgaben: Entwicklung von REST-APIs, Integration externer Systeme, Code Reviews. Anforderungen: 2+ Jahre Node.js, SQL-Datenbanken. Wünschenswert: AWS/Terraform. Wir bieten flexible Arbeitszeiten und ein freundliches Team."
}
```

Verify:
- `12a. Decide Language` outputs `de`.
- All section headings in CV are German (`PROFIL`, `BERUFSERFAHRUNG`, etc.).
- Cover letter body is German.
- No banned German cliché phrases.

- [ ] **Step 5: Run a malformed-JD fixture**

Inject a job with empty company:

```json
{
  "title": "Software Developer",
  "company": "",
  "description": "Some description that is at least 600 characters long. Responsibilities: x. ".repeat(15)
}
```

Verify:
- `4a. JD Quality Gate` rejects with `_jdQuality.reason = "company_missing"`.
- Item lands in "Rejected JDs" sheet, NOT in main pipeline.
- No tokens spent on tailor / cover letter generation.

- [ ] **Step 6: Document the smoke-test result**

Create or update `docs/superpowers/plans/phase-0-smoke-test-log.md` with:
- Date of smoke test
- Each fixture run + outcome (pass/fail per Step 2-5)
- Any issues found
- Decision: Phase 0 ready for production runs, or specific items need rework before Phase 1 starts.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/plans/phase-0-smoke-test-log.md
git commit -m "test(pipeline): document Phase 0 end-to-end smoke test results

Verified all 10 Phase 0 changes work together on synthetic English,
German, and malformed-JD fixtures. Phase 0 is ready for production
runs — user can resume submitting applications using outputs from the
'auto' routing tier."
```

---

## Self-Review (run after Task 11)

Skim the spec §7 Phase 0 list against the tasks above:

| Spec item | Task |
|---|---|
| reasoning.effort: minimal → medium | Task 1 ✓ |
| Match threshold 45 → 70 + 55-69 review band | Task 2 ✓ |
| Fallback-model output → Review Queue only | Task 3 ✓ |
| Basic JD Quality Gate | Task 4 ✓ |
| Language Decision Gate | Task 5 ✓ |
| German Style Sanitizer ban-list extension | Task 6 ✓ |
| AI-smell cleanup in resume.json | Task 7 ✓ |
| PDF/server guards (missing/Unknown company, empty CL) | Task 8 ✓ (CL empty body already exists, just verify) |
| Visibility lists in patch | Task 9 ✓ |
| Phone/footer rendering safeguards | Task 10 ✓ (this was implicit in spec's "investigate phone/footer rendering bugs") |
| Phase 0 smoke test | Task 11 ✓ |

All 9 spec items + smoke test covered. No placeholders. Each task has concrete code.

---

## Out of scope for Phase 0 (deferred to Phases 1-3)

- Evidence-ID restructure of `data/resume.json` → Phase 1
- Tag schema (`role_families`) → Phase 1
- Structured JD Parser → Phase 1
- `/context?family=X` endpoint → Phase 1
- Claim Ledger Builder → Phase 2
- Split CV/CL tailor calls → Phase 2
- Critic Pass → Phase 2
- Layout Validator → Phase 2
- Patch Diff Validator → Phase 2
- Auto-Apply Eligibility Gate (the full version with all clean-signal checks) → Phase 2
- 3-tab Sheet schema (Auto Apply / Review / Rejected JDs) → Phase 2 (the "Rejected JDs" tab from Task 4 is a precursor, not the full thing)
- Application Package Object schema docs → Phase 3
- Manual review queue ergonomics → Phase 3
- Outcome tracking column wiring → Phase 3
- Optional native-German review flow → Phase 3
- Prompt tuning based on response data → Phase 3 (after data accumulates)

After Phase 0 is complete and smoke-tested, write the next plan: `docs/superpowers/plans/2026-MM-DD-job-pipeline-phase-1.md`.

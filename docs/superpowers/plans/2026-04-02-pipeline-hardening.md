# Pipeline Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the job application pipeline so that failures are detected loudly, bad AI output never silently produces a useless application, and the job matching filter is precise enough to respect your time.

**Architecture:** Three independent layers get hardened in sequence — the Express server (PDF validation + patch schema checking), a new `src/validatePatch.js` module with unit tests, and the n8n workflow JSON (smarter Groq filter, cover letter paragraph recovery, zero-job guard). All n8n changes are direct edits to `data/Job_Application_Automator_v6.json`; import/re-import the workflow in n8n after each n8n task.

**Tech Stack:** Node.js ES Modules, Express 4, Playwright, `node:test` + `node:assert` (built-in, no install needed), n8n workflow JSON.

---

## Orchestration Notes (read before dispatching workers)

Tasks **1, 2, 5** are fully independent — dispatch in parallel.  
Task **3** depends on Task 2 (imports `validatePatch.js`).  
Task **4** depends on Task 2 (tests the same module).  
Tasks **6, 7, 8** all edit `data/Job_Application_Automator_v6.json` — run **strictly sequentially** in that order; each agent must re-read the file before editing.  
Task **9** is a final integration smoke-test — run after all others complete.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/validatePatch.js` | Schema + ID validation for AI patches |
| Modify | `src/server.js` | PDF existence check; wire in validatePatch |
| Modify | `scripts/test.js` | Add `company` field; use `{patch, company}` wrapper |
| Create | `tests/validatePatch.test.js` | Unit tests for validatePatch module |
| Modify | `package.json` | Add `test:unit` script |
| Modify | `data/Job_Application_Automator_v6.json` | n8n: Groq prompt, confidence threshold, para validation, zero-job guard |

---

## Task 1: PDF Existence Validation

**Files:** Modify `src/server.js`  
**Dependencies:** None  
**Worker context:** The server returns `{ success: true }` before checking whether `page.pdf()` actually wrote the file to disk. A Playwright crash, full disk, or permissions error produces no PDF but the caller never knows. Fix: check the file exists after `page.pdf()` in both endpoint handlers.

- [ ] **Step 1: Read the file**

  Open `src/server.js`. Confirm line 3 imports from `"fs"`: `import { mkdirSync, readFileSync } from "fs";`

- [ ] **Step 2: Add `existsSync` to the fs import**

  In `src/server.js` line 3, change:
  ```js
  import { mkdirSync, readFileSync } from "fs";
  ```
  to:
  ```js
  import { mkdirSync, readFileSync, existsSync } from "fs";
  ```

- [ ] **Step 3: Add existence check in `/generate-resume`**

  In `src/server.js`, find the block ending with `res.json({ success: true, file: outPath });` inside the `/generate-resume` handler (currently line 77). Replace that single line with:
  ```js
  if (!existsSync(outPath)) {
    throw new Error(`PDF was not written to disk: ${outPath}`);
  }
  res.json({ success: true, file: outPath });
  ```

- [ ] **Step 4: Add existence check in `/generate-coverletter`**

  Repeat the same change for the `/generate-coverletter` handler (currently line 106). Replace `res.json({ success: true, file: outPath });` with:
  ```js
  if (!existsSync(outPath)) {
    throw new Error(`PDF was not written to disk: ${outPath}`);
  }
  res.json({ success: true, file: outPath });
  ```

- [ ] **Step 5: Verify the server still starts**

  ```bash
  cd d:/KARAN && node src/server.js &
  sleep 2 && curl -s http://localhost:3000/context | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); console.log(JSON.parse(d).currentJobTitle)"
  kill %1
  ```
  Expected output: prints the job title from resume.json (e.g. `Salesforce Developer`). No errors.

- [ ] **Step 6: Commit**

  ```bash
  cd d:/KARAN
  git add src/server.js
  git commit -m "feat: throw if PDF not written to disk after page.pdf()"
  ```

---

## Task 2: Patch Validation Module

**Files:** Create `src/validatePatch.js`  
**Dependencies:** None  
**Worker context:** `applyPatch()` silently ignores unknown IDs and applies an empty patch if the AI returned garbage. This task creates a standalone validation module that (a) checks patch structure/types, (b) validates work/skill IDs against the actual IDs in `data/resume.json`, and (c) detects the `_error` sentinel from the n8n parse node. The module does NOT throw — it returns a result object so callers decide what to do.

- [ ] **Step 1: Identify the valid IDs**

  Read `data/resume.json` and note the IDs (or run):
  ```bash
  cd d:/KARAN && node -e "
  const r = JSON.parse(require('fs').readFileSync('data/resume.json'));
  const d = r.data.resumes[0];
  console.log('work:', d.content.work.entries.map(e=>e.id));
  console.log('skill:', d.content.skill.entries.map(e=>e.id));
  "
  ```
  Expected output lists 2 work IDs and 6 skill IDs (see CLAUDE.md Entry ID Quick Reference for reference values).

- [ ] **Step 2: Create `src/validatePatch.js`**

  ```js
  // src/validatePatch.js
  import { readFileSync } from "fs";

  const baseResume = JSON.parse(
    readFileSync(new URL("../data/resume.json", import.meta.url))
  );
  const _data = baseResume.data.resumes[0];

  const VALID_WORK_IDS = new Set(_data.content.work.entries.map((e) => e.id));
  const VALID_SKILL_IDS = new Set(_data.content.skill.entries.map((e) => e.id));

  /**
   * Validates an AI-generated patch before applyPatch() is called.
   *
   * @param {unknown} patch - The value received from req.body.patch or req.body
   * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
   *
   * valid:false  → patch has no actionable content or is structurally broken
   * warnings     → unknown IDs or missing optional fields (patch still applied)
   */
  export function validatePatch(patch) {
    const errors = [];
    const warnings = [];

    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      errors.push("patch must be a plain object");
      return { valid: false, errors, warnings };
    }

    if (patch._error) {
      errors.push(`AI parse failed: ${patch._error}`);
      return { valid: false, errors, warnings };
    }

    const hasTitle =
      typeof patch.jobTitle === "string" && patch.jobTitle.trim().length > 0;
    const hasProfile =
      typeof patch.profile === "string" && patch.profile.trim().length > 0;
    const hasWork = Array.isArray(patch.work) && patch.work.length > 0;
    const hasSkills = Array.isArray(patch.skills) && patch.skills.length > 0;

    if (!hasTitle && !hasProfile && !hasWork && !hasSkills) {
      errors.push(
        "patch has no actionable content: all sections are empty or missing"
      );
      return { valid: false, errors, warnings };
    }

    if (patch.work !== undefined && !Array.isArray(patch.work)) {
      errors.push("patch.work must be an array if present");
    } else if (hasWork) {
      for (const item of patch.work) {
        if (!item || typeof item !== "object") {
          warnings.push("work array contains non-object item (skipped)");
          continue;
        }
        if (!item.id) {
          warnings.push(
            `work item missing id — will be ignored: ${JSON.stringify(item).slice(0, 80)}`
          );
          continue;
        }
        if (!VALID_WORK_IDS.has(item.id)) {
          warnings.push(`unknown work id "${item.id}" — will be ignored`);
        }
        if (!item.description) {
          warnings.push(`work item "${item.id}" has no description`);
        }
      }
    }

    if (patch.skills !== undefined && !Array.isArray(patch.skills)) {
      errors.push("patch.skills must be an array if present");
    } else if (hasSkills) {
      for (const item of patch.skills) {
        if (!item || typeof item !== "object") {
          warnings.push("skills array contains non-object item (skipped)");
          continue;
        }
        if (!item.id) {
          warnings.push(
            `skill item missing id — will be ignored: ${JSON.stringify(item).slice(0, 80)}`
          );
          continue;
        }
        if (!VALID_SKILL_IDS.has(item.id)) {
          warnings.push(`unknown skill id "${item.id}" — will be ignored`);
        }
        if (!item.infoHtml) {
          warnings.push(`skill item "${item.id}" has no infoHtml`);
        }
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }
  ```

- [ ] **Step 3: Verify the module loads**

  ```bash
  cd d:/KARAN && node --input-type=module <<'EOF'
  import { validatePatch } from "./src/validatePatch.js";
  const r = validatePatch({ jobTitle: "Test Role" });
  console.log(r);
  EOF
  ```
  Expected: `{ valid: true, errors: [], warnings: [] }`

- [ ] **Step 4: Commit**

  ```bash
  cd d:/KARAN
  git add src/validatePatch.js
  git commit -m "feat: add validatePatch module with schema and ID validation"
  ```

---

## Task 3: Wire Validation into the Server

**Files:** Modify `src/server.js`  
**Dependencies:** Task 2 must be complete (`src/validatePatch.js` must exist)  
**Worker context:** The `/generate-resume` endpoint currently calls `applyPatch()` with no pre-validation. If the patch is empty, has `_error`, or uses wrong IDs, the server silently generates an unmodified resume. This task imports `validatePatch` and returns HTTP 422 on invalid patches, or logs warnings on partial ones.

- [ ] **Step 1: Add the import**

  In `src/server.js`, add after the existing imports (after line 7):
  ```js
  import { validatePatch } from "./validatePatch.js";
  ```

- [ ] **Step 2: Add validation in `/generate-resume`**

  In `src/server.js`, find the `/generate-resume` handler. Currently it starts with:
  ```js
  app.post("/generate-resume", async (req, res) => {
    const { patch, company } = req.body;
    const mergedResume = applyPatch(patch || req.body);
  ```
  Replace those three lines with:
  ```js
  app.post("/generate-resume", async (req, res) => {
    const { patch, company } = req.body;
    const rawPatch = patch || req.body;

    const validation = validatePatch(rawPatch);
    if (validation.warnings.length > 0) {
      console.warn("[/generate-resume] Patch warnings:", validation.warnings);
    }
    if (!validation.valid) {
      console.error("[/generate-resume] Invalid patch:", validation.errors);
      return res
        .status(422)
        .json({ success: false, error: "Invalid patch", details: validation.errors });
    }

    const mergedResume = applyPatch(rawPatch);
  ```

- [ ] **Step 3: Verify 422 on bad input**

  Start the server in one terminal (`npm start`), then in another:
  ```bash
  curl -s -X POST http://localhost:3000/generate-resume \
    -H "Content-Type: application/json" \
    -d '{"patch":{"_error":"AI returned garbage"}}' | node -e \
    "process.stdin.resume(); let b=''; process.stdin.on('data',d=>b+=d); process.stdin.on('end',()=>console.log(JSON.parse(b)))"
  ```
  Expected: `{ success: false, error: 'Invalid patch', details: [ 'AI parse failed: AI returned garbage' ] }`

- [ ] **Step 4: Verify valid patch still works**

  ```bash
  npm test
  ```
  Expected: `{ success: true, file: '...resume-company.pdf' }` (test.js currently sends no `company` — that gets fixed in Task 5, so "company" slug is expected here).

- [ ] **Step 5: Commit**

  ```bash
  cd d:/KARAN
  git add src/server.js
  git commit -m "feat: validate AI patch in /generate-resume, return 422 on empty or broken patch"
  ```

---

## Task 4: Unit Tests for validatePatch

**Files:** Create `tests/validatePatch.test.js`, modify `package.json`  
**Dependencies:** Task 2 must be complete  
**Worker context:** Uses Node's built-in `node:test` and `node:assert` — no install needed. Run with `node --test`. Tests cover the valid/invalid cases that matter most: empty patch, `_error` flag, unknown IDs (warnings only), and good input.

- [ ] **Step 1: Add test script to package.json**

  Read `package.json`, then add `"test:unit"` to the `scripts` section:
  ```json
  "test:unit": "node --test tests/validatePatch.test.js"
  ```

- [ ] **Step 2: Create `tests/validatePatch.test.js`**

  ```js
  // tests/validatePatch.test.js
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
  ```

- [ ] **Step 3: Run the tests**

  ```bash
  cd d:/KARAN && npm run test:unit
  ```
  Expected: all 13 tests pass. Output ends with `# tests 13` and `# pass 13`.

- [ ] **Step 4: Commit**

  ```bash
  cd d:/KARAN
  git add tests/validatePatch.test.js package.json
  git commit -m "test: add unit tests for validatePatch module"
  ```

---

## Task 5: Fix test.js

**Files:** Modify `scripts/test.js`  
**Dependencies:** None  
**Worker context:** `scripts/test.js` currently posts the patch flat at the top level with no `company` field. This means every test run generates `output/resume-company.pdf`, overwriting the previous artifact. Fix: wrap the payload in `{ patch, company }` format. After Task 3, the server requires this anyway because `req.body.patch` is checked first.

- [ ] **Step 1: Read the current file**

  Read `scripts/test.js`. Confirm that the fetch call body is `JSON.stringify(patch)` — the patch is posted flat with no wrapper.

- [ ] **Step 2: Update the fetch call**

  Find this block (currently lines 28–32):
  ```js
  const response = await fetch("http://localhost:3000/generate-resume", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  ```
  Replace with:
  ```js
  const response = await fetch("http://localhost:3000/generate-resume", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patch, company: "Test Company" }),
  });
  ```

- [ ] **Step 3: Verify**

  Start the server (`npm start`), then:
  ```bash
  cd d:/KARAN && npm test
  ```
  Expected: response shows `success: true` and file path ends with `resume-test-company.pdf` (not `resume-company.pdf`).

- [ ] **Step 4: Commit**

  ```bash
  cd d:/KARAN
  git add scripts/test.js
  git commit -m "fix: wrap test.js payload in {patch, company} format"
  ```

---

## Task 6: n8n — Groq Prompt + Confidence Threshold

**Files:** Modify `data/Job_Application_Automator_v6.json`  
**Dependencies:** None (but run Tasks 6, 7, 8 sequentially — same file)  
**Worker context:** Two n8n changes here. (A) The Groq system prompt in node "7a. Build Match Prompt" must explicitly exclude pure ML/data science roles and roles requiring 6+ years — right now the only exclusions are accounting/law/medicine and 8+ year seniority. (B) Node "9. Is Match?" only checks `matchResult.match === true` but never checks `confidence` — a 15% confidence match passes through. Add a `confidence >= 45` condition.

  > After editing, re-import the workflow in n8n: Settings → Import from file → select `data/Job_Application_Automator_v6.json`.

- [ ] **Step 1: Read the file and locate node 7a**

  In `data/Job_Application_Automator_v6.json`, search for `"7a. Build Match Prompt"`. Find the `systemPrompt` template literal in its code. It currently reads:

  ```
  match:false ONLY if: 5+ yrs niche with zero candidate exposure, completely unrelated field (accounting/law/medicine), explicitly senior 8+ yrs.
  Return ONLY JSON: {"match":bool,"confidence":0-100,"reason":"one line","jobType":"internship|werkstudent|full-time|contract|unknown"}
  ```

- [ ] **Step 2: Update the systemPrompt in node 7a**

  In the JSON string for that node's code, replace the two `match:false` and `Return ONLY JSON` lines with:

  ```
  match:false ONLY if:\\n- completely unrelated field (accounting/law/finance/legal/medical/non-tech)\\n- pure ML engineer or pure data scientist (OK if ML is one tool among many for a software role)\\n- pure project/product management with no hands-on development\\n- explicitly requires 6+ years AND role is a narrow specialisation with zero candidate exposure\\nReturn ONLY JSON: {\\"match\\":bool,\\"confidence\\":0-100,\\"reason\\":\\"one line\\",\\"jobType\\":\\"internship|werkstudent|full-time|contract|unknown\\"}
  ```

  Note: In the JSON file the string is inside a template literal inside a JavaScript string. Use the Edit tool to do a targeted find-and-replace on the old text → new text. Check the surrounding characters carefully to avoid breaking JSON string escaping.

- [ ] **Step 3: Locate node "9. Is Match?"**

  In `data/Job_Application_Automator_v6.json`, search for `"9. Is Match?"`. Find the `conditions.conditions` array. It currently contains one condition with `"id": "match-check"`.

- [ ] **Step 4: Add confidence condition to node "9. Is Match?"**

  In that conditions array, after the existing `match-check` object and before the closing `]`, add a comma and the following object:

  ```json
  ,
  {
    "id": "confidence-check",
    "leftValue": "={{ $json.matchResult.confidence }}",
    "rightValue": 45,
    "operator": {
      "type": "number",
      "operation": "gte",
      "singleValue": true
    }
  }
  ```

  The `combinator` is already `"and"` so both conditions must be true.

- [ ] **Step 5: Validate the JSON is still valid**

  ```bash
  cd d:/KARAN && node -e "JSON.parse(require('fs').readFileSync('data/Job_Application_Automator_v6.json')); console.log('JSON valid')"
  ```
  Expected: `JSON valid`

- [ ] **Step 6: Commit**

  ```bash
  cd d:/KARAN
  git add data/Job_Application_Automator_v6.json
  git commit -m "feat(n8n): tighten Groq filter — exclude ML/data/mgmt roles, add confidence >= 45 threshold"
  ```

---

## Task 7: n8n — Cover Letter Paragraph Validation & Recovery

**Files:** Modify `data/Job_Application_Automator_v6.json`  
**Dependencies:** Task 6 must be committed (same file)  
**Worker context:** Node "11. Parse AI Patch" splits the cover letter by `\n\n`. If the AI returns only one paragraph or no double newlines, `paragraph2` and `paragraph3` are empty strings. The cover letter PDF is then generated with a salutation and signature but a half-empty body — which looks like a blank template to a recruiter. This task adds recovery logic: if fewer than 3 parts are found, attempt a sentence-level split on single-block text before giving up. Also log a warning in the Notes field so you can spot it in Sheets.

- [ ] **Step 1: Read the file and locate node 11**

  In `data/Job_Application_Automator_v6.json`, search for `"11. Parse AI Patch"`. Find the block starting with `const parts = (coverLetter || '').split`. It currently reads:

  ```js
  const parts = (coverLetter || '').split(/\n\n+/);

  return [{
    json: {
      patch,
      coverLetter,
      paragraph1: parts[0] || '',
      paragraph2: parts[1] || '',
      paragraph3: parts[2] || '',
      job: {
  ```

- [ ] **Step 2: Replace that block with the validated version**

  Replace exactly the lines above with:

  ```js
  const rawParts = (coverLetter || '').split(/\n\n+/).map(p => p.trim()).filter(p => p.length > 0);
  let paragraph1 = rawParts[0] || '';
  let paragraph2 = rawParts[1] || '';
  let paragraph3 = rawParts[2] || '';
  let _coverLetterWarning = '';

  if (rawParts.length === 0) {
    _coverLetterWarning = 'AI returned empty cover letter';
  } else if (rawParts.length < 3) {
    _coverLetterWarning = `Cover letter has ${rawParts.length} paragraph(s), expected 3`;
    if (rawParts.length === 1 && rawParts[0].length > 100) {
      const sentences = rawParts[0].split(/(?<=[.!?])\s+/);
      if (sentences.length >= 3) {
        const third = Math.floor(sentences.length / 3);
        paragraph1 = sentences.slice(0, third).join(' ');
        paragraph2 = sentences.slice(third, third * 2).join(' ');
        paragraph3 = sentences.slice(third * 2).join(' ');
        _coverLetterWarning += ' — recovered via sentence split';
      }
    }
  }

  return [{
    json: {
      patch,
      coverLetter,
      paragraph1,
      paragraph2,
      paragraph3,
      _coverLetterWarning,
      job: {
  ```

- [ ] **Step 3: Update "13. Prepare Sheet Log" to surface the warning**

  In the same JSON file, search for `"13. Prepare Sheet Log"`. Find this line in its code:

  ```js
  Notes:              patchData.patch?._error || ''
  ```

  Replace with:

  ```js
  Notes:              patchData.patch?._error || patchData._coverLetterWarning || ''
  ```

- [ ] **Step 4: Validate JSON**

  ```bash
  cd d:/KARAN && node -e "JSON.parse(require('fs').readFileSync('data/Job_Application_Automator_v6.json')); console.log('JSON valid')"
  ```
  Expected: `JSON valid`

- [ ] **Step 5: Commit**

  ```bash
  cd d:/KARAN
  git add data/Job_Application_Automator_v6.json
  git commit -m "feat(n8n): validate cover letter paragraphs, recover via sentence split, log warning to Sheets"
  ```

---

## Task 8: n8n — Zero-Job Guard

**Files:** Modify `data/Job_Application_Automator_v6.json`  
**Dependencies:** Task 7 must be committed (same file)  
**Worker context:** When all scrapers return empty or all jobs are duplicates, node "6b. Filter Duplicates" returns `{ skipped: true, message: '...' }`. This item flows through the Smart Throttle (wastes 7s), then into "7a. Build Match Prompt" which builds a Groq prompt from a non-job object — sending garbage to the API. Add a guard at the top of node "7a. Build Match Prompt" that returns `[]` (halts the item) when it receives a skipped or error marker.

- [ ] **Step 1: Read the file and locate node 7a code**

  In `data/Job_Application_Automator_v6.json`, search for `"7a. Build Match Prompt"`. The code starts with:

  ```js
  // 7a. Build Match Prompt — prepare Groq API request body
  const item = $input.first().json;
  const apiKey = $env.GROQ_API_KEY;
  ```

- [ ] **Step 2: Add the guard after the first two lines**

  Insert these lines immediately after `const item = $input.first().json;`:

  ```js
  // Guard: skip sentinel items from zero-job / all-duplicate runs
  if (item.skipped || item.error) {
    console.log('[7a] Skipping non-job item:', item.message || item.error || 'unknown reason');
    return [];
  }
  ```

- [ ] **Step 3: Validate JSON**

  ```bash
  cd d:/KARAN && node -e "JSON.parse(require('fs').readFileSync('data/Job_Application_Automator_v6.json')); console.log('JSON valid')"
  ```
  Expected: `JSON valid`

- [ ] **Step 4: Commit**

  ```bash
  cd d:/KARAN
  git add data/Job_Application_Automator_v6.json
  git commit -m "feat(n8n): skip sentinel items in 7a to avoid Groq call on zero-job runs"
  ```

---

## Task 9: Integration Smoke Test

**Files:** None modified  
**Dependencies:** All previous tasks complete  
**Worker context:** Run the existing test scripts against a live server to confirm nothing is broken. Then test the error path introduced in Task 3 to confirm bad patches return 422 as expected.

- [ ] **Step 1: Start the server**

  ```bash
  cd d:/KARAN && npm start &
  sleep 3
  ```

- [ ] **Step 2: Smoke test resume generation**

  ```bash
  cd d:/KARAN && npm test
  ```
  Expected:
  - Response: `{ success: true, file: '...resume-test-company.pdf' }` (file name includes "test-company" after Task 5 fix)
  - File actually exists: `ls output/resume-test-company.pdf` → shows the file

- [ ] **Step 3: Smoke test cover letter generation**

  ```bash
  cd d:/KARAN && npm run test:coverletter
  ```
  Expected: `{ success: true, file: '...coverletter-sap-se.pdf' }`

- [ ] **Step 4: Test the 422 path**

  ```bash
  curl -s -X POST http://localhost:3000/generate-resume \
    -H "Content-Type: application/json" \
    -d '{"patch":{},"company":"Test"}' | node -p "JSON.stringify(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')),null,2)"
  ```
  Expected:
  ```json
  {
    "success": false,
    "error": "Invalid patch",
    "details": ["patch has no actionable content: all sections are empty or missing"]
  }
  ```

- [ ] **Step 5: Test the _error path**

  ```bash
  curl -s -X POST http://localhost:3000/generate-resume \
    -H "Content-Type: application/json" \
    -d '{"patch":{"_error":"AI timed out"},"company":"Test"}' | node -p "JSON.stringify(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')),null,2)"
  ```
  Expected:
  ```json
  {
    "success": false,
    "error": "Invalid patch",
    "details": ["AI parse failed: AI timed out"]
  }
  ```

- [ ] **Step 6: Run unit tests**

  ```bash
  cd d:/KARAN && npm run test:unit
  ```
  Expected: `# pass 13` (all pass).

- [ ] **Step 7: Stop server**

  ```bash
  kill %1 2>/dev/null || true
  ```

---

## Self-Review Checklist

- [x] Issue 1 (no PDF validation) → Task 1 adds `existsSync` check in both handlers
- [x] Issue 2 (empty/bad patch silently applied) → Task 2+3 add `validatePatch`, return 422 on `_error` or no-op patches
- [x] Issue 3 (cover letter missing paragraphs) → Task 7 adds recovery + warning
- [x] Issue 4 (unknown IDs silently skipped) → Task 2 warns on unknown IDs; Task 4 tests this
- [x] Issue 5 (confidence threshold) → Task 6 adds `confidence >= 45` to "9. Is Match?"
- [x] Issue 6 (ML/data/mgmt roles pass through) → Task 6 updates Groq system prompt exclusions
- [x] Issue 7 (zero-job sends garbage to Groq) → Task 8 adds early return in node 7a
- [x] Issue 9 (test.js no company) → Task 5
- [x] wrapParagraph already called correctly in mergeCoverLetter.js — no action needed
- [x] test-coverletter.js double-wrap not a real bug — wrapParagraph detects `<` prefix and returns as-is
- [x] Sheets status already checks `resumeResult.success && coverLetterResult.success` — no action needed

# n8n Workflow Audit — 2026-04-11

Audit of `data/Job_Application_Automator_v6.json` for silent data loss, incorrect output, and pipeline failures.

---

## Issue 1 — Match prompt uses wrong field names for work experience

- **Node:** `10a. Build Match Prompt`
- **Config:**
  ```js
  const recentWork = (item.resume?.workExperience || [])   // wrong key
    .map(w => `${w.title || ''} at ${w.company || ''}: ${(w.summary || '').slice(0, 120)}`)
  ```
- **Problem:** `/context` returns `currentWork` (not `workExperience`) with fields `jobTitle`, `employer`, `description` (not `title`, `company`, `summary`). Result: `recentWork` is always `'N/A'` — Gemini never sees the candidate's actual work history.
- **Severity:** Degraded quality — match decisions rely only on hardcoded skill list and dynamic skill names, missing 2+ years of work context.
- **Fix:** Change to `item.resume?.currentWork || []` and map with `w.jobTitle`, `w.employer`, `w.description.slice(0, 120)`.

---

## Issue 2 — PDF generation errors silently lost in sheet log

- **Node:** `16. Prepare Sheet Log`
- **Config:**
  ```js
  const resumes = inputs.filter(i => (i.json.fileName || '').startsWith('resume'));
  const covers  = inputs.filter(i => (i.json.fileName || '').startsWith('coverletter'));
  ```
- **Problem:** When 15a or 15b fail (`continueOnFail: true`), the error item has no `fileName` field, so it doesn't match either filter. `resumes[idx]` falls back to `{ json: {} }`, meaning `resumeItem.json.error` is `undefined`. The Notes field captures `patchData._coverLetterWarning` or `patchData.patch._error` but never the actual HTTP error from the PDF call (e.g., "ECONNREFUSED", "422 validation error", timeout). Status correctly shows 'PDF Failed', but the reason is lost.
- **Severity:** Moderate (debuggability) — can see "PDF Failed" status but must check n8n execution logs for the actual cause. Not a correctness or data-loss issue.
- **Fix:** Before filtering by `fileName`, extract error items:
  ```js
  const errors = inputs.filter(i => i.json.error || i.json.statusCode >= 400);
  const errorMsg = errors.map(e => e.json.error?.message || e.json.message || JSON.stringify(e.json.error)).join('; ');
  // Then include errorMsg in the Notes field
  ```

---

## Issue 3 — Indeed location can produce `[object Object]`

- **Node:** `4. Normalize & Merge Jobs`, BOARD_CONFIG for Indeed
- **Config:**
  ```js
  location: ['location.formattedLocation', 'location.city', 'location'],
  ```
- **Problem:** If `location.formattedLocation` and `location.city` are both empty/missing but `location` exists as an object (which Indeed's API returns), `resolveField` returns the raw object. `String(object)` produces `"[object Object]"`. This corrupts the location field for Indeed jobs, visible in the Gemini prompt, the sheet log, and the cover letter.
- **Severity:** Degraded quality — garbled location in prompts and PDFs.
- **Fix:** Remove the bare `'location'` fallback:
  ```js
  location: ['location.formattedLocation', 'location.city'],
  ```

---

## Issue 4 — Scraper total failure can stall the pipeline

- **Nodes:** `2a–2e` scrapers + `3. Wait for All Scrapers`
- **Config:** All scrapers have `onError: "continueErrorOutput"`. The merge node expects `numberInputs: 5`. Only the main outputs (index 0) are wired to the merge.
- **Problem:** If a scraper completely fails (Apify actor error, network timeout), all error items go to output 1 (unwired). Output 0 sends nothing. The merge node has 5 inputs and waits for all of them. If one input never fires, the merge may stall indefinitely, blocking the entire pipeline.
- **Severity:** Pipeline-halting — one scraper down = zero jobs processed.
- **Fix:** Either wire each scraper's error output to the merge node as well (error items would be filtered out by node 4's `desc.length < 20` check), or use n8n's `alwaysOutputData` option on the Apify nodes to emit a placeholder item on the main output even on failure.

---

## ~~Issue 5 — Error sentinel from node 4 produces empty sheet row~~ (MITIGATED)

- **Nodes:** `4. Normalize & Merge Jobs` -> `10a. Build Match Prompt` -> `18a. Prepare Skip Log`
- **Status:** Already mitigated in current workflow version. `5. Sync Jobs + Sheet` and `6. Filter Duplicates` pass through the error sentinel without masking it, and `18a. Prepare Skip Log` includes `jobData.message` in Notes and marks "Pipeline Error" paths appropriately.
- **No action required.**

---

## Issue 6 — Dedup false negatives when `applyUrl` is empty

- **Node:** `4. Normalize & Merge Jobs`, dedup block
- **Config:**
  ```js
  const key = job.applyUrl || `${job.company}::${job.title}`;
  ```
- **Problem:** If `applyUrl` resolves to empty string (common for StepStone where `detail_page.applying_details.applying_url` may not exist), the key falls back to `company::title`. Two different positions at the same company with the same title (different locations/teams) would be wrongly deduped. Conversely, the same job from two boards with different non-empty `applyUrl` values would NOT be deduped.
- **Severity:** Silent data loss (false positives) / duplicated effort (false negatives) — occasional.
- **Fix:** Use `job.url || job.applyUrl || \`${company}::${title}\`` as the primary key since `url` (the listing URL) is more reliably unique than `applyUrl`.

---

## Issue 7 — No retry/fallback for OpenAI tailor call failures

- **Node:** `13b. OpenAI API Call`
- **Config:** `retryOnFail: true`, `maxTries: 3`, `continueOnFail: true`. No fallback model (unlike Gemini which has 10e).
- **Problem:** If OpenAI returns a 429 (rate limit) or 500 three times in a row, the error continues to `14. Parse AI Patch`, which sets `patch._error`. Then 15a sends this broken patch to the Express server. The server's `validatePatch()` rejects it with 422. Both PDFs fail. The sheet logs 'PDF Failed' with no useful error message (see Issue 2).
- **Severity:** Silent degradation — the job is logged as 'PDF Failed' but the root cause (OpenAI failure) isn't captured. No fallback model is attempted.
- **Fix:** Either add a fallback (e.g., `gpt-4o-mini` -> `gpt-3.5-turbo`), or short-circuit in node 14 — when `patch._error` is set, skip 15a/15b entirely and log directly with the error. This saves two wasted HTTP calls and preserves the error message.

---

## Issue 8 — Gemini API uses hardcoded preview model names

- **Nodes:** `10c. Gemini API Call`, `10e. Fallback Gemini Call`
- **Config:** URLs hardcode `gemini-3.1-flash-lite-preview` and `gemini-2.0-flash`.
- **Problem:** Preview models are retired without notice. When Google deprecates the model, the primary Gemini call fails on every item. Both model names are hardcoded strings, not expressions — changing them requires editing the workflow.
- **Severity:** Pipeline-halting when the model is retired.
- **Fix:** Use stable model names (e.g., `gemini-2.0-flash-lite`) or parameterize the model name in node `1. Job Search URLs` alongside the other config values.

---

## Issue 9 — 3-second Gemini throttle vs retry behavior (NICE-TO-HAVE)

- **Nodes:** `10b. Wait` (3s) + `10c. Gemini API Call` (retry 3x @ 5s) + `10e. Fallback` (retry 2x @ 3s)
- **Problem:** In theory, one job could trigger up to 5 Gemini API calls across primary + fallback retries. However, n8n currently has bugs where `retryOnFail` combined with `continueOnFail` doesn't behave as documented, often skipping retries entirely ([n8n-io/n8n#9236](https://github.com/n8n-io/n8n/issues/9236)). The stated worst-case "5 calls per job in 20s" likely doesn't occur in practice.
- **Severity:** Nice-to-have optimization — the underlying concern (429 storms under load) is valid, but the specific burst scenario is overstated given current n8n behavior.
- **Fix:** Consider increasing `10b. Wait` to 5-8 seconds if Gemini 429s are observed in practice.

---

## Issue 10 — `remote` field always false for most boards

- **Node:** `4. Normalize & Merge Jobs`
- **Config:**
  ```js
  remote: resolveField(d, config.fields.remote) === true,
  ```
- **Problem:** This strict equality (`=== true`) only matches boolean `true`. Glassdoor returns `remoteWorkTypes` (an array like `["REMOTE"]`), StepStone returns `work_arrangement` (a string like `"Remote"`), Xing returns `remote` (may be a string). All of these are truthy but not `=== true`, so `remote` is always `false` for non-LinkedIn boards.
- **Severity:** Degraded quality — remote status is inaccurate in prompts. Not pipeline-breaking since `remote` isn't used in filtering.
- **Fix:**
  ```js
  remote: !!resolveField(d, config.fields.remote),
  ```

---

## Issue 11 — Pre-filter rejects legitimate Salesforce-adjacent titles with German "Vertrieb"

- **Node:** `10a. Build Match Prompt`, ROLE_REJECT_PATTERNS
- **Config:**
  ```js
  /\b(au(?:ß|ss)endienst|vertrieb|verkauf|sales\s*rep)\b/i,
  ```
- **Problem:** German job titles sometimes include department context, e.g., "Salesforce Developer - Vertrieb" (meaning "Salesforce Developer in the Sales department"). The `\bvertrieb\b` pattern rejects this before Gemini can evaluate it. The explicit "Sales" vs "Salesforce" distinction in the Gemini prompt is bypassed.
- **Severity:** Silent data loss — legitimate Salesforce developer roles in sales-department contexts are pre-filtered.
- **Fix:** Add a negative lookahead or exception:
  ```js
  /\b(au(?:ß|ss)endienst|verkauf|sales\s*rep)\b/i,  // remove vertrieb
  /\b(vertrieb(?!.*(?:salesforce|developer|engineer|entwickl)))\b/i,  // vertrieb only if no tech keyword
  ```

---

## Issue 12 — Broken patch sent to server when OpenAI fails

- **Nodes:** `14. Parse AI Patch` -> `15a. POST Generate Resume PDF`
- **Config:** When OpenAI fails, patch becomes `{ _error: 'AI parse failed: ...' }`. Node 14 doesn't short-circuit — it passes this to 15a.
- **Problem:** The Express server receives `{ patch: { _error: '...' }, company: '...', role: '...' }`. `validatePatch()` rejects it (no valid work/skills entries), returning 422. Two unnecessary HTTP roundtrips are made (resume + cover letter), and Playwright contexts are opened and closed for nothing.
- **Severity:** Wasted resources + the 422 error message from the server gets lost (see Issue 2).
- **Fix:** In node 14, when `patch._error` is set, route directly to the sheet log node instead of continuing to PDF generation. Or add an IF node between 14 and 15a/15b that checks `patch._error`.

---

## Summary by Severity

| Severity | Issues |
|----------|--------|
| Pipeline-halting | #4 (scraper failure stalls merge), #8 (deprecated model names) |
| Silent data loss | #6 (dedup false positives), #11 (pre-filter false rejects) |
| Degraded quality | #1 (match prompt missing work history), #3 (Indeed location corrupted), #7 + #12 (no OpenAI fallback + wasted calls), #10 (remote field wrong) |
| Debuggability / DX | #2 (PDF error messages lost from sheet) |
| Nice-to-have | #9 (throttle tuning) |
| Mitigated | ~~#5~~ (error sentinel — already handled in current version) |

## Recommended Fix Order

1. **Issue 1** — highest impact, easiest fix (3 field name changes)
2. **Issue 4** — pipeline-halting risk, wire error outputs or add `alwaysOutputData`
3. **Issue 7 + 12** — fix together: short-circuit on `_error` to skip wasted PDF calls
4. **Issue 3** — one-line fix, prevents garbled data
5. **Issue 8** — update model names to stable versions (make it configurable)
6. **Issue 11** — regex tweak to prevent false rejects
7. **Issue 6** — change dedup key order
8. **Issue 2** — capture PDF error details in Notes for easier debugging
9. **Issue 10** — one-line fix for remote field
10. **Issue 9** — increase wait time if 429s observed in practice
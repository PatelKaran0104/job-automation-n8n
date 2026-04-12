# n8n Workflow Bugfix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 10 active issues in `data/Job_Application_Automator_v6.json` identified by the [2026-04-11 audit](2026-04-11-workflow-bugfixes.md).

**Architecture:** Each task runs a standalone Node.js script that reads the workflow JSON, programmatically modifies target nodes, and writes it back. This avoids fragile text-editing of JSON-escaped strings and ensures atomic, verifiable changes. Tasks run sequentially (single-file constraint) via subagent-driven-development for fresh context per task.

**Tech Stack:** Node.js (ES Modules), `fs` for JSON I/O

**Token efficiency notes for subagents:**
- Do NOT read the full 1630-line workflow JSON directly -- the fix scripts handle I/O programmatically
- Each task is self-contained -- all needed context (before/after code) is in this plan
- Create the script, run it, verify the output. No exploration needed.

---

## Issue-to-Task Map

| Task | Issues Fixed | Nodes Modified |
|------|-------------|----------------|
| 1 | #1, #3, #6, #10, #11 | `4. Normalize & Merge Jobs`, `10a. Build Match Prompt` |
| 2 | #2 (also covers #7, #12) | `16. Prepare Sheet Log` |
| 3 | #4, #8 | `2a-2e` scrapers, `10c. Gemini API Call` |
| 4 | All | Read-only verification + commit |

**Issues NOT fixed (by design):**
- **#5** -- Already mitigated in current version (no action needed)
- **#7 + #12** -- Root cause addressed by Issue #2 fix: error messages now flow through to the sheet log. Adding an IF node to skip 2 localhost HTTP calls is not worth the structural complexity per user's minimal-changes preference.
- **#9** -- Nice-to-have; increase wait time only if Gemini 429s observed in practice

---

### Task 1: Fix data-path nodes (Issues 1, 3, 6, 10, 11)

**Files:**
- Create: `scripts/fixes/fix-data-path.mjs`
- Modify: `data/Job_Application_Automator_v6.json` (nodes `4` and `10a` jsCode)

**What this fixes:**
- **Issue 3:** Indeed location `[object Object]` -- remove bare `'location'` fallback from Indeed BOARD_CONFIG
- **Issue 6:** Dedup false negatives -- prefer `url` over `applyUrl` as primary dedup key
- **Issue 10:** Remote field always false -- change `=== true` to `!!` for truthy coercion
- **Issue 1:** Match prompt missing work history -- fix field names to match `/context` output (`workExperience` -> `currentWork`, `title` -> `jobTitle`, `company` -> `employer`, `summary` -> `description`)
- **Issue 11:** Pre-filter rejects Salesforce+Vertrieb titles -- remove `vertrieb` from blanket reject, add compound check that only rejects `vertrieb` when no tech keywords are present in the title

- [ ] **Step 1: Create the scripts/fixes/ directory**

Run: `mkdir -p scripts/fixes`

- [ ] **Step 2: Write the fix script**

Create `scripts/fixes/fix-data-path.mjs`:

```js
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WF_PATH = join(__dirname, '..', '..', 'data', 'Job_Application_Automator_v6.json');

const w = JSON.parse(readFileSync(WF_PATH, 'utf8'));
const results = [];

// ── Node 4: Normalize & Merge Jobs ──────────────────────────

const node4 = w.nodes.find(n => n.name === '4. Normalize & Merge Jobs');
if (!node4) throw new Error('Node "4. Normalize & Merge Jobs" not found');
let code4 = node4.parameters.jsCode;

// Issue 3: Remove bare 'location' fallback from Indeed config
const before3 = "location:    ['location.formattedLocation', 'location.city', 'location'],";
const after3  = "location:    ['location.formattedLocation', 'location.city'],";
if (!code4.includes(before3)) throw new Error('Issue 3: pattern not found in node 4');
code4 = code4.replace(before3, after3);
results.push('Issue 3: Removed bare location fallback from Indeed');

// Issue 6: Fix dedup key order (prefer url over applyUrl)
const before6 = 'const key = job.applyUrl || `${job.company}::${job.title}`;';
const after6  = 'const key = job.url || job.applyUrl || `${job.company}::${job.title}`;';
if (!code4.includes(before6)) throw new Error('Issue 6: pattern not found in node 4');
code4 = code4.replace(before6, after6);
results.push('Issue 6: Dedup key now prefers url over applyUrl');

// Issue 10: Fix remote field strict equality
const before10 = 'remote:      resolveField(d, config.fields.remote) === true,';
const after10  = 'remote:      !!resolveField(d, config.fields.remote),';
if (!code4.includes(before10)) throw new Error('Issue 10: pattern not found in node 4');
code4 = code4.replace(before10, after10);
results.push('Issue 10: Remote field uses !! instead of === true');

node4.parameters.jsCode = code4;

// ── Node 10a: Build Match Prompt ────────────────────────────

const node10a = w.nodes.find(n => n.name === '10a. Build Match Prompt');
if (!node10a) throw new Error('Node "10a. Build Match Prompt" not found');
let code10a = node10a.parameters.jsCode;

// Issue 1: Fix work experience field names to match /context output
const before1a = 'item.resume?.workExperience || []';
const after1a  = 'item.resume?.currentWork || []';
if (!code10a.includes(before1a)) throw new Error('Issue 1a: workExperience pattern not found');
code10a = code10a.replace(before1a, after1a);

const before1b = "`${w.title || ''} at ${w.company || ''}: ${(w.summary || '').slice(0, 120)}`";
const after1b  = "`${w.jobTitle || ''} at ${w.employer || ''}: ${(w.description || '').slice(0, 120)}`";
if (!code10a.includes(before1b)) throw new Error('Issue 1b: field name pattern not found');
code10a = code10a.replace(before1b, after1b);
results.push('Issue 1: Work experience uses currentWork/jobTitle/employer/description');

// Issue 11: Fix vertrieb regex — remove from blanket reject, add compound check
// Step A: Remove vertrieb from the first ROLE_REJECT_PATTERNS entry
const before11a = "/\\b(au(?:\u00df|ss)endienst|vertrieb|verkauf|sales\\s*rep)\\b/i,";
const after11a  = "/\\b(au(?:\u00df|ss)endienst|verkauf|sales\\s*rep)\\b/i,";
if (!code10a.includes(before11a)) throw new Error('Issue 11a: regex pattern not found');
code10a = code10a.replace(before11a, after11a);

// Step B: Add compound vertrieb check to the rejected assignment
const before11b = "const rejected = ROLE_REJECT_PATTERNS.some(pattern => pattern.test(jobTitle));";
const after11b  = "const rejected = ROLE_REJECT_PATTERNS.some(pattern => pattern.test(jobTitle))\n  || (/\\bvertrieb\\b/i.test(jobTitle) && !/salesforce|developer|engineer|entwickl/i.test(jobTitle));";
if (!code10a.includes(before11b)) throw new Error('Issue 11b: rejected assignment not found');
code10a = code10a.replace(before11b, after11b);
results.push('Issue 11: Vertrieb only rejected when no tech keywords in title');

node10a.parameters.jsCode = code10a;

// ── Write ───────────────────────────────────────────────────

writeFileSync(WF_PATH, JSON.stringify(w, null, 2));
results.forEach(r => console.log('\u2713', r));
console.log(`\nAll ${results.length} fixes applied to ${WF_PATH}`);
```

- [ ] **Step 3: Run the fix script**

Run: `node scripts/fixes/fix-data-path.mjs`

Expected output: 5 lines starting with checkmarks, then "All 5 fixes applied." If any pattern is not found, the script throws with the specific issue number.

- [ ] **Step 4: Verify changes**

Run:
```bash
node -e "
const w=JSON.parse(require('fs').readFileSync('data/Job_Application_Automator_v6.json','utf8'));
const n4=w.nodes.find(n=>n.name==='4. Normalize & Merge Jobs').parameters.jsCode;
const n10=w.nodes.find(n=>n.name==='10a. Build Match Prompt').parameters.jsCode;
const checks = [
  ['Issue 3: no bare location', !n4.includes(\"'location']\")],
  ['Issue 6: url-first dedup', n4.includes('job.url || job.applyUrl')],
  ['Issue 10: !! remote', n4.includes('!!resolveField')],
  ['Issue 1: currentWork', n10.includes('currentWork') && n10.includes('w.jobTitle') && n10.includes('w.employer')],
  ['Issue 11: vertrieb compound', n10.includes('vertrieb') && n10.includes('salesforce|developer')],
];
checks.forEach(([name, ok]) => console.log(ok ? '\u2713' : '\u2717', name));
if (checks.some(c => !c[1])) process.exit(1);
console.log('All checks passed');
"
```

Expected: All 5 checks pass.

---

### Task 2: Fix error-handling node (Issue 2)

**Files:**
- Create: `scripts/fixes/fix-error-handling.mjs`
- Modify: `data/Job_Application_Automator_v6.json` (node `16` jsCode)

**What this fixes:**
- **Issue 2:** PDF generation errors silently lost in sheet log -- extract error details from failed HTTP responses and include in Notes field
- **Also addresses Issues 7+12:** When OpenAI fails, node 14 sets `patch._error` and the broken patch triggers a 422 from the Express server. Previously, the 422 error message was lost. Now, error messages from failed PDF calls are captured in `pdfErrorMsg` and written to the Notes column.

**Current node 16 code (relevant section):**
```js
const resumes = inputs.filter(i => (i.json.fileName || '').startsWith('resume'));
const covers  = inputs.filter(i => (i.json.fileName || '').startsWith('coverletter'));
// ...
Notes: patchData.patch?._error || resumeItem.json.error || coverItem.json.error || patchData._coverLetterWarning || '',
```

**Problem:** When 15a/15b fail (`continueOnFail: true`), error items have no `fileName`, so they don't match either filter. `resumeItem.json.error` is `undefined`. The actual HTTP error (e.g., "422 validation error", "ECONNREFUSED") is lost.

- [ ] **Step 1: Write the fix script**

Create `scripts/fixes/fix-error-handling.mjs`:

```js
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WF_PATH = join(__dirname, '..', '..', 'data', 'Job_Application_Automator_v6.json');

const w = JSON.parse(readFileSync(WF_PATH, 'utf8'));

const node16 = w.nodes.find(n => n.name === '16. Prepare Sheet Log');
if (!node16) throw new Error('Node "16. Prepare Sheet Log" not found');
let code16 = node16.parameters.jsCode;

// Issue 2: Add error extraction BEFORE the fileName filtering
const beforeFilter = "const resumes = inputs.filter(i => (i.json.fileName || '').startsWith('resume'));";
const errorExtract = `// Capture error details from failed PDF calls (Issue 2)
const errorItems = inputs.filter(i => i.json.error || (i.json.statusCode && i.json.statusCode >= 400));
const pdfErrorMsg = errorItems.map(e => e.json.error?.message || e.json.message || JSON.stringify(e.json.error || '')).filter(Boolean).join('; ');

const resumes = inputs.filter(i => (i.json.fileName || '').startsWith('resume'));`;

if (!code16.includes(beforeFilter)) throw new Error('Issue 2: filter pattern not found');
code16 = code16.replace(beforeFilter, errorExtract);

// Update Notes field to use pdfErrorMsg instead of individual error checks
const beforeNotes = "Notes:               patchData.patch?._error || resumeItem.json.error || coverItem.json.error || patchData._coverLetterWarning || '',";
const afterNotes  = "Notes:               patchData.patch?._error || pdfErrorMsg || patchData._coverLetterWarning || '',";

if (!code16.includes(beforeNotes)) throw new Error('Issue 2: Notes pattern not found');
code16 = code16.replace(beforeNotes, afterNotes);

node16.parameters.jsCode = code16;

writeFileSync(WF_PATH, JSON.stringify(w, null, 2));
console.log('\u2713 Issue 2: PDF error messages now captured in Notes field');
console.log(`Written to ${WF_PATH}`);
```

- [ ] **Step 2: Run the fix script**

Run: `node scripts/fixes/fix-error-handling.mjs`

Expected: 1 checkmark line, no errors.

- [ ] **Step 3: Verify changes**

Run:
```bash
node -e "
const w=JSON.parse(require('fs').readFileSync('data/Job_Application_Automator_v6.json','utf8'));
const n16=w.nodes.find(n=>n.name==='16. Prepare Sheet Log').parameters.jsCode;
const checks = [
  ['Error extraction added', n16.includes('pdfErrorMsg')],
  ['Notes uses pdfErrorMsg', n16.includes('pdfErrorMsg || patchData._coverLetterWarning')],
  ['Old pattern removed', !n16.includes('resumeItem.json.error || coverItem.json.error')],
];
checks.forEach(([name, ok]) => console.log(ok ? '\u2713' : '\u2717', name));
if (checks.some(c => !c[1])) process.exit(1);
console.log('All checks passed');
"
```

Expected: All 3 checks pass.

---

### Task 3: Fix node configs (Issues 4, 8)

**Files:**
- Create: `scripts/fixes/fix-configs.mjs`
- Modify: `data/Job_Application_Automator_v6.json` (scraper node properties, Gemini URL)

**What this fixes:**
- **Issue 4:** Scraper total failure stalls the pipeline -- scrapers currently use `onError: "continueErrorOutput"` which sends errors to output 1 (unwired to the merge node). If a scraper fails completely, the merge node never receives data on that input and stalls forever. Fix: change to `"continueRegularOutput"` so errors go to the main output. Node 4's `desc.length < 20` check filters out error items (they have no description).
- **Issue 8:** Gemini API uses preview model name `gemini-3.1-flash-lite-preview` which will be retired without notice. Fix: update to stable `gemini-2.0-flash-lite`. (Fallback node 10e already uses stable `gemini-2.0-flash` -- no change needed.)

- [ ] **Step 1: Write the fix script**

Create `scripts/fixes/fix-configs.mjs`:

```js
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WF_PATH = join(__dirname, '..', '..', 'data', 'Job_Application_Automator_v6.json');

const w = JSON.parse(readFileSync(WF_PATH, 'utf8'));
const results = [];

// Issue 4: Change scraper error handling to prevent merge stalls
// continueErrorOutput -> continueRegularOutput
// Errors go to main output (index 0), reach the merge node,
// and node 4 filters them out via desc.length < 20
const scrapers = [
  '2a. Scrape LinkedIn',
  '2b. Scrape Indeed',
  '2c. Scrape StepStone',
  '2d. Scrape Glassdoor',
  '2e. Scrape Xing',
];
for (const name of scrapers) {
  const node = w.nodes.find(n => n.name === name);
  if (!node) throw new Error(`Scraper "${name}" not found`);
  if (node.onError !== 'continueErrorOutput') {
    throw new Error(`${name}: expected onError="continueErrorOutput", got "${node.onError}"`);
  }
  node.onError = 'continueRegularOutput';
  results.push(`Issue 4: ${name} -> continueRegularOutput`);
}

// Issue 8: Update Gemini primary model from preview to stable
const gemini = w.nodes.find(n => n.name === '10c. Gemini API Call');
if (!gemini) throw new Error('Node "10c. Gemini API Call" not found');
const oldUrl = gemini.parameters.url;
if (!oldUrl.includes('gemini-3.1-flash-lite-preview')) {
  throw new Error('Issue 8: expected preview model name not found in Gemini URL');
}
gemini.parameters.url = oldUrl.replace('gemini-3.1-flash-lite-preview', 'gemini-2.0-flash-lite');
results.push('Issue 8: Gemini primary model -> gemini-2.0-flash-lite');

writeFileSync(WF_PATH, JSON.stringify(w, null, 2));
results.forEach(r => console.log('\u2713', r));
console.log(`\nAll ${results.length} fixes applied to ${WF_PATH}`);
```

- [ ] **Step 2: Run the fix script**

Run: `node scripts/fixes/fix-configs.mjs`

Expected: 6 checkmark lines (5 scrapers + 1 Gemini URL), no errors.

- [ ] **Step 3: Verify changes**

Run:
```bash
node -e "
const w=JSON.parse(require('fs').readFileSync('data/Job_Application_Automator_v6.json','utf8'));
const scrapers = ['2a. Scrape LinkedIn','2b. Scrape Indeed','2c. Scrape StepStone','2d. Scrape Glassdoor','2e. Scrape Xing'];
const checks = [];
for (const name of scrapers) {
  const n = w.nodes.find(x => x.name === name);
  checks.push([name + ' onError', n.onError === 'continueRegularOutput']);
}
const gemini = w.nodes.find(n => n.name === '10c. Gemini API Call');
checks.push(['Gemini stable model', gemini.parameters.url.includes('gemini-2.0-flash-lite')]);
checks.push(['No preview in URL', !gemini.parameters.url.includes('preview')]);
checks.forEach(([name, ok]) => console.log(ok ? '\u2713' : '\u2717', name));
if (checks.some(c => !c[1])) process.exit(1);
console.log('All checks passed');
"
```

Expected: All 7 checks pass.

---

### Task 4: Comprehensive verification + commit

**Files:**
- Read-only: `data/Job_Application_Automator_v6.json`

- [ ] **Step 1: Run full verification across all issues**

Run:
```bash
node -e "
const w = JSON.parse(require('fs').readFileSync('data/Job_Application_Automator_v6.json', 'utf8'));

function getCode(name) {
  return w.nodes.find(n => n.name === name)?.parameters?.jsCode || '';
}

const n4 = getCode('4. Normalize & Merge Jobs');
const n10a = getCode('10a. Build Match Prompt');
const n16 = getCode('16. Prepare Sheet Log');

const checks = [
  // Issue 1: Work experience field names
  ['#1  currentWork key', n10a.includes('currentWork')],
  ['#1  jobTitle field', n10a.includes('w.jobTitle')],
  ['#1  employer field', n10a.includes('w.employer')],
  ['#1  description field (work)', n10a.includes('w.description')],
  // Issue 2: PDF error capture
  ['#2  pdfErrorMsg extraction', n16.includes('pdfErrorMsg')],
  ['#2  Notes uses pdfErrorMsg', n16.includes('pdfErrorMsg || patchData._coverLetterWarning')],
  // Issue 3: Indeed location
  ['#3  no bare location fallback', !n4.includes(\"'location']\")],
  // Issue 4: Scraper error handling
  ...['2a. Scrape LinkedIn','2b. Scrape Indeed','2c. Scrape StepStone','2d. Scrape Glassdoor','2e. Scrape Xing'].map(
    name => ['#4  ' + name.slice(4), w.nodes.find(n => n.name === name).onError === 'continueRegularOutput']
  ),
  // Issue 6: Dedup key
  ['#6  url-first dedup key', n4.includes('job.url || job.applyUrl')],
  // Issue 8: Gemini model
  ['#8  stable Gemini model', w.nodes.find(n => n.name === '10c. Gemini API Call').parameters.url.includes('gemini-2.0-flash-lite')],
  // Issue 10: Remote field
  ['#10 !! remote coercion', n4.includes('!!resolveField')],
  // Issue 11: Vertrieb regex
  ['#11 vertrieb removed from blanket', !n10a.includes('vertrieb|verkauf')],
  ['#11 compound vertrieb check', n10a.includes('salesforce|developer|engineer|entwickl')],
];

let pass = 0, fail = 0;
checks.forEach(([name, ok]) => {
  console.log(ok ? '\u2713' : '\u2717', name);
  ok ? pass++ : fail++;
});
console.log(fail === 0 ? '\nAll ' + pass + ' checks passed!' : '\n' + fail + ' check(s) FAILED');
if (fail) process.exit(1);
"
```

Expected: All checks pass (17+ checkmark lines).

- [ ] **Step 2: Validate JSON is parseable and node count is unchanged**

Run:
```bash
node -e "
const w = JSON.parse(require('fs').readFileSync('data/Job_Application_Automator_v6.json', 'utf8'));
console.log('\u2713 Valid JSON');
console.log('\u2713 Node count:', w.nodes.length, '(expected: 33)');
if (w.nodes.length !== 33) { console.log('\u2717 Node count changed!'); process.exit(1); }
"
```

Expected: Valid JSON, 33 nodes.

- [ ] **Step 3: Run existing unit tests to check for regressions**

Run: `npm run test:unit`

Expected: All tests pass. (These test `validatePatch.js` which is unmodified, but confirms the server code is intact.)

- [ ] **Step 4: Commit all changes**

```bash
git add data/Job_Application_Automator_v6.json scripts/fixes/
git commit -m "$(cat <<'EOF'
fix: apply 10 workflow bugfixes from 2026-04-11 audit

Issues fixed:
- #1: Match prompt uses currentWork/jobTitle/employer/description (was wrong keys)
- #2: PDF error messages captured in sheet Notes field (also covers #7, #12)
- #3: Indeed location no longer produces [object Object]
- #4: Scraper failures no longer stall the merge node (continueRegularOutput)
- #6: Dedup key prefers url over applyUrl for reliable uniqueness
- #8: Gemini primary model updated to stable gemini-2.0-flash-lite
- #10: Remote field uses !! instead of === true for all boards
- #11: Vertrieb regex allows Salesforce/developer/engineer contexts

Not fixed (by design):
- #5: Already mitigated in current version
- #9: Nice-to-have, defer until 429s observed in practice

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Execution Strategy

**Recommended: Subagent-Driven Development (4 sequential subagents)**

Each subagent gets a fresh context with only this plan + the specific task. Token cost per subagent is minimal because:
1. Fix scripts handle JSON I/O programmatically -- subagents never read the 1630-line workflow file
2. All before/after patterns are pre-computed in this plan -- no exploration needed
3. Each script validates its own patterns before applying (throws on mismatch)

**Estimated time:** ~15 minutes total (3-4 min per task)

**Review between tasks:** The main agent verifies each task's output before dispatching the next subagent. If a pattern match fails, the main agent inspects the current file state and adjusts the script.

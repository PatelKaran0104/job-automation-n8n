# Cover Letter PDF Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `/generate-coverletter` into the n8n pipeline so the cover letter becomes a PDF file (like the resume), replacing the raw-text value currently stored in Google Sheets.

**Architecture:** All changes are to `data/Job_Application_Automator_v6.json`. Node 11 splits the AI cover letter string into 3 paragraph fields. A new HTTP node (12b) POSTs those paragraphs to the local Express server. Node 13 reads the resulting PDF path instead of raw text. Tasks that modify jsCode write a small helper script first to avoid shell-escaping issues.

**Tech Stack:** Node.js (edit scripts), n8n workflow JSON, Express `/generate-coverletter` endpoint (already exists at `src/server.js`)

---

## Files Modified

- `data/Job_Application_Automator_v6.json` — all 5 tasks touch this file
- `scripts/patch-node11.js` — temp edit script (deleted after Task 1)
- `scripts/patch-node13.js` — temp edit script (deleted after Task 4)

---

### Task 1: Split coverLetter into paragraph fields in node 11

**Files:**
- Create (temp): `scripts/patch-node11.js`
- Modify: `data/Job_Application_Automator_v6.json`

- [ ] **Step 1: Write the edit script**

Create `scripts/patch-node11.js` with this exact content:

```js
import { readFileSync, writeFileSync } from 'fs';

const path = new URL('../data/Job_Application_Automator_v6.json', import.meta.url);
const data = JSON.parse(readFileSync(path));
const node = data.nodes.find(n => n.name === '11. Parse AI Patch');

// Insert paragraph split before the return statement
node.parameters.jsCode = node.parameters.jsCode
  .replace(
    'return [{',
    "const parts = (coverLetter || '').split(/\\n\\n+/);\n\nreturn [{"
  )
  .replace(
    '    patch,\n    coverLetter,\n    job: {',
    "    patch,\n    coverLetter,\n    paragraph1: parts[0] || '',\n    paragraph2: parts[1] || '',\n    paragraph3: parts[2] || '',\n    job: {"
  );

writeFileSync(path, JSON.stringify(data, null, 2));
console.log('done');
```

- [ ] **Step 2: Run the script**

```bash
node scripts/patch-node11.js
```

Expected: `done`

- [ ] **Step 3: Verify the changes**

```bash
node -e "
import { readFileSync } from 'fs';
const data = JSON.parse(readFileSync('d:/KARAN/data/Job_Application_Automator_v6.json'));
const code = data.nodes.find(n => n.name === '11. Parse AI Patch').parameters.jsCode;
console.log(code.includes('paragraph1') ? 'PASS: paragraph1 found' : 'FAIL: paragraph1 missing');
console.log(code.includes('paragraph2') ? 'PASS: paragraph2 found' : 'FAIL: paragraph2 missing');
console.log(code.includes('paragraph3') ? 'PASS: paragraph3 found' : 'FAIL: paragraph3 missing');
console.log(code.includes(\"parts = (coverLetter\") ? 'PASS: split line found' : 'FAIL: split line missing');
" --input-type=module
```

Expected:
```
PASS: paragraph1 found
PASS: paragraph2 found
PASS: paragraph3 found
PASS: split line found
```

- [ ] **Step 4: Verify JSON is still valid**

```bash
node -e "JSON.parse(require('fs').readFileSync('d:/KARAN/data/Job_Application_Automator_v6.json')); console.log('JSON valid');"
```

Expected: `JSON valid`

- [ ] **Step 5: Delete the temp script**

```bash
rm scripts/patch-node11.js
```

---

### Task 2: Add node 12b — POST Generate Cover Letter PDF

**Files:**
- Modify: `data/Job_Application_Automator_v6.json` (add new node, shift positions of nodes 13 and 14)

- [ ] **Step 1: Run the edit script**

```bash
node -e "
const fs = require('fs');
const path = 'd:/KARAN/data/Job_Application_Automator_v6.json';
const data = JSON.parse(fs.readFileSync(path));

// Shift nodes 13 and 14 right by 224 to make room for 12b
data.nodes.find(n => n.name === '13. Prepare Sheet Log').position[0] += 224;
data.nodes.find(n => n.name === '14. Log to Google Sheets').position[0] += 224;

// Add node 12b
data.nodes.push({
  parameters: {
    method: 'POST',
    url: 'http://host.docker.internal:3000/generate-coverletter',
    sendBody: true,
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify({ role: \$(\"11. Parse AI Patch\").first().json.job.title, company: \$(\"11. Parse AI Patch\").first().json.job.company, companyAddress: \$(\"11. Parse AI Patch\").first().json.job.location, paragraph1: \$(\"11. Parse AI Patch\").first().json.paragraph1, paragraph2: \$(\"11. Parse AI Patch\").first().json.paragraph2, paragraph3: \$(\"11. Parse AI Patch\").first().json.paragraph3 }) }}',
    options: { timeout: 60000 }
  },
  id: 'c7a2e891-f3b4-4d56-9e78-0a1b2c3d4e5f',
  name: '12b. POST Generate Cover Letter PDF',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [6544, 3800],
  continueOnFail: true,
  notes: 'Sends cover letter paragraphs to local server. Renders HTML and exports PDF via Playwright.'
});

fs.writeFileSync(path, JSON.stringify(data, null, 2));
console.log('done');
"
```

> **Note on jsonBody:** The `$('11. Parse AI Patch')` n8n expression references are stored as a plain string in JSON — the `$` chars do not need special escaping in the stored JSON value, only in the shell command above.

- [ ] **Step 2: Verify node 12b was added correctly**

```bash
node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('d:/KARAN/data/Job_Application_Automator_v6.json'));
const n12b = data.nodes.find(n => n.name === '12b. POST Generate Cover Letter PDF');
console.log(n12b ? 'PASS: node 12b found' : 'FAIL: node 12b missing');
console.log('position:', JSON.stringify(n12b && n12b.position));
console.log('url ok:', n12b && n12b.parameters.url.includes('generate-coverletter') ? 'PASS' : 'FAIL');
const n13x = data.nodes.find(n => n.name === '13. Prepare Sheet Log').position[0];
const n14x = data.nodes.find(n => n.name === '14. Log to Google Sheets').position[0];
console.log('node13 x=6768:', n13x === 6768 ? 'PASS' : 'FAIL (got ' + n13x + ')');
console.log('node14 x=6992:', n14x === 6992 ? 'PASS' : 'FAIL (got ' + n14x + ')');
"
```

Expected:
```
PASS: node 12b found
position: [6544,3800]
url ok: PASS
node13 x=6768: PASS
node14 x=6992: PASS
```

- [ ] **Step 3: Verify JSON is still valid**

```bash
node -e "JSON.parse(require('fs').readFileSync('d:/KARAN/data/Job_Application_Automator_v6.json')); console.log('JSON valid');"
```

Expected: `JSON valid`

---

### Task 3: Update connections — wire 12 → 12b → 13

**Files:**
- Modify: `data/Job_Application_Automator_v6.json` (connections object)

- [ ] **Step 1: Run the edit script**

```bash
node -e "
const fs = require('fs');
const path = 'd:/KARAN/data/Job_Application_Automator_v6.json';
const data = JSON.parse(fs.readFileSync(path));

// Node 12: retarget to 12b instead of 13
data.connections['12. POST Generate Resume PDF'].main[0] = [
  { node: '12b. POST Generate Cover Letter PDF', type: 'main', index: 0 }
];

// Node 12b: connects to 13
data.connections['12b. POST Generate Cover Letter PDF'] = {
  main: [[{ node: '13. Prepare Sheet Log', type: 'main', index: 0 }]]
};

fs.writeFileSync(path, JSON.stringify(data, null, 2));
console.log('done');
"
```

- [ ] **Step 2: Verify connections**

```bash
node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('d:/KARAN/data/Job_Application_Automator_v6.json'));
const c12  = data.connections['12. POST Generate Resume PDF'].main[0][0].node;
const c12b = data.connections['12b. POST Generate Cover Letter PDF'].main[0][0].node;
const c12direct13 = data.connections['12. POST Generate Resume PDF'].main[0].some(c => c.node === '13. Prepare Sheet Log');
console.log('12 → 12b:', c12 === '12b. POST Generate Cover Letter PDF' ? 'PASS' : 'FAIL (got ' + c12 + ')');
console.log('12b → 13:', c12b === '13. Prepare Sheet Log' ? 'PASS' : 'FAIL (got ' + c12b + ')');
console.log('12 not direct to 13:', !c12direct13 ? 'PASS' : 'FAIL');
"
```

Expected:
```
12 → 12b: PASS
12b → 13: PASS
12 not direct to 13: PASS
```

- [ ] **Step 3: Verify JSON is still valid**

```bash
node -e "JSON.parse(require('fs').readFileSync('d:/KARAN/data/Job_Application_Automator_v6.json')); console.log('JSON valid');"
```

Expected: `JSON valid`

---

### Task 4: Update node 13 to log cover letter PDF path

**Files:**
- Create (temp): `scripts/patch-node13.js`
- Modify: `data/Job_Application_Automator_v6.json`

- [ ] **Step 1: Write the edit script**

Create `scripts/patch-node13.js` with this exact content:

```js
import { readFileSync, writeFileSync } from 'fs';

const path = new URL('../data/Job_Application_Automator_v6.json', import.meta.url);
const data = JSON.parse(readFileSync(path));
const node = data.nodes.find(n => n.name === '13. Prepare Sheet Log');

node.parameters.jsCode = node.parameters.jsCode
  // Split single generateResult into resumeResult + coverLetterResult
  .replace(
    'const generateResult = $input.first().json;',
    "const resumeResult = $('12. POST Generate Resume PDF').first().json;\nconst coverLetterResult = $input.first().json;"
  )
  // Update Resume File to use resumeResult
  .replace(
    "'Resume File':      generateResult.file || '',",
    "'Resume File':       resumeResult.file || '',"
  )
  // Replace Cover Letter text with Cover Letter File path
  .replace(
    "'Cover Letter':     patchData.coverLetter || '',",
    "'Cover Letter File': coverLetterResult.file || '',"
  )
  // Update Status to check both PDFs
  .replace(
    "Status:             generateResult.success ? 'Generated' : 'PDF Failed',",
    "Status:             (resumeResult.success && coverLetterResult.success) ? 'Generated' : 'PDF Failed',"
  );

writeFileSync(path, JSON.stringify(data, null, 2));
console.log('done');
```

- [ ] **Step 2: Run the script**

```bash
node scripts/patch-node13.js
```

Expected: `done`

- [ ] **Step 3: Verify the changes**

```bash
node -e "
import { readFileSync } from 'fs';
const data = JSON.parse(readFileSync('d:/KARAN/data/Job_Application_Automator_v6.json'));
const code = data.nodes.find(n => n.name === '13. Prepare Sheet Log').parameters.jsCode;
console.log(code.includes('Cover Letter File') ? 'PASS: Cover Letter File found' : 'FAIL');
console.log(code.includes('coverLetterResult.file') ? 'PASS: coverLetterResult.file found' : 'FAIL');
console.log(code.includes('resumeResult.file') ? 'PASS: resumeResult.file found' : 'FAIL');
console.log(!code.includes('patchData.coverLetter') ? 'PASS: old text reference removed' : 'FAIL: old reference still present');
console.log(!code.includes('generateResult') ? 'PASS: generateResult removed' : 'FAIL: generateResult still present');
" --input-type=module
```

Expected:
```
PASS: Cover Letter File found
PASS: coverLetterResult.file found
PASS: resumeResult.file found
PASS: old text reference removed
PASS: generateResult removed
```

- [ ] **Step 4: Verify JSON is still valid**

```bash
node -e "JSON.parse(require('fs').readFileSync('d:/KARAN/data/Job_Application_Automator_v6.json')); console.log('JSON valid');"
```

Expected: `JSON valid`

- [ ] **Step 5: Delete the temp script**

```bash
rm scripts/patch-node13.js
```

---

### Task 5: Rename "Cover Letter" column to "Cover Letter File" in node 14

**Files:**
- Modify: `data/Job_Application_Automator_v6.json` (node `14. Log to Google Sheets` → columns schema)

- [ ] **Step 1: Run the edit script**

```bash
node -e "
const fs = require('fs');
const path = 'd:/KARAN/data/Job_Application_Automator_v6.json';
const data = JSON.parse(fs.readFileSync(path));
const schema = data.nodes.find(n => n.name === '14. Log to Google Sheets').parameters.columns.schema;
const col = schema.find(c => c.id === 'Cover Letter');
if (!col) { console.error('FAIL: Cover Letter column not found'); process.exit(1); }
col.id = 'Cover Letter File';
col.displayName = 'Cover Letter File';
fs.writeFileSync(path, JSON.stringify(data, null, 2));
console.log('done');
"
```

- [ ] **Step 2: Verify the rename**

```bash
node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('d:/KARAN/data/Job_Application_Automator_v6.json'));
const schema = data.nodes.find(n => n.name === '14. Log to Google Sheets').parameters.columns.schema;
console.log(schema.some(c => c.id === 'Cover Letter File') ? 'PASS: Cover Letter File column exists' : 'FAIL');
console.log(!schema.some(c => c.id === 'Cover Letter') ? 'PASS: old Cover Letter column removed' : 'FAIL');
"
```

Expected:
```
PASS: Cover Letter File column exists
PASS: old Cover Letter column removed
```

- [ ] **Step 3: Verify JSON is still valid**

```bash
node -e "JSON.parse(require('fs').readFileSync('d:/KARAN/data/Job_Application_Automator_v6.json')); console.log('JSON valid');"
```

Expected: `JSON valid`

---

### Task 6: End-to-end verification

- [ ] **Step 1: Confirm final workflow structure**

```bash
node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('d:/KARAN/data/Job_Application_Automator_v6.json'));
console.log('Total nodes:', data.nodes.length);
console.log('12b present:', data.nodes.some(n => n.name === '12b. POST Generate Cover Letter PDF') ? 'YES' : 'NO');
console.log('11 ->', data.connections['11. Parse AI Patch'].main[0][0].node);
console.log('12 ->', data.connections['12. POST Generate Resume PDF'].main[0][0].node);
console.log('12b ->', data.connections['12b. POST Generate Cover Letter PDF'].main[0][0].node);
console.log('13 ->', data.connections['13. Prepare Sheet Log'].main[0][0].node);
"
```

Expected:
```
Total nodes: 30
12b present: YES
11 -> 12. POST Generate Resume PDF
12 -> 12b. POST Generate Cover Letter PDF
12b -> 13. Prepare Sheet Log
13 -> 14. Log to Google Sheets
```

- [ ] **Step 2: Start the server and run the cover letter test**

In terminal 1:
```bash
npm start
```

In terminal 2:
```bash
npm run test:coverletter
```

Expected response contains:
```json
{ "success": true, "file": "...\\coverletter-..." }
```

Confirm a `.pdf` file exists in `output/`.

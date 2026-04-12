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

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
const before11a = "/\\b(au(?:ß|ss)endienst|vertrieb|verkauf|sales\\s*rep)\\b/i,";
const after11a  = "/\\b(au(?:ß|ss)endienst|verkauf|sales\\s*rep)\\b/i,";
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

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WF_PATH = join(__dirname, '..', '..', 'data', 'Job_Application_Automator_v6.json');

const w = JSON.parse(readFileSync(WF_PATH, 'utf8'));
const results = [];

// Issue 4: Change scraper error handling to prevent merge stalls
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

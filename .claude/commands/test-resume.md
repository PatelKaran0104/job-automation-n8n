Test the full resume generation pipeline end-to-end.

Steps:
1. Check if the server is already running on port 3000
2. If not running, remind the user to start it in a separate terminal: `npm start`
3. Once the server is up, run: `node scripts/test.js`
4. The script posts a hardcoded Salesforce Solution Architect patch to POST /generate-resume
5. Check the `output/` directory for the generated PDF (named resume-company.pdf since no company is specified in the test patch)

If the test fails:
- Connection refused → server is not running on port 3000
- "Invalid resume structure" → data/resume.json is missing or corrupted
- Fonts missing in PDF → run `npm install` to restore `@fontsource/source-serif-pro`
- PDF not in output/ → restart the server after any code change

import express from "express";
import { chromium } from "playwright";
import { mkdirSync, readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { applyPatch } from "./mergePatch.js";
import { buildCoverLetterHtml } from "./mergeCoverLetter.js";
import { buildResumeHtml } from "./buildResumeHtml.js";
import { validatePatch } from "./validatePatch.js";

const OUTPUT_DIR = resolve("output");
mkdirSync(OUTPUT_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: "10mb" }));

// Shared browser instance — launched once at startup, reused across all requests
const browser = await chromium.launch({ headless: true });

// Sanitize company/role name for safe filenames: "SAP SE" → "sap-se", "Drägerwerk" → "draegerwerk"
function toSlug(str) {
  const TRANSLITERATE = {
    'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss',
    'Ä': 'Ae', 'Ö': 'Oe', 'Ü': 'Ue',
    'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e',
    'á': 'a', 'à': 'a', 'â': 'a', 'ã': 'a',
    'í': 'i', 'ì': 'i', 'î': 'i', 'ï': 'i',
    'ó': 'o', 'ò': 'o', 'ô': 'o', 'õ': 'o',
    'ú': 'u', 'ù': 'u', 'û': 'u',
    'ñ': 'n', 'ç': 'c', 'ø': 'o', 'å': 'a',
  };
  return String(str)
    .replace(/./g, c => TRANSLITERATE[c] || c)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "company";
}

function formatDatePart(n) {
  return String(n).padStart(2, "0");
}

function buildOutputPath({ kind, company, role }) {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = formatDatePart(now.getMonth() + 1);
  const day = formatDatePart(now.getDate());
  const completeDateFolder = `${year}-${month}-${day}`;
  const hours = formatDatePart(now.getHours());
  const minutes = formatDatePart(now.getMinutes());
  const seconds = formatDatePart(now.getSeconds());

  const companySlug = toSlug(company || "company");
  const roleSlug = role ? toSlug(role) : "";
  const folderName = kind === "resume" ? "Resume" : "Coverletter";
  const filePrefix = kind === "resume" ? "resume" : "coverletter";

  let baseName = companySlug;
  if (roleSlug) {
    baseName = `${companySlug}--${roleSlug}`.slice(0, 100);
  }
  const fileName = `${filePrefix}-${baseName}-${hours}${minutes}${seconds}.pdf`;

  const directoryPath = resolve(OUTPUT_DIR, completeDateFolder, folderName);
  mkdirSync(directoryPath, { recursive: true });

  return {
    fileName,
    directoryPath,
    fullPath: resolve(directoryPath, fileName),
  };
}

// Strips HTML tags to give AI clean plain text
function stripHtml(html = "") {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// Like stripHtml but preserves list-item boundaries as newlines so bullet
// structure survives for downstream AI prompts that need to reorder/drop bullets.
function stripHtmlPreserveBullets(html = "") {
  return html
    .replace(/<\/li>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*/g, "\n")
    .replace(/^\n+|\n+$/g, "")
    .trim();
}

// GET /context — returns only the human-readable resume content for AI input
app.get("/context", (_req, res) => {
  const resume = JSON.parse(readFileSync(new URL("../data/resume.json", import.meta.url)));
  res.json({
    currentJobTitle: resume.personalDetails.jobTitle,
    currentProfile: stripHtml(resume.content.profile.entries[0]?.text),
    currentWork: resume.content.work.entries.map((e) => ({
      id: e.id,
      employer: e.employer,
      jobTitle: e.jobTitle,
      location: e.location,
      startDate: e.startDateNew,
      endDate: e.endDateNew,
      description: stripHtmlPreserveBullets(e.description),
    })),
    currentSkills: resume.content.skill.entries.map((e) => ({
      id: e.id,
      skill: e.skill,
      details: stripHtml(e.infoHtml),
    })),
  });
});

// POST /generate-resume
// Body: { patch: {...}, company: "SAP SE" }
app.post("/generate-resume", async (req, res) => {
  const { patch, company, role, language, jobId } = req.body;
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
  const output = buildOutputPath({
    kind: "resume",
    company,
    role,
  });

  let context;
  try {
    const html = buildResumeHtml(mergedResume, { language });
    context = await browser.newContext();
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({
      path: output.fullPath,
      format: "A4",
      printBackground: true,
      margin: { top: "15mm", right: "18mm", bottom: "15mm", left: "18mm" },
    });
    if (!existsSync(output.fullPath)) {
      throw new Error(`PDF was not written to disk: ${output.fullPath}`);
    }
    const result = { success: true, file: output.fullPath, fileName: output.fileName };
    if (jobId) result.jobId = jobId;
    res.json(result);
  } catch (err) {
    console.error("Resume generation error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    if (context) await context.close();
  }
});

// POST /generate-coverletter
// Body: { role, company, companyAddress, paragraph1, paragraph2, paragraph3 }
app.post("/generate-coverletter", async (req, res) => {
  const { company, role, jobId } = req.body;
  const output = buildOutputPath({
    kind: "coverletter",
    company,
    role,
  });

  let context;
  try {
    const html = buildCoverLetterHtml(req.body);
    context = await browser.newContext();
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({
      path: output.fullPath,
      format: "A4",
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
    if (!existsSync(output.fullPath)) {
      throw new Error(`PDF was not written to disk: ${output.fullPath}`);
    }
    const result = { success: true, file: output.fullPath, fileName: output.fileName };
    if (jobId) result.jobId = jobId;
    res.json(result);
  } catch (err) {
    console.error("Cover letter generation error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    if (context) await context.close();
  }
});

app.listen(3000, "0.0.0.0", () => console.log("Server running on port 3000"));
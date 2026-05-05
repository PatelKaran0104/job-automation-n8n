// src/validateCoverLetter.js
// Quality validator for AI-generated cover letter paragraphs.
//
// Returns { valid, severity, errors, warnings } — never throws.
// "valid:false" means a hard quality issue (banned opener, missing MSc anchor)
// that should be visible in logs but does NOT block PDF generation — we always
// recover what we have rather than ship nothing.

const BANNED_SUBSTRINGS_DE = [
  // Application-opener clichés (substring match, case-insensitive)
  "ich bewerbe mich",
  "hiermit bewerbe ich",
  "hiermit möchte ich mich",
  "ich möchte mich auf die",
  "ich möchte mich um die",
  "mit großem interesse",
  // Generic self-praise
  "hochmotiviert",
  "teamplayer",
  "hands-on-mentalität",
  "dynamisches umfeld",
  // The "bringe ich" pattern in any form
  "bringe ich",
];

const BANNED_SUBSTRINGS_EN = [
  "i am writing to apply",
  "i would like to apply",
  "with great interest",
  "passionate",
  "excited to",
  "team player",
  "fast learner",
  "self-starter",
  "hit the ground running",
  "think outside the box",
  "results-oriented",
  "proven track record",
  "cutting-edge",
  "dynamic environment",
  "hands-on",
];

const BANNED_OPENERS_DE = [
  /^ich bewerbe mich/i,
  /^ich möchte mich/i,
  /^hiermit/i,
];
const BANNED_OPENERS_EN = [
  /^i am writing to apply/i,
  /^i would like to apply/i,
  /^with great interest/i,
];

const ANCHOR_PATTERNS = [
  /hochschule fulda/i,
  /m\.?\s*sc\.?\s+global software development/i,
];

const WORD_TARGETS = {
  paragraph1: { min: 50, max: 70 },
  paragraph2: { min: 80, max: 110 },
  paragraph3: { min: 40, max: 60 },
};

const SENTENCE_TARGETS = {
  paragraph1: { min: 4, max: 5 },
  paragraph2: { min: 5, max: 7 },
  paragraph3: { min: 3, max: 4 },
};

function stripHtml(s) {
  return String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function countWords(s) {
  const t = stripHtml(s);
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

function countSentences(s) {
  const t = stripHtml(s);
  if (!t) return 0;
  // Split on terminal punctuation followed by space + capital/quote, OR end of string.
  const sentences = t.split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ"„])/).filter(Boolean);
  return sentences.length;
}

function detectLanguage(s) {
  const t = stripHtml(s).toLowerCase();
  // Strong DE markers
  const deHits = (t.match(/\b(ich|der|die|das|und|für|bei|über|sehr|mit|hochschule)\b/g) || []).length;
  const enHits = (t.match(/\b(the|and|i\s|with|for|at\s|of\s|to\s|my)\b/g) || []).length;
  return deHits >= enHits ? "de" : "en";
}

function findBannedSubstrings(text, lang) {
  const t = stripHtml(text).toLowerCase();
  const list = lang === "de" ? BANNED_SUBSTRINGS_DE : BANNED_SUBSTRINGS_EN;
  return list.filter((b) => t.includes(b));
}

function hasBannedOpener(text, lang) {
  const t = stripHtml(text);
  const list = lang === "de" ? BANNED_OPENERS_DE : BANNED_OPENERS_EN;
  return list.find((rx) => rx.test(t)) || null;
}

function hasAnchor(text) {
  const t = stripHtml(text);
  return ANCHOR_PATTERNS.some((rx) => rx.test(t));
}

/**
 * @param {{ paragraph1?: string, paragraph2?: string, paragraph3?: string, language?: "de"|"en" }} input
 * @returns {{ valid: boolean, severity: "ok"|"warn"|"fail", errors: string[], warnings: string[], stats: object }}
 */
export function validateCoverLetter(input = {}) {
  const errors = [];
  const warnings = [];

  const p1 = input.paragraph1 || "";
  const p2 = input.paragraph2 || "";
  const p3 = input.paragraph3 || "";

  const lang = (input.language === "de" || input.language === "en")
    ? input.language
    : detectLanguage(p1 + " " + p2 + " " + p3);

  const stats = {
    language: lang,
    p1: { words: countWords(p1), sentences: countSentences(p1) },
    p2: { words: countWords(p2), sentences: countSentences(p2) },
    p3: { words: countWords(p3), sentences: countSentences(p3) },
  };

  // Hard fail: missing paragraph
  if (!stripHtml(p1)) errors.push("paragraph1 is empty");
  if (!stripHtml(p2)) errors.push("paragraph2 is empty");
  if (!stripHtml(p3)) errors.push("paragraph3 is empty");

  // Hard fail: banned opener in P1
  const bannedOpener = hasBannedOpener(p1, lang);
  if (bannedOpener) {
    errors.push(`P1 starts with banned opener pattern: ${bannedOpener.source}`);
  }

  // Hard fail: missing Hochschule Fulda anchor in P1
  if (stripHtml(p1) && !hasAnchor(p1)) {
    errors.push("P1 missing Hochschule Fulda / M.Sc. Global Software Development anchor");
  }

  // Warn: word counts outside target band
  for (const [key, { min, max }] of Object.entries(WORD_TARGETS)) {
    const k = key.replace("paragraph", "p");
    const w = stats[k].words;
    if (w === 0) continue; // already errored above
    if (w < min) warnings.push(`${key} has ${w} words (target ${min}-${max}, below floor)`);
    else if (w > max) warnings.push(`${key} has ${w} words (target ${min}-${max}, above ceiling)`);
  }

  // Warn: sentence counts outside target band
  for (const [key, { min, max }] of Object.entries(SENTENCE_TARGETS)) {
    const k = key.replace("paragraph", "p");
    const s = stats[k].sentences;
    if (s === 0) continue;
    if (s < min) warnings.push(`${key} has ${s} sentences (target ${min}-${max}, below floor)`);
    else if (s > max) warnings.push(`${key} has ${s} sentences (target ${min}-${max}, above ceiling)`);
  }

  // Warn: banned substrings anywhere
  for (const [name, text] of [["P1", p1], ["P2", p2], ["P3", p3]]) {
    const hits = findBannedSubstrings(text, lang);
    if (hits.length > 0) {
      warnings.push(`${name} contains banned phrase(s): ${hits.join(", ")}`);
    }
  }

  // Warn: P2 missing numeric metrics (target: at least 2)
  const p2Numbers = (stripHtml(p2).match(/\b\d+(\.\d+)?%?\b/g) || []).length;
  if (stripHtml(p2) && p2Numbers < 2) {
    warnings.push(`P2 has only ${p2Numbers} numeric metric(s) — target at least 2 (e.g. "85%", "41 resources", "40%")`);
  }

  const severity = errors.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "ok";
  return { valid: errors.length === 0, severity, errors, warnings, stats };
}

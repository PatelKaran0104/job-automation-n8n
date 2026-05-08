// src/jdQualityGate.js
// Deterministic JD-quality gate. Rejects scrapes that are too broken to
// produce decent tailoring, before spending LLM tokens on them.

const JD_STRUCTURE_PATTERN = /responsibilities|requirements|qualifications|tasks|aufgaben|profil|anforderungen|qualifikation|deine aufgaben|das bringst du mit|womit du arbeitest|was du mitbringst|must.haves|nice.to.haves/i;
const BOILERPLATE_PATTERN = /cookie|datenschutz|privacy policy|impressum|equal opportunity employer|gleiche chancen|legal notice|terms of service|nutzungsbedingungen/gi;

const MIN_DESCRIPTION_CHARS = 600;

/**
 * @param {{ title?: string, company?: string, description?: string }} job
 * @returns {{ ok: boolean, reason: string | null }}
 */
export function evaluateJdQuality(job) {
  const title = String(job?.title || "").trim();
  const company = String(job?.company || "").trim();
  const description = String(job?.description || "");

  if (!title) return { ok: false, reason: "title_missing" };

  if (!company || /^unknown$/i.test(company) || /^n\.?\s*a\.?$/i.test(company)) {
    return { ok: false, reason: "company_missing" };
  }

  if (description.length < MIN_DESCRIPTION_CHARS) {
    return { ok: false, reason: "description_too_short" };
  }

  if (!JD_STRUCTURE_PATTERN.test(description)) {
    return { ok: false, reason: "no_jd_structure" };
  }

  // Boilerplate density: count chars matched, divide by total length.
  const boilerplateMatches = description.match(BOILERPLATE_PATTERN) || [];
  const boilerplateChars = boilerplateMatches.reduce((sum, m) => sum + m.length, 0);
  const ratio = boilerplateChars / description.length;
  // Heuristic: if 5%+ of the description matches boilerplate keywords AND
  // there are >8 distinct hits, the surrounding navigation/footer/legal
  // text is likely dominating.
  if (ratio > 0.05 && boilerplateMatches.length > 8) {
    return { ok: false, reason: "boilerplate_heavy" };
  }

  return { ok: true, reason: null };
}

// src/languageGate.js
// Deterministic language decision. Decides ONLY language, never eligibility.
// Hard German C1+ unsupported is handled by Claim Ledger as fatal_gap (Phase 2).

// Common German tokens unlikely to appear in English JDs. Used as a tie-breaker
// signal — count of these tokens vs total words approximates "German-ness".
const GERMAN_TOKENS = /\b(der|die|das|und|oder|für|mit|bei|von|zu|nach|über|unter|gegen|durch|ohne|aber|wenn|weil|dass|sind|haben|werden|wird|wurde|kann|muss|ist|war|nicht|auch|schon|noch|sehr|viel|mehr|weniger|gut|gute|guten|neuen|alle|jeden|deine|deiner|deinem|unser|unsere|unseren|aufgaben|anforderungen|kenntnisse|erfahrung|fähigkeiten|kollegen|umfeld|bereich|möglichkeiten|entwicklung|lösungen)\b/gi;

const HARD_GERMAN_PHRASES = /\b(fluent\s+german|c1\s+german|c2\s+german|native\s+german|verhandlungssicheres?\s+deutsch|sehr\s+gute\s+deutschkenntnisse|deutsch\s+auf\s+muttersprachniveau|deutsch\s+zwingend\s+erforderlich)\b/i;

/**
 * @param {{ description: string, languageRequirements?: Array<{language: string, level: string, hard: boolean}> }} input
 * @returns {"de" | "en"}
 */
export function decideLanguage({ description = "", languageRequirements = [] }) {
  const text = String(description);
  if (text.trim().length === 0) return "en";

  const wordCount = (text.match(/\b\w+\b/g) || []).length || 1;
  const germanMatches = (text.match(GERMAN_TOKENS) || []).length;
  const germanRatio = germanMatches / wordCount;

  if (germanRatio > 0.08) return "de";

  return "en";
}

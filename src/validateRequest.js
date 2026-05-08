// src/validateRequest.js
// Request-level parameter validation shared between PDF endpoints.

const UNKNOWN_PATTERN = /^unknown( company)?$/i;
const NA_PATTERN = /^n\.?\s*\/?\s*a\.?$|^na$/i;

/**
 * @param {unknown} company
 * @returns {{ valid: boolean, error: string | null }}
 */
export function validateCompanyParam(company) {
  if (company === null || company === undefined) {
    return { valid: false, error: "company is empty" };
  }
  const s = String(company).trim();
  if (s.length === 0) {
    return { valid: false, error: "company is empty" };
  }
  if (UNKNOWN_PATTERN.test(s)) {
    return { valid: false, error: "company is 'Unknown'" };
  }
  if (NA_PATTERN.test(s)) {
    return { valid: false, error: "company is 'N/A'" };
  }
  return { valid: true, error: null };
}

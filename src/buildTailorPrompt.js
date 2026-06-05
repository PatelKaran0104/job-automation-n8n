// src/buildTailorPrompt.js
// Prepares the job-description text that is fed to the TAILORING model.
//
// Unlike the cheap match/fit-score prompt (which stays capped at 1500 chars to
// save Gemini tokens), the tailor MUST see the COMPLETE job description so it can
// ground every bullet, keyword, and cover-letter claim in real JD signal.
// Therefore: no length cap, no section dropping, no benefits stripping — only
// lossless normalization (strip HTML tags, decode HTML entities, tidy whitespace).

// Common named HTML entities, incl. the German set that scraped DE job boards emit.
const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß",
  eacute: "é", egrave: "è", ecirc: "ê", agrave: "à", acirc: "â", ccedil: "ç",
  ntilde: "ñ", oslash: "ø", aring: "å",
  ndash: "–", mdash: "—", hellip: "…", euro: "€", pound: "£", cent: "¢",
  copy: "©", reg: "®", trade: "™", deg: "°", middot: "·", bull: "•",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  sbquo: "‚", bdquo: "„", laquo: "«", raquo: "»",
};

// Decode numeric (&#252;), hex (&#xFC;), and named (&uuml;) HTML entities.
// Single pass — non-overlapping matches — so `&amp;#38;` stays the literal text
// `&#38;` instead of being double-decoded.
export function decodeHtmlEntities(input) {
  return String(input ?? "").replace(
    /&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g,
    (match, body) => {
      if (body[0] === "#") {
        const isHex = body[1] === "x" || body[1] === "X";
        const codePoint = isHex
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
        if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
          return match; // out-of-range — leave the raw entity untouched
        }
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return match;
        }
      }
      return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body)
        ? NAMED_ENTITIES[body]
        : match; // unknown named entity — leave it literal rather than dropping it
    }
  );
}

// Full, uncapped JD preparation for the tailoring prompt.
export function prepareTailorJd(rawDescription) {
  const raw = String(rawDescription ?? "");
  if (!raw.trim()) return "";

  // Strip real HTML tags FIRST so entity-encoded angle brackets (&lt;Apex&gt;)
  // survive as literal text instead of being mistaken for markup and removed.
  const withoutTags = raw.replace(/<[^>]+>/g, " ");

  const decoded = decodeHtmlEntities(withoutTags);

  // Normalize whitespace WITHOUT dropping any content: collapse horizontal runs,
  // keep single line breaks, cap blank-line runs. No slice — the model gets the
  // complete description, and not slicing means surrogate pairs/emoji can never
  // be cut mid-character.
  return decoded
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// src/mergeCoverLetter.js
import { FONT_CSS } from "./loadFonts.js";

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function wrapParagraph(text) {
  if (!text) return "";
  if (text.trimStart().startsWith("<")) return text;
  return `<p>${text}</p>`;
}

export function buildCoverLetterHtml(content) {
  const {
    role = "Softwareentwickler",
    company = "",
    companyAddress = "",
    paragraph1 = "",
    paragraph2 = "",
    paragraph3 = "",
    language = "de",
  } = content;

  const isDE = language === "de";

  // Generated fresh on each call — intentionally not cached
  const dateStr = new Date().toLocaleDateString(isDE ? "de-DE" : "en-US", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const subject = isDE
    ? `Bewerbung als ${escapeHtml(role)}`
    : `Application for ${escapeHtml(role)}`;
  const footerRole = company
    ? `${escapeHtml(role)} @ ${escapeHtml(company)}`
    : escapeHtml(role);

  const salutation = isDE ? "Sehr geehrte Damen und Herren," : "Dear Hiring Manager,";
  const closing = isDE ? "Mit freundlichen Grüßen," : "Kind regards,";
  const htmlLang = isDE ? "de" : "en";
  const pageTitle = isDE ? "Anschreiben" : "Cover Letter";

  return `<!DOCTYPE html>
<html lang="${htmlLang}">
<head>
  <meta charset="UTF-8" />
  <title>${pageTitle} – Karan Patel</title>
  <style>
    ${FONT_CSS}

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Source Serif Pro', Georgia, 'Times New Roman', serif;
      font-size: 11pt;
      line-height: 1.6;
      color: #1a1a1a;
      background: #fff;
    }

    .page {
      width: 210mm;
      min-height: 297mm;
      margin: 0 auto;
      padding: 18mm 20mm 16mm 20mm;
      display: flex;
      flex-direction: column;
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #2563eb;
      padding-bottom: 10px;
      margin-bottom: 18px;
    }

    .header-name {
      font-size: 20pt;
      font-weight: 700;
      color: #1e3a5f;
      letter-spacing: 0.5px;
    }

    .header-title {
      font-size: 10pt;
      color: #2563eb;
      font-weight: 500;
      margin-top: 2px;
    }

    .header-contact {
      text-align: right;
      font-size: 9pt;
      color: #444;
      line-height: 1.7;
    }

    .header-contact a {
      color: #2563eb;
      text-decoration: none;
    }

    .recipient {
      margin-bottom: 20px;
      font-size: 10.5pt;
      line-height: 1.8;
      color: #1a1a1a;
    }

    .date-line {
      text-align: right;
      font-size: 10pt;
      color: #555;
      margin-bottom: 20px;
    }

    .subject {
      font-size: 12pt;
      font-weight: 700;
      color: #1e3a5f;
      margin-bottom: 18px;
      border-left: 3px solid #2563eb;
      padding-left: 10px;
    }

    .body-text p {
      margin-bottom: 13px;
      text-align: justify;
      hyphens: auto;
    }

    .closing {
      margin-top: 22px;
      font-size: 10.5pt;
    }

    .closing-line {
      margin-bottom: 38px;
    }

    .signature-name {
      font-weight: 700;
      font-size: 11pt;
      color: #1e3a5f;
    }

    .signature-title {
      font-size: 9.5pt;
      color: #555;
    }

    .footer {
      margin-top: auto;
      padding-top: 10px;
      border-top: 1px solid #d1d5db;
      font-size: 8.5pt;
      color: #777;
      display: flex;
      justify-content: space-between;
    }

    @media print {
      body { background: white; }
      .page { margin: 0; padding: 18mm 20mm 16mm 20mm; }
    }
  </style>
</head>
<body>
  <div class="page">

    <div class="header">
      <div>
        <div class="header-name">Karan Patel</div>
        <div class="header-title">${escapeHtml(role)}</div>
      </div>
      <div class="header-contact">
        khpatel0104@gmail.com<br/>
        +49 15210894179<br/>
        Hesse, Germany<br/>
        <a href="https://linkedin.com/in/patelkaran0104/">linkedin.com/in/patelkaran0104/</a><br/>
        <a href="https://karanpatel.live">karanpatel.live</a>
      </div>
    </div>

    <div class="date-line">${dateStr}</div>

    <div class="recipient">
      <div>${escapeHtml(company)}</div>
      <div>${escapeHtml(companyAddress)}</div>
    </div>

    <div class="subject">${subject}</div>

    <div style="margin-bottom: 13px;">${salutation}</div>

    <div class="body-text">
      ${wrapParagraph(paragraph1)}
      ${wrapParagraph(paragraph2)}
      ${wrapParagraph(paragraph3)}
    </div>

    <div class="closing">
      <div class="closing-line">${closing}</div>
      <div class="signature-name">Karan Patel</div>
      <div class="signature-title">${escapeHtml(role)}</div>
    </div>

    <div class="footer">
      <span>Karan Patel · khpatel0104@gmail.com · +49 15210894179</span>
      <span>${footerRole}</span>
    </div>

  </div>
</body>
</html>`;
}

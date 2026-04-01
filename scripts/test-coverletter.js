/**
 * Test script — simulates what n8n will POST to the cover letter endpoint.
 * Usage:
 *   1. Start the server: npm start
 *   2. In another terminal: node scripts/test-coverletter.js
 *      or: npm run test:coverletter
 */

const body = {
  role: "Salesforce Developer",
  company: "SAP SE",
  companyAddress: "Walldorf, Deutschland",
  paragraph1:
    "<p>Mit großem Interesse habe ich Ihre Stellenausschreibung als Salesforce Developer bei SAP SE gelesen. Als zertifizierter Salesforce Developer mit mehr als zwei Jahren Erfahrung in der Entwicklung skalierbarer CRM-Lösungen bin ich überzeugt, dass meine Kenntnisse in Apex, Lightning Web Components und Agentforce-Integrationen einen wertvollen Beitrag zu Ihrem Team leisten können.</p>",
  paragraph2:
    "<p>In meiner bisherigen Tätigkeit bei MV Clouds habe ich end-to-end Salesforce-Lösungen für mittelständische Unternehmen konzipiert und umgesetzt — darunter REST-API-Integrationen, automatisierte Flows sowie KI-gestützte Funktionen auf Basis der Agentforce-Plattform. Die Kombination aus technischer Umsetzungsstärke und lösungsorientiertem Denken hat mir ermöglicht, komplexe Anforderungen effizient in produktionsreife Anwendungen zu überführen. Die Möglichkeit, diese Kompetenzen im Umfeld eines globalen Technologieführers wie SAP einzusetzen und weiterzuentwickeln, motiviert mich besonders.</p>",
  paragraph3:
    "<p>Ich stehe ab sofort für ein Gespräch zur Verfügung und freue mich darauf, mehr über die Rolle und Ihr Team zu erfahren. Meine vollständigen Bewerbungsunterlagen übersende ich Ihnen gerne auf Anfrage. Ich freue mich auf Ihre Rückmeldung.</p>",
};

const response = await fetch("http://localhost:3000/generate-coverletter", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const result = await response.json();
console.log("Response:", result);

if (result.success) {
  console.log("PDF saved at:", result.file);
} else {
  console.error("Failed:", result);
}

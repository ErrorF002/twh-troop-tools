const fs   = require("fs");
const path = require("path");
const csvParser = require("../shared/csv-parser");
const { todayLong } = require("../shared/dates");

function fileTimestamp() {
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

// ═══════════════════════════════ MANIFEST ════════════════════════════════
const manifest = {
  id: "roster-audit",
  name: "Roster Audit",
  description: "Scans the active youth roster for data quality issues: missing dates of birth, scouts without a patrol, missing BSA IDs, and duplicate names.",
  icon: "📋",
  outputType: "html",
  inputs: [
    {
      key: "roster",
      label: "TroopWebHost Active Roster CSV",
      hint: "Export: Membership → Export Membership Data → Export Active Roster To Excel",
      required: true,
      twhReport: "roster",
    },
  ],
  options: [
    {
      key: "downloadPdf",
      label: "Also download PDF",
      type: "checkbox",
      default: false,
    },
    {
      key: "downloadCsv",
      label: "Also download CSV",
      type: "checkbox",
      default: false,
    },
  ],
};

// ═══════════════════════════════ DATA LOADING ════════════════════════════
function loadRoster(rosterPath) {
  const rows = csvParser.parseCSV(fs.readFileSync(rosterPath, "utf8"));
  return rows
    .filter(r => r.Adult === "N")
    .filter(r => !(r.Patrol || "").trim().toLowerCase().startsWith("zinactive"))
    .map(r => ({
      firstName: (r["FIrst Name"] || r["First Name"] || "").trim(),
      lastName:  (r["Last Name"]  || "").trim(),
      fullName:  `${(r["FIrst Name"] || r["First Name"] || "").trim()} ${(r["Last Name"] || "").trim()}`.trim(),
      dob:       (r["Born"] || r["Date Of Birth"] || r["Date of Birth"] || r["DOB"] || "").trim(),
      bsaId:     (r["BSA ID"] || "").trim(),
      patrol:    (r["Patrol"]  || "").trim(),
      rank:      (r["Rank"]    || "").trim(),
    }));
}

// ═══════════════════════════════ AUDIT ═══════════════════════════════════
function audit(scouts) {
  const byLastFirst = arr => arr.slice().sort((a, b) =>
    a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName)
  );

  const nameBuckets = new Map();
  for (const s of scouts) {
    const key = s.fullName.toLowerCase().replace(/\s+/g, " ").trim();
    if (!nameBuckets.has(key)) nameBuckets.set(key, []);
    nameBuckets.get(key).push(s);
  }
  const duplicates = [];
  for (const [, group] of nameBuckets) {
    if (group.length > 1) duplicates.push(...group);
  }

  return {
    missingDob:  byLastFirst(scouts.filter(s => !s.dob)),
    noPatrol:    byLastFirst(scouts.filter(s => !s.patrol)),
    missingId:   byLastFirst(scouts.filter(s => !s.bsaId)),
    duplicates:  byLastFirst(duplicates),
    scoutCount:  scouts.length,
  };
}

// ═══════════════════════════════ HTML GENERATION ═════════════════════════
function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildHTML(results, dateStr, troopName) {
  const label = troopName ? `${troopName} - ` : "";
  const { missingDob, noPatrol, missingId, duplicates, scoutCount } = results;
  const totalIssues = missingDob.length + noPatrol.length + missingId.length + duplicates.length;

  const badge = (n, bg) =>
    `<span class="badge" style="background:${n > 0 ? bg : "#aaa"}">${n}</span>`;

  const checkRow = cells => `
    <tr>
      <td class="check-cell"><span class="cb"></span></td>
      ${cells.map(c => `<td>${esc(c)}</td>`).join("")}
    </tr>`;

  const section = (id, color, icon, title, rows, headers, rowFn) => `
    <div class="section" id="${id}">
      <div class="section-header" style="border-left-color:${color}">
        <span class="section-icon">${icon}</span>
        <span class="section-title">${title}</span>
        ${badge(rows.length, color)}
      </div>
      ${rows.length === 0
        ? `<p class="empty-msg">No issues found.</p>`
        : `<table>
            <thead><tr>
              <th class="check-cell"></th>
              ${headers.map(h => `<th>${h}</th>`).join("")}
            </tr></thead>
            <tbody>${rows.map(rowFn).join("")}</tbody>
          </table>`}
    </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(label)}Roster Audit - ${dateStr}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #FAF7F0;
    color: #1C2340;
    padding: 2rem;
    max-width: 1100px;
    margin: 0 auto;
  }
  .report-header {
    background: #2A3A1F;
    color: #fff;
    padding: 1.75rem 2rem;
    border-radius: 10px;
    margin-bottom: 1.5rem;
    border-bottom: 4px solid #C7A975;
  }
  .report-header h1 { font-size: 1.6rem; font-weight: 800; letter-spacing: 0.5px; }
  .report-meta { font-size: 0.9rem; color: #E8DCC0; margin-top: 0.3rem; font-style: italic; }
  .summary {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
    margin-bottom: 1.75rem;
  }
  .summary-item {
    flex: 1;
    min-width: 150px;
    background: #fff;
    border: 1px solid #D7CDB5;
    border-radius: 8px;
    padding: 0.85rem 1rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    box-shadow: 0 1px 4px rgba(0,0,0,0.06);
  }
  .summary-count { font-size: 2rem; font-weight: 800; line-height: 1; }
  .summary-label { font-size: 0.82rem; color: #4A5568; line-height: 1.35; }
  .section {
    background: #fff;
    border: 1px solid #D7CDB5;
    border-radius: 10px;
    margin-bottom: 1.5rem;
    overflow: hidden;
    box-shadow: 0 1px 4px rgba(0,0,0,0.06);
  }
  .section-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem 1.25rem;
    background: #F7F4EC;
    border-bottom: 1px solid #D7CDB5;
    border-left: 5px solid #ccc;
  }
  .section-icon { font-size: 1.2rem; }
  .section-title { font-weight: 700; font-size: 1rem; flex: 1; }
  .badge {
    color: #fff;
    font-size: 0.82rem;
    font-weight: 700;
    padding: 0.2rem 0.6rem;
    border-radius: 20px;
    min-width: 2rem;
    text-align: center;
  }
  .empty-msg { padding: 1rem 1.25rem; color: #4A5568; font-style: italic; font-size: 0.9rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
  thead th {
    background: #F0EBDC;
    padding: 0.6rem 0.85rem;
    text-align: left;
    font-weight: 600;
    font-size: 0.8rem;
    color: #4A5568;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border-bottom: 1px solid #D7CDB5;
  }
  tbody tr:nth-child(even) { background: #FAF7F0; }
  tbody tr:hover { background: #F0EBDC; }
  tbody td {
    padding: 0.6rem 0.85rem;
    border-bottom: 1px solid #EDE8DC;
    vertical-align: middle;
  }
  tbody tr:last-child td { border-bottom: none; }
  .check-cell { width: 2rem; text-align: center; }
  .cb {
    display: inline-block;
    width: 14px; height: 14px;
    border: 2px solid #C7A975;
    border-radius: 3px;
    background: #fff;
    vertical-align: middle;
  }
  .report-footer {
    text-align: center;
    font-size: 0.8rem;
    color: #9A7E4E;
    margin-top: 2rem;
    padding-top: 1rem;
    border-top: 1px solid #D7CDB5;
  }
  @media print {
    body { background: #fff; padding: 1rem; }
    .report-header { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .section { break-inside: avoid; }
    .section-header { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .badge { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    thead th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>

<div class="report-header">
  <h1>⚜ ${esc(label)}Roster Audit</h1>
  <div class="report-meta">Generated ${dateStr}  •  ${scoutCount} active youth  •  ${totalIssues} issue${totalIssues !== 1 ? "s" : ""} found</div>
</div>

<div class="summary">
  <div class="summary-item">
    <div class="summary-count" style="color:#E65100">${missingDob.length}</div>
    <div class="summary-label">Missing<br>Date of Birth</div>
  </div>
  <div class="summary-item">
    <div class="summary-count" style="color:#C0392B">${noPatrol.length}</div>
    <div class="summary-label">No Patrol<br>Assigned</div>
  </div>
  <div class="summary-item">
    <div class="summary-count" style="color:#1565C0">${missingId.length}</div>
    <div class="summary-label">Missing<br>BSA ID</div>
  </div>
  <div class="summary-item">
    <div class="summary-count" style="color:#6A1B9A">${duplicates.length}</div>
    <div class="summary-label">Duplicate<br>Names</div>
  </div>
</div>

${section(
  "missing-dob", "#E65100", "📅", "Missing Date of Birth",
  missingDob,
  ["Name", "BSA ID", "Patrol", "Rank"],
  r => checkRow([r.fullName, r.bsaId, r.patrol, r.rank])
)}

${section(
  "no-patrol", "#C0392B", "🏕", "No Patrol Assigned",
  noPatrol,
  ["Name", "BSA ID", "Rank"],
  r => checkRow([r.fullName, r.bsaId, r.rank])
)}

${section(
  "missing-id", "#1565C0", "🪪", "Missing BSA ID",
  missingId,
  ["Name", "Patrol", "Rank"],
  r => checkRow([r.fullName, r.patrol, r.rank])
)}

${section(
  "duplicate-names", "#6A1B9A", "👥", "Duplicate Names",
  duplicates,
  ["Name", "BSA ID", "Patrol", "Rank"],
  r => checkRow([r.fullName, r.bsaId, r.patrol, r.rank])
)}

<div class="report-footer">
  Roster Audit  •  ${dateStr}
</div>
</body>
</html>`;
}

// ═══════════════════════════════ CSV GENERATION ══════════════════════════
function buildCSV(results) {
  const escape = v => {
    const s = String(v || "");
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [["Issue", "Name", "BSA ID", "Patrol", "Rank"].join(",")];
  const add = (issue, rows) =>
    rows.forEach(r => lines.push(
      [issue, r.fullName, r.bsaId, r.patrol, r.rank].map(escape).join(",")
    ));
  add("Missing Date of Birth", results.missingDob);
  add("No Patrol Assigned",    results.noPatrol);
  add("Missing BSA ID",        results.missingId);
  add("Duplicate Name",        results.duplicates);
  return lines.join("\r\n");
}

// ═══════════════════════════════ PDF GENERATION ══════════════════════════
async function buildPDF(htmlPath) {
  const { chromium } = require("playwright");
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`file://${htmlPath}`, { waitUntil: "domcontentloaded" });
    const pdfPath = htmlPath.replace(/\.html$/, ".pdf");
    await page.pdf({
      path: pdfPath,
      format: "Letter",
      margin: { top: "0.75in", bottom: "0.75in", left: "0.75in", right: "0.75in" },
      printBackground: true,
    });
    return pdfPath;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// ═══════════════════════════════ MAIN ENTRY POINT ════════════════════════
async function generate(inputs, outputDir, options = {}) {
  const { roster: rosterPath } = inputs;
  if (!rosterPath || !fs.existsSync(rosterPath)) throw new Error("TroopWebHost roster CSV not provided");

  const scouts    = loadRoster(rosterPath);
  const results   = audit(scouts);
  const dateStr   = todayLong();
  const ts        = fileTimestamp();
  const troopName = options.troopName || "";

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const htmlFileName = `Roster_Audit_${ts}.html`;
  const htmlPath     = path.join(outputDir, htmlFileName);
  fs.writeFileSync(htmlPath, buildHTML(results, dateStr, troopName), "utf8");

  const output = {
    htmlFileName,
    htmlPath,
    pdfPath:  null,
    csvPath:  null,
    stats: {
      activeScouts:   results.scoutCount,
      missingDob:     results.missingDob.length,
      noPatrol:       results.noPatrol.length,
      missingBsaId:   results.missingId.length,
      duplicateNames: results.duplicates.length,
    },
  };

  if (options.downloadPdf === true || options.downloadPdf === "true") {
    output.pdfPath     = await buildPDF(htmlPath);
    output.pdfFileName = path.basename(output.pdfPath);
  }

  if (options.downloadCsv === true || options.downloadCsv === "true") {
    const csvFileName  = `Roster_Audit_${ts}.csv`;
    output.csvPath     = path.join(outputDir, csvFileName);
    output.csvFileName = csvFileName;
    fs.writeFileSync(output.csvPath, buildCSV(results), "utf8");
  }

  return output;
}

module.exports = { manifest, generate };

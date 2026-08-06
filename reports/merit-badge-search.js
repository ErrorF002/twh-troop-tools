/**
 * Merit Badge Search
 *
 * Searchable reference across every official BSA merit badge: how many
 * currently-active scouts hold it, and a 4-year timeline of how many
 * scouts (active or not) earned it each year - useful for spotting badges
 * nobody's touched lately when planning merit badge events or summer camp.
 */

const fs   = require("fs");
const path = require("path");
const { parseCSV } = require("../shared/csv-parser");
const { normalizeName, formatDisplayName } = require("../shared/name-normalize");
const { parseDate, todayLong } = require("../shared/dates");
const { OFFICIAL_BADGES } = require("../shared/official-badges");

// ═══════════════════════════════ MANIFEST ═══════════════════════════════
const manifest = {
  id:          "merit-badge-search",
  name:        "Merit Badge Search",
  description: "Search any official BSA merit badge to see how many active scouts currently hold it and a 4-year timeline of when scouts have earned it.",
  icon:        "🔍",
  outputType:  "html",
  inputs: [
    {
      key:       "meritBadges",
      label:     "Merit Badge History CSV",
      hint:      "Export: Menu → Advancement → Advancement Status Reports → Merit Badge History By Scout By Badge Name → Open in Excel",
      required:  true,
      twhReport: "meritBadges",
    },
    {
      key:       "roster",
      label:     "Active Roster CSV",
      hint:      "Export: Menu → Membership → Export Membership Data → Export Active Roster to Excel",
      required:  true,
      twhReport: "roster",
    },
  ],
  options: [
    {
      key:      "selectedBadge",
      label:    "List individual active-scout earners for a badge (optional)",
      type:     "select",
      required: false,
      default:  "",
      choices: [
        { value: "", label: "— All badges (summary table only) —" },
        ...OFFICIAL_BADGES.map(b => ({ value: b, label: b })),
      ],
    },
    { key: "downloadPdf", label: "Also download PDF", type: "checkbox", default: false },
    { key: "downloadCsv", label: "Also download CSV", type: "checkbox", default: false },
  ],
};

const YEAR_SPAN = 4;

// ═══════════════════════════════ UTILITIES ═══════════════════════════════
function cleanBadgeName(n) {
  return n.replace(/^\*/, "")
    .replace(/\s*\([^)]*\)\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeBadgeKey(n) {
  return n.toLowerCase()
    .replace(/&/g, "and")
    .replace(/-/g, " ")
    .replace(/,/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fileTimestamp() {
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

// ═══════════════════════════════ DATA LOADING ═══════════════════════════
// Same active-scout definition as the Advancement Report: youth, currently
// assigned to a (non-alumni) patrol.
function getActiveScoutSet(rosterPath) {
  const rows = parseCSV(fs.readFileSync(rosterPath, "utf8"));
  const active = new Set();
  rows.forEach(row => {
    if (row.Adult !== "N") return;
    const rawName = (row.Name || "").trim();
    if (!rawName) return;
    let patrol = (row.Patrol || "").trim();
    patrol = patrol.replace(/\s*\([MF]\)\s*$/, "").trim();
    if (!patrol) return;
    if (patrol.toLowerCase().startsWith("zinactive")) return;
    active.add(normalizeName(rawName));
  });
  return active;
}

// ═══════════════════════════════ DATA PROCESSING ════════════════════════
function processData(meritBadgesPath, rosterPath, selectedBadge) {
  const activeScouts = getActiveScoutSet(rosterPath);
  const rows = parseCSV(fs.readFileSync(meritBadgesPath, "utf8"));

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: YEAR_SPAN }, (_, i) => currentYear - (YEAR_SPAN - 1) + i);
  const selectedKey = selectedBadge ? normalizeBadgeKey(selectedBadge) : null;

  // normalizedBadgeKey -> { activeScouts: Set, everScouts: Set, isEagle: bool,
  //                          lastEarned: Date|null, yearScouts: {year: Set} }
  const badgeData = new Map();

  // Active scout -> most recent earned Date (or null) for the selected badge only.
  const selectedEarners = new Map();

  rows.forEach(r => {
    const rawScout = (r["Scout"] || "").trim();
    const rawBadge = (r["Merit Badge"] || "").trim();
    if (!rawScout || !rawBadge) return;

    const scout   = normalizeName(rawScout);
    const isEagle = rawBadge.startsWith("*");
    const badge   = cleanBadgeName(rawBadge);
    const key     = normalizeBadgeKey(badge);
    const earned  = parseDate(r["Earned"]);

    if (!badgeData.has(key)) {
      badgeData.set(key, {
        displayName: badge, isEagle: false, everScouts: new Set(),
        activeScouts: new Set(), lastEarned: null,
        yearScouts: Object.fromEntries(years.map(y => [y, new Set()])),
      });
    }
    const d = badgeData.get(key);
    if (isEagle) d.isEagle = true;
    d.everScouts.add(scout);
    if (activeScouts.has(scout)) d.activeScouts.add(scout);
    if (earned && (!d.lastEarned || earned > d.lastEarned)) d.lastEarned = earned;
    if (earned && d.yearScouts[earned.getFullYear()]) {
      d.yearScouts[earned.getFullYear()].add(scout);
    }

    if (selectedKey && key === selectedKey && activeScouts.has(scout)) {
      if (!selectedEarners.has(scout)) {
        selectedEarners.set(scout, earned || null);
      } else if (earned) {
        const existing = selectedEarners.get(scout);
        if (!existing || earned > existing) selectedEarners.set(scout, earned);
      }
    }
  });

  const selectedBadgeDetail = selectedBadge ? {
    badge: selectedBadge,
    earners: [...selectedEarners.entries()]
      .map(([scout, earned]) => ({
        displayName: formatDisplayName(scout),
        earned,
        earnedFmt: earned
          ? earned.toLocaleDateString("en-US", { month: "long", year: "numeric" })
          : "Date not recorded",
      }))
      .sort((a, b) => {
        if (!a.earned && !b.earned) return a.displayName.localeCompare(b.displayName);
        if (!a.earned) return 1;
        if (!b.earned) return -1;
        return b.earned - a.earned;
      }),
  } : null;

  // Walk the official badge list so every real BSA badge shows up in the
  // search results, even ones with zero rows in the CSV (0s across the
  // board is itself a useful answer when planning what to offer).
  // When a specific badge is selected from the dropdown, the summary table
  // narrows to just that one row - the earners detail below it is the
  // point of that view, not a browse of every badge.
  const badgeSource = selectedKey
    ? OFFICIAL_BADGES.filter(b => normalizeBadgeKey(b) === selectedKey)
    : OFFICIAL_BADGES;
  const badges = badgeSource.map(officialName => {
    const key = normalizeBadgeKey(officialName);
    const d = badgeData.get(key);
    return {
      badge:        officialName,
      isEagle:      d ? d.isEagle : false,
      activeCount:  d ? d.activeScouts.size : 0,
      everCount:    d ? d.everScouts.size : 0,
      lastEarned:   d ? d.lastEarned : null,
      yearCounts:   years.map(y => ({ year: y, count: d ? d.yearScouts[y].size : 0 })),
    };
  }).sort((a, b) => a.badge.localeCompare(b.badge));

  return {
    badges,
    years,
    activeScoutCount: activeScouts.size,
    totalRows: rows.length,
    selectedBadgeDetail,
  };
}

// ═══════════════════════════════ HTML GENERATION ════════════════════════
function buildHTML(data, dateStr, troopName) {
  const label = troopName ? `${troopName} - ` : "";
  const yearHeaders = data.years.map(y => `<th>${y}</th>`).join("");

  const rowsHtml = data.badges.map(d => {
    const lastFmt = d.lastEarned
      ? d.lastEarned.toLocaleDateString("en-US", { month: "short", year: "numeric" })
      : "Never";
    const yearCells = d.yearCounts.map(yc =>
      `<td class="num${yc.count === 0 ? " zero" : ""}">${yc.count}</td>`
    ).join("");
    return `<tr>
      <td>${esc(d.badge)}${d.isEagle ? `<span class="tag-eagle">Eagle</span>` : ""}</td>
      <td class="num${d.activeCount === 0 ? " zero" : ""}">${d.activeCount}</td>
      ${yearCells}
      <td class="num">${d.everCount}</td>
      <td>${esc(lastFmt)}</td>
    </tr>`;
  }).join("");

  const earnersHtml = data.selectedBadgeDetail ? (
    data.selectedBadgeDetail.earners.length === 0
      ? `<p style="color:#4A5568;font-style:italic;padding:0.5rem 0">No active scout has earned this badge yet.</p>`
      : `<table>
          <thead><tr><th>Scout</th><th>Month/Year Earned</th></tr></thead>
          <tbody>
            ${data.selectedBadgeDetail.earners.map(e => `<tr>
              <td>${esc(e.displayName)}</td>
              <td>${esc(e.earnedFmt)}</td>
            </tr>`).join("")}
          </tbody>
        </table>`
  ) : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(label)}Merit Badge Search - ${esc(dateStr)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #FAF7F0; color: #1C2340; padding: 2rem; max-width: 1100px; margin: 0 auto; }
  .report-header { background: #2A3A1F; color: #fff; padding: 1.75rem 2rem;
    border-radius: 10px; margin-bottom: 1.5rem; border-bottom: 4px solid #C7A975; }
  .report-header h1 { font-size: 1.6rem; font-weight: 800; }
  .report-meta { font-size: 0.9rem; color: #E8DCC0; margin-top: 0.3rem; font-style: italic; }
  h2 { font-size: 1rem; font-weight: 700; color: #2A3A1F; border-bottom: 2px solid #C7A975;
    padding-bottom: 0.35rem; margin: 1.75rem 0 0.75rem; }
  .note { font-size: 0.82rem; color: #4A5568; font-style: italic; margin-bottom: 0.75rem; }
  .summary { display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: 1.5rem; }
  .stat { background: #fff; border: 1px solid #D7CDB5; border-radius: 8px;
    padding: 0.85rem 1.25rem; box-shadow: 0 1px 4px rgba(0,0,0,.06); min-width: 130px; }
  .stat-n { font-size: 2rem; font-weight: 800; color: #3A4F2A; line-height: 1; }
  .stat-l { font-size: 0.78rem; color: #4A5568; margin-top: 0.2rem; }
  .section { background: #fff; border: 1px solid #D7CDB5; border-radius: 10px;
    padding: 1.25rem; margin-bottom: 1.5rem; box-shadow: 0 1px 4px rgba(0,0,0,.06); overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 0.86rem; }
  thead th { background: #F0EBDC; padding: 0.45rem 0.6rem; text-align: left;
    font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
    color: #4A5568; border-bottom: 1px solid #D7CDB5; white-space: nowrap; }
  thead th.num, td.num { text-align: center; }
  tbody tr:nth-child(even) { background: #FAF7F0; }
  tbody tr:hover { background: #F0EBDC; }
  tbody td { padding: 0.4rem 0.6rem; border-bottom: 1px solid #EDE8DC; vertical-align: middle; }
  tbody tr:last-child td { border-bottom: none; }
  td.zero { color: #B0B0B0; }
  .tag-eagle { background: #0B3D6B; color: #fff; font-size: 0.68rem;
    padding: 0.1rem 0.35rem; border-radius: 3px; margin-left: 0.4rem; vertical-align: middle; }
  .report-footer { text-align: center; font-size: 0.8rem; color: #9A7E4E;
    margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #D7CDB5; }
  @media print {
    body { background: #fff; padding: 1rem; }
    .report-header { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .section { break-inside: avoid; box-shadow: none; }
  }
</style>
</head>
<body>
<div class="report-header">
  <h1>🔍 ${esc(label)}Merit Badge Search</h1>
  <div class="report-meta">Generated ${esc(dateStr)}  •  ${data.activeScoutCount} active scouts  •  ${data.totalRows} total completions on record</div>
</div>

<div class="summary">
  <div class="stat"><div class="stat-n">${data.badges.length}</div><div class="stat-l">Official BSA badges tracked</div></div>
  <div class="stat"><div class="stat-n">${data.activeScoutCount}</div><div class="stat-l">Active scouts</div></div>
  <div class="stat"><div class="stat-n">${data.years[0]}–${data.years[data.years.length - 1]}</div><div class="stat-l">Timeline window</div></div>
</div>

<p class="note">"Active Scouts Now" counts current, active youth who have earned the badge at any point. The ${YEAR_SPAN}-year columns count scouts (active or not) who earned it in that specific year. "Ever" is all-time distinct earners on record.</p>

<div class="section">
  <table id="badge-table">
    <thead><tr>
      <th>Merit Badge</th><th class="num">Active Scouts Now</th>${yearHeaders}<th class="num">Ever</th><th>Last Earned</th>
    </tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
</div>

${data.selectedBadgeDetail ? `
<h2>Active Scouts Who Have Earned ${esc(data.selectedBadgeDetail.badge)}</h2>
<p class="note">${data.selectedBadgeDetail.earners.length} of ${data.activeScoutCount} active scouts.</p>
<div class="section">${earnersHtml}</div>
` : ""}

<div class="report-footer">
  ${esc(label)}Merit Badge Search  •  ${esc(dateStr)}
</div>
</body>
</html>`;
}

// ═══════════════════════════════ CSV GENERATION ════════════════════════
function buildCSV(data) {
  const esc2 = v => {
    const s = String(v ?? "");
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ["Merit Badge", "Eagle Required", "Active Scouts Now",
    ...data.years.map(String), "Ever Earned By", "Last Earned"];
  const lines = [header.join(",")];
  data.badges.forEach(d => {
    const lastFmt = d.lastEarned
      ? d.lastEarned.toLocaleDateString("en-US", { month: "short", year: "numeric" })
      : "Never";
    lines.push([
      d.badge, d.isEagle ? "Yes" : "No", d.activeCount,
      ...d.yearCounts.map(yc => yc.count),
      d.everCount, lastFmt,
    ].map(esc2).join(","));
  });

  if (data.selectedBadgeDetail) {
    lines.push("");
    lines.push(`== ACTIVE SCOUTS WHO HAVE EARNED ${data.selectedBadgeDetail.badge.toUpperCase()} ==`);
    lines.push(["Scout", "Month/Year Earned"].join(","));
    data.selectedBadgeDetail.earners.forEach(e => {
      lines.push([e.displayName, e.earnedFmt].map(esc2).join(","));
    });
  }

  return lines.join("\r\n");
}

// ═══════════════════════════════ PDF GENERATION ═════════════════════════
async function buildPDF(htmlPath) {
  const { chromium } = require("playwright");
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`file://${htmlPath}`, { waitUntil: "domcontentloaded" });
    const pdfPath = htmlPath.replace(/\.html$/, ".pdf");
    await page.pdf({
      path: pdfPath, format: "Letter",
      margin: { top: "0.75in", bottom: "0.75in", left: "0.75in", right: "0.75in" },
      printBackground: true,
    });
    return pdfPath;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// ═══════════════════════════════ MAIN ═══════════════════════════════════
async function generate(inputs, outputDir, options = {}) {
  const { meritBadges: meritBadgesPath, roster: rosterPath } = inputs;
  if (!meritBadgesPath || !fs.existsSync(meritBadgesPath)) throw new Error("Merit Badge History CSV not provided");
  if (!rosterPath || !fs.existsSync(rosterPath)) throw new Error("Active Roster CSV not provided");

  const data      = processData(meritBadgesPath, rosterPath, options.selectedBadge || "");
  const dateStr   = todayLong();
  const ts        = fileTimestamp();
  const troopName = options.troopName || "";

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const htmlFileName = `Merit_Badge_Search_${ts}.html`;
  const htmlPath      = path.join(outputDir, htmlFileName);
  fs.writeFileSync(htmlPath, buildHTML(data, dateStr, troopName), "utf8");

  const output = {
    htmlFileName,
    htmlPath,
    pdfPath:  null,
    csvPath2: null,
    stats: {
      badgesTracked:    data.badges.length,
      activeScouts:     data.activeScoutCount,
      totalCompletions: data.totalRows,
      ...(data.selectedBadgeDetail ? {
        selectedBadge:  data.selectedBadgeDetail.badge,
        selectedEarners: data.selectedBadgeDetail.earners.length,
      } : {}),
    },
  };

  if (options.downloadPdf === true || options.downloadPdf === "true") {
    output.pdfPath     = await buildPDF(htmlPath);
    output.pdfFileName = path.basename(output.pdfPath);
  }

  if (options.downloadCsv === true || options.downloadCsv === "true") {
    const csvFileName = `Merit_Badge_Search_${ts}.csv`;
    const csvOut       = path.join(outputDir, csvFileName);
    fs.writeFileSync(csvOut, buildCSV(data), "utf8");
    output.csvPath     = csvOut;
    output.csvFileName = csvFileName;
  }

  return output;
}

module.exports = { manifest, generate };

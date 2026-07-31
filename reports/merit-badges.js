const fs   = require("fs");
const path = require("path");
const { parseCSV } = require("../shared/csv-parser");
const { todayLong } = require("../shared/dates");

// ═══════════════════════════════ MANIFEST ════════════════════════════════
const manifest = {
  id:          "merit-badges",
  name:        "Merit Badge Analysis",
  description: "Troop-wide merit badge analytics: Eagle coverage, scout progress, popular electives, badges never earned, and stale badges worth repeating.",
  icon:        "🎖️",
  outputType:  "html",
  inputs: [
    {
      key:       "meritBadges",
      label:     "Merit Badge History CSV",
      hint:      "Export: Reports → Merit Badge History By Scout By Badge Name",
      required:  true,
      twhReport: "meritBadges",
    },
  ],
  options: [
    { key: "downloadPdf", label: "Also download PDF", type: "checkbox", default: false },
    { key: "downloadCsv", label: "Also download CSV", type: "checkbox", default: false },
  ],
};

// ═══════════════════════════════ OFFICIAL BSA BADGE LIST ════════════════
const OFFICIAL_BADGES = [
  "American Business","American Cultures","American Heritage","American Indian Culture",
  "American Labor","Animal Science","Animation","Archaeology","Archery","Architecture",
  "Art","Artificial Intelligence","Astronomy","Athletics","Automotive Maintenance",
  "Aviation","Backpacking","Basketry","Bird Study","Bugling","Camping","Canoeing",
  "Chemistry","Chess","Citizenship in Society","Citizenship in the Community",
  "Citizenship in the Nation","Citizenship in the World","Climbing","Coin Collecting",
  "Collections","Communication","Composite Materials","Cooking","Crime Prevention",
  "Cybersecurity","Cycling","Dentistry","Digital Technology","Disabilities Awareness",
  "Dog Care","Drafting","Electricity","Electronics","Emergency Preparedness","Energy",
  "Engineering","Entrepreneurship","Environmental Science","Exploration","Family Life",
  "Farm Mechanics","Fingerprinting","Fire Safety","First Aid","Fish & Wildlife Management",
  "Fishing","Fly Fishing","Forestry","Game Design","Gardening","Genealogy","Geocaching",
  "Geology","Golf","Graphic Arts","Health Care Professions","Hiking","Home Repairs",
  "Horsemanship","Insect Study","Inventing","Journalism","Kayaking",
  "Landscape Architecture","Law","Leatherwork","Lifesaving","Mammal Study","Metalwork",
  "Mining in Society","Model Design and Building","Motorboating","Moviemaking","Multisport",
  "Music","Nature","Nuclear Science","Oceanography","Orienteering","Painting",
  "Personal Fitness","Personal Management","Pets","Photography","Pioneering",
  "Plant Science","Plumbing","Pottery","Programming","Public Health","Public Speaking",
  "Pulp and Paper","Radio","Railroading","Reading","Reptile and Amphibian Study",
  "Rifle Shooting","Robotics","Rowing","Safety","Salesmanship","Scholarship",
  "Scouting Heritage","Scuba Diving","Sculpture","Search and Rescue","Shotgun Shooting",
  "Signs, Signals, and Codes","Skating","Small-Boat Sailing","Snow Sports",
  "Soil and Water Conservation","Space Exploration","Sports","Stamp Collecting",
  "Surveying","Sustainability","Swimming","Textile","Theater","Traffic Safety",
  "Truck Transportation","Veterinary Medicine","Water Sports","Weather","Welding",
  "Whitewater","Wilderness Survival","Wood Carving","Woodwork",
];

// ═══════════════════════════════ CONSTANTS ═══════════════════════════════
const STALE_YEARS   = 2;
const MIN_SCOUTS    = 3;
const TOP_ELECTIVES = 25;

// ═══════════════════════════════ UTILITIES ═══════════════════════════════
function cleanName(n) {
  return n.replace(/^\*/, "")
    .replace(/\s*\([^)]*\)\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeName(n) {
  return n.toLowerCase()
    .replace(/&/g, "and")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDate(s) {
  if (!s || !s.trim()) return null;
  const parts = s.trim().split("/").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  return new Date(parts[2], parts[0] - 1, parts[1]);
}

function fmtScout(s) {
  const p = s.split(",");
  const last  = (p[0] || "").trim();
  const first = (p[1] || "").trim().split(/\s+/)[0];
  return first ? `${first} ${last}` : last;
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmt1(n) { return isNaN(n) ? "-" : Number(n).toFixed(1); }

// ═══════════════════════════════ DATA PROCESSING ════════════════════════
function processData(csvPath) {
  const raw  = fs.readFileSync(csvPath, "utf8");
  const rows = parseCSV(raw);

  const today     = new Date();
  const staleDate = new Date(today.getFullYear() - STALE_YEARS, today.getMonth(), today.getDate());
  const msPerYear = 365.25 * 24 * 60 * 60 * 1000;

  const eagleMap       = new Map(); // badge -> Set<scout>
  const electiveMap    = new Map(); // badge -> Set<scout>
  const scoutEagle     = new Map(); // scout -> Set<badge>
  const badgeLastEarned = new Map(); // badge -> Date
  const allScouts      = new Set();

  rows.forEach(r => {
    const scout    = (r["Scout"] || "").trim();
    const rawBadge = (r["Merit Badge"] || "").trim();
    const isEagle  = rawBadge.startsWith("*");
    const badge    = cleanName(rawBadge);
    const earned   = parseDate(r["Earned"]);
    if (!scout || !badge) return;

    allScouts.add(scout);

    if (earned) {
      const existing = badgeLastEarned.get(badge);
      if (!existing || earned > existing) badgeLastEarned.set(badge, earned);
    }

    if (isEagle) {
      if (!eagleMap.has(badge))  eagleMap.set(badge, new Set());
      eagleMap.get(badge).add(scout);
      if (!scoutEagle.has(scout)) scoutEagle.set(scout, new Set());
      scoutEagle.get(scout).add(badge);
    } else {
      if (!electiveMap.has(badge)) electiveMap.set(badge, new Set());
      electiveMap.get(badge).add(scout);
    }
  });

  // Never earned
  const earnedNorm = new Set(
    [...eagleMap.keys(), ...electiveMap.keys()].map(normalizeName)
  );
  const neverEarned = OFFICIAL_BADGES
    .filter(b => !earnedNorm.has(normalizeName(b)))
    .sort();

  // Worth repeating: 3+ scouts, not earned in 2+ years
  const allBadgeEntries = [
    ...[...eagleMap.entries()].map(([b, s]) => [b, s, true]),
    ...[...electiveMap.entries()].map(([b, s]) => [b, s, false]),
  ];
  const worthRepeating = allBadgeEntries
    .map(([badge, scouts, isEagle]) => {
      const last     = badgeLastEarned.get(badge);
      const yearsAgo = last ? (today - last) / msPerYear : 99;
      return { badge, scouts: scouts.size, isEagle, last, yearsAgo };
    })
    .filter(d => d.scouts >= MIN_SCOUTS && (!d.last || d.last < staleDate))
    .sort((a, b) => b.scouts - a.scouts);

  // Eagle sorted ascending (fewest scouts = most attention needed)
  const eagleSorted = [...eagleMap.entries()]
    .map(([b, s]) => ({ badge: b, count: s.size }))
    .sort((a, b) => a.count - b.count);

  // Top electives
  const electiveSorted = [...electiveMap.entries()]
    .map(([b, s]) => ({ badge: b, count: s.size }))
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_ELECTIVES);

  // Scout Eagle progress — only scouts who have started on Eagle trail
  const scoutProgress = [...scoutEagle.entries()]
    .map(([s, badges]) => ({ name: fmtScout(s), count: badges.size }))
    .sort((a, b) => b.count - a.count);

  return {
    totalScouts:    allScouts.size,
    totalRows:      rows.length,
    eagleCount:     eagleMap.size,
    neverEarned,
    worthRepeating,
    eagleSorted,
    electiveSorted,
    scoutProgress,
    maxEagle: Math.max(...eagleSorted.map(e => e.count), 1),
    maxElective: Math.max(...electiveSorted.map(e => e.count), 1),
    maxScout: Math.max(...scoutProgress.map(s => s.count), 1),
  };
}

// ═══════════════════════════════ HTML GENERATION ════════════════════════
function bar(count, max, color) {
  const pct = Math.round((count / max) * 100);
  return `<div style="display:flex;align-items:center;gap:0.5rem">
    <div style="flex:1;background:#F0EBDC;border-radius:3px;height:12px;overflow:hidden">
      <div style="width:${pct}%;background:${color};height:100%;border-radius:3px"></div>
    </div>
    <span style="font-size:0.82rem;font-weight:700;min-width:1.5rem;text-align:right">${count}</span>
  </div>`;
}

function buildHTML(data, dateStr, troopName) {
  const label = troopName ? `${troopName} - ` : "";

  const OD    = "#3A4F2A";
  const RED   = "#C0392B";
  const AMBER = "#B8860B";
  const BLUE  = "#003F87";
  const DKBL  = "#0B3D6B";

  // ── Never Earned grid (CSS columns) ──
  const neverColHtml = data.neverEarned.map(b =>
    `<div style="font-size:0.85rem;padding:0.2rem 0;border-bottom:1px solid #EDE8DC;break-inside:avoid;">${esc(b)}</div>`
  ).join("");

  // ── Worth repeating table ──
  const worthHtml = data.worthRepeating.length === 0
    ? `<p style="color:#4A5568;font-style:italic;padding:0.5rem 0">No badges match this criteria.</p>`
    : `<table>
        <thead><tr>
          <th>Merit Badge</th><th>Scouts Ever Earned</th><th>Last Earned</th><th>Years Since</th>
        </tr></thead>
        <tbody>
          ${data.worthRepeating.map(d => {
            const cls   = d.yearsAgo >= 3 ? `color:${RED};font-weight:700` : `color:${AMBER};font-weight:600`;
            const lastFmt = d.last
              ? d.last.toLocaleDateString("en-US", { month: "short", year: "numeric" })
              : "No record";
            return `<tr>
              <td>${esc(d.badge)}${d.isEagle ? `<span class="tag-eagle">Eagle</span>` : ""}</td>
              <td>${d.scouts}</td>
              <td style="${cls}">${esc(lastFmt)}</td>
              <td style="${cls}">${d.yearsAgo < 99 ? fmt1(d.yearsAgo) + " yrs" : "-"}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>`;

  // ── Eagle coverage table ──
  const eagleHtml = data.eagleSorted.map(d => {
    const color = d.count <= 5 ? RED : d.count <= 10 ? AMBER : OD;
    return `<tr>
      <td>${esc(d.badge)}</td>
      <td style="width:60%">${bar(d.count, data.maxEagle, color)}</td>
    </tr>`;
  }).join("");

  // ── Elective table ──
  const electiveHtml = data.electiveSorted.map(d => `<tr>
    <td>${esc(d.badge)}</td>
    <td style="width:60%">${bar(d.count, data.maxElective, BLUE)}</td>
  </tr>`).join("");

  // ── Scout progress table ──
  const progressHtml = data.scoutProgress.map(d => {
    const color = d.count >= 14 ? DKBL : d.count >= 8 ? BLUE : d.count >= 4 ? OD : AMBER;
    return `<tr>
      <td>${esc(d.name)}</td>
      <td style="width:55%">${bar(d.count, data.maxScout, color)}</td>
    </tr>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(label)}Merit Badge Analysis - ${esc(dateStr)}</title>
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
    padding: 1.25rem; margin-bottom: 1.5rem; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
  .copy-area { display: flex; gap: 1.5rem; align-items: flex-start; flex-wrap: wrap; }
  .copy-area table { flex: 1; border-collapse: collapse; }
  .copy-aside { flex: 0 0 200px; }
  .copy-aside label { font-size: 0.75rem; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.5px; color: #4A5568; display: block; margin-bottom: 0.35rem; }
  .copy-aside textarea { width: 100%; height: 260px; font-size: 0.78rem; font-family: monospace;
    border: 1px solid #D7CDB5; border-radius: 6px; padding: 0.5rem;
    background: #FAF7F0; color: #1C2340; resize: vertical; line-height: 1.7; }
  .copy-btn { margin-top: 0.4rem; width: 100%; padding: 0.4rem; background: #3A4F2A;
    color: #fff; border: none; border-radius: 5px; font-size: 0.8rem; cursor: pointer; }
  .copy-btn:hover { background: #5C7A47; }
  table { width: 100%; border-collapse: collapse; font-size: 0.86rem; }
  thead th { background: #F0EBDC; padding: 0.45rem 0.75rem; text-align: left;
    font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
    color: #4A5568; border-bottom: 1px solid #D7CDB5; }
  tbody tr:nth-child(even) { background: #FAF7F0; }
  tbody tr:hover { background: #F0EBDC; }
  tbody td { padding: 0.45rem 0.75rem; border-bottom: 1px solid #EDE8DC; vertical-align: middle; }
  tbody tr:last-child td { border-bottom: none; }
  .tag-eagle { background: #0B3D6B; color: #fff; font-size: 0.68rem;
    padding: 0.1rem 0.35rem; border-radius: 3px; margin-left: 0.4rem; vertical-align: middle; }
  .report-footer { text-align: center; font-size: 0.8rem; color: #9A7E4E;
    margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #D7CDB5; }
  @media print {
    body { background: #fff; padding: 1rem; }
    .report-header { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .section { break-inside: avoid; }
    .copy-aside { display: none; }
    h2 { break-after: avoid; }
    .note { break-after: avoid; }
  }
</style>
</head>
<body>
<div class="report-header">
  <h1>⚜ ${esc(label)}Merit Badge Analysis</h1>
  <div class="report-meta">Generated ${esc(dateStr)}  •  ${data.totalScouts} scouts  •  ${data.totalRows} total completions</div>
</div>

<div class="summary">
  <div class="stat"><div class="stat-n">${data.totalScouts}</div><div class="stat-l">Scouts in file</div></div>
  <div class="stat"><div class="stat-n">${data.totalRows}</div><div class="stat-l">Total completions</div></div>
  <div class="stat"><div class="stat-n">${data.eagleCount}</div><div class="stat-l">Eagle badges earned</div></div>
  <div class="stat"><div class="stat-n">${data.neverEarned.length}</div><div class="stat-l">Badges never earned</div></div>
  <div class="stat"><div class="stat-n">${data.worthRepeating.length}</div><div class="stat-l">Badges worth repeating</div></div>
</div>

<!-- Never Earned -->
<h2>Badges Never Earned (${data.neverEarned.length} of ${OFFICIAL_BADGES.length} official BSA badges)</h2>
<p class="note">No scout in this file has a completion record for any badge below. Good starting list for planning merit badge events or summer camp.</p>
<div class="section">
  <div class="copy-area">
    <div style="flex:1;columns:3 160px;column-gap:0.75rem;">${neverColHtml}</div>
    <div class="copy-aside">
      <label>Copy-paste list</label>
      <textarea readonly id="never-ta">${data.neverEarned.map(b => esc(b)).join("\n")}</textarea>
      <button class="copy-btn" onclick="const t=document.getElementById('never-ta');t.select();document.execCommand('copy');this.textContent='Copied!';setTimeout(()=>this.textContent='Copy All',1500)">Copy All</button>
    </div>
  </div>
</div>

<!-- Worth Repeating -->
<h2>Badges Worth Repeating — ${MIN_SCOUTS}+ Scouts, Not Earned in ${STALE_YEARS}+ Years</h2>
<p class="note">Popular with this troop historically but no completion recorded recently. Good candidates for organizing a merit badge event.</p>
<div class="section">${worthHtml}</div>

<!-- Eagle Coverage -->
<h2>Eagle-Required Badge Coverage — sorted by fewest completions</h2>
<p class="note">Red = 5 or fewer scouts. Amber = 6-10 scouts.</p>
<div class="section"><table><tbody>${eagleHtml}</tbody></table></div>

<!-- Scout Eagle Progress -->
<h2>Scout Eagle-Required Badge Progress</h2>
<p class="note">Dark blue = 14+ badges — likely close to Eagle.</p>
<div class="section"><table><tbody>${progressHtml}</tbody></table></div>

<!-- Top Electives -->
<h2>Top ${TOP_ELECTIVES} Elective Badges</h2>
<div class="section"><table><tbody>${electiveHtml}</tbody></table></div>

<div class="report-footer">
  ${esc(label)}Merit Badge Analysis  •  ${esc(dateStr)}
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
  const lines = [];

  lines.push("== BADGES NEVER EARNED ==");
  lines.push(["Merit Badge"].join(","));
  data.neverEarned.forEach(b => lines.push(esc2(b)));
  lines.push("");

  lines.push("== BADGES WORTH REPEATING ==");
  lines.push(["Merit Badge","Eagle Required","Scouts Ever Earned","Last Earned","Years Since"].join(","));
  data.worthRepeating.forEach(d => {
    const lastFmt = d.last
      ? d.last.toLocaleDateString("en-US", { month:"short", year:"numeric" })
      : "No record";
    lines.push([d.badge, d.isEagle ? "Yes" : "No", d.scouts, lastFmt,
      d.yearsAgo < 99 ? fmt1(d.yearsAgo) : ""].map(esc2).join(","));
  });
  lines.push("");

  lines.push("== EAGLE-REQUIRED COVERAGE ==");
  lines.push(["Merit Badge","Scouts Earned"].join(","));
  data.eagleSorted.forEach(d => lines.push([d.badge, d.count].map(esc2).join(",")));
  lines.push("");

  lines.push("== SCOUT EAGLE PROGRESS ==");
  lines.push(["Scout","Eagle Badges Earned"].join(","));
  data.scoutProgress.forEach(d => lines.push([d.name, d.count].map(esc2).join(",")));

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

// ═══════════════════════════════ TIMESTAMP ══════════════════════════════
function fileTimestamp() {
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

// ═══════════════════════════════ MAIN ═══════════════════════════════════
async function generate(inputs, outputDir, options = {}) {
  const { meritBadges: csvPath } = inputs;
  if (!csvPath || !fs.existsSync(csvPath)) throw new Error("Merit Badge History CSV not provided");

  const data    = processData(csvPath);
  const dateStr = todayLong();
  const ts      = fileTimestamp();
  const troopName = options.troopName || "";

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const htmlFileName = `Merit_Badge_Analysis_${ts}.html`;
  const htmlPath     = path.join(outputDir, htmlFileName);
  fs.writeFileSync(htmlPath, buildHTML(data, dateStr, troopName), "utf8");

  const output = {
    htmlFileName,
    htmlPath,
    pdfPath:  null,
    csvPath2: null,
    stats: {
      scouts:      data.totalScouts,
      completions: data.totalRows,
      neverEarned: data.neverEarned.length,
      worthRepeating: data.worthRepeating.length,
    },
  };

  if (options.downloadPdf === true || options.downloadPdf === "true") {
    output.pdfPath     = await buildPDF(htmlPath);
    output.pdfFileName = path.basename(output.pdfPath);
  }

  if (options.downloadCsv === true || options.downloadCsv === "true") {
    const csvFileName  = `Merit_Badge_Analysis_${ts}.csv`;
    const csvOut       = path.join(outputDir, csvFileName);
    fs.writeFileSync(csvOut, buildCSV(data), "utf8");
    output.csvPath     = csvOut;
    output.csvFileName = csvFileName;
  }

  return output;
}

module.exports = { manifest, generate };

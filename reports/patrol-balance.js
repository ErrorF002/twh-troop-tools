const fs   = require("fs");
const path = require("path");
const csvParser = require("../shared/csv-parser");
const { parseDate, todayLong } = require("../shared/dates");

// ═══════════════════════════════ MANIFEST ════════════════════════════════
const manifest = {
  id: "patrol-balance",
  name: "Patrol Balance",
  description: "Snapshot of patrol composition with age and rank variance, plus single-move rebalancing suggestions.",
  icon: "⚖️",
  outputType: "html",
  inputs: [
    {
      key: "roster",
      label: "TroopWebHost Active Roster CSV",
      hint: "Export: Menu → Membership → Export Membership Data → Export Active Roster to Excel",
      required: true,
      twhReport: "roster",
    },
  ],
  options: [
    {
      key: "patrolMin", label: "Min Patrol Size", type: "text",
      placeholder: "8", default: "8",
    },
    {
      key: "patrolMax", label: "Max Patrol Size", type: "text",
      placeholder: "10", default: "10",
    },
    {
      key: "ageWeight", label: "Age vs. Rank Weighting (Age / Rank)", type: "radio",
      choices: [
        { value: "0.5", label: "50 / 50" },
        { value: "0.6", label: "60 / 40" },
        { value: "0.7", label: "70 / 30" },
        { value: "0.8", label: "80 / 20" },
      ],
      default: "0.7",
    },
    { key: "downloadPdf", label: "Also download PDF", type: "checkbox", default: false },
    { key: "downloadCsv", label: "Also download CSV", type: "checkbox", default: false },
  ],
};

// ═══════════════════════════════ CONSTANTS ════════════════════════════════
const RANK_VALUES = {
  "no rank": 0, "": 0,
  "scout": 1, "tenderfoot": 2, "second class": 3,
  "first class": 4, "star": 5, "life": 6, "eagle": 7,
};
const AGE_WEIGHT        = 0.7;
const RANK_WEIGHT       = 0.3;
const TARGET_MIN        = 8;
const TARGET_MAX        = 10;
const HIGH_VAR_THRESHOLD = 1.0;

// ═══════════════════════════════ MATH UTILITIES ══════════════════════════
function rankNum(rank) {
  const r = (rank || "").toLowerCase().trim();
  if (/palm/.test(r)) return 7;
  return RANK_VALUES[r] ?? 0;
}

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stdDev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}

function score(scouts, aw, rw) {
  return aw * stdDev(scouts.map(s => s.age))
       + rw * stdDev(scouts.map(s => s.rankNum));
}

function metrics(scouts, aw, rw) {
  return {
    size:    scouts.length,
    avgAge:  mean(scouts.map(s => s.age)),
    sdAge:   stdDev(scouts.map(s => s.age)),
    sdRank:  stdDev(scouts.map(s => s.rankNum)),
    score:   score(scouts, aw, rw),
  };
}

// ═══════════════════════════════ DATA LOADING ════════════════════════════
function loadRoster(rosterPath) {
  const rows = csvParser.parseCSV(fs.readFileSync(rosterPath, "utf8"));
  return rows
    .filter(r => r.Adult === "N")
    .filter(r => {
      const patrol = (r.Patrol || "").trim().toLowerCase();
      return patrol && !patrol.startsWith("zinactive");
    })
    .map(r => {
      const firstName = (r["FIrst Name"] || r["First Name"] || "").trim();
      const lastName  = (r["Last Name"] || "").trim();
      const rank      = (r["Rank"] || "").trim();
      let age = parseInt(r["Age"] || "", 10);
      if (isNaN(age)) {
        const dob = parseDate(r["Born"] || "");
        if (dob) {
          const now = new Date();
          age = now.getFullYear() - dob.getFullYear() -
            (now < new Date(now.getFullYear(), dob.getMonth(), dob.getDate()) ? 1 : 0);
        } else {
          age = 0;
        }
      }
      return {
        firstName,
        lastName,
        fullName: `${firstName} ${lastName}`.trim(),
        rank,
        rankNum:  rankNum(rank),
        age,
        patrol:   (r["Patrol"] || "").trim(),
        gender:   (r["Registered Gender"] || "M").trim().toUpperCase(),
      };
    });
}

// ═══════════════════════════════ PATROL GROUPING ═════════════════════════
function buildPatrols(scouts, aw, rw) {
  const map = new Map();
  for (const s of scouts) {
    if (!map.has(s.patrol)) map.set(s.patrol, []);
    map.get(s.patrol).push(s);
  }

  const patrols = [];
  for (const [name, members] of map) {
    const femaleCount = members.filter(s => s.gender === "F").length;
    const gender      = femaleCount > members.length / 2 ? "F" : "M";
    // New scout patrol: every member has No Rank
    const isNewScout  = members.every(s => s.rankNum === 0);
    const sorted      = members.slice().sort((a, b) => a.lastName.localeCompare(b.lastName));
    patrols.push({ name, scouts: sorted, gender, isNewScout, metrics: metrics(sorted, aw, rw) });
  }

  patrols.sort((a, b) => {
    if (a.isNewScout !== b.isNewScout) return a.isNewScout ? 1 : -1;
    if (a.gender    !== b.gender)     return a.gender === "M" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return patrols;
}

// ═══════════════════════════════ SUGGESTIONS ════════════════════════════
function findSuggestions(patrols, cfg) {
  const { aw, rw, patrolMin, patrolMax, highVarThreshold } = cfg;

  const sc = scouts => score(scouts, aw, rw);
  const mt = scouts => metrics(scouts, aw, rw);

  const suggestions = [];

  // --- Source-driven: too-large or high-variance patrols ---
  for (const src of patrols) {
    const issues = [];
    if (src.metrics.size > patrolMax)         issues.push("too-large");
    if (src.metrics.score > highVarThreshold) issues.push("high-variance");
    if (!issues.length) continue;

    let best = null;
    let bestNet = 0;

    for (const scout of src.scouts) {
      const without = src.scouts.filter(s => s !== scout);
      if (!issues.includes("too-large") && without.length < patrolMin) continue;

      const srcImprovement = src.metrics.score - sc(without);

      for (const dest of patrols) {
        if (dest.name === src.name)            continue;
        if (dest.gender    !== src.gender)     continue;
        if (dest.isNewScout !== src.isNewScout) continue;
        if (dest.scouts.length >= patrolMax)   continue;

        const destWith = [...dest.scouts, scout];
        const destHarm = sc(destWith) - dest.metrics.score;
        const net      = srcImprovement - destHarm;

        if (net > bestNet) {
          bestNet = net;
          best = {
            issue:       issues[0],
            scout,
            from:        src.name,
            to:          dest.name,
            fromBefore:  src.metrics,
            fromAfter:   mt(without),
            toBefore:    dest.metrics,
            toAfter:     mt(destWith),
          };
        }
      }
    }

    if (best) suggestions.push(best);
  }

  // --- Destination-driven: too-small patrols not already addressed ---
  const addressedDests = new Set(suggestions.map(s => s.to));

  for (const dest of patrols) {
    if (dest.metrics.size >= patrolMin)   continue;
    if (addressedDests.has(dest.name))    continue;

    let best = null;
    let bestDestScore = Infinity;

    for (const src of patrols) {
      if (src.name === dest.name)              continue;
      if (src.gender    !== dest.gender)       continue;
      if (src.isNewScout !== dest.isNewScout)  continue;
      if (src.scouts.length <= patrolMin)      continue;

      for (const scout of src.scouts) {
        const destWith  = [...dest.scouts, scout];
        const destAfter = sc(destWith);
        if (destAfter < bestDestScore) {
          bestDestScore = destAfter;
          const without = src.scouts.filter(s => s !== scout);
          best = {
            issue:      "too-small",
            scout,
            from:       src.name,
            to:         dest.name,
            fromBefore: src.metrics,
            fromAfter:  mt(without),
            toBefore:   dest.metrics,
            toAfter:    mt(destWith),
          };
        }
      }
    }

    suggestions.push(best || {
      issue:   "too-small",
      noMove:  true,
      patrol:  dest.name,
      size:    dest.metrics.size,
    });
  }

  return suggestions;
}

// ═══════════════════════════════ HTML ════════════════════════════════════
function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmt(n) { return isNaN(n) ? "-" : Number(n).toFixed(2); }


function suggestionCard(s) {
  if (s.noMove) return `
  <div class="suggestion-card warn">
    <strong>${esc(s.patrol)}</strong> has only ${s.size} scouts and no valid source patrol could spare one. Consider a new scout transfer or cross-patrol merge.
  </div>`;

  const LABELS = { "too-large": "Too Large", "high-variance": "High Variance", "too-small": "Too Small" };
  const COLORS = { "too-large": "#E65100", "high-variance": "#C0392B", "too-small": "#1565C0" };
  const color  = COLORS[s.issue] || "#3A4F2A";

  function deltaSpan(before, after, lowerIsBetter = true) {
    const improved = lowerIsBetter ? after <= before : after >= before;
    const cls = improved ? "better" : "worse";
    return `<span class="${cls}">${fmt(before)} → ${fmt(after)}</span>`;
  }

  return `
  <div class="suggestion-card" style="border-left-color:${color}">
    <div class="suggestion-header">
      <span class="badge" style="background:${color}">${esc(LABELS[s.issue] || s.issue)}</span>
      <span>Move <strong>${esc(s.scout.fullName)}</strong> (${esc(s.scout.rank || "No Rank")}, age ${s.scout.age}) from <strong>${esc(s.from)}</strong> to <strong>${esc(s.to)}</strong></span>
    </div>
    <div class="delta-grid">
      <div class="delta-block">
        <div class="delta-patrol">${esc(s.from)} (source)</div>
        <div class="delta-rows">
          <span>Size: ${s.fromBefore.size} → ${s.fromAfter.size}</span>
          <span>Avg Age: ${deltaSpan(s.fromBefore.avgAge, s.fromAfter.avgAge, false)}</span>
          <span>Age SD: ${deltaSpan(s.fromBefore.sdAge, s.fromAfter.sdAge)}</span>
          <span>Rank SD: ${deltaSpan(s.fromBefore.sdRank, s.fromAfter.sdRank)}</span>
          <span>Score: ${deltaSpan(s.fromBefore.score, s.fromAfter.score)}</span>
        </div>
      </div>
      <div class="delta-block">
        <div class="delta-patrol">${esc(s.to)} (destination)</div>
        <div class="delta-rows">
          <span>Size: ${s.toBefore.size} → ${s.toAfter.size}</span>
          <span>Avg Age: ${deltaSpan(s.toBefore.avgAge, s.toAfter.avgAge, false)}</span>
          <span>Age SD: ${deltaSpan(s.toBefore.sdAge, s.toAfter.sdAge)}</span>
          <span>Rank SD: ${deltaSpan(s.toBefore.sdRank, s.toAfter.sdRank)}</span>
          <span>Score: ${deltaSpan(s.toBefore.score, s.toAfter.score)}</span>
        </div>
      </div>
    </div>
  </div>`;
}

function buildHTML(patrols, suggestions, dateStr, troopName, cfg) {
  const label = troopName ? `${troopName} - ` : "";
  const { aw, rw, patrolMin, patrolMax, highVarThreshold } = cfg;

  function patrolStatusColor(p) {
    if (p.metrics.size < patrolMin || p.metrics.size > patrolMax) return "#E65100";
    if (p.metrics.score > highVarThreshold) return "#E65100";
    if (p.metrics.score > 0.75) return "#B8860B";
    return "#2E7D32";
  }

  function patrolCard(p) {
    const color     = patrolStatusColor(p);
    const sizeFlag  = p.metrics.size < patrolMin ? " (too small)" : p.metrics.size > patrolMax ? " (too large)" : "";
    const scoreFlag = p.metrics.score > highVarThreshold ? " !" : "";
    const rows      = p.scouts.map(s => `
      <tr>
        <td class="check-cell"><span class="cb"></span></td>
        <td>${esc(s.fullName)}</td>
        <td>${s.age || "-"}</td>
        <td>${esc(s.rank || "No Rank")}</td>
      </tr>`).join("");
    return `
  <div class="patrol-card" style="border-left-color:${color}">
    <div class="patrol-header">
      <span class="patrol-name">${esc(p.name)}</span>
      <span class="patrol-tag">${p.gender === "F" ? "Female" : "Male"}</span>
      <span class="patrol-size" style="color:${color}">${p.metrics.size} scouts${esc(sizeFlag)}</span>
    </div>
    <table>
      <thead><tr>
        <th class="check-cell"></th>
        <th>Scout</th><th>Age</th><th>Rank</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="patrol-metrics">
      <div class="metric">
        <span class="metric-label">Avg Age</span>
        <span class="metric-value">${fmt(p.metrics.avgAge)}</span>
      </div>
      <div class="metric">
        <span class="metric-label">Age SD</span>
        <span class="metric-value">${fmt(p.metrics.sdAge)}</span>
      </div>
      <div class="metric">
        <span class="metric-label">Rank SD</span>
        <span class="metric-value">${fmt(p.metrics.sdRank)}</span>
      </div>
      <div class="metric">
        <span class="metric-label">Score${esc(scoreFlag)}</span>
        <span class="metric-value" style="color:${color}">${fmt(p.metrics.score)}</span>
      </div>
    </div>
  </div>`;
  }

  const totalScouts    = patrols.reduce((s, p) => s + p.metrics.size, 0);
  const established    = patrols.filter(p => !p.isNewScout);
  const newScoutGroups = patrols.filter(p => p.isNewScout);

  const step2Body = suggestions.length === 0
    ? `<p class="empty-msg">All patrols are within target range - no moves suggested.</p>`
    : suggestions.map(s => suggestionCard(s)).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(label)}Patrol Balance - ${esc(dateStr)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #FAF7F0; color: #1C2340;
    padding: 2rem; max-width: 1200px; margin: 0 auto;
  }
  .report-header {
    background: #2A3A1F; color: #fff;
    padding: 1.75rem 2rem; border-radius: 10px;
    margin-bottom: 1.5rem; border-bottom: 4px solid #C7A975;
  }
  .report-header h1 { font-size: 1.6rem; font-weight: 800; }
  .report-meta { font-size: 0.9rem; color: #E8DCC0; margin-top: 0.3rem; font-style: italic; }
  h2 {
    font-size: 1.05rem; font-weight: 700; color: #2A3A1F;
    border-bottom: 2px solid #C7A975; padding-bottom: 0.35rem;
    margin: 1.75rem 0 1rem;
  }
  .section-note {
    font-size: 0.8rem; color: #4A5568; margin-bottom: 1rem; font-style: italic;
  }
  .patrol-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 1rem; margin-bottom: 0.5rem;
  }
  .patrol-card {
    background: #fff; border: 1px solid #D7CDB5;
    border-left: 5px solid #ccc; border-radius: 8px;
    overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.06);
  }
  .patrol-header {
    display: flex; align-items: center; gap: 0.5rem;
    padding: 0.65rem 1rem; background: #F7F4EC;
    border-bottom: 1px solid #D7CDB5;
  }
  .patrol-name { font-weight: 700; font-size: 0.9rem; flex: 1; }
  .patrol-tag {
    font-size: 0.7rem; color: #4A5568;
    background: #E8DCC0; padding: 0.1rem 0.45rem; border-radius: 10px;
  }
  .patrol-size { font-size: 0.82rem; font-weight: 700; white-space: nowrap; }
  table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
  thead th {
    background: #F0EBDC; padding: 0.4rem 0.7rem;
    text-align: left; font-weight: 600; font-size: 0.72rem;
    color: #4A5568; text-transform: uppercase; letter-spacing: 0.5px;
    border-bottom: 1px solid #D7CDB5;
  }
  tbody tr:nth-child(even) { background: #FAF7F0; }
  tbody tr:hover { background: #F0EBDC; }
  tbody td { padding: 0.4rem 0.7rem; border-bottom: 1px solid #EDE8DC; }
  tbody tr:last-child td { border-bottom: none; }
  .check-cell { width: 1.75rem; text-align: center; }
  .cb {
    display: inline-block; width: 12px; height: 12px;
    border: 2px solid #C7A975; border-radius: 3px; background: #fff;
  }
  .patrol-metrics {
    display: flex; background: #F7F4EC; border-top: 1px solid #D7CDB5;
  }
  .metric {
    flex: 1; padding: 0.45rem 0.5rem; text-align: center;
    border-right: 1px solid #D7CDB5;
  }
  .metric:last-child { border-right: none; }
  .metric-label { display: block; font-size: 0.62rem; color: #4A5568; text-transform: uppercase; letter-spacing: 0.4px; }
  .metric-value { display: block; font-size: 0.88rem; font-weight: 700; margin-top: 0.1rem; }
  /* Suggestions */
  .suggestion-card {
    background: #fff; border: 1px solid #D7CDB5;
    border-left: 5px solid #ccc; border-radius: 8px;
    padding: 0.9rem 1.1rem; margin-bottom: 0.9rem;
    box-shadow: 0 1px 4px rgba(0,0,0,0.06);
  }
  .suggestion-card.warn { border-left-color: #B8860B; font-size: 0.88rem; color: #4A5568; }
  .suggestion-header {
    display: flex; align-items: center; gap: 0.65rem;
    margin-bottom: 0.65rem; font-size: 0.88rem;
  }
  .badge {
    color: #fff; font-size: 0.72rem; font-weight: 700;
    padding: 0.18rem 0.55rem; border-radius: 10px; white-space: nowrap;
  }
  .delta-grid { display: flex; gap: 0.75rem; flex-wrap: wrap; }
  .delta-block {
    flex: 1; min-width: 220px; background: #FAF7F0;
    border: 1px solid #D7CDB5; border-radius: 6px; padding: 0.55rem 0.8rem;
  }
  .delta-patrol { font-size: 0.78rem; font-weight: 700; color: #2A3A1F; margin-bottom: 0.35rem; }
  .delta-rows { display: flex; flex-wrap: wrap; gap: 0.35rem 0.75rem; font-size: 0.8rem; color: #4A5568; }
  .better { color: #2E7D32; font-weight: 600; }
  .worse  { color: #E65100; font-weight: 600; }
  .empty-msg { font-size: 0.88rem; color: #4A5568; font-style: italic; padding: 0.5rem 0; }
  .report-footer {
    text-align: center; font-size: 0.8rem; color: #9A7E4E;
    margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #D7CDB5;
  }
  @media print {
    body { background: #fff; padding: 1rem; }
    .report-header { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .patrol-card, .suggestion-card { break-inside: avoid; }
    .patrol-metrics, .badge { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    thead th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>

<div class="report-header">
  <h1>⚜ ${esc(label)}Patrol Balance</h1>
  <div class="report-meta">Generated ${esc(dateStr)}  •  ${totalScouts} active youth  •  ${patrols.length} patrols</div>
</div>

<h2>Step 1 - Established Patrols</h2>
<div class="patrol-grid">
  ${established.map(p => patrolCard(p)).join("")}
</div>

${newScoutGroups.length ? `
<h2>New Scout Patrols</h2>
<p class="section-note">All No Rank - kept separate from rebalancing suggestions.</p>
<div class="patrol-grid">
  ${newScoutGroups.map(p => patrolCard(p)).join("")}
</div>` : ""}

<h2>Step 2 - Rebalancing Suggestions</h2>
<p class="section-note">
  Each suggestion is a single-move analysis from current state.
  Weighted score = ${Math.round(aw * 100)}% age SD + ${Math.round(rw * 100)}% rank SD.
  Target size: ${patrolMin}-${patrolMax}.
  High-variance threshold: ${highVarThreshold}.
  Rank scale: No Rank=0, Scout=1, Tenderfoot=2, Second Class=3, First Class=4, Star=5, Life=6, Eagle=7.
</p>
${step2Body}

<div class="report-footer">
  Patrol Balance  •  ${esc(dateStr)}
</div>
</body>
</html>`;
}

// ═══════════════════════════════ CSV ════════════════════════════════════
function buildCSV(patrols) {
  const esc2 = v => {
    const s = String(v ?? "");
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [["Patrol", "Type", "Gender", "Size", "Avg Age", "Age SD", "Rank SD", "Score", "Scout", "Age", "Rank"].join(",")];
  for (const p of patrols) {
    p.scouts.forEach((s, i) => {
      lines.push([
        i === 0 ? p.name : "",
        i === 0 ? (p.isNewScout ? "New Scout" : "Established") : "",
        i === 0 ? (p.gender === "F" ? "Female" : "Male") : "",
        i === 0 ? p.metrics.size : "",
        i === 0 ? fmt(p.metrics.avgAge) : "",
        i === 0 ? fmt(p.metrics.sdAge) : "",
        i === 0 ? fmt(p.metrics.sdRank) : "",
        i === 0 ? fmt(p.metrics.score) : "",
        s.fullName, s.age, s.rank || "No Rank",
      ].map(esc2).join(","));
    });
  }
  return lines.join("\r\n");
}

// ═══════════════════════════════ PDF ════════════════════════════════════
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

// ═══════════════════════════════ MAIN ════════════════════════════════════
function fileTimestamp() {
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

async function generate(inputs, outputDir, options = {}) {
  const { roster: rosterPath } = inputs;
  if (!rosterPath || !fs.existsSync(rosterPath)) throw new Error("TroopWebHost roster CSV not provided");

  const aw  = Math.min(Math.max(parseFloat(options.ageWeight) || AGE_WEIGHT, 0.1), 0.9);
  const rw  = Math.round((1 - aw) * 10) / 10;
  const cfg = {
    aw,
    rw,
    patrolMin:        Math.max(parseInt(options.patrolMin) || TARGET_MIN, 1),
    patrolMax:        Math.max(parseInt(options.patrolMax) || TARGET_MAX, 1),
    highVarThreshold: HIGH_VAR_THRESHOLD,
  };
  if (cfg.patrolMin > cfg.patrolMax) cfg.patrolMax = cfg.patrolMin;

  const scouts      = loadRoster(rosterPath);
  const patrols     = buildPatrols(scouts, cfg.aw, cfg.rw);
  const suggestions = findSuggestions(patrols, cfg);
  const dateStr     = todayLong();
  const ts          = fileTimestamp();
  const troopName   = options.troopName || "";

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const htmlFileName = `Patrol_Balance_${ts}.html`;
  const htmlPath     = path.join(outputDir, htmlFileName);
  fs.writeFileSync(htmlPath, buildHTML(patrols, suggestions, dateStr, troopName, cfg), "utf8");

  const output = {
    htmlFileName,
    htmlPath,
    pdfPath:  null,
    csvPath:  null,
    stats: {
      activeScouts: scouts.length,
      patrols:      patrols.length,
      suggestions:  suggestions.length,
    },
  };

  if (options.downloadPdf === true || options.downloadPdf === "true") {
    output.pdfPath     = await buildPDF(htmlPath);
    output.pdfFileName = path.basename(output.pdfPath);
  }

  if (options.downloadCsv === true || options.downloadCsv === "true") {
    const csvFileName  = `Patrol_Balance_${ts}.csv`;
    output.csvPath     = path.join(outputDir, csvFileName);
    output.csvFileName = csvFileName;
    fs.writeFileSync(output.csvPath, buildCSV(patrols), "utf8");
  }

  return output;
}

module.exports = { manifest, generate };

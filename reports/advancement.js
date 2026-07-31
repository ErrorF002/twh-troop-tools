/**
 * Advancement Report
 *
 * Generates patrol-level breakdowns of uncompleted rank requirements.
 * Each patrol gets a slide with the top 10 actionable requirements
 * (median-impact prioritized) plus a roster sidebar.
 */

const fs = require("fs");
const path = require("path");
const pptxgen = require("pptxgenjs");
const { parseCSV } = require("../shared/csv-parser");
const { normalizeName } = require("../shared/name-normalize");
const { todayISO } = require("../shared/dates");

// ═══════════════════════════════ MANIFEST ═══════════════════════════════
// Describes the report to the dashboard. The server uses this to render
// the report card and to validate uploads before calling generate().
const manifest = {
  id: "advancement",
  name: "Advancement Report",
  description: "Patrol-level breakdown of uncompleted rank requirements (Scout through First Class). Identifies the highest-impact items to plan activities around.",
  icon: "📋",
  inputs: [
    {
      key: "requirements",
      label: "Uncompleted Requirements CSV",
      hint: "Export: Reports → Uncompleted Rank Requirements by Requirement",
      required: true,
      twhReport: "requirements",
    },
    {
      key: "roster",
      label: "Active Roster CSV",
      hint: "Export: Membership → Export Membership Data → Export Active Roster To Excel",
      required: true,
      twhReport: "roster",
    },
  ],
};

// ═══════════════════════════════ CONFIG ════════════════════════════════
const CONFIG = {
  includedRanks: [
    "Scout (Current requirements)",
    "Tenderfoot (Current requirements)",
    "Second Class (Current requirements)",
    "First Class (Current requirements)",
  ],
  requirementTextExclusions: [
    "service hours",
    "board of review",
    "scoutmaster conference",
    "be active",
    "active in your troop",
    "scout spirit",
    "demonstrate scout spirit",
    "tell your parent",
    "discuss with your parent",
    "eligible to join",
    "since joining",
    "hours of service",
  ],
  patrolExclusions: {},
  medianFallbackThreshold: 5,
  patrolSlideItemCount: 10,
  troopWideItemCount: 20,
};

// ═══════════════════════════════ SUMMARIES ═════════════════════════════
const SUMMARIES = {
  // Scout
  "Scout (Current requirements)||1.a": "Repeat Scout Oath, Law, Motto & Slogan from memory; explain meaning",
  "Scout (Current requirements)||1.c": "Demonstrate Scout sign, salute & handshake; explain when used",
  "Scout (Current requirements)||1.d": "Describe First Class badge and meaning of each part",
  "Scout (Current requirements)||1.e": "Repeat Outdoor Code & list 7 Leave No Trace principles",
  "Scout (Current requirements)||1.f": "Repeat Pledge of Allegiance from memory; explain meaning",
  "Scout (Current requirements)||2.a": "Describe how Scouts provide troop leadership",
  "Scout (Current requirements)||2.b": "Describe the four steps of Scout advancement",
  "Scout (Current requirements)||2.c": "Describe Scouts BSA ranks and how they are earned",
  "Scout (Current requirements)||2.d": "Describe what merit badges are and how they are earned",
  "Scout (Current requirements)||3.a": "Explain the patrol method and types of patrols in your troop",
  "Scout (Current requirements)||3.b": "Learn your patrol name, emblem, flag & yell",
  "Scout (Current requirements)||4.a": "Tie square knot, two half-hitches & taut-line hitch",
  "Scout (Current requirements)||4.b": "Whip and fuse rope ends",
  "Scout (Current requirements)||5.": "Demonstrate pocketknife safety (Totin' Chip)",
  // Tenderfoot
  "Tenderfoot (Current requirements)||01.a": "Present gear to leader for an overnight camping trip",
  "Tenderfoot (Current requirements)||01.b": "Spend one night on a patrol or troop campout in a tent",
  "Tenderfoot (Current requirements)||01.c": "Explain Outdoor Code & Leave No Trace use on campouts",
  "Tenderfoot (Current requirements)||02.a": "On a campout, help prepare one of the meals",
  "Tenderfoot (Current requirements)||02.b": "On a campout, demonstrate safe dish cleaning method",
  "Tenderfoot (Current requirements)||02.c": "Explain the importance of eating together as a patrol",
  "Tenderfoot (Current requirements)||03.a": "Demonstrate a practical use of the square knot",
  "Tenderfoot (Current requirements)||03.b": "Demonstrate a practical use of two half-hitches",
  "Tenderfoot (Current requirements)||03.c": "Demonstrate a practical use of the taut-line hitch",
  "Tenderfoot (Current requirements)||03.d": "Demonstrate care, sharpening & use of knife, saw, ax",
  "Tenderfoot (Current requirements)||04.a": "Show first aid for cuts, burns, bites, nosebleed, choking",
  "Tenderfoot (Current requirements)||04.b": "Identify local poisonous/hazardous plants & treatment",
  "Tenderfoot (Current requirements)||04.c": "Prevent injuries on campouts (Tenderfoot 4a & 4b)",
  "Tenderfoot (Current requirements)||04.d": "Assemble a personal first-aid kit",
  "Tenderfoot (Current requirements)||05.a": "Explain the buddy system and when to use it",
  "Tenderfoot (Current requirements)||05.b": "Describe what to do if lost on a hike or campout",
  "Tenderfoot (Current requirements)||05.c": "Explain safe & responsible hiking rules",
  "Tenderfoot (Current requirements)||05.d": "Explain hiking on durable surfaces",
  "Tenderfoot (Current requirements)||06.a": "Record fitness baseline: push-ups, sit-ups, sit-and-reach, 1-mile",
  "Tenderfoot (Current requirements)||06.b": "Develop a 30-day plan to improve on 6a tests",
  "Tenderfoot (Current requirements)||06.c": "Show fitness improvement after 30 days on 6a tests",
  "Tenderfoot (Current requirements)||07.a": "Display, raise, lower & fold the US flag",
  "Tenderfoot (Current requirements)||8.": "Teach the square knot using the EDGE method",
  // Second Class
  "Second Class (Current requirements)||01.c": "Select & recommend a patrol campsite location",
  "Second Class (Current requirements)||02.b": "Use knife/saw/ax to prepare tinder, kindling & fuel wood",
  "Second Class (Current requirements)||02.c": "Build, light, and safely extinguish a minimum-impact fire",
  "Second Class (Current requirements)||02.d": "Set up and light a lightweight or propane stove; explain safety",
  "Second Class (Current requirements)||02.e": "Plan & cook one hot breakfast or lunch on a campout",
  "Second Class (Current requirements)||04.": "Identify 10 kinds of wild animals in your area (tracks, signs, photos)",
  "Second Class (Current requirements)||05.b": "Pass BSA beginner swim test (jump in, swim 25ft, turn, return)",
  "Second Class (Current requirements)||06.a": "First aid: eye objects, bites, punctures, burns, heat exhaustion, shock",
  "Second Class (Current requirements)||07.c": "Participate in a drug/alcohol/tobacco awareness program; discuss with family",
  "Second Class (Current requirements)||08.c": "With parents, plan to earn money for a specific item",
  "Second Class (Current requirements)||08.d": "Compare prices at 3+ locations; decide what to do with money earned",
  // First Class
  "First Class (Current requirements)||01.b": "Explain camping impacts & importance of Leave No Trace",
  "First Class (Current requirements)||02.a": "Help plan a campout menu (breakfast, lunch, dinner; cook 2+ meals)",
  "First Class (Current requirements)||02.b": "Using 2a menu, make a shopping list with budget",
  "First Class (Current requirements)||02.c": "Identify pans, utensils & gear needed to cook and serve meals",
  "First Class (Current requirements)||02.d": "Demonstrate safe handling/storage of meats, dairy, eggs, produce",
  "First Class (Current requirements)||02.e": "On a campout, serve as cook; supervise assistants using stove or fire",
  "First Class (Current requirements)||03.c": "Demonstrate square, shear & diagonal lashings",
  "First Class (Current requirements)||03.d": "Use lashings to make a useful camp gadget or structure",
  "First Class (Current requirements)||04.a": "Complete a 1-mile orienteering course using compass & map",
  "First Class (Current requirements)||04.b": "Use handheld GPS or app to navigate to a destination",
  "First Class (Current requirements)||05.a": "Identify 10 kinds of native plants in your local area",
  "First Class (Current requirements)||05.d": "Describe extreme weather risks in your area & how to prepare",
  "First Class (Current requirements)||06.c": "Identify parts of a canoe, kayak, or other boat",
  "First Class (Current requirements)||06.d": "Describe proper body positioning in a watercraft",
  "First Class (Current requirements)||08.a": "Be physically active 30+ min/day, 5+ days/week for 4 weeks",
  "First Class (Current requirements)||08.b": "Share fitness challenges/successes from 8a; set a personal goal",
  "First Class (Current requirements)||09.a": "Visit & discuss with a civic or community leader",
  "First Class (Current requirements)||09.c": "Track trash on an outing; reduce it on your next outing",
};

// ═══════════════════════════════ DATA LOADING ═══════════════════════════
function buildPatrolMap(rosterPath) {
  const rows = parseCSV(fs.readFileSync(rosterPath, "utf8"));
  const patrolMap = {};
  rows.forEach(row => {
    if (row.Adult !== "N") return;
    const rawName = (row.Name || "").trim();
    if (!rawName) return;
    const name = normalizeName(rawName);
    let patrol = (row.Patrol || "").trim();
    patrol = patrol.replace(/\s*\([MF]\)\s*$/, "").trim();
    // Skip alumni and inactive scouts
    if (!patrol) return;
    if (patrol.toLowerCase().startsWith("zinactive")) return;
    patrolMap[name] = patrol;
  });
  return patrolMap;
}

function readRequirements(reqPath, activeScouts) {
  const rows = parseCSV(fs.readFileSync(reqPath, "utf8"));
  const reqs = {};
  const exclusionPatterns = CONFIG.requirementTextExclusions.map(s => s.toLowerCase());

  rows.forEach(row => {
    const rank = (row.Award || "").trim();
    const code = (row.Code || "").trim();
    const desc = (row["Uncompleted Requirement"] || "").trim();
    const scout = (row.Scout || "").trim();
    if (!rank || !code || !scout) return;
    if (!CONFIG.includedRanks.includes(rank)) return;
    if (!activeScouts.has(scout)) return;
    const descLower = desc.toLowerCase();
    if (exclusionPatterns.some(p => descLower.includes(p))) return;

    const key = `${rank}||${code}`;
    if (!reqs[key]) reqs[key] = { rank, code, desc, scouts: [] };
    reqs[key].scouts.push(scout);
  });

  return Object.values(reqs);
}

// ═══════════════════════════════ RANK LABELS & COLORS ═════════════════
const rankOrder = Object.fromEntries(
  CONFIG.includedRanks.map((r, i) => [r, i + 1])
);

function rankLabel(rank) {
  if (rank.startsWith("Scout")) return "Scout";
  if (rank.startsWith("Tenderfoot")) return "Tenderfoot";
  if (rank.startsWith("Second")) return "2nd Class";
  if (rank.startsWith("First")) return "1st Class";
  return rank.replace(" (Current requirements)", "");
}

function rankAccent(rank) {
  if (rank.startsWith("Scout")) return "2E7D32";
  if (rank.startsWith("Tenderfoot")) return "E65100";
  if (rank.startsWith("Second")) return "1565C0";
  if (rank.startsWith("First")) return "6A1B9A";
  return "555555";
}

// ═══════════════════════════════ RANKING LOGIC ════════════════════════
function scopedReqs(allReqs, scouts) {
  const scoutSet = new Set(scouts);
  return allReqs
    .map(r => ({ ...r, count: r.scouts.filter(s => scoutSet.has(s)).length }))
    .filter(r => r.count > 0);
}

function topByCount(allReqs, scouts, maxItems) {
  const scoped = scopedReqs(allReqs, scouts);
  scoped.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return (rankOrder[a.rank] || 99) - (rankOrder[b.rank] || 99);
  });
  return scoped.slice(0, maxItems);
}

function topForPatrol(allReqs, scouts, maxItems) {
  const scoped = scopedReqs(allReqs, scouts);
  if (scoped.length === 0) return [];

  const sortRankThenCount = (a, b) => {
    const rd = (rankOrder[a.rank] || 99) - (rankOrder[b.rank] || 99);
    if (rd !== 0) return rd;
    return b.count - a.count;
  };

  if (scoped.length < CONFIG.medianFallbackThreshold) {
    return scoped.sort(sortRankThenCount).slice(0, maxItems);
  }

  const counts = scoped.map(r => r.count).sort((a, b) => a - b);
  const mid = Math.floor(counts.length / 2);
  const median = counts.length % 2
    ? counts[mid]
    : (counts[mid - 1] + counts[mid]) / 2;

  const primary = scoped.filter(r => r.count >= median).sort(sortRankThenCount);
  const secondary = scoped.filter(r => r.count < median).sort(sortRankThenCount);

  const result = [...primary];
  for (const item of secondary) {
    if (result.length >= maxItems) break;
    result.push(item);
  }
  return result.slice(0, maxItems);
}

// ═══════════════════════════════ TEXT HELPERS ═════════════════════════
function shortenDesc(desc, maxLen = 85) {
  if (desc.length <= maxLen) return desc;
  const cut = desc.slice(0, maxLen - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 60 ? cut.slice(0, lastSpace) : cut) + "…";
}

function formatReqText(item) {
  const code = item.code.replace(/\s+/g, "");
  const prefix = `${code}  `;
  const key = `${item.rank}||${item.code}`;
  const summary = SUMMARIES[key];
  if (summary) return prefix + summary;
  return shortenDesc(prefix + item.desc, 95);
}

// ═══════════════════════════════ PPT COLORS ═══════════════════════════
// Matches the Troop Tools web app color scheme exactly.
const BG_DARK   = "2A3A1F";   // --od-green-dark
const BG_LIGHT  = "FAF7F0";   // --bg-page
const ACCENT    = "C7A975";   // --tan  (replaces red accent)
const ACCENT2   = "C7A975";   // --tan  (replaces orange accent)
const HDR_ROW   = "2A3A1F";   // --od-green-dark  (table header rows)
const ROW_ALT   = "F0EBDC";   // matches health report rowAlt
const TEXT_DARK = "1C2340";   // --text-dark
const TEXT_MID  = "4A5568";   // --text-mid
const TEXT_LIGHT = "FFFFFF";  // --text-light
const TAN_LIGHT  = "E8DCC0";  // --tan-light
const CUB_BLUE   = "003F87";  // --cub-blue

// ═══════════════════════════════ SLIDE BUILDERS ═══════════════════════
function addTitleSlide(pres, dateStr, scoutCount) {
  const slide = pres.addSlide();
  slide.background = { color: BG_DARK };

  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 3.8, w: 10, h: 0.08,
    fill: { color: ACCENT2 }, line: { type: "none" },
  });

  slide.addText("TROOP ADVANCEMENT", {
    x: 0.6, y: 1.0, w: 8.8, h: 0.9,
    fontSize: 48, bold: true, color: TEXT_LIGHT,
    fontFace: "Arial Black", align: "center", margin: 0, charSpacing: 4,
  });

  slide.addText("PROGRESS REPORT", {
    x: 0.6, y: 1.9, w: 8.8, h: 0.7,
    fontSize: 32, color: ACCENT2,
    fontFace: "Calibri", align: "center", margin: 0, charSpacing: 6,
  });

  slide.addText("Scout → Tenderfoot → Second Class → First Class", {
    x: 0.6, y: 4.1, w: 8.8, h: 0.5,
    fontSize: 16, color: TAN_LIGHT,
    fontFace: "Calibri", align: "center", margin: 0,
  });

  slide.addText(`${scoutCount} active Scouts • Generated ${dateStr}`, {
    x: 0.6, y: 4.7, w: 8.8, h: 0.45,
    fontSize: 14, color: ACCENT, italic: true,
    fontFace: "Calibri", align: "center", margin: 0,
  });
}

function addSummarySlide(pres, items, pageLabel) {
  const slide = pres.addSlide();
  slide.background = { color: BG_LIGHT };

  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 10, h: 1.05,
    fill: { color: BG_DARK }, line: { type: "none" },
  });
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 1.0, w: 10, h: 0.06,
    fill: { color: ACCENT2 }, line: { type: "none" },
  });

  slide.addText(`TROOP-WIDE TOP ${CONFIG.troopWideItemCount} UNCOMPLETED REQUIREMENTS  •  ${pageLabel}`, {
    x: 0.3, y: 0.1, w: 9.4, h: 0.8,
    fontSize: 16, bold: true, color: TEXT_LIGHT,
    fontFace: "Arial Black", align: "center", margin: 0, charSpacing: 1,
  });

  const colW = [0.7, 1.1, 5.3, 1.0];
  const startX = 0.25, startY = 1.2, rowH = 0.38;

  const hdrs = ["#", "Rank", "Requirement", "Scouts"];
  let cx = startX;
  hdrs.forEach((h, i) => {
    slide.addShape(pres.shapes.RECTANGLE, {
      x: cx, y: startY, w: colW[i] - 0.04, h: rowH,
      fill: { color: HDR_ROW }, line: { type: "none" },
    });
    slide.addText(h, {
      x: cx + 0.05, y: startY, w: colW[i] - 0.1, h: rowH,
      fontSize: 11, bold: true, color: TEXT_LIGHT,
      fontFace: "Calibri", align: i === 2 ? "left" : "center",
      valign: "middle", margin: 0,
    });
    cx += colW[i];
  });

  items.forEach((item, idx) => {
    const ry = startY + rowH + idx * rowH;
    const rowBg = idx % 2 === 0 ? "FFFFFF" : ROW_ALT;
    const accent = rankAccent(item.rank);
    cx = startX;

    colW.forEach((w, ci) => {
      slide.addShape(pres.shapes.RECTANGLE, {
        x: cx, y: ry, w: w - 0.04, h: rowH - 0.02,
        fill: { color: ci === 0 ? accent : rowBg }, line: { type: "none" },
      });
      cx += w;
    });

    slide.addShape(pres.shapes.RECTANGLE, {
      x: startX, y: ry, w: 0.04, h: rowH - 0.02,
      fill: { color: accent }, line: { type: "none" },
    });

    cx = startX;
    const vals = [
      String(item.globalRank),
      rankLabel(item.rank),
      formatReqText(item),
      String(item.count),
    ];
    const aligns = ["center", "center", "left", "center"];
    const colors = [TEXT_LIGHT, TEXT_DARK, TEXT_DARK, ACCENT];
    const bolds = [true, false, false, true];
    const sizes = [12, 9, 9.5, 12];

    vals.forEach((v, ci) => {
      slide.addText(v, {
        x: cx + (ci === 0 ? 0 : 0.06), y: ry,
        w: colW[ci] - (ci === 0 ? 0 : 0.08), h: rowH - 0.02,
        fontSize: sizes[ci], bold: bolds[ci], color: colors[ci],
        fontFace: "Calibri", align: aligns[ci], valign: "middle", margin: 0,
      });
      cx += colW[ci];
    });
  });

  slide.addText(`Top ${CONFIG.troopWideItemCount} by most Scouts needing completion • Rank shown for context`, {
    x: 0.3, y: 5.25, w: 9.4, h: 0.3,
    fontSize: 9, color: TEXT_MID, italic: true,
    fontFace: "Calibri", align: "center", margin: 0,
  });
}

function addPatrolSlide(pres, patrolName, patrolScouts, items, excludedNames) {
  const slide = pres.addSlide();
  slide.background = { color: BG_LIGHT };

  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 10, h: 1.05,
    fill: { color: BG_DARK }, line: { type: "none" },
  });
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 1.0, w: 10, h: 0.06,
    fill: { color: ACCENT }, line: { type: "none" },
  });

  slide.addText(patrolName.toUpperCase() + " PATROL", {
    x: 0.3, y: 0.12, w: 7.5, h: 0.75,
    fontSize: 28, bold: true, color: TEXT_LIGHT,
    fontFace: "Arial Black", align: "left", valign: "middle", margin: 0, charSpacing: 1,
  });

  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 7.8, y: 0.12, w: 1.9, h: 0.78,
    fill: { color: ACCENT }, line: { type: "none" }, rectRadius: 0.08,
  });
  slide.addText(`${patrolScouts.length}`, {
    x: 7.8, y: 0.12, w: 1.9, h: 0.45,
    fontSize: 24, bold: true, color: TEXT_LIGHT,
    fontFace: "Arial Black", align: "center", margin: 0,
  });
  slide.addText("SCOUTS", {
    x: 7.8, y: 0.57, w: 1.9, h: 0.28,
    fontSize: 9, color: TAN_LIGHT,
    fontFace: "Calibri", align: "center", margin: 0, charSpacing: 2,
  });

  const colW = [0.50, 1.00, 4.75, 0.70];
  const startX = 0.15, startY = 1.18;
  const availH = 4.0;
  const rowH = Math.min(0.43, availH / (items.length + 1));

  const hdrs = ["#", "Rank", "Requirement", "# Scouts"];
  let cx = startX;
  hdrs.forEach((h, i) => {
    slide.addShape(pres.shapes.RECTANGLE, {
      x: cx, y: startY, w: colW[i] - 0.03, h: rowH,
      fill: { color: HDR_ROW }, line: { type: "none" },
    });
    slide.addText(h, {
      x: cx + 0.04, y: startY, w: colW[i] - 0.08, h: rowH,
      fontSize: 10, bold: true, color: TEXT_LIGHT,
      fontFace: "Calibri", align: i === 2 ? "left" : "center",
      valign: "middle", margin: 0,
    });
    cx += colW[i];
  });

  items.forEach((item, idx) => {
    const ry = startY + rowH + idx * rowH;
    const rowBg = idx % 2 === 0 ? "FFFFFF" : ROW_ALT;
    const accent = rankAccent(item.rank);
    cx = startX;

    colW.forEach((w, ci) => {
      slide.addShape(pres.shapes.RECTANGLE, {
        x: cx, y: ry, w: w - 0.03, h: rowH - 0.02,
        fill: { color: ci === 0 ? accent : rowBg }, line: { type: "none" },
      });
      cx += w;
    });

    slide.addShape(pres.shapes.RECTANGLE, {
      x: startX, y: ry, w: 0.03, h: rowH - 0.02,
      fill: { color: accent }, line: { type: "none" },
    });

    cx = startX;
    const vals = [
      String(idx + 1),
      rankLabel(item.rank),
      formatReqText(item),
      String(item.count),
    ];
    const aligns = ["center", "center", "left", "center"];
    const colors = [TEXT_LIGHT, TEXT_DARK, TEXT_DARK, ACCENT];
    const bolds = [true, false, false, true];
    const sizes = [11, 9, rowH > 0.4 ? 10 : 9, 11];

    vals.forEach((v, ci) => {
      slide.addText(v, {
        x: cx + (ci === 0 ? 0 : 0.05), y: ry,
        w: colW[ci] - (ci === 0 ? 0 : 0.07), h: rowH - 0.02,
        fontSize: sizes[ci], bold: bolds[ci], color: colors[ci],
        fontFace: "Calibri", align: aligns[ci], valign: "middle", margin: 0,
      });
      cx += colW[ci];
    });
  });

  // Roster sidebar
  const rosterX = 7.15;
  const rosterY = startY;
  const rosterW = 2.70;
  const rosterHeaderH = rowH;

  slide.addShape(pres.shapes.RECTANGLE, {
    x: rosterX, y: rosterY, w: rosterW, h: rosterHeaderH,
    fill: { color: HDR_ROW }, line: { type: "none" },
  });
  slide.addText("PATROL ROSTER", {
    x: rosterX, y: rosterY, w: rosterW, h: rosterHeaderH,
    fontSize: 10, bold: true, color: TEXT_LIGHT,
    fontFace: "Calibri", align: "center", valign: "middle", margin: 0, charSpacing: 1,
  });

  const fullNames = patrolScouts
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .map(n => {
      const parts = n.split(",");
      if (parts.length < 2) return n;
      const last = parts[0].trim();
      const first = parts[1].trim().split(/\s+/)[0];
      return `${first} ${last}`;
    });

  const nameRowH = Math.min(0.32, (items.length * rowH) / Math.max(fullNames.length, 1));
  fullNames.forEach((name, idx) => {
    const ny = rosterY + rosterHeaderH + idx * nameRowH;
    slide.addShape(pres.shapes.RECTANGLE, {
      x: rosterX, y: ny, w: rosterW, h: nameRowH - 0.02,
      fill: { color: idx % 2 === 0 ? "FFFFFF" : ROW_ALT }, line: { type: "none" },
    });
    slide.addText(name, {
      x: rosterX + 0.1, y: ny, w: rosterW - 0.2, h: nameRowH - 0.02,
      fontSize: 10, color: TEXT_DARK,
      fontFace: "Calibri", align: "left", valign: "middle", margin: 0,
    });
  });

  // Legend
  const legendItems = [
    { label: "Scout", color: "2E7D32" },
    { label: "Tenderfoot", color: "E65100" },
    { label: "2nd Class", color: "1565C0" },
    { label: "1st Class", color: "6A1B9A" },
  ];
  let lx = 0.15;
  legendItems.forEach(li => {
    slide.addShape(pres.shapes.RECTANGLE, {
      x: lx, y: 5.3, w: 0.15, h: 0.15,
      fill: { color: li.color }, line: { type: "none" },
    });
    slide.addText(li.label, {
      x: lx + 0.18, y: 5.27, w: 1.1, h: 0.22,
      fontSize: 8, color: TEXT_MID,
      fontFace: "Calibri", align: "left", margin: 0,
    });
    lx += 1.35;
  });

  if (excludedNames && excludedNames.length > 0) {
    slide.addText(`* Excludes: ${excludedNames.join(", ")}`, {
      x: 5.5, y: 5.27, w: 4.35, h: 0.22,
      fontSize: 8, color: TEXT_MID, italic: true,
      fontFace: "Calibri", align: "right", margin: 0,
    });
  }
}

// ═══════════════════════════════ MAIN ENTRY POINT ══════════════════════
/**
 * Generate the PPTX from uploaded files.
 *
 * @param {Object} inputs - paths to input files (matches manifest.inputs keys)
 * @param {string} outputDir - directory where the output file should be written
 * @returns {Object} { filePath, fileName, stats }
 */
async function generate(inputs, outputDir, options = {}) {
  const { requirements: reqPath, roster: rosterPath } = inputs;
  if (!reqPath || !fs.existsSync(reqPath)) throw new Error("Requirements CSV not provided");
  if (!rosterPath || !fs.existsSync(rosterPath)) throw new Error("Roster CSV not provided");

  const patrolMap = buildPatrolMap(rosterPath);
  const activeScouts = new Set(Object.keys(patrolMap));
  const allReqs = readRequirements(reqPath, activeScouts);

  const byPatrol = {};
  Object.entries(patrolMap).forEach(([name, p]) => {
    if (!byPatrol[p]) byPatrol[p] = [];
    byPatrol[p].push(name);
  });

  const patrols = Object.keys(byPatrol)
    .filter(p => p !== "New")
    .sort();
  if (byPatrol.New) patrols.push("New");

  const pres = new pptxgen();
  pres.layout = "LAYOUT_16x9";
  const troopName = options.troopName || "";
  pres.title = troopName ? `${troopName} Advancement Report` : "Advancement Report";

  const dateStr = todayISO();

  addTitleSlide(pres, dateStr, activeScouts.size);

  const allActiveScouts = Array.from(activeScouts);
  const topN = topByCount(allReqs, allActiveScouts, CONFIG.troopWideItemCount)
    .map((item, idx) => ({ ...item, globalRank: idx + 1 }));
  const half = Math.ceil(CONFIG.troopWideItemCount / 2);
  addSummarySlide(pres, topN.slice(0, half), `#1–${half}`);
  addSummarySlide(pres, topN.slice(half, CONFIG.troopWideItemCount), `#${half + 1}–${CONFIG.troopWideItemCount}`);

  let patrolsRendered = 0;
  patrols.forEach(p => {
    const allPatrolScouts = byPatrol[p];
    const excluded = CONFIG.patrolExclusions[p] || [];
    const analyzed = allPatrolScouts.filter(s => !excluded.includes(s));
    if (analyzed.length === 0) return;

    const items = topForPatrol(allReqs, analyzed, CONFIG.patrolSlideItemCount);
    if (items.length === 0) return;

    addPatrolSlide(pres, p, analyzed, items, excluded);
    patrolsRendered++;
  });

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const fileName = `troop_advancement_${dateStr}.pptx`;
  const filePath = path.join(outputDir, fileName);
  await pres.writeFile({ fileName: filePath });

  return {
    filePath,
    fileName,
    stats: {
      activeScouts: activeScouts.size,
      patrolsRendered,
      requirementsAnalyzed: allReqs.length,
    },
  };
}

module.exports = { manifest, generate };

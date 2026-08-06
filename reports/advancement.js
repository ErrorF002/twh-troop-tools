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
      hint: "Export: Menu → Advancement → Requirements Reports → Uncompleted Rank Requirements By Requirement → Open in Excel",
      required: true,
      twhReport: "requirements",
    },
    {
      key: "roster",
      label: "Active Roster CSV",
      hint: "Export: Menu → Membership → Export Membership Data → Export Active Roster to Excel",
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
  medianBandPadding: 5,
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
function buildRosterMaps(rosterPath) {
  const rows = parseCSV(fs.readFileSync(rosterPath, "utf8"));
  const patrolMap = {};
  const rankMap = {};
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
    rankMap[name] = (row.Rank || "").trim();
  });
  return { patrolMap, rankMap };
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

// ═══════════════════════════════ ROSTER RANK BADGES ═══════════════════
// Maps a scout's roster Rank (from the Active Roster CSV) to the short
// abbreviation shown next to their name in the patrol roster sidebar.
function rankAbbrev(rank) {
  const r = (rank || "").trim();
  if (!r) return "";
  if (r.startsWith("Scout")) return "S";
  if (r.startsWith("Tenderfoot")) return "TF";
  if (r.startsWith("Second Class")) return "2C";
  if (r.startsWith("First Class")) return "1C";
  if (r.startsWith("Star")) return "St";
  if (r.startsWith("Life")) return "L";
  if (r.startsWith("Eagle")) return "E";
  if (/palm/i.test(r)) return "E";
  return "";
}

function rankBadgeColor(abbrev) {
  switch (abbrev) {
    case "S": return "2E7D32";
    case "TF": return "E65100";
    case "2C": return "1565C0";
    case "1C": return "6A1B9A";
    case "St": return "C7A975";
    case "L": return "9E2A2B";
    case "E": return "B8860B";
    default: return "555555";
  }
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
function formatScoutName(rawName) {
  const parts = rawName.split(",");
  if (parts.length < 2) return rawName;
  const last = parts[0].trim();
  const first = parts[1].trim().split(/\s+/)[0];
  return `${first} ${last}`;
}

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

function addPatrolSlide(pres, patrolName, patrolScouts, items, excludedNames, rankMap) {
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

  const rosterEntries = patrolScouts
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .map(n => ({
      displayName: formatScoutName(n),
      abbrev: rankAbbrev(rankMap && rankMap[n]),
    }));

  const nameRowH = Math.min(0.32, (items.length * rowH) / Math.max(rosterEntries.length, 1));
  const badgeW = 0.42;
  rosterEntries.forEach(({ displayName, abbrev }, idx) => {
    const ny = rosterY + rosterHeaderH + idx * nameRowH;
    slide.addShape(pres.shapes.RECTANGLE, {
      x: rosterX, y: ny, w: rosterW, h: nameRowH - 0.02,
      fill: { color: idx % 2 === 0 ? "FFFFFF" : ROW_ALT }, line: { type: "none" },
    });
    slide.addText(displayName, {
      x: rosterX + 0.1, y: ny, w: rosterW - 0.2 - badgeW, h: nameRowH - 0.02,
      fontSize: 10, color: TEXT_DARK,
      fontFace: "Calibri", align: "left", valign: "middle", margin: 0,
    });
    if (abbrev) {
      slide.addText(abbrev, {
        x: rosterX + rosterW - badgeW - 0.08, y: ny, w: badgeW, h: nameRowH - 0.02,
        fontSize: 9, bold: true, color: rankBadgeColor(abbrev),
        fontFace: "Calibri", align: "right", valign: "middle", margin: 0,
      });
    }
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

// ═══════════════════════════════ INDIVIDUAL PROGRESS ══════════════════
// Counts, per rank, how many of that rank's uncompleted requirements a
// given scout still has outstanding.
function scoutRankCounts(allReqs, scoutName) {
  const counts = {};
  CONFIG.includedRanks.forEach(r => { counts[r] = 0; });
  allReqs.forEach(item => {
    if (item.scouts.includes(scoutName)) {
      counts[item.rank] += 1;
    }
  });
  return counts;
}

// Total number of distinct (trackable, non-excluded) requirement items in
// each rank, derived from the troop-wide data itself rather than a
// hardcoded BSA checklist - keeps it in sync with whatever the CSV and
// exclusion filters actually produced.
function rankTotals(allReqs) {
  const totals = {};
  CONFIG.includedRanks.forEach(r => { totals[r] = 0; });
  allReqs.forEach(item => { totals[item.rank] += 1; });
  return totals;
}

// Total distinct completed count across all 4 tracked ranks for one scout.
function scoutCompletedTotal(totals, outstanding) {
  return CONFIG.includedRanks.reduce((sum, rank) => sum + (totals[rank] - outstanding[rank]), 0);
}

// Windows the grid down to the span of columns actually called out on the
// patrol's summary slide, plus a few neighbors on either side for context.
// Anchored to the lowest and highest index (in troop-wide rank/code order)
// among the selected requirements, padded by `padding` columns each way -
// this guarantees every selected requirement is always inside the shown
// range (and therefore always highlighted), while still trimming the grid
// down from the full troop-wide column count.
function medianBandColumns(columns, highlightItems, padding) {
  if (highlightItems.length === 0) return [];
  const highlightKeys = new Set(highlightItems.map(it => `${it.rank}||${it.code}`));
  const indices = [];
  columns.forEach((item, idx) => {
    if (highlightKeys.has(`${item.rank}||${item.code}`)) indices.push(idx);
  });
  if (indices.length === 0) return [];
  const startIdx = Math.max(0, Math.min(...indices) - padding);
  const endIdx = Math.min(columns.length - 1, Math.max(...indices) + padding);
  return columns.slice(startIdx, endIdx + 1);
}

function addPatrolProgressSlide(pres, patrolName, patrolScouts, columns, rankMap, opts = {}) {
  const { titleSuffix = "INDIVIDUAL PROGRESS", showCodes = false, highlightItems = [] } = opts;
  const highlightKeys = new Set(highlightItems.map(it => `${it.rank}||${it.code}`));
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

  slide.addText(`${patrolName.toUpperCase()} PATROL — ${titleSuffix}`, {
    x: 0.3, y: 0.1, w: 9.4, h: 0.85,
    fontSize: 22, bold: true, color: TEXT_LIGHT,
    fontFace: "Arial Black", align: "center", valign: "middle", margin: 0, charSpacing: 1,
  });

  const totals = rankTotals(columns);

  // Least-completed scouts first, so drawing rows top-to-bottom puts the
  // most-advanced scout at the bottom. Totals reflect only the columns
  // actually shown on this grid, so they stay consistent with the dots.
  const rows = patrolScouts
    .map(n => {
      const outstanding = scoutRankCounts(columns, n);
      return { name: n, total: scoutCompletedTotal(totals, outstanding) };
    })
    .sort((a, b) => (a.total - b.total) || a.name.localeCompare(b.name));

  const gridX = 2.1, bandH = 0.22;
  const gridW = 6.85, totalColW = 0.45;
  const codeBandH = showCodes ? 0.32 : 0;
  const gridY = 1.5 + codeBandH;
  const rowsAreaH = 3.9 - codeBandH;
  const rowH = Math.min(0.7, rowsAreaH / Math.max(rows.length, 1));
  const colW = gridW / Math.max(columns.length, 1);
  const dotR = Math.min(colW, rowH) * 0.3;

  // Rotated requirement-code label per column, only when there's enough
  // room per column (median-band slide, fewer columns than the full grid).
  if (showCodes) {
    columns.forEach((item, ci) => {
      const cx = gridX + ci * colW + colW / 2;
      const cy = 1.5 + codeBandH / 2;
      slide.addText(item.code.replace(/\s+/g, ""), {
        x: cx - codeBandH / 2, y: cy - colW / 2, w: codeBandH, h: colW,
        fontSize: 6, color: TEXT_DARK,
        fontFace: "Calibri", align: "center", valign: "middle", margin: 0,
        rotate: 270,
      });
    });
  }

  // Rank header bands above the dot grid line up with each column's rank.
  let bx = gridX;
  CONFIG.includedRanks.forEach(rank => {
    const count = columns.filter(c => c.rank === rank).length;
    if (count === 0) return;
    const w = colW * count;
    slide.addShape(pres.shapes.RECTANGLE, {
      x: bx, y: gridY, w, h: bandH,
      fill: { color: rankAccent(rank) }, line: { type: "none" },
    });
    if (w > 0.55) {
      slide.addText(rankLabel(rank), {
        x: bx, y: gridY, w, h: bandH,
        fontSize: 8, bold: true, color: TEXT_LIGHT,
        fontFace: "Calibri", align: "center", valign: "middle", margin: 0,
      });
    }
    bx += w;
  });
  slide.addShape(pres.shapes.RECTANGLE, {
    x: gridX + gridW + 0.05, y: gridY, w: totalColW, h: bandH,
    fill: { color: BG_DARK }, line: { type: "none" },
  });
  slide.addText("TOTAL", {
    x: gridX + gridW + 0.05, y: gridY, w: totalColW, h: bandH,
    fontSize: 7, bold: true, color: TEXT_LIGHT,
    fontFace: "Calibri", align: "center", valign: "middle", margin: 0,
  });

  const rowsBottom = gridY + bandH + rows.length * rowH;

  // Pass 1: row background stripes (full width).
  rows.forEach((_, ri) => {
    const ry = gridY + bandH + ri * rowH;
    slide.addShape(pres.shapes.RECTANGLE, {
      x: 0.3, y: ry, w: gridX + gridW + totalColW - 0.3, h: rowH - 0.01,
      fill: { color: ri % 2 === 0 ? "FFFFFF" : ROW_ALT }, line: { type: "none" },
    });
  });

  // Pass 2: highlight tint behind columns for requirements also called out
  // on this patrol's summary slide, so it's obvious where those items fall
  // in the individual-progress picture. Drawn over the row stripes but
  // under the dots/text, and confined to the rows area (not the header
  // bands) so it doesn't clash with the rank-color/code labels above.
  if (highlightKeys.size > 0) {
    columns.forEach((item, ci) => {
      if (!highlightKeys.has(`${item.rank}||${item.code}`)) return;
      slide.addShape(pres.shapes.RECTANGLE, {
        x: gridX + ci * colW, y: gridY + bandH, w: colW, h: rowsBottom - (gridY + bandH),
        fill: { color: ACCENT, transparency: 55 }, line: { type: "none" },
      });
    });
  }

  // Pass 3: scout names, completion dots, and totals on top.
  rows.forEach(({ name, total }, ri) => {
    const ry = gridY + bandH + ri * rowH;

    const abbrev = rankAbbrev(rankMap && rankMap[name]);
    const label = abbrev ? `${formatScoutName(name)} (${abbrev})` : formatScoutName(name);
    slide.addText(label, {
      x: 0.3, y: ry, w: gridX - 0.35, h: rowH - 0.01,
      fontSize: 9.5, color: TEXT_DARK,
      fontFace: "Calibri", align: "left", valign: "middle", margin: 0,
    });

    columns.forEach((item, ci) => {
      if (item.scouts.includes(name)) return; // still outstanding - no dot
      const cx = gridX + ci * colW + colW / 2;
      const cy = ry + (rowH - 0.01) / 2;
      slide.addShape(pres.shapes.OVAL, {
        x: cx - dotR, y: cy - dotR, w: dotR * 2, h: dotR * 2,
        fill: { color: rankAccent(item.rank) }, line: { type: "none" },
      });
    });

    slide.addText(String(total), {
      x: gridX + gridW + 0.05, y: ry, w: totalColW, h: rowH - 0.01,
      fontSize: 10, bold: true, color: TEXT_DARK,
      fontFace: "Calibri", align: "center", valign: "middle", margin: 0,
    });
  });

  const highlightNote = highlightKeys.size > 0 ? "  •  highlighted = also on this patrol's focus list" : "";
  slide.addText(
    `● = requirement completed, colored by rank  •  ${columns.length} requirements shown${highlightNote}`,
    {
      x: 0.3, y: rowsBottom + 0.05, w: 9.4, h: 0.25,
      fontSize: 8, color: TEXT_MID, italic: true,
      fontFace: "Calibri", align: "center", margin: 0,
    }
  );
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

  const { patrolMap, rankMap } = buildRosterMaps(rosterPath);
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

  // Every trackable requirement, troop-wide, ordered rank by rank - these
  // become the progress grids' columns. (allReqs is already built rank
  // block by rank block, code ascending within each block, since that's
  // the order rows appear in the source CSV.)
  const allColumns = CONFIG.includedRanks.flatMap(rank => allReqs.filter(r => r.rank === rank));

  let patrolsRendered = 0;
  patrols.forEach(p => {
    const allPatrolScouts = byPatrol[p];
    const excluded = CONFIG.patrolExclusions[p] || [];
    const analyzed = allPatrolScouts.filter(s => !excluded.includes(s));
    if (analyzed.length === 0) return;

    const items = topForPatrol(allReqs, analyzed, CONFIG.patrolSlideItemCount);
    if (items.length === 0) return;

    addPatrolSlide(pres, p, analyzed, items, excluded, rankMap);

    const bandColumns = medianBandColumns(allColumns, items, CONFIG.medianBandPadding);
    if (bandColumns.length > 0) {
      addPatrolProgressSlide(pres, p, analyzed, bandColumns, rankMap, {
        showCodes: true,
        highlightItems: items,
      });
    }
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

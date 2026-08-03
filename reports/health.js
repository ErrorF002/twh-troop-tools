/**
 * Troop Health Report
 *
 * Quarterly committee-meeting deck showing membership, demographics,
 * advancement health, and follow-up items.
 */

const fs = require("fs");
const path = require("path");
const pptxgen = require("pptxgenjs");
const { parseCSV } = require("../shared/csv-parser");
const { formatDisplayName } = require("../shared/name-normalize");
const { parseDate, todayISO, todayLong } = require("../shared/dates");

// ═══════════════════════════════ MANIFEST ═══════════════════════════════
const manifest = {
  id: "health",
  name: "Troop Health Report",
  description: "Committee-meeting deck with membership demographics, rank distribution, recent advancements, Eagle pipeline, and scouts needing follow-up.",
  icon: "❤️",
  inputs: [
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
  troopName: "BSA TROOP",
  recentLowerRankDays: 90,
  recentUpperRankDays: 180,
};

// ═══════════════════════════════ COLORS ════════════════════════════════
const COLOR = {
  tan: "C7A975",
  tanLight: "E8DCC0",
  tanDark: "9A7E4E",
  odGreen: "3A4F2A",
  odGreenLight: "5C7A47",
  cubBlue: "003F87",
  cubBlueLight: "1F5BA8",
  textDark: "1C2340",
  textMid: "4A5568",
  textLight: "FFFFFF",
  bgLight: "FAF7F0",
  bgDark: "2A3A1F",
  border: "B8A57E",
  rowAlt: "F0EBDC",
};

function rankColor(rank) {
  const r = (rank || "").trim().toLowerCase();
  if (!r) return "999999";
  if (r === "scout") return "2E7D32";
  if (r === "tenderfoot") return "E65100";
  if (r === "second class") return "1565C0";
  if (r === "first class") return "6A1B9A";
  if (r === "star") return "C0392B";
  if (r === "life") return "B8860B";
  if (r === "eagle") return "0B3D6B";
  if (r.includes("palm")) return "5D4037";
  return "888888";
}

const RANK_ORDER = [
  "Unranked", "Scout", "Tenderfoot", "Second Class", "First Class",
  "Star", "Life", "Eagle", "Bronze Palm", "Gold Palm", "Silver Palm",
];
const LOWER_RANKS = ["Scout", "Tenderfoot", "Second Class", "First Class"];
const UPPER_RANKS = ["Star", "Life", "Eagle", "Bronze Palm", "Gold Palm", "Silver Palm"];

// ═══════════════════════════════ DATA LOADING ═══════════════════════════
function loadScouts(rosterPath) {
  const rows = parseCSV(fs.readFileSync(rosterPath, "utf8"));
  return rows.filter(r => r.Adult === "N").map(r => {
    const patrol = ((r.Patrol || "").replace(/\s*\([MFA]\)\s*$/, "").trim()) || "Unassigned";
    return {
      name: r.Name,
      displayName: formatDisplayName(r.Name),
      rank: (r.Rank || "").trim() || "Unranked",
      rankDate: parseDate(r["Rank Date"]),
      patrol,
      joinDate: parseDate(r["Date Joined Unit"]),
      gender: r["Registered Gender"],
      age: parseInt(r.Age) || null,
      meritBadges: parseInt(r["Merit Badges"]) || 0,
      leadership: r.Leadership,
    };
  }).filter(s => {
    // Filter out alumni (empty patrol) and inactive scouts
    if (s.patrol === "Unassigned") return false;
    if (s.patrol.toLowerCase().startsWith("zinactive")) return false;
    return true;
  });
}

function countAdults(rosterPath) {
  const rows = parseCSV(fs.readFileSync(rosterPath, "utf8"));
  return rows.filter(r => r.Adult === "Y").length;
}

// ═══════════════════════════════ STYLE HELPERS ═════════════════════════
function addPageHeader(slide, pres, title, subtitle) {
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 10, h: 1.05,
    fill: { color: COLOR.bgDark }, line: { type: "none" },
  });
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 1.0, w: 10, h: 0.06,
    fill: { color: COLOR.tan }, line: { type: "none" },
  });
  slide.addText(title, {
    x: 0.3, y: 0.1, w: 9.4, h: 0.5,
    fontSize: 22, bold: true, color: COLOR.textLight,
    fontFace: "Arial Black", align: "left", margin: 0, charSpacing: 1,
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.3, y: 0.62, w: 9.4, h: 0.36,
      fontSize: 12, color: COLOR.tanLight,
      fontFace: "Calibri", align: "left", margin: 0,
    });
  }
}

function addPageFooter(slide, dateStr) {
  slide.addText(`${CONFIG.troopName}  •  Troop Health Report  •  ${dateStr}`, {
    x: 0.3, y: 5.32, w: 9.4, h: 0.25,
    fontSize: 9, color: COLOR.textMid, italic: true,
    fontFace: "Calibri", align: "center", margin: 0,
  });
}

function addHorizontalBars(slide, pres, opts) {
  const { x, y, w, h, items, maxValue, barColor, labelColor } = opts;
  if (items.length === 0) return;

  const max = maxValue || Math.max(...items.map(i => i.value));
  const labelW = 1.65;
  const valueW = 0.5;
  const barAreaX = x + labelW;
  const barAreaW = w - labelW - valueW - 0.1;
  const rowH = h / items.length;
  const barH = Math.min(0.32, rowH * 0.7);

  items.forEach((item, idx) => {
    const ry = y + idx * rowH;
    const barCenterY = ry + (rowH - barH) / 2;
    const barW = max > 0 ? (item.value / max) * barAreaW : 0;

    slide.addText(item.label, {
      x: x, y: ry, w: labelW - 0.1, h: rowH,
      fontSize: 11, color: labelColor || COLOR.textDark,
      fontFace: "Calibri", align: "right", valign: "middle", margin: 0,
    });

    slide.addShape(pres.shapes.RECTANGLE, {
      x: barAreaX, y: barCenterY, w: barAreaW, h: barH,
      fill: { color: "EAE3D0" }, line: { type: "none" },
    });

    if (barW > 0) {
      slide.addShape(pres.shapes.RECTANGLE, {
        x: barAreaX, y: barCenterY, w: barW, h: barH,
        fill: { color: item.color || barColor || COLOR.odGreen },
        line: { type: "none" },
      });
    }

    slide.addText(String(item.value), {
      x: barAreaX + barAreaW + 0.05, y: ry, w: valueW, h: rowH,
      fontSize: 12, bold: true, color: COLOR.textDark,
      fontFace: "Calibri", align: "left", valign: "middle", margin: 0,
    });
  });
}

function addStatBox(slide, pres, opts) {
  const { x, y, w, h, value, label, sublabel, fillColor, textColor } = opts;
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x, y, w, h,
    fill: { color: fillColor || COLOR.odGreen },
    line: { type: "none" },
    rectRadius: 0.1,
  });
  slide.addText(String(value), {
    x, y: y + 0.1, w, h: h * 0.55,
    fontSize: 48, bold: true, color: textColor || COLOR.textLight,
    fontFace: "Arial Black", align: "center", valign: "middle", margin: 0,
  });
  slide.addText(label, {
    x, y: y + h * 0.62, w, h: 0.32,
    fontSize: 13, bold: true, color: textColor || COLOR.textLight,
    fontFace: "Calibri", align: "center", margin: 0, charSpacing: 2,
  });
  if (sublabel) {
    slide.addText(sublabel, {
      x, y: y + h * 0.84, w, h: 0.25,
      fontSize: 9, color: textColor || COLOR.tanLight,
      fontFace: "Calibri", align: "center", italic: true, margin: 0,
    });
  }
}

// ═══════════════════════════════ SLIDE BUILDERS ═══════════════════════
function slideTitle(pres, dateStr) {
  const slide = pres.addSlide();
  slide.background = { color: COLOR.bgDark };

  slide.addShape(pres.shapes.RECTANGLE, { x: 0, y: 2.5, w: 10, h: 0.04, fill: { color: COLOR.tan }, line: { type: "none" } });
  slide.addShape(pres.shapes.RECTANGLE, { x: 0, y: 4.2, w: 10, h: 0.04, fill: { color: COLOR.tan }, line: { type: "none" } });

  slide.addText(CONFIG.troopName, {
    x: 0.6, y: 1.4, w: 8.8, h: 1.0,
    fontSize: 56, bold: true, color: COLOR.textLight,
    fontFace: "Arial Black", align: "center", margin: 0, charSpacing: 6,
  });
  slide.addText("TROOP HEALTH REPORT", {
    x: 0.6, y: 2.7, w: 8.8, h: 0.7,
    fontSize: 32, color: COLOR.tan,
    fontFace: "Calibri", align: "center", margin: 0, charSpacing: 8,
  });
  slide.addText(dateStr, {
    x: 0.6, y: 4.4, w: 8.8, h: 0.5,
    fontSize: 18, color: COLOR.tanLight, italic: true,
    fontFace: "Calibri", align: "center", margin: 0,
  });
}

function slideAtAGlance(pres, scouts, adultCount, dateStr) {
  const slide = pres.addSlide();
  slide.background = { color: COLOR.bgLight };
  addPageHeader(slide, pres, "TROOP AT A GLANCE", "A current snapshot of membership and demographics");

  const total = scouts.length;
  const male = scouts.filter(s => s.gender === "M").length;
  const female = scouts.filter(s => s.gender === "F").length;
  const patrols = new Set(scouts.map(s => s.patrol).filter(p => p !== "New")).size;

  const today = new Date();
  const tenures = scouts.map(s => s.joinDate ? (today - s.joinDate) / (1000 * 60 * 60 * 24 * 365.25) : null).filter(t => t !== null);
  const avgTenure = tenures.length ? (tenures.reduce((a, b) => a + b, 0) / tenures.length) : 0;

  const oneYearAgo = new Date(today);
  oneYearAgo.setFullYear(today.getFullYear() - 1);
  const newScouts = scouts.filter(s => s.joinDate && s.joinDate >= oneYearAgo).length;

  const boxW = 2.85, boxH = 1.75;
  const startX = 0.4, startY = 1.35;
  const gapX = 0.25, gapY = 0.25;

  const stats = [
    { value: total, label: "TOTAL SCOUTS", fillColor: COLOR.odGreen },
    { value: patrols, label: "PATROLS", fillColor: COLOR.cubBlue },
    { value: adultCount, label: "REGISTERED ADULTS", fillColor: COLOR.tanDark, textColor: COLOR.textLight },
    { value: `${male}/${female}`, label: "MALE / FEMALE", sublabel: `${Math.round(male/total*100)}% / ${Math.round(female/total*100)}%`, fillColor: COLOR.odGreenLight },
    { value: avgTenure.toFixed(1), label: "AVG YEARS IN TROOP", fillColor: COLOR.cubBlueLight },
    { value: newScouts, label: "NEW SCOUTS THIS YEAR", fillColor: COLOR.tan, textColor: COLOR.bgDark },
  ];

  stats.forEach((stat, idx) => {
    const col = idx % 3;
    const row = Math.floor(idx / 3);
    addStatBox(slide, pres, {
      x: startX + col * (boxW + gapX),
      y: startY + row * (boxH + gapY),
      w: boxW, h: boxH,
      value: stat.value, label: stat.label, sublabel: stat.sublabel,
      fillColor: stat.fillColor, textColor: stat.textColor,
    });
  });

  addPageFooter(slide, dateStr);
}

function slidePatrolDistribution(pres, scouts, dateStr) {
  const slide = pres.addSlide();
  slide.background = { color: COLOR.bgLight };
  addPageHeader(slide, pres, "PATROL DISTRIBUTION", "Scouts per patrol");

  const counts = {};
  scouts.forEach(s => {
    if (!counts[s.patrol]) counts[s.patrol] = 0;
    counts[s.patrol]++;
  });
  const items = Object.entries(counts)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  addHorizontalBars(slide, pres, {
    x: 0.5, y: 1.3, w: 9.0, h: 3.85,
    items, barColor: COLOR.odGreen,
  });

  addPageFooter(slide, dateStr);
}

function slideAgeDistribution(pres, scouts, dateStr) {
  const slide = pres.addSlide();
  slide.background = { color: COLOR.bgLight };
  addPageHeader(slide, pres, "AGE DISTRIBUTION", "Scouts by age");

  const counts = {};
  scouts.forEach(s => {
    if (s.age == null) return;
    if (!counts[s.age]) counts[s.age] = 0;
    counts[s.age]++;
  });

  const minAge = 10, maxAge = 18;
  const ages = [];
  for (let a = minAge; a <= maxAge; a++) ages.push(a);

  const chartX = 0.8, chartY = 1.4, chartW = 8.4, chartH = 3.5;
  const barAreaW = chartW;
  const barW = barAreaW / ages.length * 0.7;
  const barGap = barAreaW / ages.length * 0.3;
  const maxCount = Math.max(...ages.map(a => counts[a] || 0), 1);

  ages.forEach((age, idx) => {
    const cnt = counts[age] || 0;
    const x = chartX + idx * (barAreaW / ages.length) + barGap / 2;
    const fullBarH = chartH - 0.55;
    const barH = (cnt / maxCount) * fullBarH;
    const barY = chartY + fullBarH - barH;

    if (cnt > 0) {
      slide.addShape(pres.shapes.RECTANGLE, {
        x, y: barY, w: barW, h: barH,
        fill: { color: COLOR.cubBlue }, line: { type: "none" },
      });
      slide.addText(String(cnt), {
        x, y: barY - 0.32, w: barW, h: 0.3,
        fontSize: 13, bold: true, color: COLOR.textDark,
        fontFace: "Calibri", align: "center", margin: 0,
      });
    }

    slide.addText(String(age), {
      x, y: chartY + fullBarH + 0.05, w: barW, h: 0.3,
      fontSize: 12, bold: true, color: COLOR.textDark,
      fontFace: "Calibri", align: "center", margin: 0,
    });
  });

  slide.addText("AGE", {
    x: 0, y: chartY + chartH - 0.18, w: 10, h: 0.3,
    fontSize: 10, bold: true, color: COLOR.textMid,
    fontFace: "Calibri", align: "center", margin: 0, charSpacing: 3,
  });

  addPageFooter(slide, dateStr);
}

function slideTenure(pres, scouts, dateStr) {
  const slide = pres.addSlide();
  slide.background = { color: COLOR.bgLight };
  addPageHeader(slide, pres, "TENURE IN TROOP", "How long Scouts have been registered with the unit");

  const today = new Date();
  const buckets = [
    { label: "Less than 1 year", min: 0, max: 1, count: 0 },
    { label: "1 – 2 years", min: 1, max: 2, count: 0 },
    { label: "2 – 3 years", min: 2, max: 3, count: 0 },
    { label: "3 – 4 years", min: 3, max: 4, count: 0 },
    { label: "4+ years", min: 4, max: Infinity, count: 0 },
  ];

  scouts.forEach(s => {
    if (!s.joinDate) return;
    const years = (today - s.joinDate) / (1000 * 60 * 60 * 24 * 365.25);
    for (const b of buckets) {
      if (years >= b.min && years < b.max) { b.count++; break; }
    }
  });

  addHorizontalBars(slide, pres, {
    x: 0.5, y: 1.45, w: 9.0, h: 3.6,
    items: buckets.map(b => ({ label: b.label, value: b.count })),
    barColor: COLOR.tanDark,
  });

  addPageFooter(slide, dateStr);
}

function slideRankDistribution(pres, scouts, dateStr) {
  const slide = pres.addSlide();
  slide.background = { color: COLOR.bgLight };
  addPageHeader(slide, pres, "RANK DISTRIBUTION", "Current rank breakdown across all Scouts");

  const counts = {};
  RANK_ORDER.forEach(r => counts[r] = 0);
  scouts.forEach(s => { counts[s.rank] = (counts[s.rank] || 0) + 1; });

  const items = RANK_ORDER
    .filter(r => counts[r] > 0)
    .map(r => ({
      label: r, value: counts[r],
      color: r === "Unranked" ? "888888" : rankColor(r),
    }));

  addHorizontalBars(slide, pres, {
    x: 0.5, y: 1.3, w: 9.0, h: 3.85,
    items,
  });

  addPageFooter(slide, dateStr);
}

function slideRecentAdvancements(pres, scouts, dateStr) {
  const slide = pres.addSlide();
  slide.background = { color: COLOR.bgLight };
  addPageHeader(slide, pres, "RECENT ADVANCEMENTS",
    `Rank advancements earned in the past ${CONFIG.recentLowerRankDays} days`);

  const today = new Date();
  const cutoff = new Date(today);
  cutoff.setDate(today.getDate() - CONFIG.recentLowerRankDays);

  const counts = {};
  RANK_ORDER.forEach(r => counts[r] = 0);
  scouts.forEach(s => {
    if (!s.rankDate) return;
    if (s.rankDate < cutoff) return;
    if (LOWER_RANKS.includes(s.rank) || UPPER_RANKS.includes(s.rank)) {
      counts[s.rank]++;
    }
  });

  const items = [...LOWER_RANKS, ...UPPER_RANKS]
    .filter(r => counts[r] > 0 || ["Scout","Tenderfoot","Second Class","First Class","Star","Life","Eagle"].includes(r))
    .map(r => ({ label: r, value: counts[r], color: rankColor(r) }));

  addHorizontalBars(slide, pres, {
    x: 1.5, y: 1.4, w: 7.0, h: 2.7,
    items,
  });

  const total = items.reduce((a, b) => a + b.value, 0);
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 3.0, y: 4.3, w: 4.0, h: 0.85,
    fill: { color: COLOR.odGreen }, line: { type: "none" }, rectRadius: 0.06,
  });
  slide.addText(`${total}`, {
    x: 3.0, y: 4.35, w: 4.0, h: 0.5,
    fontSize: 28, bold: true, color: COLOR.textLight,
    fontFace: "Arial Black", align: "center", margin: 0,
  });
  slide.addText(`ADVANCEMENTS IN PAST ${CONFIG.recentLowerRankDays} DAYS`, {
    x: 3.0, y: 4.85, w: 4.0, h: 0.27,
    fontSize: 10, color: COLOR.tanLight,
    fontFace: "Calibri", align: "center", margin: 0, charSpacing: 2,
  });

  addPageFooter(slide, dateStr);
}

function slideEaglePipeline(pres, scouts, dateStr) {
  const slide = pres.addSlide();
  slide.background = { color: COLOR.bgLight };

  const lifeScouts = scouts
    .filter(s => s.rank === "Life")
    .map(s => {
      const today = new Date();
      const monthsAsLife = s.rankDate ? Math.round((today - s.rankDate) / (1000 * 60 * 60 * 24 * 30.4)) : null;
      const monthsToAge18 = s.age != null ? (18 - s.age) * 12 : null;
      return { ...s, monthsAsLife, monthsToAge18 };
    })
    .sort((a, b) => {
      if (a.monthsToAge18 == null) return 1;
      if (b.monthsToAge18 == null) return -1;
      return a.monthsToAge18 - b.monthsToAge18;
    });

  addPageHeader(slide, pres, "EAGLE PIPELINE",
    `${lifeScouts.length} Life Scouts working toward Eagle  •  Sorted by time remaining`);

  const startX = 0.4, startY = 1.3;
  const colW = [3.3, 1.6, 1.8, 2.1];
  const headerH = 0.4;
  const maxTableH = 3.4;
  const rowH = Math.min(0.32, (maxTableH - headerH) / Math.max(lifeScouts.length, 1));

  let cx = startX;
  ["Scout", "Age", "Months as Life", "Time to Age 18"].forEach((h, i) => {
    slide.addShape(pres.shapes.RECTANGLE, {
      x: cx, y: startY, w: colW[i] - 0.05, h: headerH,
      fill: { color: COLOR.bgDark }, line: { type: "none" },
    });
    slide.addText(h, {
      x: cx + 0.1, y: startY, w: colW[i] - 0.2, h: headerH,
      fontSize: 11, bold: true, color: COLOR.textLight,
      fontFace: "Calibri", align: i === 0 ? "left" : "center", valign: "middle", margin: 0,
    });
    cx += colW[i];
  });

  lifeScouts.forEach((s, idx) => {
    const ry = startY + headerH + idx * rowH;
    const rowBg = idx % 2 === 0 ? "FFFFFF" : COLOR.rowAlt;

    let urgencyColor = COLOR.odGreen;
    if (s.monthsToAge18 != null) {
      if (s.monthsToAge18 < 18) urgencyColor = "C0392B";
      else if (s.monthsToAge18 < 36) urgencyColor = "E65100";
    }

    cx = startX;
    colW.forEach((w, ci) => {
      slide.addShape(pres.shapes.RECTANGLE, {
        x: cx, y: ry, w: w - 0.05, h: rowH - 0.02,
        fill: { color: rowBg }, line: { type: "none" },
      });
      cx += w;
    });
    slide.addShape(pres.shapes.RECTANGLE, {
      x: startX, y: ry, w: 0.06, h: rowH - 0.02,
      fill: { color: urgencyColor }, line: { type: "none" },
    });

    cx = startX;
    const vals = [
      s.displayName,
      s.age != null ? String(s.age) : "—",
      s.monthsAsLife != null ? `${s.monthsAsLife} mo` : "—",
      s.monthsToAge18 != null ? (s.monthsToAge18 <= 0 ? "AGED OUT" : `${s.monthsToAge18} mo`) : "—",
    ];
    const aligns = ["left", "center", "center", "center"];
    const colors = [COLOR.textDark, COLOR.textDark, COLOR.textDark, urgencyColor];
    const bolds = [false, false, false, true];

    vals.forEach((v, ci) => {
      slide.addText(v, {
        x: cx + (ci === 0 ? 0.15 : 0.1), y: ry,
        w: colW[ci] - (ci === 0 ? 0.25 : 0.2), h: rowH - 0.02,
        fontSize: 11, bold: bolds[ci], color: colors[ci],
        fontFace: "Calibri", align: aligns[ci], valign: "middle", margin: 0,
      });
      cx += colW[ci];
    });
  });

  const legendY = 5.05;
  const legendItems = [
    { label: "< 18 months to 18", color: "C0392B" },
    { label: "18 – 36 months", color: "E65100" },
    { label: "36+ months", color: COLOR.odGreen },
  ];
  let lx = 0.4;
  legendItems.forEach(li => {
    slide.addShape(pres.shapes.RECTANGLE, {
      x: lx, y: legendY, w: 0.15, h: 0.15,
      fill: { color: li.color }, line: { type: "none" },
    });
    slide.addText(li.label, {
      x: lx + 0.18, y: legendY - 0.03, w: 1.7, h: 0.22,
      fontSize: 9, color: COLOR.textMid,
      fontFace: "Calibri", align: "left", margin: 0,
    });
    lx += 2.1;
  });

  addPageFooter(slide, dateStr);
}

function slideNeedsAttention(pres, scouts, dateStr) {
  const slide = pres.addSlide();
  slide.background = { color: COLOR.bgLight };
  addPageHeader(slide, pres, "SCOUTS NEEDING ATTENTION",
    `Scout–First Class: no advancement in ${CONFIG.recentLowerRankDays}+ days  •  Star–Eagle: ${CONFIG.recentUpperRankDays}+ days`);

  const today = new Date();
  const lowerCutoff = new Date(today);
  lowerCutoff.setDate(today.getDate() - CONFIG.recentLowerRankDays);
  const upperCutoff = new Date(today);
  upperCutoff.setDate(today.getDate() - CONFIG.recentUpperRankDays);

  const counts = {};
  RANK_ORDER.forEach(r => counts[r] = 0);

  scouts.forEach(s => {
    if (s.rank === "Eagle" || s.rank.includes("Palm")) return;
    if (s.rank === "Unranked") {
      if (s.joinDate && s.joinDate < lowerCutoff) counts["Unranked"]++;
      return;
    }
    if (!s.rankDate) return;
    if (LOWER_RANKS.includes(s.rank) && s.rankDate < lowerCutoff) {
      counts[s.rank]++;
    } else if (UPPER_RANKS.includes(s.rank) && s.rankDate < upperCutoff) {
      counts[s.rank]++;
    }
  });

  const lowerItems = ["Unranked", ...LOWER_RANKS].map(r => ({
    label: r, value: counts[r] || 0,
    color: r === "Unranked" ? "888888" : rankColor(r),
  }));
  const upperItems = ["Star", "Life"].map(r => ({
    label: r, value: counts[r] || 0, color: rankColor(r),
  }));

  slide.addText(`${CONFIG.recentLowerRankDays}+ DAYS`, {
    x: 0.4, y: 1.35, w: 4.5, h: 0.3,
    fontSize: 11, bold: true, color: COLOR.odGreen,
    fontFace: "Calibri", align: "center", margin: 0, charSpacing: 2,
  });
  slide.addText(`${CONFIG.recentUpperRankDays}+ DAYS`, {
    x: 5.1, y: 1.35, w: 4.5, h: 0.3,
    fontSize: 11, bold: true, color: COLOR.odGreen,
    fontFace: "Calibri", align: "center", margin: 0, charSpacing: 2,
  });

  const sharedMax = Math.max(...lowerItems.map(i => i.value), ...upperItems.map(i => i.value), 1);

  addHorizontalBars(slide, pres, {
    x: 0.4, y: 1.75, w: 4.5, h: 2.0,
    items: lowerItems, maxValue: sharedMax,
  });
  addHorizontalBars(slide, pres, {
    x: 5.1, y: 1.75, w: 4.5, h: 2.0,
    items: upperItems, maxValue: sharedMax,
  });

  const total = [...lowerItems, ...upperItems].reduce((a, b) => a + b.value, 0);
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 3.0, y: 4.2, w: 4.0, h: 0.85,
    fill: { color: COLOR.tanDark }, line: { type: "none" }, rectRadius: 0.06,
  });
  slide.addText(`${total}`, {
    x: 3.0, y: 4.25, w: 4.0, h: 0.5,
    fontSize: 28, bold: true, color: COLOR.textLight,
    fontFace: "Arial Black", align: "center", margin: 0,
  });
  slide.addText("SCOUTS FLAGGED FOR FOLLOW-UP", {
    x: 3.0, y: 4.75, w: 4.0, h: 0.27,
    fontSize: 10, color: COLOR.tanLight,
    fontFace: "Calibri", align: "center", margin: 0, charSpacing: 2,
  });

  addPageFooter(slide, dateStr);
}

function slideThankYou(pres, dateStr) {
  const slide = pres.addSlide();
  slide.background = { color: COLOR.bgDark };

  slide.addShape(pres.shapes.RECTANGLE, { x: 0, y: 2.4, w: 10, h: 0.04, fill: { color: COLOR.tan }, line: { type: "none" } });
  slide.addShape(pres.shapes.RECTANGLE, { x: 0, y: 4.3, w: 10, h: 0.04, fill: { color: COLOR.tan }, line: { type: "none" } });

  slide.addText("THANK YOU", {
    x: 0.6, y: 1.35, w: 8.8, h: 1.0,
    fontSize: 64, bold: true, color: COLOR.textLight,
    fontFace: "Arial Black", align: "center", margin: 0, charSpacing: 8,
  });
  slide.addText(`For your continued support of ${CONFIG.troopName.replace("TROOP ", "Troop ")}`, {
    x: 0.6, y: 2.6, w: 8.8, h: 0.6,
    fontSize: 22, color: COLOR.tan,
    fontFace: "Calibri", align: "center", italic: true, margin: 0,
  });
  slide.addText("On my honor I will do my best", {
    x: 0.6, y: 3.5, w: 8.8, h: 0.5,
    fontSize: 16, color: COLOR.tanLight,
    fontFace: "Calibri", align: "center", margin: 0, charSpacing: 2,
  });
  slide.addText("Questions or comments are welcome.", {
    x: 0.6, y: 4.5, w: 8.8, h: 0.4,
    fontSize: 13, color: COLOR.tanLight, italic: true,
    fontFace: "Calibri", align: "center", margin: 0,
  });
}

function slideStalledScoutsDetail(pres, scouts, dateStr) {
  const slide = pres.addSlide();
  slide.background = { color: COLOR.bgLight };

  const today = new Date();
  const lowerCutoff = new Date(today);
  lowerCutoff.setDate(today.getDate() - CONFIG.recentLowerRankDays);
  const upperCutoff = new Date(today);
  upperCutoff.setDate(today.getDate() - CONFIG.recentUpperRankDays);

  const stalled = [];
  scouts.forEach(s => {
    if (s.rank === "Eagle" || s.rank.includes("Palm")) return;
    if (s.rank === "Unranked") {
      if (s.joinDate && s.joinDate < lowerCutoff) {
        const days = Math.floor((today - s.joinDate) / (1000 * 60 * 60 * 24));
        stalled.push({ name: s.displayName, rank: "Unranked", patrol: s.patrol, daysSince: days });
      }
      return;
    }
    if (!s.rankDate) return;
    const isLower = LOWER_RANKS.includes(s.rank);
    const isUpper = UPPER_RANKS.includes(s.rank);
    if (!isLower && !isUpper) return;
    const cutoff = isLower ? lowerCutoff : upperCutoff;
    if (s.rankDate < cutoff) {
      const days = Math.floor((today - s.rankDate) / (1000 * 60 * 60 * 24));
      stalled.push({ name: s.displayName, rank: s.rank, patrol: s.patrol, daysSince: days });
    }
  });

  stalled.sort((a, b) => {
    const ra = RANK_ORDER.indexOf(a.rank);
    const rb = RANK_ORDER.indexOf(b.rank);
    if (ra !== rb) return ra - rb;
    return b.daysSince - a.daysSince;
  });

  addPageHeader(slide, pres, "SCOUTS NEEDING ATTENTION — DETAIL",
    `${stalled.length} Scouts flagged for Scoutmaster follow-up  •  Sorted by rank, then by time since last advancement`);

  const startX = 0.25, startY = 1.25;
  const headerH = 0.30;
  const columnGap = 0.25;
  const colTotalW = (10 - startX * 2 - columnGap) / 2;
  const subColW = [2.05, 1.05, 0.55, 1.10];
  const subTotal = subColW.reduce((a, b) => a + b, 0);
  const scaledColW = subColW.map(w => (w / subTotal) * colTotalW);

  const totalRows = stalled.length;
  const perColumn = Math.ceil(totalRows / 2);
  const availH = 5.20 - startY - headerH;
  const rowH = Math.min(0.22, availH / Math.max(perColumn, 1));
  const fontSize = rowH < 0.20 ? 7.5 : 8.5;

  for (let colIdx = 0; colIdx < 2; colIdx++) {
    const colX = startX + colIdx * (colTotalW + columnGap);
    const colItems = stalled.slice(colIdx * perColumn, (colIdx + 1) * perColumn);
    if (colItems.length === 0) continue;

    const hdrs = ["Scout", "Rank", "Days", "Patrol"];
    let cx = colX;
    hdrs.forEach((h, i) => {
      slide.addShape(pres.shapes.RECTANGLE, {
        x: cx, y: startY, w: scaledColW[i] - 0.03, h: headerH,
        fill: { color: COLOR.bgDark }, line: { type: "none" },
      });
      slide.addText(h, {
        x: cx + 0.05, y: startY, w: scaledColW[i] - 0.1, h: headerH,
        fontSize: 9, bold: true, color: COLOR.textLight,
        fontFace: "Calibri", align: i === 0 ? "left" : "center",
        valign: "middle", margin: 0,
      });
      cx += scaledColW[i];
    });

    colItems.forEach((item, idx) => {
      const ry = startY + headerH + idx * rowH;
      const rowBg = idx % 2 === 0 ? "FFFFFF" : COLOR.rowAlt;
      const accent = item.rank === "Unranked" ? "888888" : rankColor(item.rank);
      cx = colX;

      scaledColW.forEach((w, ci) => {
        slide.addShape(pres.shapes.RECTANGLE, {
          x: cx, y: ry, w: w - 0.03, h: rowH - 0.02,
          fill: { color: rowBg }, line: { type: "none" },
        });
        cx += w;
      });
      slide.addShape(pres.shapes.RECTANGLE, {
        x: colX, y: ry, w: 0.05, h: rowH - 0.02,
        fill: { color: accent }, line: { type: "none" },
      });

      cx = colX;
      const vals = [
        item.name,
        item.rank === "Second Class" ? "2nd Class"
          : item.rank === "First Class" ? "1st Class"
          : item.rank,
        String(item.daysSince),
        item.patrol === "Unassigned" ? "—" : item.patrol,
      ];
      const aligns = ["left", "center", "center", "left"];
      const colors = [COLOR.textDark, COLOR.textDark, COLOR.tanDark, COLOR.textMid];
      const bolds = [false, false, true, false];
      const sizes = [fontSize, fontSize - 0.5, fontSize, fontSize - 0.5];

      vals.forEach((v, ci) => {
        slide.addText(v, {
          x: cx + (ci === 0 ? 0.08 : 0.04), y: ry,
          w: scaledColW[ci] - (ci === 0 ? 0.13 : 0.06), h: rowH - 0.02,
          fontSize: sizes[ci], bold: bolds[ci], color: colors[ci],
          fontFace: "Calibri", align: aligns[ci], valign: "middle", margin: 0,
        });
        cx += scaledColW[ci];
      });
    });
  }

  addPageFooter(slide, dateStr);
}

// ═══════════════════════════════ MAIN ENTRY POINT ══════════════════════
async function generate(inputs, outputDir, options = {}) {
  const { roster: rosterPath } = inputs;
  if (!rosterPath || !fs.existsSync(rosterPath)) throw new Error("Roster CSV not provided");

  // Apply troopName from settings/options for this run only
  const savedTroopName = CONFIG.troopName;
  CONFIG.troopName = (options.troopName || "BSA Troop").toUpperCase();

  const scouts = loadScouts(rosterPath);
  const adultCount = countAdults(rosterPath);

  const pres = new pptxgen();
  pres.layout = "LAYOUT_16x9";
  pres.title = `${CONFIG.troopName} Health Report`;

  const dateStr = todayISO();
  const longDateStr = todayLong();

  slideTitle(pres, longDateStr);
  slideAtAGlance(pres, scouts, adultCount, dateStr);
  slidePatrolDistribution(pres, scouts, dateStr);
  slideAgeDistribution(pres, scouts, dateStr);
  slideTenure(pres, scouts, dateStr);
  slideRankDistribution(pres, scouts, dateStr);
  slideRecentAdvancements(pres, scouts, dateStr);
  slideEaglePipeline(pres, scouts, dateStr);
  slideNeedsAttention(pres, scouts, dateStr);
  slideThankYou(pres, dateStr);
  slideStalledScoutsDetail(pres, scouts, dateStr);

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const fileName = `troop_health_${dateStr}.pptx`;
  const filePath = path.join(outputDir, fileName);
  await pres.writeFile({ fileName: filePath });

  CONFIG.troopName = savedTroopName;

  return {
    filePath,
    fileName,
    stats: {
      activeScouts: scouts.length,
      registeredAdults: adultCount,
      lifeScouts: scouts.filter(s => s.rank === "Life").length,
    },
  };
}

module.exports = { manifest, generate };

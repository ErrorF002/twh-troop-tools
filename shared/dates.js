function parseDate(s) {
  if (!s) return null;
  // Match both 4-digit year (01/15/2026) and 2-digit year (01/15/26)
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let year = parseInt(m[3]);
  // Expand 2-digit year: 00-49 → 2000-2049, 50-99 → 1950-1999
  if (year < 100) year += year < 50 ? 2000 : 1900;
  return new Date(year, parseInt(m[1]) - 1, parseInt(m[2]));
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function todayLong() {
  return new Date().toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });
}

module.exports = { parseDate, todayISO, todayLong };

/**
 * Name normalization for matching across TroopWebHost reports.
 * Roster has middle initials and suffixes; requirements file doesn't.
 *
 *   "Stewart, Liam R"        → "Stewart, Liam"
 *   "Riedl, Quentin Jr."     → "Riedl, Quentin"
 *   "Pokorney, Matthew j II" → "Pokorney, Matthew"
 */
function normalizeName(name) {
  let n = (name || "").trim();
  n = n.replace(/\s+(Jr\.?|Sr\.?|II|III|IV|V)\s*$/i, "");
  n = n.replace(/\s+[A-Za-z]\.?\s*$/, "");
  return n.trim();
}

/**
 * Convert "Last, First M" to "First Last" for display.
 */
function formatDisplayName(name) {
  const parts = (name || "").split(",");
  if (parts.length < 2) return name;
  const last = parts[0].trim();
  const first = parts[1].trim().split(/\s+/)[0];
  return `${first} ${last}`.replace(/\s+(Jr\.?|Sr\.?|II|III|IV|V)$/i, "").trim();
}

module.exports = { normalizeName, formatDisplayName };

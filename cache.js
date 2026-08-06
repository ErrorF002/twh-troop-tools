/**
 * Local CSV Cache
 *
 * Keeps the most recently fetched/uploaded copy of each external data
 * source (TroopWebHost roster/requirements/meritBadges, my.scouting
 * roster) on disk with a timestamp, so the report generation screen can
 * show how old the data is instead of silently re-hitting TroopWebHost
 * on every generation.
 *
 * Shared by cacheKey, not by report - several reports reference the same
 * TWH roster, and they all read/write the same cache entry.
 */

const fs   = require("fs");
const path = require("path");
const os   = require("os");

function getCacheDir() {
  if (!process.pkg) {
    const dir = path.join(__dirname, "cache");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
  // Running as packaged binary — same OS user-data directory settings.js uses
  const base = process.platform === "win32"
    ? (process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"))
    : process.platform === "darwin"
      ? path.join(os.homedir(), "Library", "Application Support")
      : path.join(os.homedir(), ".config");
  const dir = path.join(base, "TroopTools", "cache");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const CACHE_DIR     = getCacheDir();
const MANIFEST_FILE = path.join(CACHE_DIR, "manifest.json");

// A cache entry older than this is still usable but flagged stale in the UI.
const STALE_DAYS = 7;

function loadManifest() {
  try {
    if (fs.existsSync(MANIFEST_FILE)) return JSON.parse(fs.readFileSync(MANIFEST_FILE, "utf8"));
  } catch (e) {
    console.warn("Could not load cache manifest.json:", e.message);
  }
  return {};
}

function saveManifest(data) {
  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(data, null, 2), "utf8");
}

function csvFilePath(cacheKey) {
  return path.join(CACHE_DIR, `${cacheKey}.csv`);
}

/**
 * Copy a downloaded/uploaded CSV into the cache under cacheKey and record
 * the current time as its "last refreshed" timestamp.
 */
function store(cacheKey, sourceFilePath) {
  fs.copyFileSync(sourceFilePath, csvFilePath(cacheKey));
  const manifest = loadManifest();
  manifest[cacheKey] = { cachedAt: new Date().toISOString() };
  saveManifest(manifest);
}

/**
 * { cachedAt, ageDays } for a cache entry, or null if nothing is cached
 * (or the manifest is stale and the file is gone).
 */
function status(cacheKey) {
  const entry = loadManifest()[cacheKey];
  if (!entry || !fs.existsSync(csvFilePath(cacheKey))) return null;
  const ageMs = Date.now() - new Date(entry.cachedAt).getTime();
  return { cachedAt: entry.cachedAt, ageDays: Math.floor(ageMs / (24 * 60 * 60 * 1000)) };
}

/** Status for every cacheKey that currently has an entry. */
function allStatus() {
  const manifest = loadManifest();
  const out = {};
  Object.keys(manifest).forEach(key => { out[key] = status(key); });
  return out;
}

/** Whether a cache entry exists and is within the staleness window. */
function isFresh(cacheKey) {
  const st = status(cacheKey);
  return !!st && st.ageDays <= STALE_DAYS;
}

module.exports = { store, status, allStatus, isFresh, csvFilePath, STALE_DAYS };

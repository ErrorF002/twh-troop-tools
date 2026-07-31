const fs   = require("fs");
const path = require("path");
const os   = require("os");

function getSettingsPath() {
  if (!process.pkg) return path.join(__dirname, "settings.json");
  // Running as packaged binary — write to OS user-data directory
  const base = process.platform === "win32"
    ? (process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"))
    : process.platform === "darwin"
      ? path.join(os.homedir(), "Library", "Application Support")
      : path.join(os.homedir(), ".config");
  const dir = path.join(base, "TroopTools");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "settings.json");
}

const SETTINGS_FILE = getSettingsPath();

const DEFAULTS = {
  setupComplete: false,
  troopName:     "",
  subdomain:     "",
  menuItemIds: {
    roster:       null,
    requirements: null,
    meritBadges:  null,
  },
};

let _cache = null;

function load() {
  if (_cache) return _cache;
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
      _cache = {
        ...DEFAULTS,
        ...saved,
        menuItemIds: { ...DEFAULTS.menuItemIds, ...(saved.menuItemIds || {}) },
      };
      return _cache;
    }
  } catch (e) {
    console.warn("Could not load settings.json:", e.message);
  }
  _cache = { ...DEFAULTS, menuItemIds: { ...DEFAULTS.menuItemIds } };
  return _cache;
}

function save(data) {
  const current = load();
  const updated = {
    ...current,
    ...(data.setupComplete !== undefined ? { setupComplete: !!data.setupComplete } : {}),
    ...(data.troopName    !== undefined ? { troopName:    String(data.troopName).trim() }    : {}),
    ...(data.subdomain    !== undefined ? { subdomain:    String(data.subdomain).trim() }    : {}),
    menuItemIds: {
      ...current.menuItemIds,
      ...(data.menuItemIds || {}),
    },
  };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(updated, null, 2), "utf8");
  _cache = updated;
  return updated;
}

module.exports = { load, save, DEFAULTS };

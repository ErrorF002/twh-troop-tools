/**
 * TroopWebHost Downloads
 *
 * Downloads reports by navigating directly to their report URLs.
 * TroopWebHost report URLs follow the pattern:
 *   https://www.troopwebhost.org/FormReport.aspx?Menu_Item_ID=XXXXX&Stack=1&ReportFormat=XLS
 *
 * The session cookie from login grants access — no menu navigation needed.
 * A blank page (rather than a redirect to login) is returned when not logged
 * in, so we verify the download actually fires rather than trusting the response.
 *
 * NOTE: Menu_Item_IDs are troop-specific. Each troop configures its own
 * via the Settings UI (see settings.js) rather than hardcoding them here.
 */

const fs       = require("fs");
const path     = require("path");
const os       = require("os");
const settings = require("../settings");

const TROOPWEBHOST_REPORT_BASE = "https://www.troopwebhost.org/FormReport.aspx";
// Some reports (e.g. Merit Badge History, which covers the troop's entire
// badge history) can take TroopWebHost noticeably longer to generate than a
// simple roster export - give it generous headroom before giving up.
const DOWNLOAD_TIMEOUT_MS = 120000;
// How long to give the download a head start before checking whether we've
// been silently redirected away from the report URL (see
// raceDownloadAgainstPermissionRedirect below).
const PERMISSION_CHECK_DELAY_MS = 15000;

// ═══════════════════════════════ RECIPES ════════════════════════════════
// Each recipe maps to a direct TroopWebHost report URL. The Menu_Item_ID
// itself is troop-specific and comes from settings.js, not from here.

const RECIPES = {
  roster: {
    id: "roster",
    description: "Active Roster CSV",
  },
  requirements: {
    id: "requirements",
    description: "Uncompleted Rank Requirements By Requirement CSV",
  },
  meritBadges: {
    id: "meritBadges",
    description: "Merit Badge History By Scout CSV",
  },
};

/**
 * Build the direct download URL for a report.
 */
function reportUrl(menuItemId) {
  return `${TROOPWEBHOST_REPORT_BASE}?Menu_Item_ID=${menuItemId}&Stack=1&ReportFormat=XLS`;
}

/**
 * Download a single report by navigating directly to its URL.
 *
 * @param {Page} page
 * @param {string} reportName  "roster" or "requirements"
 * @returns {Promise<string>}  Absolute path to the downloaded file in temp
 */
async function downloadReport(page, reportName) {
  const recipe = RECIPES[reportName];
  if (!recipe) throw new Error(`Unknown TroopWebHost report: ${reportName}`);

  const configuredIds = settings.load().menuItemIds;
  const menuItemId    = configuredIds && configuredIds[reportName];
  if (!menuItemId) {
    throw new Error(
      `The Menu Item ID for "${recipe.description}" is not configured. ` +
      `Open Settings, enter the ID from your TroopWebHost report URL (after Menu_Item_ID=), and save.`
    );
  }
  const url = reportUrl(menuItemId);
  console.log(`  → Navigating to report URL: ${url}`);

  // Set up the download listener first, then navigate. page.goto() usually
  // rejects when the response is a file download (the browser interrupts
  // navigation to start the download) - this is expected and ignored. That
  // resolve-vs-reject outcome isn't a reliable enough signal on its own to
  // detect a missing-permission redirect though: there's a race between
  // Chromium's download interception and Playwright's "commit" milestone,
  // and goto() can resolve even for a real, successful download. Don't act
  // on it directly - see raceDownloadAgainstPermissionRedirect below.
  const downloadPromise = page.waitForEvent("download", { timeout: DOWNLOAD_TIMEOUT_MS });
  page.goto(url, { waitUntil: "commit", timeout: DOWNLOAD_TIMEOUT_MS })
    .catch(() => { /* expected: throws when response is a file download */ });

  try {
    const download = await raceDownloadAgainstPermissionRedirect(page, downloadPromise, recipe);

    const tempDir = path.join(os.tmpdir(), "troop-tools-twh");
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const suggested = download.suggestedFilename() || `${recipe.id}.csv`;
    const safeName = `${recipe.id}-${Date.now()}-${suggested.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const savePath = path.join(tempDir, safeName);
    await download.saveAs(savePath);

    console.log(`  → Saved: ${savePath}`);
    return savePath;
  } catch (err) {
    if (err.isPermissionError) throw err;

    // Capture diagnostics on failure
    const diagPath = await captureDiagnostics(page, `download-failed-${recipe.id}`);
    const isTimeout = /timeout/i.test(err.message) && /exceeded/i.test(err.message);
    const summary = isTimeout
      ? `TroopWebHost didn't finish generating "${recipe.description}" within ` +
        `${DOWNLOAD_TIMEOUT_MS / 1000} seconds and no file ever started downloading. This can ` +
        "happen with large reports or when TroopWebHost is slow to respond - try again in a moment."
      : `Failed to download ${recipe.description}: ${err.message}`;
    throw new Error(`${summary}  Diagnostic info: ${diagPath}`);
  }
}

/**
 * Give the download a head start; if it hasn't fired yet, check whether
 * page.url() shows we've been silently redirected away from the report URL
 * (the signature of an account lacking permission for this report) so we
 * can fail fast with a clear message instead of waiting out the full
 * download timeout. If we're still parked on the report URL, this is more
 * likely just a slow report - keep waiting on the original download promise.
 */
async function raceDownloadAgainstPermissionRedirect(page, downloadPromise, recipe) {
  const headStart = new Promise(resolve => setTimeout(() => resolve(undefined), PERMISSION_CHECK_DELAY_MS));
  const early = await Promise.race([downloadPromise, headStart]);
  if (early) return early;

  if (!page.url().includes("FormReport.aspx")) {
    downloadPromise.catch(() => {}); // it'll time out on its own; avoid an unhandled rejection
    const diagPath = await captureDiagnostics(page, `no-permission-${recipe.id}`);
    const err = new Error(
      `TroopWebHost loaded a normal page instead of returning "${recipe.description}". ` +
      "This almost always means the signed-in account doesn't have permission to run this " +
      "report - ask your Key 3 or Committee Chair to grant Scoutmaster-level access or " +
      "Report permissions. (If this happens after being idle a long time, try reconnecting " +
      "via the Connect button instead.) " +
      `Diagnostic info: ${diagPath}`
    );
    err.isPermissionError = true;
    throw err;
  }

  return downloadPromise;
}

/**
 * Save diagnostic info on download failure.
 */
async function captureDiagnostics(page, label) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(os.tmpdir(), "troop-tools-diagnostics", `${ts}-${label}`);
  fs.mkdirSync(dir, { recursive: true });

  try { await page.screenshot({ path: path.join(dir, "screenshot.png"), fullPage: true }); } catch {}
  try { fs.writeFileSync(path.join(dir, "page.html"), await page.content()); } catch {}
  try {
    const summary = { url: page.url(), title: await page.title().catch(() => ""), frames: [] };
    for (const frame of page.frames()) {
      const fields = await frame.$$eval(
        "input, button, a",
        els => els.map(el => ({
          tag: el.tagName,
          type: el.getAttribute("type"),
          name: el.getAttribute("name"),
          id: el.getAttribute("id"),
          text: ["A","BUTTON"].includes(el.tagName) ? (el.textContent||"").trim().slice(0,80) : undefined,
          href: el.tagName === "A" ? el.getAttribute("href") : undefined,
          visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
        }))
      ).catch(() => []);
      summary.frames.push({ url: frame.url(), isMain: frame === page.mainFrame(), fields });
    }
    fs.writeFileSync(path.join(dir, "form-elements.json"), JSON.stringify(summary, null, 2));
  } catch {}

  console.log(`Diagnostic info saved to: ${dir}`);
  return dir;
}

module.exports = { downloadReport, RECIPES };

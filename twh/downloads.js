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
 * NOTE: Menu_Item_IDs are troop-specific. Update the IDs below to match
 * your troop's TroopWebHost account before use.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const TROOPWEBHOST_REPORT_BASE = "https://www.troopwebhost.org/FormReport.aspx";
const DOWNLOAD_TIMEOUT_MS = 60000;

// ═══════════════════════════════ RECIPES ════════════════════════════════
// Each recipe maps to a direct TroopWebHost report URL.
// Menu_Item_ID values are troop-specific — update these for your unit.

const RECIPES = {
  roster: {
    id: "roster",
    description: "Active Roster CSV",
    menuItemId: 53747,
  },
  requirements: {
    id: "requirements",
    description: "Uncompleted Rank Requirements By Requirement CSV",
    menuItemId: 46047,
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

  const url = reportUrl(recipe.menuItemId);
  console.log(`  → Navigating to report URL: ${url}`);

  try {
    // Set up the download listener first, then navigate.
    // page.goto will throw "Download is starting" when the server responds
    // with a file instead of a page — this is expected and we ignore it.
    const downloadPromise = page.waitForEvent("download", { timeout: DOWNLOAD_TIMEOUT_MS });
    page.goto(url, { waitUntil: "commit", timeout: DOWNLOAD_TIMEOUT_MS })
      .catch(() => { /* expected: throws when response is a file download */ });
    const download = await downloadPromise;

    const tempDir = path.join(os.tmpdir(), "troop-tools-twh");
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const suggested = download.suggestedFilename() || `${recipe.id}.csv`;
    const safeName = `${recipe.id}-${Date.now()}-${suggested.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const savePath = path.join(tempDir, safeName);
    await download.saveAs(savePath);

    console.log(`  → Saved: ${savePath}`);
    return savePath;
  } catch (err) {
    // Capture diagnostics on failure
    const diagPath = await captureDiagnostics(page, `download-failed-${recipe.id}`);
    throw new Error(`Failed to download ${recipe.description}: ${err.message}  Diagnostic info: ${diagPath}`);
  }
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

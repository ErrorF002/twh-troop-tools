#!/usr/bin/env node
/**
 * Postinstall: download Chromium for Playwright.
 *
 * This script wraps `playwright install chromium` so that a failed
 * browser download doesn't block the whole npm install. If the
 * download fails, we print a clear message and exit successfully —
 * the user can retry manually with `npx playwright install chromium`.
 *
 * The actual TroopWebHost login flow won't work until Chromium is downloaded,
 * but the manual-upload CSV path still does. Skipping the failure
 * here keeps the tool usable in degraded mode.
 */

const { spawnSync } = require("child_process");

console.log("");
console.log("Downloading Chromium for TroopWebHost automation (~150 MB)...");
console.log("This is part of the one-time setup and takes 1-2 minutes.");
console.log("");

const result = spawnSync("npx", ["playwright", "install", "chromium"], {
  stdio: "inherit",
  shell: true,
});

if (result.status === 0) {
  console.log("");
  console.log("✓ Chromium installed. Run `npm start` to launch the app.");
  process.exit(0);
}

console.log("");
console.log("══════════════════════════════════════════════════════════════");
console.log("⚠  Chromium download did not complete.");
console.log("");
console.log("This usually means a network issue (firewall, proxy, or");
console.log("temporary outage). The rest of the install succeeded, but");
console.log("the TroopWebHost auto-login feature won't work until you");
console.log("finish the browser download.");
console.log("");
console.log("To finish the install later, run:");
console.log("    npx playwright install chromium");
console.log("");
console.log("In the meantime, you can use the app with manual CSV upload");
console.log("by running `npm start` as usual.");
console.log("══════════════════════════════════════════════════════════════");
console.log("");
process.exit(0);

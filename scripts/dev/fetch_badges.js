// One-off maintainer tool: scrapes the official merit badge list from
// scouting.org to refresh OFFICIAL_BADGES in reports/merit-badges.js.
// Not part of the app; not run in production.
const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page    = await browser.newPage();
  console.log("Fetching...");
  await page.goto("https://www.scouting.org/skills/merit-badges/all/", {
    waitUntil: "networkidle", timeout: 30000,
  });
  await page.waitForTimeout(2000);

  const badges = await page.evaluate(() => {
    const found = new Set();
    document.querySelectorAll("span.elementor-heading-title a").forEach(el => {
      const t = el.textContent.trim();
      if (t.length > 1) found.add(t);
    });
    return [...found].sort();
  });

  console.log(`Found ${badges.length} merit badges`);
  badges.forEach(b => console.log(" ", b));

  fs.writeFileSync(
    "C:\\Users\\grodriguez\\Downloads\\badge_list_raw.json",
    JSON.stringify(badges, null, 2)
  );
  console.log("\nSaved to badge_list_raw.json");

  await browser.close();
})();

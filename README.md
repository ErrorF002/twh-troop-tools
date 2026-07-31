# Troop Tools

A local app for Scoutmasters that generates reports (PowerPoint decks, HTML dashboards, CSV/VCF exports) from TroopWebHost and my.scouting.org data.

Currently supports:

- **Advancement Report** - Patrol-level breakdown of uncompleted rank requirements (Scout through First Class). Identifies the highest-impact items to plan activities around.
- **Troop Health Report** - Committee-meeting deck with membership demographics, rank distribution, recent advancements, Eagle pipeline, and scouts needing follow-up.
- **Merit Badge Analysis** - Troop-wide merit badge analytics: Eagle coverage, scout progress, popular electives, badges never earned, and stale badges worth repeating.
- **Patrol Balance** - Snapshot of patrol composition with age and rank variance, plus single-move rebalancing suggestions.
- **Roster Audit** - Scans the active youth roster for data quality issues: missing dates of birth, scouts without a patrol, missing BSA IDs, and duplicate names.
- **Roster Reconciliation** - Compares youth on my.scouting.org against TroopWebHost. Flags who needs to be added, who needs investigation, and any name or rank discrepancies.
- **Troop Contacts Export** - Exports adult leaders from the active roster into a contacts file. Import directly into Google Contacts or tap to import on iPhone.

## Install (one-time)

1. Download the latest `TroopTools-Setup-vX.X.X.exe` (Windows) from wherever you were given the link.
2. Run it and follow the installer. No admin rights are needed - it installs to your own user account.
3. Windows may show a SmartScreen warning ("Windows protected your PC") because the installer isn't code-signed. Click **More info → Run anyway**. This is a one-time warning.
4. When it finishes, Troop Tools launches automatically and opens in your browser. You'll also find it in the Start Menu.

A macOS `.dmg` build exists but is less tested - if you hit issues there, please report them.

## First-run setup

The first time you open Troop Tools, a setup wizard asks for:

- **Troop name** - used in report titles.
- **TroopWebHost site path** - the part of your TroopWebHost URL before `.troopwebhost.org` (e.g. if your site is `https://Troop123YourCity.troopwebhost.org`, enter `Troop123YourCity`).
- **Menu Item IDs** for the reports you want to auto-fetch (see below).

You can revisit these anytime from the **Settings** button on the dashboard.

### Finding your Menu Item IDs

TroopWebHost doesn't have a lookup API for this, so it's a one-time manual step per report:

1. Log into TroopWebHost in your regular browser.
2. Run the report once the normal way (e.g. Reports → Uncompleted Rank Requirements By Requirement, or Membership → Export Roster).
3. Look at the URL in your browser - it will contain `Menu_Item_ID=12345`.
4. Copy that number into the matching field in Troop Tools' Settings.

Reports Troop Tools can auto-fetch this way:
- **Roster** - Membership → Export Membership Data → Export Roster to Excel
- **Requirements** - Reports → Uncompleted Rank Requirements By Requirement
- **Merit Badge History** - Reports → Merit Badge History By Scout By Badge Name

Any report can also be run without these, using the manual upload path below.

## Two ways to use it

### 1. Sign in (recommended)

Sign in with your TroopWebHost credentials. The app uses them once to log into your TroopWebHost site in a hidden browser, then automatically downloads the CSVs each report needs.

- Your credentials stay on this computer. They live in memory only - they're not written to disk, and they're cleared when you log out or restart the app.
- After 30 minutes of inactivity the session expires automatically and you sign in again.

When you sign in, each report card shows a single "Fetch & Generate" button. Click it and your browser's normal download dialog will appear with the file - save it wherever you like.

### 2. Manual upload (fallback)

You can also skip the login and just drop in CSVs yourself. Export the right reports from TroopWebHost or my.scouting.org manually, drop them into the appropriate slots on each card, and click Generate.

Useful when:
- You don't want to put your TroopWebHost password into the tool
- TroopWebHost is down or the automation breaks
- You want to test changes against a saved snapshot

## Privacy

- CSVs are processed locally and deleted after each report runs.
- Credentials are held in memory only while you're signed in.
- Nothing about your troop, your scouts, or your credentials ever leaves your computer. All HTTP traffic is between your browser and your local server. The only external service this tool ever talks to is TroopWebHost itself, using the same login flow you'd do manually in a browser.
- Settings (troop name, subdomain, Menu Item IDs) are saved to a small file in your user profile, not inside the installed app folder.

## Troubleshooting

**Windows warns "Windows protected your PC" when I run the installer**
The installer isn't code-signed (that costs money we haven't spent on a hobby tool). Click **More info → Run anyway**. This is safe if you got the installer from a trusted source.

**The browser shows "This site can't be reached"**
The app may still be starting, or it's not running. Reopen it from the Start Menu.

**A report says the Menu Item ID isn't configured**
Open Settings and follow the steps under [Finding your Menu Item IDs](#finding-your-menu-item-ids) above.

**Login fails with "Couldn't find the username field" or "Couldn't find the Log On link"**
The TroopWebHost site path may be wrong. Make sure you entered just the path segment (e.g. `Troop123YourCity`) and not the full URL.

**Login fails with "invalid username or password"**
The credentials weren't accepted by TroopWebHost. Verify them by signing into TroopWebHost manually in your browser.

**"Couldn't click menu item" during fetch**
TroopWebHost's menu structure may have changed, or your account may not have permissions for that report. Try the **manual upload** path as a workaround, then report the issue.

---

## For developers

### Running from source

Requires Node.js 18+.

```
npm install
npm start
```

This downloads the app's dependencies plus a copy of Chromium (~150 MB) used to log into TroopWebHost on your behalf. `npm start` opens the dashboard automatically; the port auto-increments past 3000 if something else is already using it.

### Building the installer

```
npm run build:win     # requires Inno Setup 6 (jrsoftware.org/isdl.php)
npm run build:mac     # must be run on a Mac (hdiutil is macOS-only); unsigned
```

Output lands in `dist/win/` or `dist/mac/`. See `scripts/build.js` for what each step does - it compiles with `@yao-pkg/pkg`, bundles a Playwright Chromium next to the binary, and wraps it with an installer.

### How to add a new report

Drop a new file in the `reports/` folder that exports a manifest and a `generate` function:

```js
const manifest = {
  id: "my-report",
  name: "My New Report",
  description: "Short description shown on the dashboard card",
  icon: "📊",
  inputs: [
    {
      key: "roster",
      label: "Roster CSV",
      hint: "Where to export from",
      required: true,
      twhReport: "roster",   // Optional: enables auto-fetch from TroopWebHost
    },
  ],
};

async function generate(inputs, outputDir, options) {
  // inputs.roster will be the path to the CSV (uploaded or fetched)
  // options.troopName is populated from Settings automatically
  // Generate your output here, save to outputDir
  return {
    filePath: "/path/to/output.pptx",
    fileName: "output.pptx",
    stats: { scoutsAnalyzed: 105 },  // optional - shown in UI after generation
  };
}

module.exports = { manifest, generate };
```

If `twhReport` matches a recipe in `twh/downloads.js` (`roster`, `requirements`, or `meritBadges`), the report becomes available as a one-click "Fetch & Generate". If you omit it, the report still works via manual upload. To add a new TroopWebHost recipe, edit the `RECIPES` object in `twh/downloads.js` - its Menu_Item_ID is then user-configurable via Settings rather than hardcoded.

### File locations

- `public/` - HTML, CSS, and JS for the dashboard UI
- `reports/` - One file per report, each self-contained
- `shared/` - Utilities used by multiple reports (CSV parser, name normalization, dates)
- `twh/` - TroopWebHost automation (Playwright login + download)
- `settings.js` - Persisted settings (project dir in dev, OS user-data dir when packaged)
- `scripts/build.js` - Standalone installer build pipeline
- `server.js` - Express server that ties it all together

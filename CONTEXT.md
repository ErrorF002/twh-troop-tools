# Troop Tools - Project Context

This document provides context for AI coding assistants (Claude Code, etc.) working on this project. Read this before making any changes.

---

## What This Is

A Node.js application for BSA Scoutmasters that automates report generation from TroopWebHost (TWH) CSV exports and my.scouting.org data.

Two ways it runs:
- **From source** (developers): `npm install && npm start`, opens at `http://localhost:3000` (auto-increments if busy).
- **As a standalone installer** (end users): a Windows `.exe` (Inno Setup) or macOS `.app`/`.dmg`, built by `scripts/build.js` and distributed via GitHub Releases. No Node.js or npm required on the user's machine.

The user opens it in a browser, either signs into TroopWebHost (the app drives a hidden Playwright browser to fetch CSVs automatically) or uploads CSVs manually, and generates reports with one click. Files are delivered through the browser's normal download mechanism.

The repo is public: `github.com/guillermorodriguez-dot/twh-troop-tools`. It is **not affiliated with or endorsed by the Boy Scouts of America** - avoid language, branding, or identifiers (app publisher, bundle ID, etc.) that imply otherwise. "BSA" only belongs in places describing actual BSA terminology (rank names, the "BSA ID" field, etc.), never as this project's own branding.

---

## Tech Stack

- **Runtime:** Node.js 18+, Windows primary (Mac supported, less tested)
- **Server:** Express 4
- **File uploads:** Multer
- **Browser automation:** Playwright (Chromium) - TroopWebHost login/download automation and PDF generation
- **PPTX generation:** pptxgenjs
- **Frontend:** Vanilla HTML/CSS/JS - no framework
- **Packaging:** `@yao-pkg/pkg` (compiles to a single binary) + Inno Setup 6 (Windows installer) / `hdiutil` (macOS dmg)
- **Unique IDs:** uuid

---

## Project Structure

```
troop-tools/
├── server.js                  Express server - routes, auth, file serving, pkg-aware path resolution
├── settings.js                Persisted settings: troop name, subdomain, menuItemIds. Project dir in dev,
│                               OS user-data dir (%APPDATA%/TroopTools, ~/Library/Application Support/TroopTools)
│                               when packaged.
├── package.json                Dependencies, pkg config, build scripts
├── LICENSE                    MIT
├── assets/
│   ├── icon.svg                Source icon (OD green/tan, "TT" monogram)
│   ├── icon.ico                Generated multi-res Windows icon
│   └── icon.icns                Generated macOS icon
├── scripts/
│   ├── install-browser.js     Resilient Chromium installer (doesn't fail npm install)
│   ├── build.js                Builds the standalone installer (pkg + Inno Setup / hdiutil) - see below
│   └── dev/
│       └── fetch_badges.js    One-off maintainer tool, scrapes scouting.org for the official badge list
├── public/
│   ├── index.html             Login view, first-run setup wizard, Settings modal, dashboard
│   ├── style.css              Scout-themed: OD green / tan / cub blue
│   └── app.js                 Frontend: login, setup wizard, settings, session state, card rendering
├── reports/                   One file per report - drop a new file here to add a report
│   ├── advancement.js         Patrol advancement PPTX
│   ├── health.js              Quarterly committee health PPTX
│   ├── merit-badges.js        Merit badge analytics (HTML + optional PDF/CSV)
│   ├── patrol-balance.js      Patrol composition + rebalancing suggestions (HTML)
│   ├── audit.js                Roster data-quality audit (HTML), manifest id "roster-audit"
│   ├── contacts.js            Leader contacts export (Google CSV or VCF)
│   └── reconciliation.js      my.scouting vs TroopWebHost comparison (HTML + optional PDF/CSV)
├── shared/
│   ├── csv-parser.js          Handles quoted fields, BOM, CRLF
│   ├── name-normalize.js      normalizeName(), formatDisplayName()
│   └── dates.js               parseDate() handles both 2-digit and 4-digit years
└── twh/
    ├── session.js             Singleton Playwright browser, 30-min inactivity timeout
    ├── login.js               TWH login - handles frameset redirect + popup modal
    └── downloads.js           Direct URL navigation to download CSVs; Menu_Item_IDs come from settings.js
```

---

## TroopWebHost Architecture (Hard-Won Knowledge)

TWH is an ASP.NET site with unusual structure. Key facts:

- **Frameset:** The root URL loads a `<frameset>` containing `Redirect.htm`, which runs JavaScript to detect screen width, then loads the real page. Playwright must wait for this redirect chain to complete.
- **Login:** A "Log On" link in the top-right opens a popup modal with fields `name="User_Login"` and `name="User_Password"`. The submit button is `type="button"` (not `type="submit"`) with `name="login"`.
- **Menu:** Behind a hamburger button (`href="javascript:togglemenu();"`). Categories use `toggleLower('mNN')` to expand - they don't navigate.
- **Downloads:** Reports are downloaded by navigating directly to URLs of the form `https://www.troopwebhost.org/FormReport.aspx?Menu_Item_ID=XXXXX&Stack=1&ReportFormat=XLS`. These URLs are troop-specific (Menu_Item_IDs vary by troop).

Menu_Item_IDs are unit-specific and are **not hardcoded anywhere in the codebase**. Each troop configures its own via the first-run setup wizard or the Settings modal, stored as `menuItemIds.roster`, `menuItemIds.requirements`, and `menuItemIds.meritBadges` in `settings.js`. `twh/downloads.js`'s `RECIPES` object only holds the `id`/`description` per report; the actual ID is looked up from settings at fetch time. Don't reintroduce a hardcoded ID here, even as a "default" - it would leak whichever troop's ID a contributor tests with into a public repo.

**Download trigger:** `page.goto(url)` throws "Download is starting" - this is expected and must be caught silently. The download event listener must be set up before the navigation.

---

## Report Architecture

Each report module exports:

```js
module.exports = {
  manifest: {
    id: "string",
    name: "string",
    description: "string",
    icon: "emoji",
    outputType: "html" | undefined,   // undefined = file download, "html" = open in new tab
    inputs: [
      {
        key: "string",
        label: "string",
        hint: "string",
        required: true|false,
        twhReport: "roster"|"requirements"|"meritBadges"|null,  // null = manual upload only
      }
    ],
    options: [   // optional - non-file inputs rendered above generate button
      {
        key: "string",
        label: "string",
        type: "text"|"radio"|"checkbox",
        placeholder: "string",     // for text
        choices: [{value, label}], // for radio
        default: value,
        required: true|false,
      }
    ]
  },
  generate: async (inputs, outputDir, options) => ({
    // For file output:
    filePath: "/absolute/path/to/file",
    fileName: "filename.ext",
    stats: { key: value },   // shown in UI after generation
    // For outputType: "html":
    htmlPath, htmlFileName,
    pdfPath, pdfFileName,    // optional
    csvPath, csvFileName,    // optional
  })
};
```

`options.troopName` is auto-injected by `server.js` from settings before `generate()` is called, unless already provided. Reports should fall back to a generic label (e.g. "BSA Troop") if it's empty, never a specific real troop name.

The server auto-discovers all `.js` files in `reports/`. Adding a new report = drop a file there and restart.

---

## Key Data Notes

### TroopWebHost Roster CSV

- Field `FIrst Name` has a typo (capital I) - this is how TWH exports it
- Dates are in `MM/DD/YY` format (2-digit year) - `parseDate()` handles this
- Adults: `Adult === "Y"`, Youth: `Adult === "N"`
- Inactive scouts are in patrols starting with `zinactive` - filter these out
- Alumni have empty `Patrol` field - filter these out
- `BSA ID` field matches `..memberid` in my.scouting exports

### my.scouting Roster CSV

- Has a 10-line header block before the actual data (district, council, org name, etc.)
- Troop name can be extracted from line matching `Organization Name: Troop 0123...`
- Field `..memberid` has leading dots due to the comment marker format
- `firstname` field contains legal first name + middle name combined (e.g. "Jiann Molly") - strip after first word for name comparison
- Youth are `positionname === "Youth Member"`, adults have various role names
- Rank names differ from TWH: "Eagle Scout" vs "Eagle", "Star Scout" vs "Star", etc.
- Palm ranks (Gold/Silver/Bronze Palm) should be treated as equivalent to Eagle

### Name Normalization

`normalizeName()` in `shared/name-normalize.js` strips middle initials and suffixes because the roster CSV has them but the requirements CSV doesn't. This was critical - without it, 17% of scouts were silently dropped from the advancement report.

---

## Color Palette (All Reports and UI Use These)

```
--od-green:       #3A4F2A   (primary green)
--od-green-dark:  #2A3A1F   (dark headers)
--od-green-light: #5C7A47   (hover states)
--tan:            #C7A975   (accent / stripe)
--tan-light:      #E8DCC0   (subtitle text)
--cub-blue:       #003F87   (secondary action)
--bg-page:        #FAF7F0   (warm cream background)
--text-dark:      #1C2340
--text-mid:       #4A5568
--text-light:     #FFFFFF
--border:         #D7CDB5
--row-alt:        #F0EBDC   (alternating table rows)
```

Rank colors (used in both PPTX and HTML):
- Scout: `#2E7D32`
- Tenderfoot: `#E65100`
- Second Class: `#1565C0`
- First Class: `#6A1B9A`
- Star: `#C0392B`
- Life: `#B8860B`
- Eagle: `#0B3D6B`

The app icon (`assets/icon.svg`) uses the same OD green/tan palette.

---

## UI Behavior

- **First-run setup wizard** (`setupComplete: false` in settings) walks new users through troop name, TWH subdomain, and Menu_Item_IDs (roster + requirements required, merit badges optional) before showing the dashboard.
- **Settings modal** lets users revisit all of the above anytime.
- **Cards are collapsed by default** - click header to expand; accordion behavior (one open at a time)
- **Login persists the subdomain** in `localStorage` - shown read-only with a "Change" link
- **Remember Me** stores username + password in `localStorage` (user-opted-in, with warning)
- **Fetch & Generate** auto-downloads CSVs from TWH and streams the result to the browser's download dialog
- **Partial fetch** (reconciliation): fetches what it can from TWH, prompts for manual upload of the rest
- **HTML output type** (merit-badges, patrol-balance, audit, reconciliation): server returns JSON with a `/view/` URL; frontend opens it in a new tab
- **Session timeout**: 30 minutes of inactivity closes the Playwright browser; user must log in again

---

## Things to Never Do

- **No em dashes** anywhere in user-facing text (UI, report output, README, release notes). Use plain hyphens instead.
- **No tar.gz** for packaging - always use `.zip` (npm distribution) or the Inno Setup `.exe` / `.dmg` (installer distribution)
- **No generated files** (PPTX, PDF, CSV, VCF, HTML) in the project directory or committed to git. `dist/` is gitignored; installer binaries are distributed via GitHub Releases only, never committed to the repo tree.
- **Credentials never written to disk** - TWH login credentials live in memory only
- **Don't break the manual upload fallback** - every report must work without TWH auto-fetch
- **No real troop-identifying data in source or docs** - no live Menu_Item_IDs, real troop numbers/names, or subdomains as "defaults" or example values. The repo is public; use generic placeholders like "Troop 123 Anytown".
- **No implied BSA affiliation** - this is an independent tool, not published or endorsed by BSA. Keep BSA references limited to actual domain terminology.

---

## Reports Summary

| Report | Manifest id | Output | TWH Auto-Fetch | Manual Input |
|---|---|---|---|---|
| Advancement Report | `advancement` | PPTX | Roster + Requirements | Both CSVs |
| Troop Health Report | `health` | PPTX | Roster | Roster CSV |
| Merit Badge Analysis | `merit-badges` | HTML (+ optional PDF/CSV) | Merit Badge History | CSV |
| Patrol Balance | `patrol-balance` | HTML (+ optional PDF/CSV) | Roster | Roster CSV |
| Roster Audit | `roster-audit` | HTML | Roster | Roster CSV |
| Roster Reconciliation | `reconciliation` | HTML (+ optional PDF/CSV) | Roster | my.scouting CSV |
| Troop Contacts Export | `contacts` | CSV or VCF | Roster | Roster CSV |

---

## Packaging & Distribution (Hard-Won Knowledge)

`npm run build:win` / `build:mac` run `scripts/build.js`, which compiles with `@yao-pkg/pkg`, copies `public/` next to the binary, downloads a Playwright Chromium into a `browsers/` folder next to the binary, then wraps it with Inno Setup (Windows) or `hdiutil` (Mac). All of this was built, broken, and fixed for real - these gotchas will bite again if touched carelessly:

- **`pkg` needs `.` + a `"bin"` field, not a direct file path.** `pkg server.js` compiles fine but **silently ignores the entire `"pkg"` config block** in package.json (no `scripts`/`assets` bundling at all, no warning). Only `pkg .` (which requires `"bin"` in package.json) reads that config. package.json has `"bin": "server.js"` for exactly this reason - don't remove it.
- **`playwright-core`'s `browsers.json` doesn't get auto-bundled.** It's required via a path pkg's static analysis can't follow. It's explicitly listed in `pkg.scripts` in package.json. If Playwright ever throws `Cannot find module '...browsers.json'` from a packaged build, this is why.
- **pkg's V8 snapshot breaks Node's lazy `globalThis.crypto` getter** on Node 18, throwing `TypeError: Invalid host defined options` the moment `playwright-core` loads. `server.js` shims it with `Object.defineProperty(globalThis, "crypto", ...)` before any playwright-touching code runs, gated on `process.pkg`. Don't remove this without re-testing a packaged build.
- **Inno Setup's `PrivilegesRequired`** is `lowest` (not `admin`) - this app installs per-user to avoid a UAC prompt, matching where `settings.js` writes (`%APPDATA%`/`~/Library/Application Support`, not a machine-wide location). The desktop shortcut uses `{autodesktop}` (not `{commondesktop}`) so it adapts correctly.
- **App icon**: `assets/icon.ico`/`icon.icns` are generated from `assets/icon.svg` (ImageMagick: `magick -background none icon.svg -resize 1024x1024 icon-1024.png`, then `-define icon:auto-resize=...` for the `.ico` and a direct `magick icon-1024.png icon.icns` for the `.icns`). Wired in via `SetupIconFile=` in the generated `.iss` and `CFBundleIconFile` in `Info.plist`.
- **On Windows, run silent installers via PowerShell `Start-Process`, not Git Bash.** Git Bash's MSYS path conversion mangles leading-slash flags like `/VERYSILENT` into `C:/Program Files/Git/VERYSILENT`, which makes Inno Setup launch in full interactive mode instead of silently.
- **Distribution is via GitHub Releases, not the git tree.** The installer binary (~230 MB) is uploaded as a release asset (`gh release create`/`gh release upload --clobber`), tagged to match the version in `package.json`. `dist/` stays gitignored. When re-releasing under the same version tag after a fix, move the tag (`git tag -f vX.Y.Z <commit> && git push origin vX.Y.Z --force`) and re-upload with `--clobber` so the release stays consistent with what it's tagged at.
- **Verifying a build actually works** means: build it, install it silently on this machine (`Start-Process installer.exe -ArgumentList "/VERYSILENT","/SUPPRESSMSGBOXES" -Wait`), launch the *installed* binary (not the `dist/` output directly), and confirm it serves the dashboard, reads settings from the real OS user-data path (not the dev project dir), and that Playwright's bundled Chromium actually launches. All of these have broken independently before.

---

## Known Issues / Future Work

- **TWH automation fragility** - if TWH changes their HTML structure, `twh/login.js` selectors may need updating. Diagnostic capture (screenshot + form-elements.json) is built in and triggers automatically on failure.
- **macOS build is unverified** - the pipeline exists (`build:mac`) but has never actually been run/tested on a Mac. Treat it as best-effort until someone does.
- **No code signing** - both the Windows installer and macOS app are unsigned (cost isn't justified for a small hobby project yet). Windows shows a SmartScreen warning; Mac requires right-click → Open. Documented in the README.
- **No CI, no automated tests** - deliberate for now, given the small scope and single maintainer. Revisit if regressions start recurring.

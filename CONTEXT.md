# Troop Tools — Project Context

This document provides context for AI coding assistants (Claude Code, etc.) working on this project. Read this before making any changes.

---

## What This Is

A local Node.js web application for BSA Scoutmasters. It automates report generation from TroopWebHost (TWH) CSV exports and my.scouting.org data.

The app runs on `localhost:3000`. The user opens it in a browser, logs in with TroopWebHost credentials, and generates reports with one click. Files are delivered through the browser's normal download mechanism.

---

## Tech Stack

- **Runtime:** Node.js 18+, Windows primary (Mac supported)
- **Server:** Express 4
- **File uploads:** Multer
- **Browser automation:** Playwright (Chromium) — used both for TroopWebHost login/download automation and PDF generation
- **PPTX generation:** pptxgenjs
- **Frontend:** Vanilla HTML/CSS/JS — no framework
- **Unique IDs:** uuid

---

## Project Structure

```
troop-tools/
├── server.js                  Express server — routes, auth, file serving
├── package.json               Dependencies + postinstall (auto-downloads Chromium)
├── scripts/
│   └── install-browser.js     Resilient Chromium installer (doesn't fail npm install)
├── public/
│   ├── index.html             Login view + dashboard
│   ├── style.css              Scout-themed: OD green / tan / cub blue
│   └── app.js                 Frontend: login, session state, card rendering
├── reports/                   One file per report — drop a new file here to add a report
│   ├── advancement.js         Patrol advancement PPTX
│   ├── health.js              Quarterly committee health PPTX
│   ├── contacts.js            Leader contacts export (Google CSV or VCF)
│   └── reconciliation.js      my.scouting vs TroopWebHost comparison (HTML + optional PDF/CSV)
├── shared/
│   ├── csv-parser.js          Handles quoted fields, BOM, CRLF
│   ├── name-normalize.js      normalizeName(), formatDisplayName()
│   └── dates.js               parseDate() handles both 2-digit and 4-digit years
└── twh/
    ├── session.js             Singleton Playwright browser, 30-min inactivity timeout
    ├── login.js               TWH login — handles frameset redirect + popup modal
    └── downloads.js           Direct URL navigation to download CSVs
```

---

## TroopWebHost Architecture (Hard-Won Knowledge)

TWH is an ASP.NET site with unusual structure. Key facts:

- **Frameset:** The root URL loads a `<frameset>` containing `Redirect.htm`, which runs JavaScript to detect screen width, then loads the real page. Playwright must wait for this redirect chain to complete.
- **Login:** A "Log On" link in the top-right opens a popup modal with fields `name="User_Login"` and `name="User_Password"`. The submit button is `type="button"` (not `type="submit"`) with `name="login"`.
- **Menu:** Behind a hamburger button (`href="javascript:togglemenu();"`). Categories use `toggleLower('mNN')` to expand — they don't navigate.
- **Downloads:** Reports are downloaded by navigating directly to URLs of the form `https://www.troopwebhost.org/FormReport.aspx?Menu_Item_ID=XXXXX&Stack=1&ReportFormat=XLS`. These URLs are troop-specific (Menu_Item_IDs may vary by troop).

Menu_Item_IDs are unit-specific. They're no longer hardcoded in the
codebase; each troop configures its own via the Settings UI (see
`settings.js`), which stores them as `menuItemIds.roster`,
`menuItemIds.requirements`, and `menuItemIds.meritBadges`.

**Download trigger:** `page.goto(url)` throws "Download is starting" — this is expected and must be caught silently. The download event listener must be set up before the navigation.

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
        twhReport: "roster"|"requirements"|null,  // null = manual upload only
      }
    ],
    options: [   // optional — non-file inputs rendered above generate button
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

The server auto-discovers all `.js` files in `reports/`. Adding a new report = drop a file there and restart.

---

## Key Data Notes

### TroopWebHost Roster CSV

- Field `FIrst Name` has a typo (capital I) — this is how TWH exports it
- Dates are in `MM/DD/YY` format (2-digit year) — `parseDate()` handles this
- Adults: `Adult === "Y"`, Youth: `Adult === "N"`
- Inactive scouts are in patrols starting with `zinactive` — filter these out
- Alumni have empty `Patrol` field — filter these out
- `BSA ID` field matches `..memberid` in my.scouting exports

### my.scouting Roster CSV

- Has a 10-line header block before the actual data (district, council, org name, etc.)
- Troop name can be extracted from line matching `Organization Name: Troop 0123...`
- Field `..memberid` has leading dots due to the comment marker format
- `firstname` field contains legal first name + middle name combined (e.g. "Jiann Molly") — strip after first word for name comparison
- Youth are `positionname === "Youth Member"`, adults have various role names
- Rank names differ from TWH: "Eagle Scout" vs "Eagle", "Star Scout" vs "Star", etc.
- Palm ranks (Gold/Silver/Bronze Palm) should be treated as equivalent to Eagle

### Name Normalization

`normalizeName()` in `shared/name-normalize.js` strips middle initials and suffixes because the roster CSV has them but the requirements CSV doesn't. This was critical — without it, 17% of scouts were silently dropped from the advancement report.

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

---

## UI Behavior

- **Cards are collapsed by default** — click header to expand; accordion behavior (one open at a time)
- **Login persists the subdomain** in `localStorage` — shown read-only with a "Change" link
- **Remember Me** stores username + password in `localStorage` (user-opted-in, with warning)
- **Fetch & Generate** auto-downloads CSVs from TWH and streams the result to the browser's download dialog
- **Partial fetch** (reconciliation): fetches what it can from TWH, prompts for manual upload of the rest
- **HTML output type** (reconciliation): server returns JSON with a `/view/` URL; frontend opens it in a new tab
- **Session timeout**: 30 minutes of inactivity closes the Playwright browser; user must log in again

---

## Things to Never Do

- **No em dashes** anywhere in user-facing text. Use plain hyphens instead.
- **No tar.gz** for packaging — always use `.zip`
- **No generated files** (PPTX, PDF, CSV, VCF, HTML) in the project directory or zip archive
- **Credentials never written to disk** — TWH login credentials live in memory only
- **Don't break the manual upload fallback** — every report must work without TWH auto-fetch

---

## Reports Summary

| Report | Output | TWH Auto-Fetch | Manual Input |
|---|---|---|---|
| Advancement Report | PPTX | Roster + Requirements | Both CSVs |
| Troop Health Report | PPTX | Roster | Roster CSV |
| Troop Contacts Export | CSV or VCF | Roster | Roster CSV |
| Roster Reconciliation | HTML (+ optional PDF/CSV) | Roster | my.scouting CSV |

---

## Known Issues / Future Work

- **Menu_Item_IDs** for TWH downloads may be troop-specific. If sharing with other troops, these should be made configurable (currently hardcoded in `twh/downloads.js`).
- **Bundled installer** (.exe for Windows, .app for Mac) planned for non-technical users — deferred until feature development stabilizes.
- **TWH automation fragility** — if TWH changes their HTML structure, `twh/login.js` selectors may need updating. Diagnostic capture (screenshot + form-elements.json) is built in and triggers automatically on failure.

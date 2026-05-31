# Troop Tools

A local web app for Scoutmasters to generate PowerPoint reports from TroopWebHost CSV exports.

Currently supports:

- **Advancement Report** — Patrol-level breakdown of uncompleted rank requirements (Scout through First Class) with the highest-impact items prioritized for activity planning
- **Troop Health Report** — Quarterly committee-meeting deck with membership demographics, rank distribution, recent advancements, Eagle pipeline, and follow-up items

## Setup (one-time)

You need Node.js 18 or newer. Download the LTS version from [nodejs.org](https://nodejs.org):

- **Windows:** Download the **Windows Installer (.msi)** and run it with default options.
- **Mac:** Download the **macOS Installer (.pkg)**, or `brew install node` if you use Homebrew.

After Node finishes installing, open a terminal and navigate to the folder where you extracted Troop Tools.

**Windows** (use Command Prompt or PowerShell — both work):
```
cd %USERPROFILE%\Documents\troop-tools
```

**Mac** (use Terminal):
```
cd ~/Documents/troop-tools
```

Then run this one command (same on both platforms):

```
npm install
```

This downloads the libraries the app needs and a copy of Chromium (~150 MB) used to log into TroopWebHost on your behalf. The whole process takes 1–2 minutes. You only do this once.

## Running the app

From the same folder, run:

```
npm start
```

You'll see a message like:

```
TROOP TOOLS — Running on port 3000
Open in browser: http://localhost:3000
Output folder:   C:\Users\your-name\Downloads      (Windows)
                 /Users/your-name/Downloads        (Mac)
```

Open that link in your browser. To stop the app, click in the terminal window and press `Ctrl+C`.

## Two ways to use it

### 1. Sign in (recommended)

Sign in with your TroopWebHost credentials. The app uses them once to log into your TroopWebHost site in a hidden browser, then automatically downloads the CSVs each report needs.

- Your credentials stay on this computer. They live in memory only — they're not written to disk, and they're cleared when you log out or restart the app.
- After 30 minutes of inactivity the session expires automatically and you sign in again.

When you sign in, each report card shows a single "Fetch & Generate" button. Click it and your browser's normal download dialog will appear with the PPTX file — save it wherever you like.

### 2. Manual upload (fallback)

You can also skip the login and just drop in CSVs yourself. Export the right reports from TroopWebHost manually, drop them into the appropriate slots on each card, and click Generate.

Useful when:
- You don't want to put your TroopWebHost password into the tool
- TroopWebHost is down or the automation breaks
- You want to test changes against a saved snapshot

## How to add a new report

Drop a new file in the `reports/` folder that exports two things:

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

async function generate(inputs, outputDir) {
  // inputs.roster will be the path to the CSV (uploaded or fetched)
  // Generate your PPTX here, save to outputDir
  return {
    filePath: "/path/to/output.pptx",
    fileName: "output.pptx",
    stats: { scoutsAnalyzed: 105 },  // optional - shown in UI after generation
  };
}

module.exports = { manifest, generate };
```

If `twhReport` matches a recipe in `twh/downloads.js`, the report becomes available as a one-click "Fetch & Generate". If you omit it, the report still works via manual upload.

Currently available TroopWebHost recipes:
- `"roster"` — Membership → Export Membership Data → Export Roster to Excel
- `"requirements"` — Reports → Uncompleted Rank Requirements by Requirement

To add a new TroopWebHost recipe, edit the `RECIPES` object in `twh/downloads.js`.

## File locations

- `public/` — HTML, CSS, and JS for the dashboard UI
- `reports/` — One file per report, each self-contained
- `shared/` — Utilities used by multiple reports (CSV parser, name normalization, dates)
- `twh/` — TroopWebHost automation (Playwright login + download)
- `server.js` — Express server that ties it all together

## Privacy

- CSVs are processed locally and deleted after each report runs.
- Credentials are held in memory only while you're signed in.
- Nothing about your troop, your scouts, or your credentials ever leaves your computer. All HTTP traffic is between your browser and your local server. The only external service this tool ever talks to is TroopWebHost itself, using the same login flow you'd do manually in a browser.

## Troubleshooting

**Login fails with "Executable doesn't exist..."**
The Chromium browser download didn't complete during install (usually a network or firewall issue). To finish it, run `npx playwright install chromium` from the troop-tools folder.

**The browser shows "This site can't be reached" when I open http://localhost:3000**
The server isn't running. Go back to your terminal and run `npm start` again.

**Login fails with "Couldn't find the username field"**
The TroopWebHost site path may be wrong. Make sure you entered just the path segment (e.g. `Troop123YourCity`) and not the full URL.

**Login fails with "TroopWebHost login failed: invalid username or password"**
The credentials weren't accepted by TroopWebHost. Verify them by signing into TroopWebHost manually in your browser.

**"Couldn't click menu item" during fetch**
TroopWebHost's menu structure may have changed, or your account may not have permissions for that report. Try the **manual upload** path as a workaround, then let the developer know.

**Port 3000 is already in use**
Another app is using that port. Either stop the other app, or change the `PORT` constant in `server.js`.

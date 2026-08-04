/**
 * Troop Tools - Local Web Server
 *
 * Serves the dashboard and provides endpoints for each report.
 * Reports are auto-discovered from the ./reports/ folder.
 *
 * Generated PPTX files are streamed back to the browser as downloads
 * rather than saved silently to disk — the browser handles the save
 * dialog just like any other file download.
 */

// Must run before playwright loads
if (process.pkg) {
  const path = require("path");
  const resourceDir = process.platform === "darwin"
    ? path.join(path.dirname(process.execPath), "..", "Resources")
    : path.dirname(process.execPath);
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(resourceDir, "browsers");

  // pkg's V8 snapshot breaks the lazy globalThis.crypto getter Node installs at
  // bootstrap ("TypeError: Invalid host defined options") — playwright-core touches
  // it as soon as it loads, so replace it with a plain reference before that happens.
  Object.defineProperty(globalThis, "crypto", {
    value: require("node:crypto").webcrypto,
    configurable: true,
    writable: true,
  });
}

const express = require("express");
const multer  = require("multer");
const fs      = require("fs");
const path    = require("path");
const os      = require("os");
const net     = require("net");
const readline = require("readline");
const { exec } = require("child_process");

const twhSession = require("./twh/session");
const { login: twhLogin } = require("./twh/login");
const { downloadReport: twhDownload } = require("./twh/downloads");
const settings   = require("./settings");
const { version: APP_VERSION } = require("./package.json");

const PORT = 3000; // starting port — auto-increments if in use
const app = express();

// ═══════════════════════════════ AUTO-DISCOVERY ════════════════════════
const REPORTS_DIR = path.join(__dirname, "reports");
const reports = {};

fs.readdirSync(REPORTS_DIR)
  .filter(f => f.endsWith(".js"))
  .forEach(f => {
    const mod = require(path.join(REPORTS_DIR, f));
    if (!mod.manifest || !mod.generate) {
      console.warn(`⚠ Skipping ${f} - missing manifest or generate()`);
      return;
    }
    reports[mod.manifest.id] = mod;
    console.log(`✓ Loaded report: ${mod.manifest.id} (${mod.manifest.name})`);
  });

// ═══════════════════════════════ FILE LOCATIONS ════════════════════════
const TEMP_DIR   = path.join(os.tmpdir(), "troop-tools-uploads");
const OUTPUT_DIR = path.join(os.tmpdir(), "troop-tools-output");
[TEMP_DIR, OUTPUT_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

const upload = multer({
  dest: TEMP_DIR,
  limits: { fileSize: 20 * 1024 * 1024 },
});

// ═══════════════════════════════ MIDDLEWARE ════════════════════════════
const PUBLIC_DIR = process.pkg
  ? path.join(
      process.platform === "darwin"
        ? path.join(path.dirname(process.execPath), "..", "Resources")
        : path.dirname(process.execPath),
      "public"
    )
  : path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR));
app.use(express.json());

// ─── Serve generated HTML reports in new tab ─────────────────────────
// Files are served from OUTPUT_DIR under /view/:filename
app.get("/view/:filename", (req, res) => {
  const filePath = path.join(OUTPUT_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).send("Report not found.");
  res.sendFile(filePath);
});

// ─── Download a generated file by name (PDF, CSV) ────────────────────
app.get("/download/:filename", (req, res) => {
  const filePath = path.join(OUTPUT_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).send("File not found.");
  res.download(filePath, req.params.filename);
});

// ═══════════════════════════════ SHARED SEND HELPER ═══════════════════
async function generateAndStream(report, inputs, res, options = {}) {
  // Inject troopName from settings so every report can use it
  if (!options.troopName) options = { troopName: settings.load().troopName || "", ...options };
  const result = await report.generate(inputs, OUTPUT_DIR, options);

  // HTML output type: return JSON with URLs instead of streaming a file
  if (report.manifest.outputType === "html") {
    console.log(`✓ Generated HTML: ${result.htmlFileName}`);
    const response = {
      success: true,
      outputType: "html",
      htmlUrl: `/view/${result.htmlFileName}`,
      stats: result.stats || {},
      downloads: [],
    };
    if (result.pdfFileName) {
      response.downloads.push({ label: "Download PDF", url: `/download/${result.pdfFileName}` });
    }
    if (result.csvFileName) {
      response.downloads.push({ label: "Download CSV", url: `/download/${result.csvFileName}` });
    }
    return res.json(response);
  }

  // Default: stream file to browser as a download
  console.log(`✓ Generated: ${result.fileName}`);
  const ext = path.extname(result.fileName).toLowerCase();
  const contentType = {
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".csv":  "text/csv",
    ".vcf":  "text/vcard",
  }[ext] || "application/octet-stream";

  res.setHeader("Content-Type", contentType);
  res.setHeader("X-Report-Stats", JSON.stringify(result.stats || {}));

  res.download(result.filePath, result.fileName, err => {
    try { fs.unlinkSync(result.filePath); } catch {}
    if (err && !res.headersSent) {
      res.status(500).json({ error: "Failed to stream file to browser" });
    }
  });
}

// ═══════════════════════════════ VERSION ════════════════════════════════
app.get("/api/version", (req, res) => {
  res.json({ version: APP_VERSION });
});

// ═══════════════════════════════ SETTINGS ══════════════════════════════
app.get("/api/settings", (req, res) => {
  res.json(settings.load());
});

app.post("/api/settings", (req, res) => {
  try {
    const updated = settings.save(req.body || {});
    res.json({ success: true, settings: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════ REPORT LISTING ════════════════════════
app.get("/api/reports", (req, res) => {
  const list = Object.values(reports).map(r => {
    const m = r.manifest;
    return {
      id: m.id,
      name: m.name,
      description: m.description,
      icon: m.icon,
      inputs: m.inputs.map(i => ({
        key: i.key,
        label: i.label,
        hint: i.hint,
        required: i.required,
        autoFetch: !!i.twhReport,
      })),
      options: (m.options || []).map(o => ({
        key: o.key,
        label: o.label,
        type: o.type,
        placeholder: o.placeholder,
        required: o.required,
        default: o.default,
        choices: o.choices,
      })),
      canAutoFetch: m.inputs.filter(i => i.required).every(i => !!i.twhReport),
      canPartialFetch: m.inputs.some(i => i.required && !!i.twhReport) &&
                       m.inputs.some(i => i.required && !i.twhReport),
    };
  });
  res.json(list);
});

// ═══════════════════════════════ AUTH ENDPOINTS ════════════════════════
app.get("/api/auth/status", (req, res) => {
  res.json(twhSession.status());
});

app.post("/api/auth/login", async (req, res) => {
  const { subdomain, username, password } = req.body || {};
  if (!subdomain || !username || !password) {
    return res.status(400).json({ error: "subdomain, username, and password are required" });
  }

  try {
    console.log(`▶ Logging in to TroopWebHost (${subdomain}) as ${username}...`);
    await twhSession.start();
    await twhLogin(twhSession.page, subdomain, username, password);
    twhSession.subdomain = subdomain;
    twhSession.loggedInUser = username;
    twhSession.touch();
    console.log(`✓ Logged in as ${username}`);
    res.json({ success: true, status: twhSession.status() });
  } catch (err) {
    console.error("✗ Login failed:", err.message);
    try { await twhSession.close(); } catch {}
    res.status(401).json({ error: err.message });
  }
});

app.post("/api/auth/logout", async (req, res) => {
  console.log("▶ Logging out, closing browser...");
  try {
    await twhSession.close();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════ AUTO-FETCH + GENERATE ═════════════════
// Handles both full auto-fetch (all inputs from TWH) and partial fetch
// (some from TWH, others uploaded as files in the same multipart request).
app.post("/api/reports/:id/fetch-and-generate", (req, res) => {
  const report = reports[req.params.id];
  if (!report) return res.status(404).json({ error: "Unknown report" });

  if (!twhSession.isActive()) {
    return res.status(401).json({ error: "Not logged in to TroopWebHost", needsLogin: true });
  }

  // Accept any manual-upload fields alongside the fetch
  const manualFields = report.manifest.inputs
    .filter(i => !i.twhReport)
    .map(i => ({ name: i.key, maxCount: 1 }));

  upload.fields(manualFields)(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });

    // Options come in the body (may be JSON string if multipart)
    let options = {};
    try {
      options = req.body.options
        ? (typeof req.body.options === "string" ? JSON.parse(req.body.options) : req.body.options)
        : {};
    } catch {}

    // Validate required options
    if (report.manifest.options) {
      for (const opt of report.manifest.options) {
        if (opt.required && !options[opt.key]) {
          return res.status(400).json({ error: `"${opt.label}" is required` });
        }
      }
    }

    const fetchedFiles = [];
    const tempFilesToCleanup = [];

    try {
      const inputs = {};

      for (const inputSpec of report.manifest.inputs) {
        if (inputSpec.twhReport) {
          // Fetch this one from TroopWebHost
          console.log(`▶ Fetching ${inputSpec.twhReport} from TroopWebHost...`);
          const csvPath = await twhDownload(twhSession.page, inputSpec.twhReport);
          inputs[inputSpec.key] = csvPath;
          fetchedFiles.push(csvPath);
          twhSession.touch();
        } else {
          // Expect this one as an uploaded file
          const fileArr = req.files && req.files[inputSpec.key];
          if (inputSpec.required && (!fileArr || fileArr.length === 0)) {
            return res.status(400).json({ error: `Missing required file: ${inputSpec.label}` });
          }
          if (fileArr && fileArr.length > 0) {
            inputs[inputSpec.key] = fileArr[0].path;
            tempFilesToCleanup.push(fileArr[0].path);
          }
        }
      }

      console.log(`▶ Generating ${report.manifest.id}...`);
      await generateAndStream(report, inputs, res, options);
    } catch (err) {
      console.error("✗ Auto-fetch failed:", err.message);
      const needsLogin = /not logged in|session/i.test(err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message, needsLogin });
      }
    } finally {
      fetchedFiles.forEach(p => { try { fs.unlinkSync(p); } catch {} });
      tempFilesToCleanup.forEach(p => { try { fs.unlinkSync(p); } catch {} });
    }
  });
});

// ═══════════════════════════════ MANUAL UPLOAD + GENERATE ══════════════
app.post("/api/reports/:id/generate", (req, res) => {
  const report = reports[req.params.id];
  if (!report) return res.status(404).json({ error: "Unknown report" });

  const fields = report.manifest.inputs.map(input => ({
    name: input.key, maxCount: 1,
  }));

  upload.fields(fields)(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });

    const tempFilesToCleanup = [];
    try {
      const inputs = {};

      // Extract non-file option fields from FormData
      const options = {};
      if (report.manifest.options) {
        for (const opt of report.manifest.options) {
          if (req.body && req.body[opt.key] !== undefined) {
            options[opt.key] = req.body[opt.key];
          }
          if (opt.required && !options[opt.key]) {
            return res.status(400).json({ error: `"${opt.label}" is required` });
          }
        }
      }
      for (const input of report.manifest.inputs) {
        const fileArr = req.files && req.files[input.key];
        if (input.required && (!fileArr || fileArr.length === 0)) {
          return res.status(400).json({ error: `Missing required file: ${input.label}` });
        }
        if (fileArr && fileArr.length > 0) {
          inputs[input.key] = fileArr[0].path;
          tempFilesToCleanup.push(fileArr[0].path);
        }
      }

      console.log(`▶ Generating ${report.manifest.id} (manual upload)...`);
      await generateAndStream(report, inputs, res, options);
    } catch (err) {
      console.error("✗ Generation failed:", err);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    } finally {
      tempFilesToCleanup.forEach(p => { try { fs.unlinkSync(p); } catch {} });
    }
  });
});

// ═══════════════════════════════ GRACEFUL SHUTDOWN ═════════════════════
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\n⏹  Shutting down...");
  try { await twhSession.close(); } catch {}
  process.exit(0);
}

process.on("SIGINT", shutdown);

// The packaged app's console window has no buttons - closing it with the X
// skips Node's cleanup entirely, so give users an explicit, graceful way to
// stop the server and close the background browser session.
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", line => {
  const cmd = line.trim().toLowerCase();
  if (cmd === "q" || cmd === "quit" || cmd === "exit") shutdown();
});

// ═══════════════════════════════ START ════════════════════════════════
function findAvailablePort(start) {
  return new Promise(resolve => {
    const srv = net.createServer();
    srv.listen(start, "127.0.0.1", () => { srv.close(() => resolve(start)); });
    srv.on("error", () => resolve(findAvailablePort(start + 1)));
  });
}

function openBrowser(url) {
  const cmd = process.platform === "win32"  ? `start "" "${url}"` :
              process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, err => { if (err) console.warn("Could not auto-open browser:", err.message); });
}

findAvailablePort(PORT).then(port => {
  app.listen(port, "127.0.0.1", () => {
    const url = `http://localhost:${port}`;
    console.log("");
    console.log("════════════════════════════════════════════");
    console.log(`  TROOP TOOLS - Running on port ${port}`);
    console.log(`  Open in browser:  ${url}`);
    console.log("");
    console.log("  Type Q and press Enter to stop Troop Tools");
    console.log("  (or press Ctrl+C)");
    console.log("════════════════════════════════════════════");
    openBrowser(url);
  });
});

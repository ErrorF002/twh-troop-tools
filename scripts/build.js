#!/usr/bin/env node
/**
 * Build script — produces a platform installer from the source tree.
 *
 * Usage:
 *   node scripts/build.js          # auto-detects host platform
 *   node scripts/build.js --win    # force Windows target
 *   node scripts/build.js --mac    # force macOS target
 *
 * Windows output : dist/win/TroopTools-Setup-vX.X.X.exe
 *   Requires Inno Setup 6 — https://jrsoftware.org/isdl.php
 *
 * macOS output   : dist/mac/TroopTools-vX.X.X.dmg
 *   Must be run on a Mac (hdiutil is macOS-only).
 *   Note: the app is unsigned — users right-click → Open on first launch.
 *
 * Both builds require Playwright Chromium to be downloadable (~150 MB).
 */

"use strict";
const { execSync } = require("child_process");
const fs           = require("fs");
const os           = require("os");
const path         = require("path");

const ROOT    = path.resolve(__dirname, "..");
const PKG     = require(path.join(ROOT, "package.json"));
const VERSION = PKG.version;
const ARGS    = process.argv.slice(2);

const platform = ARGS.includes("--mac") ? "mac"
  : ARGS.includes("--win")              ? "win"
  : process.platform === "darwin"       ? "mac" : "win";

const OUT       = path.join(ROOT, "dist", platform);
const ICONS_DIR = path.join(ROOT, "assets");

console.log(`\n${"=".repeat(60)}`);
console.log(`  Building Troop Tools v${VERSION} — target: ${platform}`);
console.log(`${"=".repeat(60)}\n`);

// ── Clean output dir ─────────────────────────────────────────────
if (fs.existsSync(OUT)) fs.rmSync(OUT, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

// ── Step 1: Compile with pkg ─────────────────────────────────────
const pkgTarget = platform === "win" ? "node18-win-x64" : "node18-macos-x64";
const binName   = platform === "win" ? "troop-tools.exe" : "troop-tools";
const binOut    = path.join(OUT, binName);

step("Compiling with pkg...");
run(`npx @yao-pkg/pkg . --target ${pkgTarget} --output "${binOut}"`, ROOT);
ok(`Binary: ${binOut}`);

// ── Step 2: Copy public/ alongside the binary ────────────────────
// express.static() reads from the real filesystem; public/ ships outside the snapshot.
const publicDest = platform === "mac"
  ? path.join(OUT, "TroopTools.app", "Contents", "Resources", "public")
  : path.join(OUT, "public");

step("Copying public/...");
copyDir(path.join(ROOT, "public"), publicDest);
ok("Copied public/");

// ── Step 3: Download Playwright Chromium ─────────────────────────
const browsersDir = platform === "mac"
  ? path.join(OUT, "TroopTools.app", "Contents", "Resources", "browsers")
  : path.join(OUT, "browsers");

fs.mkdirSync(browsersDir, { recursive: true });
step("Downloading Playwright Chromium (~150 MB)...");
run("npx playwright install chromium", ROOT, { PLAYWRIGHT_BROWSERS_PATH: browsersDir });
ok("Chromium ready");

// ── Step 4: Platform packaging ───────────────────────────────────
if (platform === "win") {
  buildWindows();
} else {
  buildMac();
}

// ════════════════════════════════════════════════════════════════

function buildWindows() {
  const issPath = path.join(OUT, "setup.iss");
  fs.writeFileSync(issPath, makeISS(), "utf8");

  // Locate ISCC.exe (Inno Setup Compiler)
  const candidates = [
    "C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe",
    "C:\\Program Files\\Inno Setup 6\\ISCC.exe",
    path.join(os.homedir(), "AppData", "Local", "Programs", "Inno Setup 6", "ISCC.exe"),
  ];
  let iscc = candidates.find(p => fs.existsSync(p));
  if (!iscc) {
    try { execSync("ISCC.exe /?", { stdio: "ignore" }); iscc = "ISCC.exe"; } catch {}
  }

  if (!iscc) {
    console.log(`
⚠  Inno Setup 6 not found — skipping installer compilation.
   Download from: https://jrsoftware.org/isdl.php

   Unpackaged build is ready in: ${OUT}
   To compile the installer manually:
     ISCC.exe "${issPath}"
`);
    return;
  }

  step("Building Windows installer...");
  run(`"${iscc}" "${issPath}"`, OUT);
  ok(`Installer: dist/win/TroopTools-Setup-v${VERSION}.exe`);
}

function buildMac() {
  const appDir   = path.join(OUT, "TroopTools.app");
  const macosDir = path.join(appDir, "Contents", "MacOS");
  fs.mkdirSync(macosDir, { recursive: true });

  // Move binary into MacOS/
  const binFinal = path.join(macosDir, "troop-tools");
  fs.renameSync(binOut, binFinal);
  fs.chmodSync(binFinal, 0o755);

  // Info.plist
  fs.writeFileSync(path.join(appDir, "Contents", "Info.plist"), makePlist(), "utf8");

  // App icon
  const resourcesDir = path.join(appDir, "Contents", "Resources");
  fs.mkdirSync(resourcesDir, { recursive: true });
  fs.copyFileSync(path.join(ICONS_DIR, "icon.icns"), path.join(resourcesDir, "icon.icns"));

  // DMG
  const dmgPath = path.join(OUT, `TroopTools-v${VERSION}.dmg`);
  step("Creating DMG...");
  run(`hdiutil create -volname "Troop Tools" -srcfolder "${appDir}" -ov -format UDZO "${dmgPath}"`, OUT);
  ok(`DMG: dist/mac/TroopTools-v${VERSION}.dmg`);

  console.log(`
⚠  The app is unsigned. First-time users must right-click the app → Open
   to bypass Gatekeeper (one-time only). Code signing requires an Apple
   Developer account ($99/yr).
`);
}

// ── ISS template ─────────────────────────────────────────────────
function makeISS() {
  const appDir = OUT.replace(/\//g, "\\");
  return `; Inno Setup 6 script — generated by scripts/build.js
[Setup]
AppName=Troop Tools
AppVersion=${VERSION}
AppPublisher=BSA Troop Tools
DefaultDirName={autopf}\\TroopTools
DefaultGroupName=Troop Tools
OutputDir=${appDir}
OutputBaseFilename=TroopTools-Setup-v${VERSION}
Compression=lzma
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
UninstallDisplayName=Troop Tools
SetupIconFile=${path.join(ICONS_DIR, "icon.ico")}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "${appDir}\\troop-tools.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "${appDir}\\public\\*"; DestDir: "{app}\\public"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "${appDir}\\browsers\\*"; DestDir: "{app}\\browsers"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\\Troop Tools"; Filename: "{app}\\troop-tools.exe"; Comment: "Open Troop Tools in your browser"
Name: "{autodesktop}\\Troop Tools"; Filename: "{app}\\troop-tools.exe"; Comment: "Open Troop Tools in your browser"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop icon"; GroupDescription: "Additional icons:"

[Run]
Filename: "{app}\\troop-tools.exe"; Description: "Launch Troop Tools now"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: files; Name: "{userappdata}\\TroopTools\\settings.json"
`;
}

// ── Info.plist template ───────────────────────────────────────────
function makePlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>troop-tools</string>
  <key>CFBundleIdentifier</key><string>com.bsa.troop-tools</string>
  <key>CFBundleName</key><string>Troop Tools</string>
  <key>CFBundleDisplayName</key><string>Troop Tools</string>
  <key>CFBundleIconFile</key><string>icon.icns</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundleVersion</key><string>${VERSION}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>10.15</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>`;
}

// ── Helpers ───────────────────────────────────────────────────────
function step(msg) { console.log(`▶  ${msg}`); }
function ok(msg)   { console.log(`✓  ${msg}\n`); }

function run(cmd, cwd, extraEnv = {}) {
  execSync(cmd, { cwd, stdio: "inherit", env: { ...process.env, ...extraEnv } });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    entry.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
  }
}

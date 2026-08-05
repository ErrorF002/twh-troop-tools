/**
 * TroopWebHost Login
 *
 * Logs into TroopWebHost using the headless browser session.
 *
 * TroopWebHost sites use a two-stage redirect pattern:
 *   1. Root URL loads a <frameset> containing Redirect.htm
 *   2. Redirect.htm runs JavaScript that detects screen width and
 *      reloads the frame with a real page (Home.aspx?ScreenWidth=N)
 *
 * Once the real page is loaded inside the frame, the "Log On" link
 * appears in the upper-right. Clicking it opens a popup (also a frame
 * or modal) containing the username/password form.
 *
 * Because the actual content lives inside frames rather than the main
 * document, all of our selector queries search across frames.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const TROOPWEBHOST_BASE = "https://www.troopwebhost.org";

/**
 * Build the full URL for a TroopWebHost troop site.
 */
function siteUrl(subdomain) {
  const clean = subdomain.replace(/^\/+|\/+$/g, "");
  return `${TROOPWEBHOST_BASE}/${clean}/`;
}

/**
 * Build the post-redirect Home.aspx URL with a ScreenWidth hint.
 * Used as a fallback if the JavaScript redirect chain stalls.
 */
function homeUrl(subdomain) {
  const clean = subdomain.replace(/^\/+|\/+$/g, "");
  return `${TROOPWEBHOST_BASE}/${clean}/Home.aspx?ScreenWidth=1280`;
}

/**
 * Attempt login. Throws on failure with a descriptive message.
 */
async function login(page, subdomain, username, password) {
  // First: try the natural entry point (root URL → frameset → redirect).
  await page.goto(siteUrl(subdomain), {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  // Wait for the frame chain to complete and the Log On link to appear.
  // If the JavaScript redirect doesn't fire in headless Chromium (it
  // sometimes doesn't), fall back to navigating directly to Home.aspx.
  let ready = await waitForLogOnLink(page, 8000);
  if (!ready) {
    await page.goto(homeUrl(subdomain), {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    ready = await waitForLogOnLink(page, 8000);
  }
  if (!ready) {
    const diagPath = await captureDiagnostics(page, "no-logon-link");
    throw new Error("Couldn't find the Log On link on the TroopWebHost site. " +
      `Diagnostic info saved to: ${diagPath}`);
  }

  // Click the Log On link. This typically opens a modal/popup with the
  // username/password form. The popup may be a new frame, or it may
  // render directly in the existing frame.
  await clickLogOnLink(page);

  // Wait for the login form to appear somewhere in the frame tree.
  const formReady = await waitForLoginForm(page, 8000);
  if (!formReady) {
    const diagPath = await captureDiagnostics(page, "no-login-form");
    throw new Error("Clicked the Log On link but the login form didn't appear. " +
      `Diagnostic info saved to: ${diagPath}`);
  }

  // Find the form fields. Search across all frames.
  // The specific selectors for TroopWebHost come first; generics are
  // fallbacks in case TWH changes naming in future versions.
  const usernameField = await findFirstAnywhere(page, [
    'input[name="User_Login"]',
    'input[id="User_Login"]',
    'input[name="userName"]',
    'input[name="UserName"]',
    'input[name="username"]',
    'input[id*="UserName" i]',
    'input[id*="username" i]',
    'input[type="text"][placeholder*="user" i]',
    'input[type="email"]',
  ]);
  if (!usernameField) {
    const diagPath = await captureDiagnostics(page, "username-not-found");
    throw new Error("Couldn't find the username field after opening the login form. " +
      `Diagnostic info saved to: ${diagPath}`);
  }

  const passwordField = await findFirstAnywhere(page, [
    'input[name="User_Password"]',
    'input[id="User_Password"]',
    'input[name="password"]',
    'input[name="Password"]',
    'input[id*="Password" i]',
    'input[type="password"]',
  ]);
  if (!passwordField) {
    const diagPath = await captureDiagnostics(page, "password-not-found");
    throw new Error("Couldn't find the password field after opening the login form. " +
      `Diagnostic info saved to: ${diagPath}`);
  }

  await usernameField.fill(username);
  await passwordField.fill(password);

  const submitButton = await findFirstAnywhere(page, [
    'input[name="login"]',
    'input[id="login"]',
    'input[type="submit"][value*="Log" i]',
    'input[type="submit"][value*="Sign" i]',
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Log In")',
    'button:has-text("Login")',
    'button:has-text("Log On")',
    'button:has-text("Sign In")',
  ]);
  if (!submitButton) {
    const diagPath = await captureDiagnostics(page, "no-submit-button");
    throw new Error("Couldn't find the login submit button. " +
      `Diagnostic info saved to: ${diagPath}`);
  }

  // Click submit. Don't wait for a specific navigation - TroopWebHost
  // may submit via Ajax, full postback, or popup-close. Just wait until
  // we see logged-in markers.
  await submitButton.click();

  // Poll for logged-in markers rather than a single check after a fixed
  // delay - some troops' sites take noticeably longer than others to
  // reload the post-login frame, and a one-shot check too early produces
  // a false "login failed" even though login actually succeeded.
  const success = await waitForLoggedIn(page, 10000);
  if (!success) {
    const errorMsg = await extractLoginError(page);
    if (errorMsg) {
      throw new Error(`TroopWebHost login failed: ${errorMsg}`);
    }
    const diagPath = await captureDiagnostics(page, "login-rejected");
    throw new Error("Login submitted but the site didn't recognize us as signed in. " +
      `This usually means invalid credentials. Diagnostic info: ${diagPath}`);
  }

  return { url: page.url() };
}

// ═══════════════════════════════ WAIT HELPERS ═══════════════════════════

/**
 * Poll the frame tree until a "Log On" link is visible somewhere,
 * indicating the redirect chain has finished and we're on the real
 * landing page. Returns true on success, false on timeout.
 */
async function waitForLogOnLink(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const logOnSelectors = [
    'a:has-text("Log On")',
    'a:has-text("Log In")',
    'a:has-text("Login")',
    'a:has-text("Sign In")',
  ];
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      for (const sel of logOnSelectors) {
        try {
          if (await frame.locator(sel).count() > 0) return true;
        } catch {}
      }
      // Also check for a password field already on the page (some skins
      // put the form directly on the landing page)
      try {
        if (await frame.locator('input[type="password"]').count() > 0) return true;
      } catch {}
    }
    await page.waitForTimeout(400);
  }
  return false;
}

/**
 * Poll until a username and password field appear together somewhere
 * in the frame tree.
 */
async function waitForLoginForm(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      try {
        const hasPwd = await frame.locator('input[type="password"]').count() > 0;
        if (hasPwd) return true;
      } catch {}
    }
    await page.waitForTimeout(400);
  }
  return false;
}

/**
 * Click the Log On link wherever it lives in the frame tree.
 */
async function clickLogOnLink(page) {
  const selectors = [
    'a:has-text("Log On")',
    'a:has-text("Log In")',
    'a:has-text("Login")',
    'a:has-text("Sign In")',
  ];
  for (const frame of page.frames()) {
    for (const sel of selectors) {
      try {
        const loc = frame.locator(sel).first();
        if (await loc.count() > 0) {
          await loc.click({ timeout: 5000 });
          // Brief pause for the popup to render
          await page.waitForTimeout(750);
          return;
        }
      } catch {}
    }
  }
  // Caller will surface a sensible error if the form never appears.
}

// ═══════════════════════════════ FRAME SEARCH HELPERS ════════════════════

/**
 * Find the first matching element across the main page AND every frame.
 */
async function findFirstAnywhere(page, selectors) {
  for (const frame of page.frames()) {
    for (const sel of selectors) {
      try {
        const loc = frame.locator(sel).first();
        const count = await loc.count();
        if (count === 0) continue;
        // Prefer visible elements, but accept invisible-but-present as a
        // fallback (some forms keep fields hidden until expanded).
        const visible = await loc.isVisible({ timeout: 500 }).catch(() => false);
        if (visible) return loc;
        // remember the first invisible match in case nothing visible is found
        if (!findFirstAnywhere._fallback) findFirstAnywhere._fallback = loc;
      } catch {}
    }
  }
  const fb = findFirstAnywhere._fallback;
  findFirstAnywhere._fallback = null;
  return fb || null;
}

// ═══════════════════════════════ POST-LOGIN VERIFICATION ════════════════

/**
 * Poll until detectLoggedIn(page) returns true, or the timeout elapses.
 */
async function waitForLoggedIn(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await detectLoggedIn(page)) return true;
    await page.waitForTimeout(400);
  }
  return detectLoggedIn(page);
}

async function detectLoggedIn(page) {
  // Require a genuine "Log Off" marker - this is the one signal that's
  // specific to actually being authenticated. Generic nav-text matches
  // (e.g. "Membership", "Calendar") and "no password field left" were both
  // too easy to false-positive on a failed login (wrong password), which
  // left the app reporting a successful connection while every subsequent
  // request silently hit TroopWebHost unauthenticated.
  for (const frame of page.frames()) {
    try {
      const hasLogout = await frame.locator(
        'a[href*="logoff" i], a:has-text("Log Off"), a:has-text("Logout"), a:has-text("Sign Out")'
      ).count() > 0;
      if (hasLogout) return true;
    } catch {}
  }
  return false;
}

async function extractLoginError(page) {
  const candidates = [
    '[id*="error" i]',
    '[class*="error" i]',
    '[class*="alert" i]',
    'span[style*="red" i]',
    '.validation-summary-errors',
  ];
  for (const frame of page.frames()) {
    for (const sel of candidates) {
      try {
        const loc = frame.locator(sel).first();
        if (await loc.count() > 0) {
          const text = (await loc.innerText().catch(() => "")).trim();
          if (text && text.length < 300) return text;
        }
      } catch {}
    }
  }
  return null;
}

// ═══════════════════════════════ DIAGNOSTICS ════════════════════════════

/**
 * Save diagnostic info when login fails: screenshot, page HTML,
 * list of all inputs/buttons across every frame.
 */
async function captureDiagnostics(page, label) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(os.tmpdir(), "troop-tools-diagnostics", `${ts}-${label}`);
  fs.mkdirSync(dir, { recursive: true });

  try {
    await page.screenshot({ path: path.join(dir, "screenshot.png"), fullPage: true });
  } catch {}

  try {
    fs.writeFileSync(path.join(dir, "page.html"), await page.content());
  } catch {}

  try {
    const summary = {
      url: page.url(),
      title: await page.title().catch(() => ""),
      frames: [],
    };
    for (const frame of page.frames()) {
      const fields = await frame.$$eval(
        "input, select, textarea, button, a",
        els => els.map(el => ({
          tag: el.tagName,
          type: el.getAttribute("type"),
          name: el.getAttribute("name"),
          id: el.getAttribute("id"),
          placeholder: el.getAttribute("placeholder"),
          value: el.tagName === "INPUT" && el.getAttribute("type") === "submit"
            ? el.getAttribute("value") : undefined,
          text: ["A", "BUTTON"].includes(el.tagName)
            ? (el.textContent || "").trim().slice(0, 80) : undefined,
          href: el.tagName === "A" ? el.getAttribute("href") : undefined,
          visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
        }))
      ).catch(() => []);
      summary.frames.push({
        url: frame.url(),
        isMain: frame === page.mainFrame(),
        fields,
      });
    }
    fs.writeFileSync(path.join(dir, "form-elements.json"), JSON.stringify(summary, null, 2));
  } catch {}

  console.log(`Diagnostic info saved to: ${dir}`);
  return dir;
}

module.exports = { login, siteUrl };

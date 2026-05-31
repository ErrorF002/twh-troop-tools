/**
 * TroopWebHost Session Manager
 *
 * Maintains a single Playwright browser instance per server process.
 * Tracks the logged-in state, the current TroopWebHost context (subdomain),
 * and an inactivity timeout that auto-closes the browser after 30 minutes.
 *
 * Credentials live in memory only - never written to disk.
 */

const { chromium } = require("playwright");

const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

class TwhSession {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.subdomain = null;        // TroopWebHost subdomain from login
    this.loggedInUser = null;     // username used for last login (for display only)
    this.lastActivity = null;
    this._timeoutHandle = null;
  }

  isActive() {
    return this.browser !== null && this.page !== null;
  }

  status() {
    return {
      active: this.isActive(),
      subdomain: this.subdomain,
      user: this.loggedInUser,
      lastActivity: this.lastActivity ? this.lastActivity.toISOString() : null,
    };
  }

  /**
   * Start a new browser session. Closes any existing one first.
   * Does not yet log in - call login() after.
   */
  async start() {
    await this.close();
    this.browser = await chromium.launch({
      headless: true,
      args: [
        "--disable-blink-features=AutomationControlled",
      ],
    });
    this.context = await this.browser.newContext({
      acceptDownloads: true,
      viewport: { width: 1280, height: 800 },
    });
    this.page = await this.context.newPage();
    this._touchActivity();
  }

  /**
   * Update last-activity timestamp and reset the inactivity timer.
   * Called on every successful session-using action.
   */
  _touchActivity() {
    this.lastActivity = new Date();
    if (this._timeoutHandle) clearTimeout(this._timeoutHandle);
    this._timeoutHandle = setTimeout(() => {
      console.log("⏱  Session expired (30 min inactivity) - closing browser.");
      this.close().catch(err => console.error("Error closing session:", err));
    }, INACTIVITY_TIMEOUT_MS);
  }

  /**
   * Mark this session as actively in use. Public method called by routes
   * that touch the session (login, download, etc).
   */
  touch() {
    this._touchActivity();
  }

  async close() {
    if (this._timeoutHandle) {
      clearTimeout(this._timeoutHandle);
      this._timeoutHandle = null;
    }
    if (this.browser) {
      try { await this.browser.close(); } catch {}
    }
    this.browser = null;
    this.context = null;
    this.page = null;
    this.subdomain = null;
    this.loggedInUser = null;
    this.lastActivity = null;
  }
}

// Singleton - one session per server process
const session = new TwhSession();

module.exports = session;

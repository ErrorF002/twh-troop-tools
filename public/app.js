/**
 * Troop Tools — Frontend
 *
 * Two views:
 *   1. Login view — TroopWebHost subdomain + credentials
 *   2. Dashboard view — one card per report, each with auto-fetch + manual upload
 *
 * On load we check session status. If logged in, show dashboard.
 * If not, show login (with a "skip" link to use the manual-upload flow only).
 */

(async function () {
  const $ = sel => document.querySelector(sel);

  const loginView = $("#login-view");
  const dashboardView = $("#dashboard-view");
  const sessionBar = $("#session-bar");
  const sessionInfo = $("#session-info");
  const logoutBtn = $("#logout-btn");

  // ─── Remembered subdomain ─────────────────────────────
  // Stored in localStorage so the user only types it once per browser.
  const SUBDOMAIN_KEY = "troopTools.subdomain";

  function loadSavedSubdomain() {
    try { return localStorage.getItem(SUBDOMAIN_KEY) || ""; } catch { return ""; }
  }

  function saveSubdomain(value) {
    try { localStorage.setItem(SUBDOMAIN_KEY, value); } catch {}
  }

  // ─── Remembered credentials (Remember Me) ──────────────
  // Stored in localStorage when the user opts in. UNENCRYPTED — the
  // checkbox label warns the user explicitly. Cleared on logout, or
  // when the user unchecks Remember Me on a subsequent login.
  const CREDS_KEY = "troopTools.credentials";

  function loadSavedCreds() {
    try {
      const raw = localStorage.getItem(CREDS_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed.username || !parsed.password) return null;
      return parsed;
    } catch { return null; }
  }

  function saveCreds(username, password) {
    try {
      localStorage.setItem(CREDS_KEY, JSON.stringify({ username, password }));
    } catch {}
  }

  function clearSavedCreds() {
    try { localStorage.removeItem(CREDS_KEY); } catch {}
  }

  // Apply saved subdomain to UI
  function applySavedSubdomainUI() {
    const saved = loadSavedSubdomain();
    const field = $("#subdomain-field");
    const input = $("#subdomain");
    const hint = field.querySelector(".field-hint");
    const changeBtn = $("#change-subdomain");

    if (saved) {
      input.value = saved;
      input.readOnly = true;
      input.classList.add("locked");
      hint.classList.add("hidden");
      changeBtn.classList.remove("hidden");
    } else {
      input.readOnly = false;
      input.classList.remove("locked");
      hint.classList.remove("hidden");
      changeBtn.classList.add("hidden");
    }
  }

  // Apply saved credentials to UI (username + password)
  function applySavedCredsUI() {
    const saved = loadSavedCreds();
    if (saved) {
      $("#username").value = saved.username;
      $("#password").value = saved.password;
      $("#remember-me").checked = true;
    }
  }

  // "Change" link unlocks the subdomain field
  $("#change-subdomain").addEventListener("click", () => {
    const field = $("#subdomain-field");
    const input = $("#subdomain");
    input.readOnly = false;
    input.classList.remove("locked");
    field.querySelector(".field-hint").classList.remove("hidden");
    $("#change-subdomain").classList.add("hidden");
    input.focus();
    input.select();
  });

  applySavedSubdomainUI();
  applySavedCredsUI();

  // ─── Session check on load ────────────────────────────
  let sessionState = null;
  try {
    const res = await fetch("/api/auth/status");
    sessionState = await res.json();
  } catch {
    sessionState = { active: false };
  }

  if (sessionState.active) {
    showDashboard(true);
  } else {
    showLogin();
  }

  // ─── View switching ───────────────────────────────────
  function showLogin() {
    loginView.classList.remove("hidden");
    dashboardView.classList.add("hidden");
    sessionBar.classList.add("hidden");
    // Reapply any saved credentials in case Remember Me was set
    applySavedCredsUI();
    // Focus password if username is prefilled, else username if subdomain is locked,
    // else subdomain
    setTimeout(() => {
      const sub = $("#subdomain");
      const user = $("#username");
      const pwd = $("#password");
      if (sub && !sub.value) sub.focus();
      else if (user && !user.value) user.focus();
      else if (pwd && !pwd.value) pwd.focus();
      else if (pwd) pwd.focus();
    }, 50);
  }

  async function showDashboard(authenticated) {
    loginView.classList.add("hidden");
    dashboardView.classList.remove("hidden");
    if (authenticated) {
      sessionBar.classList.remove("hidden");
      const st = await fetchSessionStatus();
      sessionInfo.textContent = `Signed in as ${st.user || ""}`;
    } else {
      sessionBar.classList.add("hidden");
    }
    if (!dashboardRendered) {
      await renderDashboard();
    }
  }

  async function fetchSessionStatus() {
    try {
      const res = await fetch("/api/auth/status");
      return await res.json();
    } catch {
      return { active: false };
    }
  }

  // ─── Login form ───────────────────────────────────────
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const subdomain = $("#subdomain").value.trim();
    const username = $("#username").value.trim();
    const password = $("#password").value;
    const submitBtn = $("#login-submit");
    const resultEl = $("#login-result");

    if (!subdomain || !username || !password) {
      showResult(resultEl, "error", "All fields are required.");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Signing in…";
    showResult(resultEl, "working", `<span class="spinner"></span>Connecting to TroopWebHost…`);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subdomain, username, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Login failed");

      // Persist credentials only if Remember Me is checked.
      // Otherwise clear any previously-saved creds.
      const remember = $("#remember-me").checked;
      if (remember) {
        saveCreds(username, password);
      } else {
        clearSavedCreds();
        // Clear the in-form values so they don't linger after navigation
        $("#password").value = "";
        $("#username").value = "";
      }
      resultEl.innerHTML = "";

      // Remember the subdomain for next time (always, regardless of Remember Me)
      saveSubdomain(subdomain);
      applySavedSubdomainUI();

      showDashboard(true);
    } catch (err) {
      showResult(resultEl, "error", `Couldn't sign in: ${escape(err.message)}`);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Sign In";
    }
  });

  // ─── Skip login → manual-only mode ────────────────────
  $("#skip-login").addEventListener("click", () => {
    showDashboard(false);
  });

  // ─── Logout ───────────────────────────────────────────
  logoutBtn.addEventListener("click", async () => {
    logoutBtn.disabled = true;
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {}
    logoutBtn.disabled = false;
    // Reset dashboard so it re-renders with new auth state next time
    dashboardRendered = false;
    $("#reports-container").innerHTML = '<div class="loading">Loading reports…</div>';
    showLogin();
  });

  // ─── Dashboard ────────────────────────────────────────
  let dashboardRendered = false;
  const container = $("#reports-container");

  async function renderDashboard() {
    let reports;
    try {
      const res = await fetch("/api/reports");
      reports = await res.json();
    } catch {
      container.innerHTML = `<div class="result error">Couldn't load reports.</div>`;
      return;
    }

    if (!reports || reports.length === 0) {
      container.innerHTML = `<div class="loading">No reports available.</div>`;
      return;
    }

    container.innerHTML = "";
    reports.forEach(manifest => container.appendChild(renderCard(manifest)));
    dashboardRendered = true;
  }

  // ─── Card rendering ────────────────────────────────────
  function renderCard(manifest) {
    const card = document.createElement("div");
    card.className = "report-card";
    card.dataset.reportId = manifest.id;

    const authenticated = !sessionBar.classList.contains("hidden");
    const canAuto = manifest.canAutoFetch && authenticated;
    const canPartial = manifest.canPartialFetch && authenticated;
    const hasOptions = manifest.options && manifest.options.length > 0;

    card.innerHTML = `
      <div class="card-header">
        <span class="card-icon">${escape(manifest.icon || "📄")}</span>
        <span class="card-title">${escape(manifest.name)}</span>
        <span class="card-chevron">▼</span>
      </div>
      <div class="card-body">
        <p class="card-description">${escape(manifest.description)}</p>
        ${hasOptions ? `<div class="option-inputs"></div>` : ""}
        ${canAuto ? `
          <button class="fetch-btn" ${hasOptions ? "disabled" : ""}>
            <span class="icon">⬇</span> Fetch &amp; Generate
          </button>
          <button class="manual-toggle" type="button">or upload CSVs manually ▾</button>
        ` : ""}
        ${canPartial ? `
          <div class="partial-fetch-section">
            <div class="partial-fetch-inputs"></div>
            <button class="fetch-btn fetch-btn-partial" disabled>
              <span class="icon">⬇</span> Fetch from TroopWebHost &amp; Generate
            </button>
          </div>
          <button class="manual-toggle" type="button">or upload all CSVs manually ▾</button>
        ` : ""}
        <div class="manual-section ${canAuto || canPartial ? "hidden" : ""}">
          ${canAuto || canPartial ? '<div class="manual-section-title">Manual CSV Upload</div>' : ""}
          <div class="file-inputs"></div>
          <button class="generate-btn" disabled>Generate</button>
        </div>
        <div class="result-area"></div>
      </div>
    `;

    const fileInputsContainer = card.querySelector(".file-inputs");
    const generateBtn = card.querySelector(".generate-btn");
    const resultArea = card.querySelector(".result-area");
    const fetchBtn = card.querySelector(".fetch-btn:not(.fetch-btn-partial)");
    const fetchBtnPartial = card.querySelector(".fetch-btn-partial");
    const manualToggle = card.querySelector(".manual-toggle");
    const manualSection = card.querySelector(".manual-section");
    const optionInputsContainer = card.querySelector(".option-inputs");
    const partialFetchInputsContainer = card.querySelector(".partial-fetch-inputs");

    // Files for the partial-fetch section (manual-only inputs)
    const partialFiles = {};

    // ─── Option fields (text inputs, radio groups) ───
    const optionValues = {};
    if (manifest.options) {
      manifest.options.forEach(opt => {
        if (opt.default !== undefined) optionValues[opt.key] = opt.default;
        const wrapper = document.createElement("div");
        wrapper.className = "option-input";

        if (opt.type === "text") {
          wrapper.innerHTML = `
            <label class="field">
              <span class="field-label">${escape(opt.label)}${opt.required ? " *" : ""}</span>
              <input type="text" class="option-text" data-key="${escape(opt.key)}"
                placeholder="${escape(opt.placeholder || "")}"
                autocomplete="off" spellcheck="false" />
            </label>`;
          const input = wrapper.querySelector("input");
          input.addEventListener("input", () => {
            optionValues[opt.key] = input.value.trim();
            updateButtonStates();
          });
        } else if (opt.type === "radio") {
          const choicesHTML = opt.choices.map(c => `
            <label class="radio-choice">
              <input type="radio" name="${escape(manifest.id)}-${escape(opt.key)}"
                value="${escape(c.value)}"
                ${opt.default === c.value ? "checked" : ""} />
              <span>${escape(c.label)}</span>
            </label>`).join("");
          wrapper.innerHTML = `
            <div class="radio-group">
              <span class="field-label">${escape(opt.label)}</span>
              <div class="radio-choices">${choicesHTML}</div>
            </div>`;
          wrapper.querySelectorAll("input[type=radio]").forEach(radio => {
            radio.addEventListener("change", () => {
              optionValues[opt.key] = radio.value;
              updateButtonStates();
            });
          });
        } else if (opt.type === "checkbox") {
          if (opt.default !== undefined) optionValues[opt.key] = opt.default;
          wrapper.innerHTML = `
            <label class="checkbox-field option-checkbox">
              <input type="checkbox" data-key="${escape(opt.key)}"
                ${opt.default ? "checked" : ""} />
              <span class="checkbox-text">
                <span class="checkbox-label">${escape(opt.label)}</span>
              </span>
            </label>`;
          const cb = wrapper.querySelector("input[type=checkbox]");
          cb.addEventListener("change", () => {
            optionValues[opt.key] = cb.checked;
            updateButtonStates();
          });
        }

        if (optionInputsContainer) optionInputsContainer.appendChild(wrapper);
      });
    }

    function optionsValid() {
      if (!manifest.options) return true;
      return manifest.options.every(opt =>
        !opt.required || (optionValues[opt.key] && String(optionValues[opt.key]).trim())
      );
    }

    function updateButtonStates() {
      const optOk = optionsValid();
      if (fetchBtn) fetchBtn.disabled = !optOk;
      // Partial fetch button requires manual inputs to be uploaded
      if (fetchBtnPartial) {
        const manualRequired = manifest.inputs.filter(i => i.required && !i.autoFetch).map(i => i.key);
        fetchBtnPartial.disabled = !optOk || !manualRequired.every(k => partialFiles[k]);
      }
      const requiredKeys = manifest.inputs.filter(i => i.required).map(i => i.key);
      generateBtn.disabled = !(optOk && requiredKeys.every(k => selectedFiles[k]));
    }

    // Build partial-fetch file inputs (manual-only inputs shown above the fetch button)
    if (partialFetchInputsContainer) {
      manifest.inputs
        .filter(i => !i.autoFetch)
        .forEach(input => {
          const fi = document.createElement("div");
          fi.className = "file-input";
          fi.innerHTML = `
            <label class="file-label">${escape(input.label)}${input.required ? " *" : ""}</label>
            <span class="file-hint">${escape(input.hint || "")}</span>
            <label class="file-drop" data-key="${escape(input.key)}">
              <span class="file-drop-icon">📁</span>
              <span class="file-drop-text">Drop CSV here or click to browse</span>
              <input type="file" accept=".csv" />
            </label>`;
          partialFetchInputsContainer.appendChild(fi);

          const drop = fi.querySelector(".file-drop");
          const fileInput = fi.querySelector("input[type=file]");
          const dropText = fi.querySelector(".file-drop-text");

          function setPartialFile(file) {
            if (!file || !file.name.toLowerCase().endsWith(".csv")) return;
            partialFiles[input.key] = file;
            drop.classList.add("has-file");
            dropText.textContent = `✓ ${file.name}`;
            updateButtonStates();
          }
          fileInput.addEventListener("change", e => {
            if (e.target.files[0]) setPartialFile(e.target.files[0]);
          });
          drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("drag-over"); });
          drop.addEventListener("dragleave", () => drop.classList.remove("drag-over"));
          drop.addEventListener("drop", e => {
            e.preventDefault(); drop.classList.remove("drag-over");
            if (e.dataTransfer.files[0]) setPartialFile(e.dataTransfer.files[0]);
          });
        });
    }

    // ─── Partial fetch handler ───
    if (fetchBtnPartial) {
      fetchBtnPartial.addEventListener("click", async () => {
        fetchBtnPartial.disabled = true;
        showResult(resultArea, "working",
          `<span class="spinner"></span>Fetching from TroopWebHost &amp; generating…`);
        try {
          const formData = new FormData();
          // Include manual-only files
          Object.entries(partialFiles).forEach(([k, f]) => formData.append(k, f));
          // Include options
          if (Object.keys(optionValues).length) {
            formData.append("options", JSON.stringify(optionValues));
          }
          const res = await fetch(`/api/reports/${manifest.id}/fetch-and-generate`, {
            method: "POST",
            body: formData,
          });
          await handleResponse(res, resultArea);
        } catch (err) {
          showResult(resultArea, "error", `Error: ${escape(err.message)}`);
        } finally {
          fetchBtnPartial.disabled = false;
          updateButtonStates();
        }
      });
    }

    // Build file inputs
    const selectedFiles = {};
    updateButtonStates();
    manifest.inputs.forEach(input => {
      const fi = document.createElement("div");
      fi.className = "file-input";
      fi.innerHTML = `
        <label class="file-label">${escape(input.label)}${input.required ? " *" : ""}</label>
        <span class="file-hint">${escape(input.hint || "")}</span>
        <label class="file-drop" data-key="${escape(input.key)}">
          <span class="file-drop-icon">📁</span>
          <span class="file-drop-text">Drop CSV here or click to browse</span>
          <input type="file" accept=".csv" data-key="${escape(input.key)}" />
        </label>
      `;
      fileInputsContainer.appendChild(fi);

      const drop = fi.querySelector(".file-drop");
      const fileInput = fi.querySelector("input[type=file]");
      const dropText = fi.querySelector(".file-drop-text");

      function setFile(file) {
        if (!file) return;
        if (!file.name.toLowerCase().endsWith(".csv")) {
          showResult(resultArea, "error", "Please select a .csv file.");
          return;
        }
        selectedFiles[input.key] = file;
        drop.classList.add("has-file");
        dropText.textContent = `✓ ${file.name}`;
        updateManualButton();
      }

      fileInput.addEventListener("change", e => {
        if (e.target.files && e.target.files[0]) setFile(e.target.files[0]);
      });
      drop.addEventListener("dragover", e => {
        e.preventDefault();
        drop.classList.add("drag-over");
      });
      drop.addEventListener("dragleave", () => drop.classList.remove("drag-over"));
      drop.addEventListener("drop", e => {
        e.preventDefault();
        drop.classList.remove("drag-over");
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
          setFile(e.dataTransfer.files[0]);
        }
      });
    });

    function updateManualButton() {
      updateButtonStates();
    }

    // ─── Manual generation ───
    generateBtn.addEventListener("click", async () => {
      generateBtn.disabled = true;
      showResult(resultArea, "working", `<span class="spinner"></span>Generating report…`);

      try {
        const formData = new FormData();
        Object.entries(selectedFiles).forEach(([k, f]) => formData.append(k, f));
        Object.entries(optionValues).forEach(([k, v]) => formData.append(k, v));
        const res = await fetch(`/api/reports/${manifest.id}/generate`, {
          method: "POST",
          body: formData,
        });
        await handleResponse(res, resultArea);
      } catch (err) {
        showResult(resultArea, "error", `Error: ${escape(err.message)}`);
      } finally {
        updateButtonStates();
      }
    });

    // ─── Auto-fetch ───
    if (fetchBtn) {
      fetchBtn.addEventListener("click", async () => {
        fetchBtn.disabled = true;
        const progressEl = document.createElement("div");
        progressEl.className = "progress-step";
        showResult(resultArea, "working",
          `<span class="spinner"></span>Fetching CSVs from TroopWebHost…`);
        resultArea.querySelector(".result").appendChild(progressEl);
        const numFiles = manifest.inputs.filter(i => i.required && i.autoFetch).length;
        progressEl.textContent = `Downloading ${numFiles} report${numFiles === 1 ? "" : "s"} — this can take 20–40 seconds.`;

        try {
          const res = await fetch(`/api/reports/${manifest.id}/fetch-and-generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ options: optionValues }),
          });
          await handleResponse(res, resultArea);
        } catch (err) {
          showResult(resultArea, "error", `Error: ${escape(err.message)}`);
        } finally {
          fetchBtn.disabled = false;
        }
      });
    }

    // ─── Toggle manual section ───
    if (manualToggle) {
      manualToggle.addEventListener("click", () => {
        manualSection.classList.toggle("hidden");
        manualToggle.textContent = manualSection.classList.contains("hidden")
          ? "or upload CSVs manually ▾"
          : "hide manual upload ▴";
      });
    }

    // ─── Expand / collapse on header click (accordion) ───
    card.querySelector(".card-header").addEventListener("click", () => {
      const isOpen = card.classList.contains("open");
      // Close all cards
      container.querySelectorAll(".report-card.open").forEach(c => c.classList.remove("open"));
      // Open this one only if it wasn't already open
      if (!isOpen) card.classList.add("open");
    });

    return card;
  }

  // ─── Helpers ───────────────────────────────────────────
  function showResult(area, kind, html) {
    area.innerHTML = `<div class="result ${kind}">${html}</div>`;
  }

  // Unified response handler — detects HTML vs file responses.
  async function handleResponse(res, resultArea) {
    if (!res.ok) {
      // Try to parse error JSON
      const contentType = res.headers.get("Content-Type") || "";
      if (contentType.includes("application/json")) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 401 || data.needsLogin) {
          showResult(resultArea, "error",
            `Your TroopWebHost session has expired. <button class="link-btn relogin-btn">Sign in again</button>.`);
          resultArea.querySelector(".relogin-btn")?.addEventListener("click", () => showLogin());
          return;
        }
        throw new Error(data.error || `Server error ${res.status}`);
      }
      throw new Error(`Server error ${res.status}`);
    }

    const contentType = res.headers.get("Content-Type") || "";
    if (contentType.includes("application/json")) {
      const data = await res.json();
      if (data.outputType === "html") {
        await handleHtmlResponse(data, resultArea);
      } else if (!data.success) {
        throw new Error(data.error || "Generation failed");
      }
    } else {
      await triggerBrowserDownload(res, resultArea);
    }
  }

  // Receive the PPTX as a blob from the server and trigger the browser's
  // native save dialog, just like clicking a download link.
  async function triggerBrowserDownload(res, resultArea) {
    const fileName = res.headers.get("Content-Disposition")
      ?.match(/filename="?([^"]+)"?/)?.[1]
      || "report.pptx";

    // Parse stats from the custom header if present
    let stats = null;
    try {
      const raw = res.headers.get("X-Report-Stats");
      if (raw) stats = JSON.parse(raw);
    } catch {}

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    const statsHTML = stats && Object.keys(stats).length ? `
      <div class="result-stats">
        ${Object.entries(stats).map(([k, v]) =>
          `<span>${formatStatLabel(k)}: <strong>${v}</strong></span>`).join("")}
      </div>` : "";

    showResult(resultArea, "success", `
      <div>Download started:</div>
      <div class="result-filename">${escape(fileName)}</div>
      ${statsHTML}
    `);
  }

  function escape(s) {
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function formatStatLabel(key) {
    return key.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase()).trim();
  }

  // Handle HTML output type — open in new tab, trigger any extra downloads.
  async function handleHtmlResponse(data, resultArea) {
    window.open(data.htmlUrl, "_blank");

    // Trigger any additional downloads (PDF, CSV)
    for (const dl of (data.downloads || [])) {
      const a = document.createElement("a");
      a.href = dl.url;
      a.download = dl.url.split("/").pop();
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      await new Promise(r => setTimeout(r, 300));
    }

    const statsHTML = data.stats && Object.keys(data.stats).length ? `
      <div class="result-stats">
        ${Object.entries(data.stats).map(([k, v]) =>
          `<span>${formatStatLabel(k)}: <strong>${v}</strong></span>`).join("")}
      </div>` : "";

    const dlLinks = (data.downloads || []).map(dl =>
      `<span><a href="${escape(dl.url)}" target="_blank">${escape(dl.label)}</a></span>`
    ).join("  ");

    showResult(resultArea, "success", `
      <div>Report opened in new tab.</div>
      ${dlLinks ? `<div class="result-stats">${dlLinks}</div>` : ""}
      ${statsHTML}
    `);
  }
})();

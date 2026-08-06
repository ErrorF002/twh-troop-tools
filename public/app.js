(async function () {
  const $ = sel => document.querySelector(sel);

  // ─── Global TWH connection state ──────────────────────
  let twhConnected  = false;
  let dashboardRendered = false;

  // ─── Helpers ──────────────────────────────────────────
  function escape(s) {
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function formatStatLabel(key) {
    return key.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase()).trim();
  }

  function showResult(area, kind, html) {
    area.innerHTML = `<div class="result ${kind}">${html}</div>`;
  }

  // ─── Settings modal ───────────────────────────────────
  const settingsBtn    = $("#settings-btn");
  const settingsModal  = $("#settings-modal");
  const settingsClose  = $("#settings-close");
  const settingsCancel = $("#settings-cancel");
  const settingsSave   = $("#settings-save");
  const settingsResult = $("#settings-result");

  async function openSettings() {
    try {
      const res  = await fetch("/api/settings");
      const data = await res.json();
      $("#settings-troop-name").value       = data.troopName  || "";
      $("#settings-subdomain").value        = data.subdomain  || "";
      $("#settings-id-roster").value        = data.menuItemIds?.roster        || "";
      $("#settings-id-requirements").value  = data.menuItemIds?.requirements  || "";
      $("#settings-id-merit-badges").value  = data.menuItemIds?.meritBadges   || "";
    } catch {}
    settingsResult.textContent = "";
    settingsResult.className   = "";
    settingsModal.classList.remove("hidden");
  }

  function closeSettings() { settingsModal.classList.add("hidden"); }

  settingsBtn.addEventListener("click", openSettings);
  settingsClose.addEventListener("click", closeSettings);
  settingsCancel.addEventListener("click", closeSettings);
  $("#settings-backdrop").addEventListener("click", closeSettings);

  settingsSave.addEventListener("click", async () => {
    settingsSave.disabled = true;
    settingsResult.textContent = "";
    settingsResult.className   = "";
    try {
      const roster       = parseInt($("#settings-id-roster").value, 10);
      const requirements = parseInt($("#settings-id-requirements").value, 10);
      const meritBadges  = parseInt($("#settings-id-merit-badges").value, 10);
      const body = {
        troopName:   $("#settings-troop-name").value.trim(),
        subdomain:   $("#settings-subdomain").value.trim(),
        menuItemIds: {
          roster:       isNaN(roster)       ? null : roster,
          requirements: isNaN(requirements) ? null : requirements,
          meritBadges:  isNaN(meritBadges)  ? null : meritBadges,
        },
      };
      const res  = await fetch("/api/settings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Save failed");
      // Update TWH panel subdomain display if it changed
      const panelSub = $("#twh-panel-subdomain");
      if (panelSub) panelSub.textContent = body.subdomain;
      settingsResult.textContent = "Settings saved.";
      settingsResult.className   = "success";
      setTimeout(closeSettings, 900);
    } catch (err) {
      settingsResult.textContent = `Error: ${escape(err.message)}`;
      settingsResult.className   = "error";
    } finally {
      settingsSave.disabled = false;
    }
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && !settingsModal.classList.contains("hidden")) closeSettings();
  });

  // ─── Setup screen ─────────────────────────────────────
  async function showSetup(prefill = {}) {
    $("#dashboard-view").classList.add("hidden");
    $("#setup-view").classList.remove("hidden");
    if (prefill.troopName)   $("#setup-troop-name").value      = prefill.troopName;
    if (prefill.subdomain)   $("#setup-subdomain").value        = prefill.subdomain;
    if (prefill.menuItemIds?.roster)       $("#setup-id-roster").value        = prefill.menuItemIds.roster;
    if (prefill.menuItemIds?.requirements) $("#setup-id-requirements").value  = prefill.menuItemIds.requirements;
    if (prefill.menuItemIds?.meritBadges)  $("#setup-id-merit-badges").value  = prefill.menuItemIds.meritBadges;
  }

  $("#setup-submit").addEventListener("click", async () => {
    const troopName   = $("#setup-troop-name").value.trim();
    const subdomain   = $("#setup-subdomain").value.trim();
    const rosterRaw   = $("#setup-id-roster").value.trim();
    const reqRaw      = $("#setup-id-requirements").value.trim();
    const meritRaw    = $("#setup-id-merit-badges").value.trim();
    const resultEl    = $("#setup-result");

    if (!troopName)   { resultEl.textContent = "Troop Name is required."; resultEl.className = "error"; return; }
    if (!subdomain)   { resultEl.textContent = "TroopWebHost site path is required."; resultEl.className = "error"; return; }
    if (!rosterRaw)   { resultEl.textContent = "Active Roster Report ID is required."; resultEl.className = "error"; return; }
    if (!reqRaw)      { resultEl.textContent = "Rank Requirements Report ID is required."; resultEl.className = "error"; return; }

    const roster       = parseInt(rosterRaw, 10);
    const requirements = parseInt(reqRaw, 10);
    const meritBadges  = meritRaw ? parseInt(meritRaw, 10) : null;
    if (isNaN(roster) || roster < 1)       { resultEl.textContent = "Roster Report ID must be a positive number."; resultEl.className = "error"; return; }
    if (isNaN(requirements) || requirements < 1) { resultEl.textContent = "Requirements Report ID must be a positive number."; resultEl.className = "error"; return; }
    if (meritRaw && (isNaN(meritBadges) || meritBadges < 1)) { resultEl.textContent = "Merit Badge History Report ID must be a positive number."; resultEl.className = "error"; return; }

    $("#setup-submit").disabled = true;
    resultEl.textContent = "";

    try {
      const res  = await fetch("/api/settings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          setupComplete: true, troopName, subdomain,
          menuItemIds: { roster, requirements, meritBadges },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Could not save settings.");
      $("#setup-view").classList.add("hidden");
      await showDashboard();
    } catch (err) {
      resultEl.textContent = `Error: ${escape(err.message)}`;
      resultEl.className   = "error";
    } finally {
      $("#setup-submit").disabled = false;
    }
  });

  // ─── TWH Connect panel ────────────────────────────────
  const CREDS_KEY = "troopTools.credentials";

  function loadSavedCreds() {
    try {
      const raw = localStorage.getItem(CREDS_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw);
      return (p.username && p.password) ? p : null;
    } catch { return null; }
  }
  function saveCreds(u, p) {
    try { localStorage.setItem(CREDS_KEY, JSON.stringify({ username: u, password: p })); } catch {}
  }
  function clearCreds() {
    try { localStorage.removeItem(CREDS_KEY); } catch {}
  }

  const twhConnectBtn    = $("#twh-connect-btn");
  const twhConnectedEl   = $("#twh-connected");
  const twhPanel         = $("#twh-panel");
  const twhUserLabel     = $("#twh-user-label");
  const twhDisconnectBtn = $("#twh-disconnect-btn");
  const twhSignInBtn     = $("#twh-sign-in-btn");
  const twhPanelResult   = $("#twh-panel-result");

  function setTwhConnectedUI(username) {
    twhConnected = true;
    twhConnectBtn.classList.add("hidden");
    twhConnectedEl.classList.remove("hidden");
    twhUserLabel.textContent = `Connected: ${username}`;
    twhPanel.classList.add("hidden");
  }

  function setTwhDisconnectedUI() {
    twhConnected = false;
    twhConnectBtn.classList.remove("hidden");
    twhConnectedEl.classList.add("hidden");
    twhPanel.classList.add("hidden");
  }

  function openTwhPanel() {
    // Pre-fill site path from settings, pre-fill creds if remembered
    fetch("/api/settings").then(r => r.json()).then(d => {
      $("#twh-panel-subdomain").textContent = d.subdomain || "(not set - check Settings)";
    }).catch(() => {});
    const saved = loadSavedCreds();
    if (saved) {
      $("#twh-username").value    = saved.username;
      $("#twh-password").value    = saved.password;
      $("#twh-remember").checked  = true;
    } else {
      $("#twh-username").value    = "";
      $("#twh-password").value    = "";
      $("#twh-remember").checked  = false;
    }
    twhPanelResult.textContent = "";
    twhPanelResult.className   = "";
    twhPanel.classList.toggle("hidden");
    if (!twhPanel.classList.contains("hidden")) {
      setTimeout(() => $("#twh-username").focus(), 50);
    }
  }

  twhConnectBtn.addEventListener("click", openTwhPanel);

  // "change" link opens Settings so user can update subdomain
  $("#twh-panel-change-site").addEventListener("click", () => {
    twhPanel.classList.add("hidden");
    openSettings();
  });

  // Close panel when clicking outside
  document.addEventListener("click", e => {
    if (!twhPanel.classList.contains("hidden") &&
        !$("#twh-connect-area").contains(e.target)) {
      twhPanel.classList.add("hidden");
    }
  });

  twhSignInBtn.addEventListener("click", async () => {
    const username = $("#twh-username").value.trim();
    const password = $("#twh-password").value;
    if (!username || !password) {
      twhPanelResult.textContent = "Username and password are required.";
      twhPanelResult.className   = "error";
      return;
    }

    twhSignInBtn.disabled      = true;
    twhPanelResult.textContent = "Signing in…";
    twhPanelResult.className   = "working";

    try {
      // Subdomain comes from settings
      const settingsRes = await fetch("/api/settings");
      const settings    = await settingsRes.json();
      const subdomain   = settings.subdomain;
      if (!subdomain) throw new Error("TroopWebHost site path is not configured. Open Settings.");

      const res  = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subdomain, username, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Login failed");

      if ($("#twh-remember").checked) {
        saveCreds(username, password);
      } else {
        clearCreds();
        $("#twh-password").value = "";
      }

      setTwhConnectedUI(username);
      // Re-render dashboard cards so auto-fetch buttons appear
      dashboardRendered = false;
      await renderDashboard();
    } catch (err) {
      twhPanelResult.textContent = err.message;
      twhPanelResult.className   = "error";
    } finally {
      twhSignInBtn.disabled = false;
    }
  });

  // Sign in on Enter key from password field
  $("#twh-password").addEventListener("keydown", e => {
    if (e.key === "Enter") twhSignInBtn.click();
  });

  twhDisconnectBtn.addEventListener("click", async () => {
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch {}
    clearCreds();
    setTwhDisconnectedUI();
    dashboardRendered = false;
    await renderDashboard();
  });

  // ─── Dashboard sections ───────────────────────────────
  const SECTIONS = [
    { label: "Review", ids: ["reconciliation", "roster-audit"] },
    { label: "Plan",   ids: ["advancement", "merit-badges", "merit-badge-search", "patrol-balance"] },
    { label: "Data",   ids: ["contacts", "health"] },
  ];

  // ─── Dashboard ────────────────────────────────────────
  async function showDashboard() {
    $("#setup-view").classList.add("hidden");
    $("#dashboard-view").classList.remove("hidden");
    if (!dashboardRendered) await renderDashboard();
  }

  const container = $("#reports-container");

  let cacheStatus = { staleDays: 7, sources: {} };

  async function refreshCacheStatus() {
    try {
      const cacheRes = await fetch("/api/cache/status");
      cacheStatus = await cacheRes.json();
    } catch {
      cacheStatus = { staleDays: 7, sources: {} };
    }
  }

  function formatCacheAge(ageDays) {
    if (ageDays <= 0) return "today";
    if (ageDays === 1) return "1 day old";
    return `${ageDays} days old`;
  }

  function isStale(ageDays) {
    return ageDays > (cacheStatus.staleDays || 7);
  }

  function cacheNoteHTML(input) {
    if (!input.cacheKey) return "";
    const st = cacheStatus.sources[input.cacheKey];
    if (!st) return ` <span class="cache-note cache-note-empty">(no cached copy yet)</span>`;
    const staleClass = isStale(st.ageDays) ? " stale" : "";
    const staleWarning = isStale(st.ageDays) ? " — consider refreshing" : "";
    return ` <span class="cache-note${staleClass}">(cached copy: ${formatCacheAge(st.ageDays)}${staleWarning})</span>`;
  }

  async function renderDashboard() {
    let reports;
    try {
      const res = await fetch("/api/reports");
      reports   = await res.json();
    } catch {
      container.innerHTML = `<div class="result error">Could not load reports.</div>`;
      return;
    }
    await refreshCacheStatus();
    if (!reports || reports.length === 0) {
      container.innerHTML = `<div class="loading">No reports available.</div>`;
      return;
    }
    container.innerHTML = "";
    const byId = Object.fromEntries(reports.map(r => [r.id, r]));
    const assigned = new Set(SECTIONS.flatMap(s => s.ids));
    SECTIONS.forEach(section => {
      const group = section.ids.map(id => byId[id]).filter(Boolean);
      if (!group.length) return;
      const h = document.createElement("div");
      h.className   = "section-heading";
      h.textContent = section.label;
      container.appendChild(h);
      group.forEach(manifest => container.appendChild(renderCard(manifest)));
    });
    reports.filter(r => !assigned.has(r.id))
      .forEach(manifest => container.appendChild(renderCard(manifest)));
    dashboardRendered = true;
  }

  // ─── Card rendering ───────────────────────────────────
  function renderCard(manifest) {
    const card = document.createElement("div");
    card.className    = "report-card";
    card.dataset.reportId = manifest.id;

    const canAuto    = manifest.canAutoFetch    && twhConnected;
    const canPartial = manifest.canPartialFetch && twhConnected;
    const hasOptions = manifest.options && manifest.options.length > 0;

    // "Generate from Cache" doesn't need a TWH connection at all - it's
    // available whenever every required input has a cache slot, regardless
    // of connection state. It's only *clickable* when those slots are
    // actually filled with fresh (non-stale) data.
    const cacheableInputs = manifest.inputs.filter(i => i.cacheKey);
    const cacheReady = manifest.canGenerateFromCache && manifest.inputs
      .filter(i => i.required)
      .every(i => {
        const st = i.cacheKey && cacheStatus.sources[i.cacheKey];
        return st && !isStale(st.ageDays);
      });

    function buildCacheSummaryHTML() {
      if (!cacheableInputs.length) return "";
      return `<div class="cache-status">${cacheableInputs.map(i => {
        const st = cacheStatus.sources[i.cacheKey];
        const stale = st && isStale(st.ageDays);
        return `<span class="cache-status-item${stale ? " stale" : ""}">${escape(i.label)}: ${st ? formatCacheAge(st.ageDays) : "not cached yet"}</span>`;
      }).join("")}</div>`;
    }

    card.innerHTML = `
      <div class="card-header">
        <span class="card-icon">${escape(manifest.icon || "📄")}</span>
        <span class="card-title">${escape(manifest.name)}</span>
        <span class="card-chevron">▼</span>
      </div>
      <div class="card-body">
        <p class="card-description">${escape(manifest.description)}</p>
        <div class="cache-status-container">${buildCacheSummaryHTML()}</div>
        ${hasOptions ? `<div class="option-inputs"></div>` : ""}
        ${manifest.canGenerateFromCache ? `
          <button class="cache-btn" ${cacheReady ? "" : "disabled"} title="${cacheReady ? "" : "Needs a fresh (within 7 days) cached copy of every required file"}">
            <span class="icon">📦</span> Generate from Cache
          </button>
        ` : ""}
        ${canAuto ? `
          <button class="fetch-btn">
            <span class="icon">📥</span> Fetch &amp; Generate
          </button>
          <button class="manual-toggle" type="button">or upload CSVs manually ▾</button>
        ` : ""}
        ${canPartial ? `
          <div class="partial-fetch-section">
            <div class="partial-fetch-inputs"></div>
            <button class="fetch-btn fetch-btn-partial" disabled>
              <span class="icon">📥</span> Fetch from TroopWebHost &amp; Generate
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

    const fileInputsContainer      = card.querySelector(".file-inputs");
    const generateBtn              = card.querySelector(".generate-btn");
    const resultArea               = card.querySelector(".result-area");
    const fetchBtn                 = card.querySelector(".fetch-btn:not(.fetch-btn-partial)");
    const fetchBtnPartial          = card.querySelector(".fetch-btn-partial");
    const cacheBtn                 = card.querySelector(".cache-btn");
    const manualToggle             = card.querySelector(".manual-toggle");
    const manualSection            = card.querySelector(".manual-section");
    const optionInputsContainer    = card.querySelector(".option-inputs");
    const partialFetchInputsContainer = card.querySelector(".partial-fetch-inputs");

    const partialFiles  = {};
    const optionValues  = {};

    // ─── Option fields ───
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
          if (opt.default !== undefined) input.value = opt.default;
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
        } else if (opt.type === "select") {
          const choicesHTML = (opt.choices || []).map(c => `
            <option value="${escape(c.value)}" ${opt.default === c.value ? "selected" : ""}>${escape(c.label)}</option>`
          ).join("");
          wrapper.innerHTML = `
            <label class="field">
              <span class="field-label">${escape(opt.label)}${opt.required ? " *" : ""}</span>
              <select class="option-select" data-key="${escape(opt.key)}">${choicesHTML}</select>
            </label>`;
          const select = wrapper.querySelector("select");
          if (opt.default !== undefined) select.value = opt.default;
          select.addEventListener("change", () => {
            optionValues[opt.key] = select.value;
            updateButtonStates();
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
      if (fetchBtnPartial) {
        const manualRequired = manifest.inputs.filter(i => i.required && !i.autoFetch).map(i => i.key);
        fetchBtnPartial.disabled = !optOk || !manualRequired.every(k => partialFiles[k]);
      }
      const requiredKeys = manifest.inputs.filter(i => i.required).map(i => i.key);
      generateBtn.disabled = !(optOk && requiredKeys.every(k => selectedFiles[k]));
    }

    // ─── Partial-fetch file inputs ───
    if (partialFetchInputsContainer) {
      manifest.inputs.filter(i => !i.autoFetch).forEach(input => {
        const fi = document.createElement("div");
        fi.className = "file-input";
        fi.innerHTML = `
          <label class="file-label">${escape(input.label)}${input.required ? " *" : ""}</label>
          <span class="file-hint">${escape(input.hint || "")}${cacheNoteHTML(input)}</span>
          <label class="file-drop" data-key="${escape(input.key)}">
            <span class="file-drop-icon">📁</span>
            <span class="file-drop-text">Drop CSV here or click to browse</span>
            <input type="file" accept=".csv" />
          </label>`;
        partialFetchInputsContainer.appendChild(fi);
        const drop = fi.querySelector(".file-drop");
        const fileInput = fi.querySelector("input[type=file]");
        const dropText  = fi.querySelector(".file-drop-text");
        function setPartialFile(file) {
          if (!file || !file.name.toLowerCase().endsWith(".csv")) return;
          partialFiles[input.key] = file;
          drop.classList.add("has-file");
          dropText.textContent = `✓ ${file.name}`;
          updateButtonStates();
        }
        fileInput.addEventListener("change", e => { if (e.target.files[0]) setPartialFile(e.target.files[0]); });
        drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("drag-over"); });
        drop.addEventListener("dragleave", () => drop.classList.remove("drag-over"));
        drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("drag-over"); if (e.dataTransfer.files[0]) setPartialFile(e.dataTransfer.files[0]); });
      });
    }

    // ─── Partial fetch handler ───
    if (fetchBtnPartial) {
      fetchBtnPartial.addEventListener("click", async () => {
        fetchBtnPartial.disabled = true;
        showResult(resultArea, "working", `<span class="spinner"></span>Fetching from TroopWebHost &amp; generating…`);
        try {
          const formData = new FormData();
          Object.entries(partialFiles).forEach(([k, f]) => formData.append(k, f));
          if (Object.keys(optionValues).length) formData.append("options", JSON.stringify(optionValues));
          const res = await fetch(`/api/reports/${manifest.id}/fetch-and-generate`, { method: "POST", body: formData });
          await handleResponse(res, resultArea);
        } catch (err) {
          showResult(resultArea, "error", `Error: ${escape(err.message)}`);
        } finally {
          fetchBtnPartial.disabled = false;
          updateButtonStates();
        }
      });
    }

    // ─── Manual file inputs ───
    const selectedFiles = {};
    updateButtonStates();

    manifest.inputs.forEach(input => {
      const fi = document.createElement("div");
      fi.className = "file-input";
      fi.innerHTML = `
        <label class="file-label">${escape(input.label)}${input.required ? " *" : ""}</label>
        <span class="file-hint">${escape(input.hint || "")}${cacheNoteHTML(input)}</span>
        <label class="file-drop" data-key="${escape(input.key)}">
          <span class="file-drop-icon">📁</span>
          <span class="file-drop-text">Drop CSV here or click to browse</span>
          <input type="file" accept=".csv" data-key="${escape(input.key)}" />
        </label>
      `;
      fileInputsContainer.appendChild(fi);
      const drop      = fi.querySelector(".file-drop");
      const fileInput = fi.querySelector("input[type=file]");
      const dropText  = fi.querySelector(".file-drop-text");
      function setFile(file) {
        if (!file) return;
        if (!file.name.toLowerCase().endsWith(".csv")) {
          showResult(resultArea, "error", "Please select a .csv file.");
          return;
        }
        selectedFiles[input.key] = file;
        drop.classList.add("has-file");
        dropText.textContent = `✓ ${file.name}`;
        updateButtonStates();
      }
      fileInput.addEventListener("change", e => { if (e.target.files?.[0]) setFile(e.target.files[0]); });
      drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("drag-over"); });
      drop.addEventListener("dragleave", () => drop.classList.remove("drag-over"));
      drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("drag-over"); if (e.dataTransfer.files?.[0]) setFile(e.dataTransfer.files[0]); });
    });

    // ─── Generate (manual upload) ───
    generateBtn.addEventListener("click", async () => {
      generateBtn.disabled = true;
      showResult(resultArea, "working", `<span class="spinner"></span>Generating report…`);
      try {
        const formData = new FormData();
        Object.entries(selectedFiles).forEach(([k, f]) => formData.append(k, f));
        Object.entries(optionValues).forEach(([k, v]) => formData.append(k, v));
        const res = await fetch(`/api/reports/${manifest.id}/generate`, { method: "POST", body: formData });
        await handleResponse(res, resultArea);
      } catch (err) {
        showResult(resultArea, "error", `Error: ${escape(err.message)}`);
      } finally {
        updateButtonStates();
      }
    });

    // ─── Generate from Cache (no TroopWebHost traffic at all) ───
    if (cacheBtn) {
      cacheBtn.addEventListener("click", async () => {
        cacheBtn.disabled = true;
        showResult(resultArea, "working", `<span class="spinner"></span>Generating from cached data…`);
        try {
          const res = await fetch(`/api/reports/${manifest.id}/fetch-and-generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ options: optionValues, useCache: true }),
          });
          await handleResponse(res, resultArea);
        } catch (err) {
          showResult(resultArea, "error", `Error: ${escape(err.message)}`);
        } finally {
          cacheBtn.disabled = !cacheReady;
        }
      });
    }

    // ─── Fetch & Generate (always live-fetches from TroopWebHost) ───
    if (fetchBtn) {
      fetchBtn.addEventListener("click", async () => {
        fetchBtn.disabled = true;
        const progressEl = document.createElement("div");
        progressEl.className = "progress-step";
        showResult(resultArea, "working", `<span class="spinner"></span>Fetching CSVs from TroopWebHost…`);
        resultArea.querySelector(".result").appendChild(progressEl);
        const numFiles = manifest.inputs.filter(i => i.required && i.autoFetch).length;
        progressEl.textContent = `Downloading ${numFiles} report${numFiles === 1 ? "" : "s"} — this can take 20-40 seconds.`;
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

    // ─── Manual toggle ───
    if (manualToggle) {
      manualToggle.addEventListener("click", () => {
        manualSection.classList.toggle("hidden");
        manualToggle.textContent = manualSection.classList.contains("hidden")
          ? "or upload CSVs manually ▾"
          : "hide manual upload ▴";
      });
    }

    // ─── Accordion ───
    card.querySelector(".card-header").addEventListener("click", () => {
      const isOpen = card.classList.contains("open");
      container.querySelectorAll(".report-card.open").forEach(c => c.classList.remove("open"));
      if (!isOpen) card.classList.add("open");
    });

    return card;
  }

  // ─── Response handlers ────────────────────────────────
  async function handleResponse(res, resultArea) {
    if (!res.ok) {
      const contentType = res.headers.get("Content-Type") || "";
      if (contentType.includes("application/json")) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 401 || data.needsLogin) {
          setTwhDisconnectedUI();
          dashboardRendered = false;
          await renderDashboard();
          showResult(resultArea, "error",
            `Your TroopWebHost session expired. Use the Connect button in the header to sign in again.`);
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

  async function triggerBrowserDownload(res, resultArea) {
    const fileName = res.headers.get("Content-Disposition")
      ?.match(/filename="?([^"]+)"?/)?.[1] || "report.pptx";
    let stats = null;
    try {
      const raw = res.headers.get("X-Report-Stats");
      if (raw) stats = JSON.parse(raw);
    } catch {}
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = fileName;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
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

  async function handleHtmlResponse(data, resultArea) {
    window.open(data.htmlUrl, "_blank");
    for (const dl of (data.downloads || [])) {
      const a = document.createElement("a");
      a.href = dl.url; a.download = dl.url.split("/").pop();
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
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

  // ─── Initialise ───────────────────────────────────────
  fetch("/api/version")
    .then(r => r.json())
    .then(data => { if (data.version) $("#app-version").textContent = `v${data.version}`; })
    .catch(() => {});

  let appSettings;
  try {
    const res = await fetch("/api/settings");
    appSettings = await res.json();
  } catch {
    appSettings = { setupComplete: false };
  }

  if (!appSettings.setupComplete) {
    // First run - show setup screen, pre-fill any existing values
    showSetup(appSettings);
  } else {
    // Check TWH session status
    try {
      const res  = await fetch("/api/auth/status");
      const st   = await res.json();
      if (st.active) setTwhConnectedUI(st.user || "");
    } catch {}
    await showDashboard();
  }
})();

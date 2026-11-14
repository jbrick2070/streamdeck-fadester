/* SPDX-License-Identifier: GPL-2.0-or-later */
/* global WebSocket, window, document */
(function () {
  let ws = null;
  let uuid = "";
  let actionInfo = {};
  let currentSettings = {};
  let currentState = null;
  let passwordDirty = false;
  let bindControls = null;
  let connectionEditorInitialized = false;
  let layoutBusy = false;
  // What the last layout or Studio request was ("layout" or "studio"): its result says what was done.
  let setupAction = "layout";
  // A connection test is running: the status line says so until the plugin reports the test done.
  let connectionTesting = false;
  let connectionTestTimer = null;
  // The longest the line waits for that report (a plugin restarted meanwhile never sends it).
  const CONNECTION_TEST_LIMIT_MS = 10000;
  // Texts come from ui/i18n.js (loaded first), in the plugin's language: Stream Deck's, or the Language choice (R-LANG-3).
  const T = function (key, params) { return window.FadesterI18n.t(key, params); };
  // The Language choice (PLAN.md 11.1): Automatic, then the nine languages by their own names, never translated (D-L3).
  const LANGUAGE_CHOICES = [
    ["en", "English"], ["de", "Deutsch"], ["es", "Español"], ["fr", "Français"], ["ja", "日本語"],
    ["ko", "한국어"], ["zh_CN", "简体中文"], ["zh_TW", "繁體中文"], ["nl", "Nederlands"]
  ];
  // Every plugin's inspectors share one file:// origin, so the key names this plugin.
  const LANGUAGE_MEMORY_KEY = "fadester:resolvedLanguage";

  function $(id) {
    return document.getElementById(id);
  }

  function send(payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  function sendToPlugin(payload) {
    send({
      action: actionInfo.action,
      event: "sendToPlugin",
      context: uuid,
      payload: payload
    });
  }

  function save(partial) {
    currentSettings = Object.assign({}, currentSettings, partial, { presetBindingsVersion: 1 });
    send({ event: "setSettings", context: uuid, payload: currentSettings });
    refreshControls();
  }

  /** The language the plugin last resolved, remembered for the next page's first paint (D-L5). */
  function recalledLanguage() {
    try {
      return window.localStorage.getItem(LANGUAGE_MEMORY_KEY);
    } catch {
      return null;
    }
  }

  function rememberLanguage(code) {
    if (typeof code !== "string") return;
    try {
      window.localStorage.setItem(LANGUAGE_MEMORY_KEY, code);
    } catch {
      // No storage (private mode, blocked): the next page paints in Stream Deck's language first.
    }
  }

  function setBanner(el, text, kind) {
    if (!el) return;
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    if (!text) {
      el.style.display = "none";
      el.textContent = "";
      return;
    }
    el.textContent = text;
    el.className = "status-banner status-" + (kind || "info");
    el.style.display = "block";
  }

  function fillSelect(el, items, selected, placeholder) {
    if (!el || document.activeElement === el) return;
    el.innerHTML = "";
    if (placeholder) {
      const placeholderOption = document.createElement("option");
      placeholderOption.value = "";
      placeholderOption.textContent = placeholder;
      placeholderOption.selected = !selected;
      el.appendChild(placeholderOption);
    }
    let found = false;
    items.forEach(function (item) {
      const option = document.createElement("option");
      option.value = item.value;
      option.textContent = item.text;
      option.selected = item.value === selected;
      found = found || option.selected;
      el.appendChild(option);
    });
    if (selected && !found) {
      const missing = document.createElement("option");
      missing.value = selected;
      missing.textContent = T("notInObsNow", { value: selected });
      missing.selected = true;
      el.appendChild(missing);
    }
  }

  function renderSharedSections() {
    const mount = $("direct-shared-sections");
    if (!mount || mount.dataset.ready === "true") return;
    mount.dataset.ready = "true";
    mount.innerHTML = [
      // The page accent of this control (PLAN.md 10.4); the Neo Info Bar has none.
      '<div class="row" id="direct-accent-row"><label for="direct-accent" data-i18n="accentLabel">Accent</label><select id="direct-accent">',
      '<option value="default" data-i18n="accentDefault">Fadester violet</option><option value="brass" data-i18n="accentBrass">Brass</option>',
      '<option value="teal" data-i18n="accentTeal">Teal</option><option value="magenta" data-i18n="accentMagenta">Magenta</option></select></div>',
      // One Language for the whole plugin, kept by the plugin (PLAN.md 11.1); the page only asks for a change.
      '<h3><span data-i18n="languageHeading">Language</span> <span class="scope" data-i18n="scopeAllControls">all Fadester for OBS controls</span></h3>',
      '<div class="row"><label for="direct-language" data-i18n="languageHeading">Language</label><select id="direct-language">',
      '<option value="auto" data-i18n="languageAuto">Automatic (Stream Deck\'s language)</option>',
      LANGUAGE_CHOICES.map(function (entry) {
        return '<option value="' + entry[0] + '" lang="' + entry[0].replace("_", "-") + '">' + entry[1] + "</option>";
      }).join(""),
      '</select></div>',
      '<p class="muted" id="direct-language-note" data-i18n="languageNote">Applies to all Fadester for OBS controls. Stream Deck\'s own menus, action list, tooltips and dial hints stay in Stream Deck\'s language.</p>',
      '<h3><span data-i18n="connHeading">OBS connection</span> <span class="scope" data-i18n="scopeAllControls">all Fadester for OBS controls</span></h3>',
      '<div id="direct-conn-status" class="status-banner status-err" data-i18n="connWaiting">Waiting for OBS…</div>',
      '<p class="muted" id="direct-conn-hint" data-i18n="connHintOnce">Connect once for every Fadester for OBS button and dial.</p>',
      '<details id="direct-conn-editor" class="editor" open><summary id="direct-conn-summary" data-i18n="connSetupOnce">Set up OBS once</summary>',
      '<p class="muted" data-i18n="connAppliesAll">These settings apply to all Fadester for OBS controls on all your layouts. Enter the OBS password once here.</p>',
      '<div class="row"><label for="direct-conn-host" data-i18n="host">Host</label><input id="direct-conn-host" type="text" value="127.0.0.1" /></div>',
      '<div class="row"><label for="direct-conn-port" data-i18n="port">Port</label><input id="direct-conn-port" type="number" value="4455" min="1" max="65535" /></div>',
      '<div class="row"><label for="direct-conn-password" data-i18n="password">Password</label><input id="direct-conn-password" type="password" autocomplete="off" placeholder="Enter the OBS password once" data-i18n-placeholder="passwordPlaceholderOnce" /></div>',
      '<div class="row"><label></label><button id="direct-conn-read-obs" class="btn secondary" type="button" data-i18n="obsSavedReadBtn">Use OBS\'s saved password</button></div>',
      '<p class="muted" id="direct-obs-saved-hint" style="display:none"></p>',
      '<div id="direct-obs-saved-preview" class="status-banner status-info" style="display:none"></div>',
      '<div class="row" id="direct-obs-saved-apply-row" style="display:none"><label></label><button id="direct-conn-apply-obs" class="btn secondary" type="button" data-i18n="obsSavedApplyBtn">Fill port &amp; save password</button></div>',
      '<div class="row"><label></label><button id="direct-conn-test" class="btn" type="button" data-i18n="saveAndTest">Save for all controls &amp; test</button></div>',
      '</details>',
      '<details id="direct-setup-checklist" class="editor"><summary data-i18n="chkHeading">Setup checklist</summary>',
      '<p class="muted" data-i18n="chkIntro">One-pass readiness check for OBS, the T-bar, optional OBS plugins, and the VJster link.</p>',
      '<div id="direct-checklist-list" class="checklist-list"></div>',
      '<div class="editor-actions"><button id="direct-checklist-refresh" class="btn secondary" type="button" data-i18n="chkCheckAgain">Check again</button></div>',
      '</details>',
      '<div id="direct-studio-setup" style="display:none"><p class="muted" data-i18n="studioSetupNote">This control uses Studio Mode. Prepare Preview from your existing scenes to start mixing.</p>',
      '<button id="direct-studio-prepare" class="btn" type="button">Enable Studio Mode &amp; prepare Preview</button></div>',
      '<div id="direct-setup-status" class="status-banner" style="display:none"></div>',
      '<p class="muted" id="direct-opendeck-starter" style="display:none"></p>',
      '<details id="direct-elgato-layouts" class="editor"><summary data-i18n="layoutsSummary">Ready-made layouts</summary>',
      '<p class="muted" data-i18n="layoutsIntro">Open an editable full, half, or creative desk. Scene buttons follow your current OBS scene list automatically. Main audio and microphone controls use matching OBS mixer inputs when available.</p>',
      '<p class="muted" data-i18n="layoutsInstallNote">The current starter installs as an editable profile once. Any older layouts you customized stay available.</p>',
      '<div class="row"><label for="direct-layout" data-i18n="layoutLabel">Layout</label><select id="direct-layout"></select></div>',
      '<div class="row"><label></label><button id="direct-layout-open" class="btn" type="button">Open current starter layout</button></div>',
      '<p class="muted" id="direct-layout-hint" style="display:none"></p>',
      '<p class="muted" data-i18n="layoutsOrderNote">Everyday Source Desks keep layer order fixed. Creative Layer Lab enables its labelled reorder controls.</p>',
      '</details>',
      '<details class="editor direct-optional"><summary data-i18n="optionalSummary">Optional: Midi Fadester integration</summary>',
      '<p class="muted" data-i18n="optionalNote">You do not need Midi Fadester, an APC40, or any MIDI controller for the controls above. The separately labelled <em data-slot="actions" data-i18n="optionalActions">Midi Fadester (optional)</em> actions keep advanced shared slots and A/B layer mixing for people who use that setup.</p>',
      '</details>'
    ].join("");
    window.FadesterI18n.apply(mount);

    const host = $("direct-conn-host");
    const port = $("direct-conn-port");
    const password = $("direct-conn-password");
    const test = $("direct-conn-test");
    const readObs = $("direct-conn-read-obs");
    const applyObs = $("direct-conn-apply-obs");
    const refreshChecklist = $("direct-checklist-refresh");
    function syncObsSavedHostGate() {
      const val = (host ? host.value : "127.0.0.1").trim().toLowerCase();
      const local = val === "" || val === "127.0.0.1" || val === "localhost" || val === "::1" || val === "[::1]";
      if (readObs) readObs.disabled = !local;
      const hostHint = $("direct-obs-saved-hint");
      if (hostHint) {
        hostHint.textContent = local ? "" : T("obsSavedNonLocal");
        hostHint.style.display = local ? "none" : "";
      }
    }
    function pushConnection() {
      const payload = {
        event: "directUpdateGlobalSettings",
        host: host ? host.value : "127.0.0.1",
        port: port ? Number(port.value) : 4455
      };
      // A saved password is deliberately never echoed into the inspector.
      if (passwordDirty && password) payload.password = password.value;
      sendToPlugin(payload);
      passwordDirty = false;
    }
    if (password) {
      password.oninput = function () { passwordDirty = true; };
      password.onchange = pushConnection;
    }
    if (host) {
      host.oninput = syncObsSavedHostGate;
      host.onchange = function () {
        syncObsSavedHostGate();
        pushConnection();
      };
    }
    if (port) port.onchange = pushConnection;
    if (readObs) readObs.onclick = function () {
      sendToPlugin({ event: "directReadObsSavedConfig", host: host ? host.value : "127.0.0.1" });
    };
    if (applyObs) applyObs.onclick = function () {
      passwordDirty = false;
      connectionTesting = true;
      window.clearTimeout(connectionTestTimer);
      connectionTestTimer = window.setTimeout(endConnectionTest, CONNECTION_TEST_LIMIT_MS);
      setBanner($("direct-conn-status"), T("connTesting"), "info");
      sendToPlugin({ event: "directApplyObsSavedConfig" });
    };
    if (refreshChecklist) refreshChecklist.onclick = function () {
      sendToPlugin({ event: "directRunChecklist" });
    };
    if (test) test.onclick = function () {
      pushConnection();
      // Feedback that the test runs, also when its result is the same sentence as before; the button stays usable.
      connectionTesting = true;
      window.clearTimeout(connectionTestTimer);
      connectionTestTimer = window.setTimeout(endConnectionTest, CONNECTION_TEST_LIMIT_MS);
      setBanner($("direct-conn-status"), T("connTesting"), "info");
      sendToPlugin({ event: "directTestConnection" });
    };
    const languagePicker = $("direct-language");
    if (languagePicker) languagePicker.onchange = function () {
      // The plugin saves and applies the choice; its next state message refills this page.
      sendToPlugin({ event: "setLanguageChoice", choice: languagePicker.value });
    };
    const openLayout = $("direct-layout-open");
    if (openLayout) openLayout.onclick = function () {
      const select = $("direct-layout");
      const layout = currentState && (currentState.layouts || []).find(function (item) { return item.slug === (select && select.value); });
      if (layout && !layoutBusy) {
        layoutBusy = true;
        setupAction = "layout";
        updateLayoutButton();
        setBanner($("direct-setup-status"), T("layoutPreparing"), "info");
        sendToPlugin({ event: "directActivateLayout", slug: layout.slug, prepareStudio: layout.obsMode === "studio" });
      }
    };
    const layoutPicker = $("direct-layout");
    if (layoutPicker) layoutPicker.onchange = updateLayoutButton;
    const prepareStudio = $("direct-studio-prepare");
    if (prepareStudio) prepareStudio.onclick = function () {
      if (layoutBusy) return;
      layoutBusy = true;
      setupAction = "studio";
      updateStudioSetup();
      setBanner($("direct-setup-status"), T("studioPreparing"), "info");
      sendToPlugin({ event: "directPrepareStudio" });
    };
  }

  function updateLayoutButton() {
    const button = $("direct-layout-open");
    const picker = $("direct-layout");
    const state = currentState || {};
    const layout = (state.layouts || []).find(function (item) { return item.slug === (picker && picker.value); });
    if (!button) return;
    const studio = layout && layout.obsMode === "studio";
    const needsObs = Boolean(studio && (!state.status || state.status.kind !== "connected"));
    button.textContent = T(layoutBusy ? "preparing" : studio
      ? (state.catalog && state.catalog.studioMode ? "layoutOpenPrepare" : "layoutOpenEnable")
      : "layoutOpen");
    button.disabled = layoutBusy || !layout || needsObs;
    // A Studio Mode layout waits for OBS: say why its button is off.
    const hint = $("direct-layout-hint");
    if (hint) {
      const show = needsObs && !layoutBusy;
      hint.textContent = show ? T("layoutNeedsObs") : "";
      hint.style.display = show ? "" : "none";
    }
  }

  /** The connection test is over (or never answered): the status line shows the plugin's state again. */
  function endConnectionTest() {
    window.clearTimeout(connectionTestTimer);
    connectionTestTimer = null;
    if (!connectionTesting) return;
    connectionTesting = false;
    if (currentState) updateConnection(currentState);
  }

  function updateStudioSetup() {
    const mount = $("direct-studio-setup");
    const button = $("direct-studio-prepare");
    const state = currentState || {};
    const catalog = state.catalog || {};
    const usesStudio = currentSettings.target === "tbar" || currentSettings.operation === "preview" || currentSettings.sceneTarget === "__current_preview__";
    const sameScene = catalog.currentPreviewScene === catalog.currentProgramScene;
    if (mount) mount.style.display = usesStudio && state.status && state.status.kind === "connected" && (!catalog.studioMode || sameScene) ? "block" : "none";
    if (button) {
      button.textContent = T(layoutBusy ? "preparing" : catalog.studioMode ? "studioPrepareDifferent" : "studioPrepareEnable");
      button.disabled = layoutBusy;
    }
  }

  function checklistItemTitle(id) {
    if (id === "obs_reachable") return T("chkItemReachable");
    if (id === "password_accepted") return T("chkItemPassword");
    if (id === "obs_version") return T("chkItemObsVersion");
    if (id === "studio_mode") return T("chkItemStudioMode");
    if (id === "fade_selected") return T("chkItemFade");
    if (id === "obs_not_elevated") return T("chkItemNotElevated");
    if (id === "window_not_minimised") return T("chkItemNotMinimised");
    if (id === "macos_accessibility") return T("chkItemMacAx");
    if (id === "midi_fadester") return T("chkItemMidiFadester");
    if (id === "visual_sidechain") return T("chkItemVisualSidechain");
    if (id === "playlister") return T("chkItemPlaylister");
    return T("chkItemVjsterPort");
  }

  function checklistItemDetail(item) {
    const id = item.id;
    const code = item.code;
    const metaParams = {
      port: item.meta && item.meta.port ? item.meta.port : 48150,
      holder: item.meta && item.meta.holder ? item.meta.holder : ""
    };
    if (id === "password_accepted") {
      if (code === "ok") return T("chkDetailAccepted");
      if (code === "wrong_password") return T("chkDetailRejected");
      return T("chkDetailWaitingObs");
    }
    if (id === "obs_version") {
      if (code === "unknown") return T("chkDetailWaitingObs");
      return item.detail || T("chkDetailUnknown");
    }
    if (id === "studio_mode") {
      if (code === "ok") return T("chkDetailOn");
      if (code === "studio_off") return T("chkDetailOff");
      return T("chkDetailWaitingObs");
    }
    if (id === "fade_selected") {
      if (code === "unknown") return T("chkDetailWaitingObs");
      return item.detail || T("chkDetailUnknown");
    }
    if (id === "obs_not_elevated") {
      if (code === "ok") return T("chkDetailNormalUser");
      if (code === "elevated") return T("chkDetailElevated");
      if (code === "not_applicable") return T("chkDetailNotApplicable");
      return T("chkDetailUnknown");
    }
    if (id === "window_not_minimised") {
      if (code === "ok") return T("chkDetailVisible");
      if (code === "minimised") return T("chkDetailMinimised");
      return T("chkDetailUnknown");
    }
    if (id === "macos_accessibility") {
      if (code === "ok") return T("chkDetailGranted");
      if (code === "ax_denied") return T("chkDetailNotGranted");
      if (code === "not_applicable") return T("chkDetailNotApplicable");
      return T("chkDetailUnknown");
    }
    if (id === "midi_fadester" || id === "visual_sidechain") {
      if (code === "missing") return T("chkDetailOptionalMissing");
      if (code === "unknown") return T("chkDetailWaitingObs");
      return item.detail || T("chkDetailUnknown");
    }
    if (id === "playlister") {
      if (code === "present") return T("chkDetailPlPresent");
      if (code === "missing") return T("chkDetailPlMissing");
      return T("chkDetailVersionUnknown");
    }
    if (id === "vjster_port_holder") {
      if (code === "port_free") return T("chkDetailPortFree", metaParams);
      if (code === "port_self") return T("chkDetailPortSelf", metaParams);
      if (code === "port_other") return T("chkDetailPortOther", metaParams);
      if (code === "port_unknown_holder") return T("chkDetailPortInUse", metaParams);
    }
    return item.detail || "";
  }

  function checklistItemFix(item) {
    const code = item.code;
    const metaParams = {
      port: item.meta && item.meta.port ? item.meta.port : 48150,
      holder: item.meta && item.meta.holder ? item.meta.holder : ""
    };
    if (code === "unreachable") return T("chkFixReachable");
    if (code === "wrong_password") return T("chkFixPassword");
    if (code === "not_obs_33") return T("chkFixObsVersion");
    if (code === "studio_off") return T("chkFixStudioMode");
    if (code === "not_fade") return T("chkFixFade");
    if (code === "elevated") return T("chkFixElevated");
    if (code === "minimised") return T("chkFixMinimised");
    if (code === "ax_denied") return T("chkFixMacAx");
    if (item.id === "midi_fadester" && code === "missing") return T("chkFixMfMissing");
    if (item.id === "midi_fadester" && code === "too_old") return T("chkFixMfOld");
    if (item.id === "visual_sidechain" && code === "missing") return T("chkFixVsMissing");
    if (item.id === "visual_sidechain" && code === "too_old") return T("chkFixVsOld");
    if (item.id === "playlister" && code === "missing") return T("chkFixPlMissing");
    if (code === "port_other") return T("chkFixPortOther", metaParams);
    if (code === "port_unknown_holder") return T("chkFixPortUnknown", metaParams);
    return item.fix || "";
  }

  function updateObsSavedConfigPreview(state) {
    const preview = state && state.obsSavedConfigPreview;
    const banner = $("direct-obs-saved-preview");
    const applyRow = $("direct-obs-saved-apply-row");
    const readObs = $("direct-conn-read-obs");
    const hostHint = $("direct-obs-saved-hint");
    const hostEl = $("direct-conn-host");
    const hostVal = ((hostEl ? hostEl.value : "") || (state && state.connection && state.connection.host) || "127.0.0.1").trim().toLowerCase();
    const local = hostVal === "" || hostVal === "127.0.0.1" || hostVal === "localhost" || hostVal === "::1" || hostVal === "[::1]";
    if (readObs) readObs.disabled = !local;
    if (hostHint) {
      hostHint.textContent = local ? "" : T("obsSavedNonLocal");
      hostHint.style.display = local ? "none" : "";
    }
    if (!preview) {
      setBanner(banner, "");
      if (applyRow) applyRow.style.display = "none";
      return;
    }
    const previewParams = {
      source: preview.sourceRelPath || "obs-studio/plugin_config/obs-websocket/config.json",
      port: preview.serverPort || 4455
    };
    let text = "";
    let kind = "info";
    let canApply = false;
    if (preview.ok) {
      text = preview.serverEnabled === false ? T("obsSavedServerOff", previewParams) : T("obsSavedFound", previewParams);
      kind = preview.serverEnabled === false ? "warn" : "ok";
      canApply = true;
    } else if (preview.reason === "no_password" && preview.authRequired === false && preview.serverPort) {
      text = T("obsSavedAuthOff", previewParams);
      kind = "ok";
      canApply = true;
    } else if (preview.reason === "no_password") {
      text = T("obsSavedNoPassword", previewParams);
      kind = "warn";
    } else if (preview.reason === "missing_file") {
      text = T("obsSavedMissing", previewParams);
      kind = "warn";
    } else if (preview.reason === "non_local") {
      text = T("obsSavedNonLocal");
      kind = "warn";
    } else {
      text = T("obsSavedInvalid", previewParams);
      kind = "warn";
    }
    setBanner(banner, text, kind);
    if (applyRow) applyRow.style.display = canApply ? "" : "none";
  }

  function updateSetupChecklist(state) {
    const list = $("direct-checklist-list");
    if (!list) return;
    const report = state && state.setupChecklist;
    list.innerHTML = "";
    if (!report || !Array.isArray(report.items)) {
      const waiting = document.createElement("p");
      waiting.className = "muted";
      waiting.textContent = T("chkWaiting");
      list.appendChild(waiting);
      return;
    }
    report.items.forEach(function (item) {
      const row = document.createElement("div");
      row.className = "chk-row";
      const dot = document.createElement("span");
      dot.className = "chk-dot chk-" + (item.state || "unknown");
      row.appendChild(dot);
      const body = document.createElement("div");
      body.className = "chk-body";
      const head = document.createElement("div");
      head.className = "chk-head";
      const title = document.createElement("span");
      title.className = "chk-title";
      title.textContent = checklistItemTitle(item.id);
      const detail = document.createElement("span");
      detail.className = "chk-detail";
      detail.textContent = checklistItemDetail(item);
      head.appendChild(title);
      head.appendChild(detail);
      body.appendChild(head);
      const fixText = checklistItemFix(item);
      if (fixText && item.state !== "ok" && item.state !== "not_applicable") {
        const fix = document.createElement("div");
        fix.className = "chk-fix";
        fix.textContent = fixText;
        body.appendChild(fix);
      }
      row.appendChild(body);
      list.appendChild(row);
    });
  }

  function updateConnection(state) {
    const connection = state.connection || {};
    const status = state.status || {};
    const host = $("direct-conn-host");
    const port = $("direct-conn-port");
    const hint = $("direct-conn-hint");
    const password = $("direct-conn-password");
    const editor = $("direct-conn-editor");
    const summary = $("direct-conn-summary");
    if (host && document.activeElement !== host) host.value = connection.host || "127.0.0.1";
    if (port && document.activeElement !== port) port.value = String(connection.port || 4455);
    if (hint) hint.textContent = T(status.kind === "wrong_password"
      ? "connHintRejected"
      : connection.passwordSet
      ? "connHintSaved"
      : "connHintShared");
    if (summary) summary.textContent = T(connection.passwordSet || status.kind === "connected"
      ? "connEdit" : "connSetupOnce");
    if (password && !passwordDirty && document.activeElement !== password) {
      password.value = "";
      password.placeholder = T(connection.passwordSet ? "passwordPlaceholderSaved" : "passwordPlaceholderOnce");
    }
    if (editor && !connectionEditorInitialized) {
      editor.open = !(connection.passwordSet || status.kind === "connected") || status.kind === "wrong_password";
      connectionEditorInitialized = true;
    }
    const kind = status.kind === "connected" ? "ok" : "err";
    // The status sentence arrives worded in the plugin's language (the same as this page's). While a test
    // runs, the line keeps saying so (in the page's current language).
    if (connectionTesting) setBanner($("direct-conn-status"), T("connTesting"), "info");
    else setBanner($("direct-conn-status"), status.sentence || T("connWaiting"), kind);
    const layouts = state.layouts || [];
    const openDeck = state.openDeckStarter;
    const hostHint = $("direct-opendeck-starter");
    const elgatoPicker = $("direct-elgato-layouts");
    if (elgatoPicker) elgatoPicker.style.display = openDeck ? "none" : "";
    if (hostHint) {
      hostHint.style.display = openDeck ? "" : "none";
      hostHint.textContent = !openDeck ? "" : openDeck.profileName
        ? T("openDeckPickStarter", { name: openDeck.profileName }) : T("openDeckManualStarter");
    }
    const picker = $("direct-layout");
    const selected = picker && picker.value || "";
    fillSelect(picker, layouts.map(function (layout) { return { value: layout.slug, text: layout.name }; }), selected, T("layoutChoose"));
    updateLayoutButton();
    updateStudioSetup();
    updateObsSavedConfigPreview(state);
    updateSetupChecklist(state);
  }

  /**
   * The select shows the stored choice on every state message; another resolved
   * language refills the page in place (R-LANG-4): static texts now, then the
   * caller's updateConnection and refreshControls redo the dynamic ones. Typed
   * values, focus and open sections stay; the one-off setup banner is cleared.
   */
  function updateLanguage(language) {
    if (!language) return;
    const picker = $("direct-language");
    const known = LANGUAGE_CHOICES.some(function (entry) { return entry[0] === language.choice; });
    if (picker) picker.value = known ? language.choice : "auto";
    if (language.resolved === window.FadesterI18n.language()) {
      rememberLanguage(language.resolved);
      return;
    }
    // Only a language the page accepted is remembered for the next first paint.
    if (!window.FadesterI18n.setResolved(language.resolved)) return;
    rememberLanguage(language.resolved);
    setBanner($("direct-setup-status"), "");
  }

  function updateAccent() {
    const row = $("direct-accent-row");
    const accent = $("direct-accent");
    if (row) row.style.display = actionInfo.action === "io.github.jbrick2070.fadester-for-obs.obs-neo-infobar" ? "none" : "";
    if (!accent) return;
    if (document.activeElement !== accent) accent.value = currentSettings.accent || "default";
    accent.onchange = function () { save({ accent: accent.value }); };
  }

  function refreshControls() {
    if (typeof bindControls === "function") {
      bindControls(currentSettings, save, currentState);
    }
    updateStudioSetup();
    updateAccent();
  }

  window.directObsFillSelect = fillSelect;
  window.directObsMixHint = function (state) {
    const availability = state && state.wholeMix && state.wholeMix.availability;
    return T(availability === "ready" ? "mixHint" : availability === "disabled" ? "mixDisabled" : availability === "conflict" ? "mixConflict" : "mixOffline");
  };

  window.directObsAudioItems = function (state) {
    const catalog = state && state.catalog || {};
    const resolved = state && state.automaticInputs || {};
    const automatic = [
      { value: "__audio_main__", text: T("audioMainAuto") },
      { value: "__audio_mic__", text: T("audioMicAuto") },
      { value: "__audio_aux__", text: T("audioAuxAuto") },
      { value: "__audio_input_2__", text: T("audioInput3Auto") }
    ].map(function (item) {
      return { value: item.value, text: T("automaticResolved", { label: item.text, input: resolved[item.value] || T("notAvailable") }) };
    });
    return automatic.concat(Object.keys(catalog.inputVolumes || {}).map(function (name) { return { value: name, text: name }; }));
  };
  window.directObsRefresh = function () {
    sendToPlugin({ event: "directRefreshCatalog" });
  };
  window.directObsRefreshLayers = function (settings) {
    sendToPlugin({
      event: "directLayerCatalog",
      scope: settings.scope || "auto",
      sceneName: settings.sceneName || ""
    });
  };
  /** The filters on one source (OBS Filter inspector); the answer arrives in the next directObsState. */
  window.directObsRefreshFilters = function (sourceUuid) {
    if (sourceUuid) sendToPlugin({ event: "directFilterCatalog", sourceUuid: sourceUuid });
  };
  window.directObsSelectLayer = function (sceneName, sceneItemId) {
    sendToPlugin({ event: "directSelectLayer", sceneName: sceneName, sceneItemId: sceneItemId });
  };

  window.initDirectObsPropertyInspector = function (callback) {
    bindControls = callback;
    renderSharedSections();
    window.connectElgatoStreamDeckSocket = function (
      inPort,
      inPropertyInspectorUUID,
      inRegisterEvent,
      inInfo,
      inActionInfo
    ) {
      // The language the plugin last resolved first, with no hold (D-L5); Stream Deck's language when none is
      // remembered or the remembered one is not one of the nine. The plugin's first state message settles it.
      if (!window.FadesterI18n.setResolved(recalledLanguage())) {
        window.FadesterI18n.setLanguage(window.FadesterI18n.languageFromInfo(inInfo));
      }
      uuid = inPropertyInspectorUUID;
      actionInfo = JSON.parse(inActionInfo || "{}");
      window.directObsController = actionInfo.payload && actionInfo.payload.controller || "Keypad";
      currentSettings = (actionInfo.payload && actionInfo.payload.settings) || {};
      ws = new WebSocket("ws://127.0.0.1:" + inPort);
      ws.onopen = function () {
        send({ event: inRegisterEvent, uuid: uuid });
        refreshControls();
        sendToPlugin({ event: "directPiReady" });
      };
      ws.onmessage = function (event) {
        let message = {};
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        if (message.event === "didReceiveSettings" && message.payload) {
          currentSettings = message.payload.settings || {};
          refreshControls();
          return;
        }
        if (message.event === "sendToPropertyInspector" && message.payload && message.payload.event === "directObsState") {
          currentState = message.payload;
          updateLanguage(currentState.language);
          updateConnection(currentState);
          refreshControls();
        }
        if (message.event === "sendToPropertyInspector" && message.payload && message.payload.event === "directTestDone") {
          endConnectionTest();
          sendToPlugin({ event: "directRunChecklist" });
        }
        if (message.event === "sendToPropertyInspector" && message.payload && message.payload.event === "directSetupResult") {
          layoutBusy = false;
          // Each request says what it did: a layout opened, or Studio Mode and Preview made ready.
          const done = setupAction === "studio" ? T("studioPrepared") : T("setupDone");
          setBanner($("direct-setup-status"), message.payload.ok ? done : message.payload.error || T("setupFailed"), message.payload.ok ? "ok" : "err");
          updateLayoutButton();
          updateStudioSetup();
        }
      };
    };
  };
})();

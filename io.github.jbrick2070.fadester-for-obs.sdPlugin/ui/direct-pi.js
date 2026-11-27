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
  let layoutBusy = false;
  // The operator chose in the layout list (also "Choose a ready-made layout"): the page stops suggesting one.
  let layoutPicked = false;
  // What the last layout or Studio request was ("layout" or "studio"): its result says what was done.
  let setupAction = "layout";
  // The layout or Studio request now out: its id (only its own answer ends it), and the timer that ends the wait when
  // no answer comes (a plugin restarted meanwhile never sends one).
  let setupRequestId = "";
  let setupCounter = 0;
  let setupTimer = null;
  // This page's own mark in its request ids: the plugin answers whichever page is open.
  const PAGE_ID = Math.random().toString(36).slice(2, 8);
  // The footer and the connection fold open by themselves once, when the first state says something there needs doing.
  let footerInitialized = false;
  const PRODUCT_NAME = "Fadester for OBS";
  // A connection test is running: the status line says so until the plugin reports the test done.
  let connectionTesting = false;
  let connectionTestTimer = null;
  // The longest the line waits for that report (a plugin restarted meanwhile never sends it).
  const CONNECTION_TEST_LIMIT_MS = 10000;
  // Texts come from ui/i18n.js (loaded first), in the plugin's language: Stream Deck's, or the Language choice (R-LANG-3).
  const T = function (key, params) { return window.FadesterI18n.t(key, params); };
  // The Language choice (PLAN.md 11.1): Automatic, then the plugin's languages by their own names, never translated
  // (D-L3). The list is the plugin's own (src/i18n/strings.ts), written into ui/i18n.js with the texts.
  const LANGUAGE_CHOICES = window.FadesterI18n.languageChoices();
  // Every plugin's inspectors share one file:// origin, so the key names this plugin.
  const LANGUAGE_MEMORY_KEY = "fadester:resolvedLanguage";
  // The line that offers a ready-made layout at the top of the page goes once it was used (this computer remembers).
  const LAYOUT_HINT_KEY = "fadester:layoutHintSeen";

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
    return recall(LANGUAGE_MEMORY_KEY);
  }

  function recall(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function remember(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // No storage: the page works the same, it only shows the hint again next time.
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
      // What this control needs from OBS right now, with the button that does it.
      '<div id="direct-studio-setup" style="display:none"><p class="muted" data-i18n="studioSetupNote">This control uses Studio Mode. Prepare Preview from your existing scenes to start mixing.</p>',
      '<button id="direct-studio-prepare" class="btn" type="button">Enable Studio Mode &amp; prepare Preview</button></div>',
      '<div id="direct-setup-status" class="status-banner" style="display:none"></div>',
      '<p class="muted" id="direct-opendeck-starter" style="display:none"></p>',
      // Everything that belongs to the whole plugin, not to this key, behind one closed line at the foot of the page.
      // The line itself says which version this is and whether OBS is connected.
      '<details id="direct-plugin-footer" class="editor plugin-footer"><summary id="direct-footer-summary">Fadester for OBS</summary>',
      // One Language for the whole plugin, kept by the plugin (PLAN.md 11.1); the page only asks for a change.
      '<h3><span data-i18n="languageHeading">Language</span> <span class="scope" data-i18n="scopeAllControls">all Fadester for OBS controls</span></h3>',
      '<div class="row"><label for="direct-language" data-i18n="languageHeading">Language</label><select id="direct-language">',
      '<option value="auto" data-i18n="languageAuto">Automatic (Stream Deck\'s language)</option>',
      LANGUAGE_CHOICES.map(function (entry) {
        return '<option value="' + entry[0] + '" lang="' + entry[0].replace("_", "-") + '">' + entry[1] + "</option>";
      }).join(""),
      '</select></div>',
      '<p class="muted" id="direct-language-note" data-i18n="languageNote">For every Fadester for OBS key and dial. Stream Deck\'s own menus stay in Stream Deck\'s language.</p>',
      '<h3><span data-i18n="connHeading">OBS connection</span> <span class="scope" data-i18n="scopeAllControls">all Fadester for OBS controls</span></h3>',
      '<div id="direct-conn-status" class="status-banner status-info" data-i18n="connWaiting">Looking for OBS…</div>',
      '<p class="muted" id="direct-conn-hint" data-i18n="connHintShared">One OBS connection is shared by all Fadester for OBS keys and dials.</p>',
      // The one way to drop a typed password (an emptied box is "no change"): shown only while one is stored.
      '<div class="row" id="direct-conn-own-row" style="display:none"><label></label><button id="direct-conn-use-obs" class="btn secondary" type="button" data-i18n="connUseObsPassword">Use OBS\'s own password</button></div>',
      // With OBS on this computer there is nothing to fill in, so the fields stay folded away.
      '<details id="direct-conn-editor" class="editor"><summary id="direct-conn-summary" data-i18n="connOtherComputer">OBS on another computer, or another port</summary>',
      '<p class="muted" data-i18n="connAppliesAll">With OBS on this computer there is nothing to fill in: the port and the password are read from OBS. Fill this in for OBS on another computer, or when signing in fails.</p>',
      '<div class="row"><label for="direct-conn-host" data-i18n="host">Host</label><input id="direct-conn-host" type="text" value="127.0.0.1" /></div>',
      '<div class="row"><label for="direct-conn-port" data-i18n="port">Port</label><input id="direct-conn-port" type="number" value="4455" min="1" max="65535" /></div>',
      '<div class="row"><label for="direct-conn-password" data-i18n="password">OBS password</label><input id="direct-conn-password" type="password" autocomplete="off" placeholder="Automatic" data-i18n-placeholder="passwordPlaceholderFromObs" /></div>',
      '<div class="row"><label></label><button id="direct-conn-test" class="btn" type="button" data-i18n="saveAndTest">Save for all controls &amp; test</button></div>',
      '</details>',
      '<details id="direct-setup-checklist" class="editor"><summary data-i18n="chkHeading">Setup checklist</summary>',
      '<p class="muted" data-i18n="chkIntro">Red is what must be fixed. Everything else is a note.</p>',
      '<div id="direct-checklist-list" class="checklist-list"></div>',
      '<div class="editor-actions"><button id="direct-checklist-refresh" class="btn secondary" type="button" data-i18n="chkCheckAgain">Check again</button></div>',
      '</details>',
      '<details id="direct-elgato-layouts" class="editor"><summary data-i18n="layoutsSummary">Ready-made layouts</summary>',
      '<p class="muted" id="direct-layouts-none" style="display:none" data-i18n="layoutsNone">No ready-made layout for this deck yet. Drag Scene onto a key to begin.</p>',
      '<div id="direct-layouts-body">',
      '<p class="muted" data-i18n="layoutsIntro">Fills this deck with keys that already follow your scenes and audio. You can change every key.</p>',
      '<div class="row"><label for="direct-layout" data-i18n="layoutLabel">Layout</label><select id="direct-layout"></select></div>',
      '<div class="row"><label></label><button id="direct-layout-open" class="btn" type="button">Open this layout</button></div>',
      '<p class="muted" id="direct-layout-hint" style="display:none"></p>',
      '<p class="muted" data-i18n="layoutsInstallNote">The layout installs once as a profile you can edit. Layouts you changed earlier stay.</p>',
      '</div>',
      '</details>',
      // The lists follow OBS by themselves; this is the last resort when one looks stale.
      '<div class="editor-actions"><button id="direct-refresh-lists" class="btn secondary" type="button" data-i18n="refreshLists">Refresh lists</button></div>',
      '</details>'
    ].join("");
    window.FadesterI18n.apply(mount);

    const host = $("direct-conn-host");
    const port = $("direct-conn-port");
    const password = $("direct-conn-password");
    const test = $("direct-conn-test");
    const refreshChecklist = $("direct-checklist-refresh");
    function pushConnection() {
      const payload = {
        event: "directUpdateGlobalSettings",
        host: host ? host.value : "127.0.0.1",
        port: port ? Number(port.value) : 4455
      };
      // A saved password is deliberately never echoed into the inspector. An empty box is "no change", never "no
      // password": typing and deleting again fires no change event, and the next host or port save would clear it.
      if (passwordDirty && password && password.value !== "") payload.password = password.value;
      sendToPlugin(payload);
      passwordDirty = false;
    }
    if (password) {
      password.oninput = function () { passwordDirty = password.value !== ""; };
      password.onchange = pushConnection;
    }
    if (host) host.onchange = pushConnection;
    if (port) port.onchange = pushConnection;
    const useObs = $("direct-conn-use-obs");
    if (useObs) useObs.onclick = function () {
      // The stored password goes; the plugin signs in with OBS's own saved one and tests at once.
      passwordDirty = false;
      if (password) password.value = "";
      startConnectionTest();
      sendToPlugin({ event: "directUseObsPassword" });
    };
    const refreshLists = $("direct-refresh-lists");
    if (refreshLists) refreshLists.onclick = function () { window.directObsRefresh(); };
    const topLayouts = $("direct-top-layouts");
    if (topLayouts) topLayouts.onclick = function () {
      // Straight to the layout picker; the line has done its job and does not come back.
      const footer = $("direct-plugin-footer");
      const layouts = $("direct-elgato-layouts");
      if (footer) footer.open = true;
      if (layouts) {
        layouts.open = true;
        if (typeof layouts.scrollIntoView === "function") layouts.scrollIntoView();
      }
      remember(LAYOUT_HINT_KEY, "1");
      topLayouts.style.display = "none";
    };
    if (refreshChecklist) refreshChecklist.onclick = function () {
      sendToPlugin({ event: "directRunChecklist" });
    };
    if (test) test.onclick = function () {
      pushConnection();
      startConnectionTest();
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
        beginSetup("layout");
        updateLayoutButton();
        setBanner($("direct-setup-status"), T("layoutPreparing"), "info");
        sendToPlugin({ event: "directActivateLayout", slug: layout.slug, prepareStudio: layout.obsMode === "studio", requestId: setupRequestId });
      }
    };
    const layoutPicker = $("direct-layout");
    if (layoutPicker) layoutPicker.onchange = function () { layoutPicked = true; updateLayoutButton(); };
    // Opening the list and keeping the layout it shows is a choice too (no change event then): it stays.
    if (layoutPicker) layoutPicker.onclick = function () { layoutPicked = true; };
    const prepareStudio = $("direct-studio-prepare");
    if (prepareStudio) prepareStudio.onclick = function () {
      if (layoutBusy) return;
      beginSetup("studio");
      updateStudioSetup();
      setBanner($("direct-setup-status"), T("studioPreparing"), "info");
      sendToPlugin({ event: "directPrepareStudio", requestId: setupRequestId });
    };
  }

  /** Feedback that a connection test runs, also when its result is the same sentence as before; the button stays usable. */
  function startConnectionTest() {
    connectionTesting = true;
    window.clearTimeout(connectionTestTimer);
    connectionTestTimer = window.setTimeout(endConnectionTest, CONNECTION_TEST_LIMIT_MS);
    setBanner($("direct-conn-status"), T("connTesting"), "info");
  }

  /** A layout or Studio Mode request leaves: "Preparing…" until its own answer, or until the wait runs out. */
  function beginSetup(action) {
    layoutBusy = true;
    setupAction = action;
    setupCounter += 1;
    setupRequestId = "setup_" + PAGE_ID + "_" + setupCounter;
    window.clearTimeout(setupTimer);
    setupTimer = window.setTimeout(function () {
      // No answer (the plugin restarted meanwhile): the buttons come back and the page says so.
      setupTimer = null;
      if (!layoutBusy) return;
      endSetup();
      setBanner($("direct-setup-status"), T("setupNoAnswer"), "err");
    }, CONNECTION_TEST_LIMIT_MS);
  }

  function endSetup() {
    window.clearTimeout(setupTimer);
    setupTimer = null;
    layoutBusy = false;
    setupRequestId = "";
    updateLayoutButton();
    updateStudioSetup();
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
    if (id === "visual_sidechain" && code === "vs_conflict") {
      return item.meta && item.meta.version
        ? T("chkDetailVsConflict", { version: item.meta.version })
        : T("chkDetailVsConflict", { version: "" }).replace(/\s+/g, " ").trim();
    }
    if (id === "visual_sidechain" && code === "vs_off") return T("chkDetailVsOff");
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
      if (code === "port_other" || code === "port_standalone") return T("chkDetailPortOther", metaParams);
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
    if (item.id === "visual_sidechain" && code === "vs_conflict") return T("chkFixVsConflict");
    if (item.id === "visual_sidechain" && code === "vs_off") return T("chkFixVsOff");
    if (item.id === "playlister" && code === "missing") return T("chkFixPlMissing");
    if (code === "port_other") return T("chkFixPortOther", metaParams);
    if (code === "port_standalone") return T("chkFixPortStandalone", metaParams);
    if (code === "port_unknown_holder") return T("chkFixPortUnknown", metaParams);
    return item.fix || "";
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
    let group = "";
    let neededFails = false;
    report.items.forEach(function (item) {
      // Three groups: what every control needs, what only the T-bar dial needs, and the optional extras.
      if (item.group && item.group !== group) {
        group = item.group;
        const heading = document.createElement("div");
        heading.className = "chk-group";
        heading.textContent = T(group === "needed" ? "chkGroupNeeded" : group === "tbar" ? "chkGroupTbar" : "chkGroupOptional");
        list.appendChild(heading);
      }
      if (item.group === "needed" && item.state === "fail") neededFails = true;
      const row = document.createElement("div");
      row.className = "chk-row";
      const dot = document.createElement("span");
      dot.className = "chk-dot chk-" + (item.state || "unknown");
      // A mark inside the dot, so the state is not told by colour alone.
      dot.textContent = item.state === "ok" ? "✓" : item.state === "fail" || item.state === "warn" ? "!"
        : item.state === "note" || item.state === "info" ? "i" : "";
      dot.setAttribute("aria-hidden", "true");
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
    // Something that must be fixed: the checklist is open when the user gets to it.
    const fold = $("direct-setup-checklist");
    if (fold && neededFails) fold.open = true;
  }

  /**
   * The ready-made layout to offer first: the Scene Desk for OBS's mode (Studio Mode on, or off), else a layout that
   * works in either mode, else the first. studioMode is null while OBS is not connected: the regular Scene Desk then,
   * which needs nothing from OBS to open.
   */
  function suggestedLayout(layouts, studioMode) {
    if (!layouts || layouts.length === 0) return null;
    const mode = studioMode ? "studio" : "regular";
    const sceneDesk = function (layout) { return /(^|-)scene-(desk|regular)$/.test(layout.slug); };
    return layouts.find(function (layout) { return layout.obsMode === mode && sceneDesk(layout); })
      || layouts.find(function (layout) { return layout.obsMode === "either"; })
      || layouts[0];
  }

  /** Whether a ready-made layout was already offered and looked at on this computer. */
  function layoutHintSeen() {
    return recall(LAYOUT_HINT_KEY) === "1";
  }

  function updateConnection(state) {
    const connection = state.connection || {};
    const status = state.status || {};
    const connected = status.kind === "connected";
    const host = $("direct-conn-host");
    const port = $("direct-conn-port");
    const hint = $("direct-conn-hint");
    const password = $("direct-conn-password");
    const editor = $("direct-conn-editor");
    const footer = $("direct-plugin-footer");
    // The plugin says whether the host is this computer (one rule, the plugin's); an older plugin does not say.
    const local = connection.local !== false;
    if (host && document.activeElement !== host) host.value = connection.host || "127.0.0.1";
    if (port && document.activeElement !== port) port.value = String(connection.port || 4455);
    const followedPort = connected && connection.portInUse && connection.portInUse !== connection.port ? connection.portInUse : 0;
    if (hint) hint.textContent = status.kind === "wrong_password"
      ? T("connHintRejected")
      : connection.passwordSet
      ? T("connHintSaved")
      : followedPort
      ? T("connPortFromObs", { port: followedPort })
      : connection.obsSaved && connected
      ? T("passwordFromObs")
      : T("connHintShared");
    // A typed password is stored: the one way to drop it and go back to OBS's own.
    const ownRow = $("direct-conn-own-row");
    if (ownRow) ownRow.style.display = connection.passwordSet && local ? "" : "none";
    if (password && !passwordDirty && document.activeElement !== password) {
      password.value = "";
      password.placeholder = T(connection.passwordSet ? "passwordPlaceholderSaved" : "passwordPlaceholderFromObs");
    }
    // Once, from the first state: with OBS on this computer nothing here needs filling in, so everything stays
    // folded. A refused password, or OBS on another computer that does not answer, opens what has to be looked at.
    if (!footerInitialized) {
      footerInitialized = true;
      const needsHands = status.kind === "wrong_password" || (!connected && !local);
      if (editor) editor.open = needsHands;
      if (footer && needsHands) footer.open = true;
    }
    // The status sentence arrives worded in the plugin's language (the same as this page's). While a test
    // runs, the line keeps saying so (in the page's current language).
    const sentence = connectionTesting ? T("connTesting") : status.sentence || T("connWaiting");
    const kind = connectionTesting || !status.kind ? "info" : connected ? "ok" : "err";
    setBanner($("direct-conn-status"), sentence, kind);
    // Not connected: what to do is the first line of the page, above the key's own fields, and the key's own
    // banners (which would name a missing scene or input that is only missing because OBS is) stay out of the way.
    setBanner($("direct-top-status"), connected ? "" : sentence, kind);
    if (document.body) document.body.className = connected ? "" : "obs-offline";
    const summary = $("direct-footer-summary");
    if (summary) {
      const params = { product: PRODUCT_NAME, version: state.pluginVersion || "", obsVersion: status.obsVersion || "" };
      summary.textContent = (connected ? T("footerConnected", params) : T("footerNotConnected", params)).replace(/\s+/g, " ").trim();
    }
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
    // A deck model with no ready-made layout says so, in place of an empty list and a dead button.
    const none = $("direct-layouts-none");
    const body = $("direct-layouts-body");
    if (none) none.style.display = layouts.length === 0 ? "" : "none";
    if (body) body.style.display = layouts.length === 0 ? "none" : "";
    // A new deck: one line at the top offers a ready-made layout, until it was looked at once.
    const topLayouts = $("direct-top-layouts");
    if (topLayouts) {
      const offer = connected && !openDeck && layouts.length > 0 && !layoutHintSeen();
      topLayouts.textContent = T("layoutTopHint");
      topLayouts.style.display = offer ? "" : "none";
    }
    // The layout that fits OBS as it is now comes first and is already chosen (U2-04): the Scene Desk for OBS's mode,
    // Studio or regular. A choice the operator made stays; the other layouts follow in their own order.
    const picker = $("direct-layout");
    const suggested = suggestedLayout(layouts, state.catalog ? state.catalog.studioMode === true : null);
    const ordered = suggested ? [suggested].concat(layouts.filter(function (layout) { return layout !== suggested; })) : layouts;
    // Until the operator picks, the choice follows OBS (a page opened before OBS answered moves to the Studio desk
    // when OBS says Studio Mode is on). The list is left alone while it has the focus (fillSelect).
    const selected = layoutPicked ? (picker && picker.value || "") : (suggested ? suggested.slug : "");
    fillSelect(picker, ordered.map(function (layout) { return { value: layout.slug, text: layout.name }; }), selected, T("layoutChoose"));
    updateLayoutButton();
    updateStudioSetup();
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

  /**
   * A fold inside a key's own fields (Timing, Advanced). It opens by itself when a setting inside it is in use, so
   * nothing that acts is hidden; when that changes it follows once, and otherwise the user's own click stays.
   * `shown === false` takes the whole fold away (its rows do not apply to this key now).
   */
  const foldWanted = {};
  window.directObsFold = function (id, inUse, shown) {
    const fold = $(id);
    if (!fold) return;
    fold.style.display = shown === false ? "none" : "";
    if (foldWanted[id] === Boolean(inUse)) return;
    foldWanted[id] = Boolean(inUse);
    fold.open = Boolean(inUse);
  };
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
      // remembered or the remembered one is not one of the thirteen. The plugin's first state message settles it.
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
          if (typeof window.showFadesterPluginVersion === "function") window.showFadesterPluginVersion(currentState.pluginVersion);
          updateLanguage(currentState.language);
          updateConnection(currentState);
          refreshControls();
        }
        if (message.event === "sendToPropertyInspector" && message.payload && message.payload.event === "directTestDone") {
          endConnectionTest();
          sendToPlugin({ event: "directRunChecklist" });
        }
        if (message.event === "sendToPropertyInspector" && message.payload && message.payload.event === "directSetupResult") {
          // Only the answer to this page's own request: one meant for the page that was open before says nothing
          // here (an answer without an id is from a plugin that does not send them back yet).
          if (message.payload.requestId && message.payload.requestId !== setupRequestId) return;
          if (!layoutBusy) return;
          // Each request says what it did: a layout opened, or Studio Mode and Preview made ready.
          const done = setupAction === "studio" ? T("studioPrepared") : T("setupDone");
          if (message.payload.ok && setupAction === "layout") remember(LAYOUT_HINT_KEY, "1");
          endSetup();
          setBanner($("direct-setup-status"), message.payload.ok ? done : message.payload.error || T("setupFailed"), message.payload.ok ? "ok" : "err");
        }
      };
    };
  };
})();

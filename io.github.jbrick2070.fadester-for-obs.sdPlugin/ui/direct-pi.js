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
      '<h3><span data-i18n="languageHeading">Language</span> <span class="scope" data-i18n="scopeAllControls">all Fadester controls</span></h3>',
      '<div class="row"><label for="direct-language" data-i18n="languageHeading">Language</label><select id="direct-language">',
      '<option value="auto" data-i18n="languageAuto">Automatic (Stream Deck\'s language)</option>',
      LANGUAGE_CHOICES.map(function (entry) {
        return '<option value="' + entry[0] + '" lang="' + entry[0].replace("_", "-") + '">' + entry[1] + "</option>";
      }).join(""),
      '</select></div>',
      '<p class="muted" id="direct-language-note" data-i18n="languageNote">Applies to all Fadester for OBS controls. Stream Deck\'s own menus, action list, tooltips and dial hints stay in Stream Deck\'s language.</p>',
      '<h3><span data-i18n="connHeading">OBS connection</span> <span class="scope" data-i18n="scopeAllControls">all Fadester controls</span></h3>',
      '<div id="direct-conn-status" class="status-banner status-err" data-i18n="connWaiting">Waiting for OBS…</div>',
      '<p class="muted" id="direct-conn-hint" data-i18n="connHintOnce">Connect once for every Fadester button and dial.</p>',
      '<details id="direct-conn-editor" class="editor" open><summary id="direct-conn-summary" data-i18n="connSetupOnce">Set up OBS once</summary>',
      '<p class="muted" data-i18n="connAppliesAll">These settings apply to all Fadester controls on all your layouts. Enter the OBS password once here.</p>',
      '<div class="row"><label for="direct-conn-host" data-i18n="host">Host</label><input id="direct-conn-host" type="text" value="127.0.0.1" /></div>',
      '<div class="row"><label for="direct-conn-port" data-i18n="port">Port</label><input id="direct-conn-port" type="number" value="4455" min="1" max="65535" /></div>',
      '<div class="row"><label for="direct-conn-password" data-i18n="password">Password</label><input id="direct-conn-password" type="password" autocomplete="off" placeholder="Enter the OBS password once" data-i18n-placeholder="passwordPlaceholderOnce" /></div>',
      '<div class="row"><label></label><button id="direct-conn-test" class="btn" type="button" data-i18n="saveAndTest">Save for all controls &amp; test</button></div>',
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
    if (host) host.onchange = pushConnection;
    if (port) port.onchange = pushConnection;
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

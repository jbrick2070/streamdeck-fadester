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
      missing.textContent = selected + " (not in OBS now)";
      missing.selected = true;
      el.appendChild(missing);
    }
  }

  function renderSharedSections() {
    const mount = $("direct-shared-sections");
    if (!mount || mount.dataset.ready === "true") return;
    mount.dataset.ready = "true";
    mount.innerHTML = [
      '<h3>OBS connection <span class="scope">all Fadester controls</span></h3>',
      '<div id="direct-conn-status" class="status-banner status-err">Waiting for OBS…</div>',
      '<p class="muted" id="direct-conn-hint">Connect once for every Fadester button and dial.</p>',
      '<details id="direct-conn-editor" class="editor" open><summary id="direct-conn-summary">Set up OBS once</summary>',
      '<p class="muted">These settings apply to all Fadester controls on all your layouts. Enter the OBS password once here.</p>',
      '<div class="row"><label for="direct-conn-host">Host</label><input id="direct-conn-host" type="text" value="127.0.0.1" /></div>',
      '<div class="row"><label for="direct-conn-port">Port</label><input id="direct-conn-port" type="number" value="4455" min="1" max="65535" /></div>',
      '<div class="row"><label for="direct-conn-password">Password</label><input id="direct-conn-password" type="password" autocomplete="off" placeholder="Enter the OBS password once" /></div>',
      '<div class="row"><label></label><button id="direct-conn-test" class="btn" type="button">Save for all controls &amp; test</button></div>',
      '</details>',
      '<div id="direct-studio-setup" style="display:none"><p class="muted">This control uses Studio Mode. Prepare Preview from your existing scenes to start mixing.</p>',
      '<button id="direct-studio-prepare" class="btn" type="button">Enable Studio Mode &amp; prepare Preview</button></div>',
      '<div id="direct-setup-status" class="status-banner" style="display:none"></div>',
      '<details class="editor"><summary>Ready-made layouts</summary>',
      '<p class="muted">Open an editable full, half, or creative desk. Scene buttons follow your current OBS scene list automatically. Main audio and microphone controls use matching OBS mixer inputs when available.</p>',
      '<p class="muted">The current starter installs as an editable profile once. Any older layouts you customized stay available.</p>',
      '<div class="row"><label for="direct-layout">Layout</label><select id="direct-layout"></select></div>',
      '<div class="row"><label></label><button id="direct-layout-open" class="btn" type="button">Open current starter layout</button></div>',
      '<p class="muted">Everyday Source Desks keep layer order fixed. Creative Layer Lab enables its labelled reorder controls.</p>',
      '</details>',
      '<details class="editor direct-optional"><summary>Optional: Midi Fadester integration</summary>',
      '<p class="muted">You do not need Midi Fadester, an APC40, or any MIDI controller for the controls above. The separately labelled <em>Midi Fadester (optional)</em> actions keep advanced shared slots and A/B layer mixing for people who use that setup.</p>',
      '</details>'
    ].join("");

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
      sendToPlugin({ event: "directTestConnection" });
    };
    const openLayout = $("direct-layout-open");
    if (openLayout) openLayout.onclick = function () {
      const select = $("direct-layout");
      const layout = currentState && (currentState.layouts || []).find(function (item) { return item.slug === (select && select.value); });
      if (layout && !layoutBusy) {
        layoutBusy = true;
        updateLayoutButton();
        setBanner($("direct-setup-status"), "Preparing layout…", "info");
        sendToPlugin({ event: "directActivateLayout", slug: layout.slug, prepareStudio: layout.obsMode === "studio" });
      }
    };
    const layoutPicker = $("direct-layout");
    if (layoutPicker) layoutPicker.onchange = updateLayoutButton;
    const prepareStudio = $("direct-studio-prepare");
    if (prepareStudio) prepareStudio.onclick = function () {
      if (layoutBusy) return;
      layoutBusy = true;
      updateStudioSetup();
      setBanner($("direct-setup-status"), "Preparing Studio Mode and Preview…", "info");
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
    button.textContent = layoutBusy ? "Preparing…" : studio
      ? (state.catalog && state.catalog.studioMode ? "Prepare Preview & open current starter layout" : "Enable Studio Mode & open current starter layout")
      : "Open current starter layout";
    button.disabled = layoutBusy || !layout || (studio && (!state.status || state.status.kind !== "connected"));
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
      button.textContent = layoutBusy ? "Preparing…" : catalog.studioMode ? "Prepare a different Preview" : "Enable Studio Mode & prepare Preview";
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
    if (hint) hint.textContent = status.kind === "wrong_password"
      ? "OBS rejected the saved shared password. Replace it once here for all Fadester controls."
      : connection.passwordSet
      ? "Password saved for all Fadester buttons and dials. You do not need to enter it again."
      : "One OBS connection is shared by all Fadester buttons and dials.";
    if (summary) summary.textContent = connection.passwordSet || status.kind === "connected"
      ? "Edit shared connection" : "Set up OBS once";
    if (password && !passwordDirty && document.activeElement !== password) {
      password.value = "";
      password.placeholder = connection.passwordSet ? "Saved — leave blank to keep" : "Enter the OBS password once";
    }
    if (editor && !connectionEditorInitialized) {
      editor.open = !(connection.passwordSet || status.kind === "connected") || status.kind === "wrong_password";
      connectionEditorInitialized = true;
    }
    const kind = status.kind === "connected" ? "ok" : "err";
    setBanner($("direct-conn-status"), status.sentence || "Waiting for OBS…", kind);
    const layouts = state.layouts || [];
    const picker = $("direct-layout");
    const selected = picker && picker.value || "";
    fillSelect(picker, layouts.map(function (layout) { return { value: layout.slug, text: layout.name }; }), selected, "Choose a ready-made layout");
    updateLayoutButton();
    updateStudioSetup();
  }

  function refreshControls() {
    if (typeof bindControls === "function") {
      bindControls(currentSettings, save, currentState);
    }
    updateStudioSetup();
  }

  window.directObsFillSelect = fillSelect;
  window.directObsAudioItems = function (state) {
    const catalog = state && state.catalog || {};
    const resolved = state && state.automaticInputs || {};
    const automatic = [
      { value: "__audio_main__", text: "Main audio (automatic)" },
      { value: "__audio_mic__", text: "Microphone (automatic)" },
      { value: "__audio_aux__", text: "Aux audio (automatic)" },
      { value: "__audio_input_2__", text: "Audio input 3 (automatic)" }
    ].map(function (item) {
      return { value: item.value, text: item.text + " — " + (resolved[item.value] || "not available") };
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
          updateConnection(currentState);
          refreshControls();
        }
        if (message.event === "sendToPropertyInspector" && message.payload && message.payload.event === "directSetupResult") {
          layoutBusy = false;
          setBanner($("direct-setup-status"), message.payload.ok ? "Request completed. Accept the Stream Deck import prompt if one appears." : message.payload.error || "Could not prepare this layout.", message.payload.ok ? "ok" : "err");
          updateLayoutButton();
          updateStudioSetup();
        }
      };
    };
  };
})();

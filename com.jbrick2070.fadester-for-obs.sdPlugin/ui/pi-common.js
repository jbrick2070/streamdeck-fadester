// SPDX-License-Identifier: GPL-2.0-or-later
/* global WebSocket, window, document */

/**
 * Shared Property Inspector runtime for every Fadester for OBS action.
 *
 * Settings scopes, made explicit in the UI:
 *   - "This action": saved per Stream Deck key or dial (setSettings).
 *   - "Slot assignment in OBS": lives in Midi Fadester and is shared by every
 *     surface (APC40, Stream Deck, websocket). Edited via set_slot.
 *   - "Controller" and "OBS connection": shared by all Fadester actions
 *     (global settings / load_profile).
 *
 * Nothing here is hard-coded to a controller. Slot names, availability,
 * profile, target modes and curves all arrive from the plugin, which reads
 * them from the live Midi Fadester API; the only static list is the contract's
 * known profile slugs, and the UI labels it as such.
 */
(function () {
  const ALL_FX_ID = "__all_fx__";
  // Texts come from ui/i18n.js (loaded first), in Stream Deck's language (R-I18N-1).
  // Slot names below mirror Midi Fadester's API names and stay as the API has them.
  const T = function (key, params) { return window.FadesterI18n.t(key, params); };
  const CONTRACT_SLOT_FALLBACK = [
    { id: "crossfader", name: "Crossfader", kind: "crossfader" },
    { id: "fader_1", name: "Fader 1", kind: "fader" },
    { id: "fader_2", name: "Fader 2", kind: "fader" },
    { id: "fader_3", name: "Fader 3", kind: "fader" },
    { id: "fader_4", name: "Fader 4", kind: "fader" },
    { id: "fader_5", name: "Fader 5", kind: "fader" },
    { id: "fader_6", name: "Fader 6", kind: "fader" },
    { id: "fader_7", name: "Fader 7", kind: "fader" },
    { id: "fader_8", name: "Fader 8", kind: "fader" },
    { id: "master", name: "Master", kind: "master" },
    { id: "fx_1", name: "FX 1", kind: "fx" },
    { id: "fx_2", name: "FX 2", kind: "fx" },
    { id: "fx_3", name: "FX 3", kind: "fx" },
    { id: "fx_4", name: "FX 4", kind: "fx" },
    { id: "fx_5", name: "FX 5", kind: "fx" },
    { id: "fx_6", name: "FX 6", kind: "fx" },
    { id: "fx_7", name: "FX 7", kind: "fx" },
    { id: "fx_8", name: "FX 8", kind: "fx" }
  ];

  let ws = null;
  let uuid = "";
  let actionInfo = {};
  let currentSettings = {};
  let lastState = null;
  let lastSlotSignature = "";
  let passwordDirty = false;
  let requestCounter = 0;
  const pendingReplies = new Map();
  let overviewCatalog = null;
  let sourceCatalogCache = {};
  let editorDirty = false;
  let editorBaseline = null;
  let editorConflict = false;
  let editorGeneration = 0;
  let editRevision = 0;
  let catalogGeneration = 0;
  let applySequence = 0;
  let applying = false;
  let profileDraft = null;
  let profileLoading = false;

  function markEditorDirty() {
    editorDirty = true;
    editRevision += 1;
    setBanner($("assign-draft"), T("assignDraft"), "info");
  }

  function resetEditorContext() {
    editorGeneration += 1;
    applySequence += 1;
    applying = false;
    editorDirty = false;
    editorBaseline = null;
    editorConflict = false;
    const applyBtn = $("assign-apply");
    if (applyBtn) applyBtn.disabled = false;
    setBanner($("assign-draft"), "", "info");
    setBanner($("assign-result"), "", "info");
  }

  function $(id) {
    return document.getElementById(id);
  }

  function send(payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  function saveActionSettings(partial) {
    currentSettings = Object.assign({}, currentSettings, partial);
    send({ event: "setSettings", context: uuid, payload: currentSettings });
  }

  function sendToPlugin(payload) {
    send({
      action: actionInfo.action,
      event: "sendToPlugin",
      context: uuid,
      payload: payload
    });
  }

  /** sendToPlugin with a reply promise keyed by requestId. */
  function request(payload) {
    requestCounter += 1;
    const requestId = "pi_" + requestCounter;
    return new Promise(function (resolve) {
      const timer = setTimeout(function () {
        pendingReplies.delete(requestId);
        resolve({ error: T("noReply") });
      }, 6000);
      pendingReplies.set(requestId, function (reply) {
        clearTimeout(timer);
        resolve(reply);
      });
      sendToPlugin(Object.assign({ requestId: requestId }, payload));
    });
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

  function tierBadge(tier, label) {
    const span = document.createElement("span");
    span.className = "tier tier-" + (tier || "custom");
    span.textContent = label || tier || "";
    return span;
  }

  function option(value, text, selected, disabled) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = text;
    if (selected) opt.selected = true;
    if (disabled) opt.disabled = true;
    return opt;
  }

  function fillSelect(selectEl, items, selectedValue, placeholder) {
    if (!selectEl) return;
    selectEl.innerHTML = "";
    if (placeholder) {
      selectEl.appendChild(option("", placeholder, !selectedValue, false));
    }
    let found = false;
    for (const it of items) {
      const sel = it.value === selectedValue;
      found = found || sel;
      selectEl.appendChild(option(it.value, it.text, sel, false));
    }
    if (selectedValue && !found) {
      selectEl.appendChild(
        option(selectedValue, T("notInObsNow", { value: selectedValue }), true, false)
      );
    }
  }

  // ---------------------------------------------------------------- shared markup
  function renderSharedSections(mount) {
    if (!mount) return;
    mount.innerHTML = [
      '<h3><span data-i18n="assignHeading">Slot assignment in OBS</span> <span class="scope" data-i18n="scopeSharedSurfaces">shared by every surface</span></h3>',
      '<div id="assign-sentence" class="status-banner status-info"></div>',
      '<details id="assign-editor" class="editor">',
      '<summary data-i18n="changeSlot">Change what this slot does</summary>',
      '<p class="muted" data-i18n="assignIntro">Changes apply in Midi Fadester for the APC40, Stream Deck and every other surface. Pickers list only what the live OBS catalog offers.</p>',
      '<div class="row"><label for="assign-mode" data-i18n="whatItDoes">What it does</label><select id="assign-mode"></select></div>',
      '<div id="assign-fields"></div>',
      '<div id="assign-draft" class="status-banner status-info" style="display:none;"></div>',
      '<div class="editor-actions"><button id="assign-apply" class="btn" type="button" data-i18n="applyInObs">Apply in OBS</button><button id="assign-refresh" class="btn secondary" type="button" data-i18n="refreshLists">Refresh lists</button><button id="assign-discard" class="btn secondary" type="button" data-i18n="discardEdits">Discard edits</button></div>',
      '<div id="assign-result" class="status-banner" style="display:none;"></div>',
      "</details>",

      '<h3><span data-i18n="controllerHeading">Controller</span> <span class="scope" data-i18n="scopeShared">shared</span></h3>',
      '<div id="ctrl-status" class="status-banner status-info"></div>',
      '<details class="editor"><summary data-i18n="switchProfile">Switch controller profile</summary>',
      '<p class="muted" data-i18n="profileIntro">Loading a profile resets slot defaults in Midi Fadester for every surface. Only the active profile reports what the connected desk can do; this list is the API contract’s known profiles. Only APC40 mkII is verified on real hardware.</p>',
      '<div class="row"><label for="profile-select" data-i18n="profile">Profile</label><select id="profile-select"></select></div>',
      '<div class="row"><label></label><button id="profile-load" class="btn danger" type="button" data-i18n="loadProfile">Load profile</button></div>',
      '<div id="profile-result" class="status-banner" style="display:none;"></div>',
      "</details>",

      '<h3><span data-i18n="connHeading">OBS connection</span> <span class="scope" data-i18n="scopeAllControls">all Fadester controls</span></h3>',
      '<div id="conn-status" class="status-banner status-err" data-i18n="connWaitingPlugin">Waiting for the plugin…</div>',
      '<a id="conn-link" class="release-link" href="https://github.com/jbrick2070/midi-fadester/releases" target="_blank" data-i18n="downloadMf">Download Midi Fadester for OBS Studio 33</a>',
      '<p class="muted" data-i18n="connIntroMf">Connect once for every Fadester button and dial, including the direct OBS actions.</p>',
      '<details id="conn-editor" class="editor" open><summary data-i18n="connEdit">Edit shared connection</summary>',
      '<div class="row"><label for="conn-host" data-i18n="host">Host</label><input type="text" id="conn-host" value="127.0.0.1" /></div>',
      '<div class="row"><label for="conn-port" data-i18n="port">Port</label><input type="number" id="conn-port" value="4455" min="1" max="65535" /></div>',
      '<div class="row"><label for="conn-password" data-i18n="password">Password</label><input type="password" id="conn-password" autocomplete="off" placeholder="Leave blank if authentication is off" data-i18n-placeholder="passwordPlaceholderAuthOff" /></div>',
      '<div class="row"><label></label><button id="conn-test-btn" class="btn" type="button" data-i18n="saveAndTest">Save for all controls &amp; test</button><span class="hint" id="conn-hint"></span></div>',
      '</details>'
    ].join("");
    window.FadesterI18n.apply(mount);
  }

  // ---------------------------------------------------------------- slot dropdown
  // Slot name, label and reason are Midi Fadester's own texts and are shown as they come.
  function slotOptionText(s) {
    let text = s.name || s.id;
    if (s.label && s.label !== s.name) {
      text = T("slotOptionLabel", { name: text, label: s.label });
    }
    if (s.available === false && s.reason) {
      text = T("slotOptionReason", { text: text, reason: s.reason });
    } else if (s.live && s.target_mode === "unassigned") {
      text = T("slotOptionNotUsed", { text: text });
    }
    return text;
  }

  function populateSlotsDropdown(state) {
    const selectEl = $("slot-select");
    if (!selectEl) return;
    const allowAllFx = selectEl.dataset.allowAllFx === "true";
    const selectedSlot = currentSettings.slot || "crossfader";
    const liveSlots = state && Array.isArray(state.slots) && state.slots.length > 0 ? state.slots : null;
    const connected = Boolean(state && state.status && state.status.kind === "connected");

    const list = liveSlots
      ? liveSlots.map(function (s) { return Object.assign({ live: true }, s); })
      : CONTRACT_SLOT_FALLBACK.map(function (s) { return Object.assign({ live: false, available: true, reason: "", label: "" }, s); });

    const fxSupported = Boolean(state && state.capabilities && (state.capabilities.resetFx || state.capabilities.fxSlots));
    const signature = JSON.stringify([
      connected,
      allowAllFx,
      fxSupported,
      selectedSlot,
      list.map(function (s) { return [s.id, slotOptionText(s), s.kind]; })
    ]);
    if (signature === lastSlotSignature) return;
    if (document.activeElement === selectEl) return; // never rebuild under the operator's cursor
    lastSlotSignature = signature;

    selectEl.innerHTML = "";
    let currentReason = "";
    let seen = false;

    function appendGroup(label, items) {
      if (items.length === 0) return;
      const group = document.createElement("optgroup");
      group.label = label;
      for (const s of items) {
        const opt = option(s.id, slotOptionText(s), s.id === selectedSlot, false);
        if (s.id === selectedSlot) {
          seen = true;
          if (s.available === false && s.reason) currentReason = s.reason;
        }
        group.appendChild(opt);
      }
      selectEl.appendChild(group);
    }

    const faders = list.filter(function (s) { return s.kind !== "fx"; });
    const fx = list.filter(function (s) { return s.kind === "fx"; });
    const groupLabel = function (key) { return liveSlots ? T(key) : T("groupOffline", { group: T(key) }); };
    appendGroup(groupLabel("groupFaders"), faders);
    appendGroup(groupLabel("groupFx"), fx);

    if (allowAllFx && (fxSupported || selectedSlot === ALL_FX_ID || !liveSlots)) {
      const group = document.createElement("optgroup");
      group.label = T("groupAllFx");
      const text = T(fxSupported || !liveSlots ? "allFxClean" : "allFxNeeds");
      group.appendChild(option(ALL_FX_ID, text, selectedSlot === ALL_FX_ID, false));
      selectEl.appendChild(group);
      if (selectedSlot === ALL_FX_ID) seen = true;
    }

    if (!seen && selectedSlot) {
      selectEl.appendChild(option(selectedSlot, T("slotSaved", { slot: selectedSlot }), true, false));
    }

    setBanner($("slot-reason-banner"), currentReason, "err");
  }

  // ---------------------------------------------------------------- controller panel
  function updateControllerPanel(state) {
    const statusEl = $("ctrl-status");
    const profileSel = $("profile-select");
    if (!statusEl) return;
    statusEl.innerHTML = "";
    const connected = state.status && state.status.kind === "connected";
    if (!connected) {
      statusEl.textContent = T("ctrlOffline");
      statusEl.className = "status-banner status-info";
    } else {
      const p = state.profile || {};
      const d = state.device || {};
      const line = document.createElement("div");
      line.textContent = T("ctrlProfile", { name: p.displayName || p.slug || T("unknown") });
      line.appendChild(tierBadge(p.tier, p.tierLabel));
      statusEl.appendChild(line);
      const dev = document.createElement("div");
      // The device name and error are Midi Fadester's own texts.
      if (d.connected) {
        dev.textContent = T("midiConnected", { device: d.name || T("midiDevice") });
        statusEl.className = "status-banner status-ok";
      } else {
        dev.textContent = d.error
          ? T("midiError", { error: d.error })
          : d.name ? T("midiNotFound", { device: d.name }) : T("midiNone");
        statusEl.className = "status-banner status-warn";
      }
      statusEl.appendChild(dev);
      const sm = document.createElement("div");
      sm.textContent = T(state.studioMode ? "studioOn" : "studioOffTbar");
      statusEl.appendChild(sm);
    }

    if (profileSel && document.activeElement !== profileSel) {
      const active = state.profile ? state.profile.slug : "";
      fillSelect(
        profileSel,
        (state.knownProfiles || []).map(function (kp) {
          return {
            value: kp.slug,
            text: T(kp.slug === active ? "profileOptionActive" : "profileOption", { name: kp.displayName, tier: kp.tierLabel })
          };
        }),
        profileDraft === null ? active : profileDraft,
        ""
      );
    }
    const loadBtn = $("profile-load");
    if (loadBtn) loadBtn.disabled = !connected || profileLoading;
  }

  // ---------------------------------------------------------------- connection panel
  function updateConnectionPanel(state) {
    const statusEl = $("conn-status");
    const linkEl = $("conn-link");
    const hostEl = $("conn-host");
    const portEl = $("conn-port");
    const passEl = $("conn-password");
    const hintEl = $("conn-hint");

    if (state.connection) {
      if (hostEl && document.activeElement !== hostEl) hostEl.value = state.connection.host || "127.0.0.1";
      if (portEl && document.activeElement !== portEl) portEl.value = String(state.connection.port || 4455);
      if (passEl && !passwordDirty && document.activeElement !== passEl) {
        passEl.value = "";
        passEl.placeholder = T(state.connection.passwordSet
          ? "passwordPlaceholderSavedAll"
          : "passwordPlaceholderAuthOff");
      }
    }
    const connEditor = $("conn-editor");
    if (connEditor && !connEditor.dataset.initialized && state.connection) {
      connEditor.open = !state.connection.passwordSet || state.status.kind === "wrong_password";
      connEditor.dataset.initialized = "true";
    }
    if (statusEl && state.status) {
      statusEl.textContent = state.status.sentence || "";
      statusEl.className = "status-banner " + (state.status.kind === "connected" ? "status-ok" : "status-err");
    }
    if (linkEl && state.status) {
      linkEl.style.display = state.status.linkUrl ? "inline-block" : "none";
      if (state.status.linkUrl) linkEl.href = state.status.linkUrl;
    }
    if (hintEl) {
      hintEl.textContent = state.lastErrorComment && state.status.kind === "connected"
        ? T("lastObsError", { comment: state.lastErrorComment })
        : state.connection && state.connection.passwordSet ? T("passwordSavedAll") : "";
    }
  }

  // ---------------------------------------------------------------- slot assignment editor
  function currentSlotObject() {
    if (!lastState || !Array.isArray(lastState.slots)) return null;
    const id = currentSettings.slot || "crossfader";
    return lastState.slots.find(function (s) { return s.id === id; }) || null;
  }

  function updateAssignmentSentence(state) {
    const el = $("assign-sentence");
    const editor = $("assign-editor");
    if (!el) return;
    const slotId = currentSettings.slot || "crossfader";
    const connected = state.status && state.status.kind === "connected";
    if (slotId === ALL_FX_ID) {
      setBanner(el, T("allFxSentence"), "info");
      if (editor) editor.style.display = "none";
      return;
    }
    if (editor) editor.style.display = "";
    if (!connected) {
      setBanner(el, T("assignConnect"), "info");
      return;
    }
    const slot = currentSlotObject();
    if (!slot) {
      setBanner(el, T("slotNotReported", { slot: slotId }), "err");
      return;
    }
    const modeLabel = (state.targetModes || []).reduce(function (acc, m) {
      return m.id === slot.target_mode ? m.label : acc;
    }, slot.target_mode);
    // Name, label, reason and display_value are Midi Fadester's texts, shown as they come.
    const text = slot.label && slot.label !== slot.name
      ? T("assignLineLabel", { slot: slot.name || slot.id, mode: modeLabel, label: slot.label })
      : T("assignLine", { slot: slot.name || slot.id, mode: modeLabel });
    if (slot.available === false) {
      setBanner(el, slot.reason ? T("assignUnavailable", { line: text, reason: slot.reason }) : T("assignUnavailableNoReason", { line: text }),
        slot.target_mode === "unassigned" ? "info" : "warn");
    } else {
      setBanner(el, slot.display_value ? T("assignNow", { line: text, value: slot.display_value }) : text, "ok");
    }
  }

  function buildModeSelect(state) {
    const sel = $("assign-mode");
    if (!sel) return;
    const slot = currentSlotObject();
    const current = slot ? slot.target_mode : "unassigned";
    const catalog = Boolean(state.capabilities && state.capabilities.catalog);
    const items = (state.targetModes || []).filter(function (m) {
      return m.id !== "filter_param" || catalog || current === "filter_param";
    }).map(function (m) {
      let text = m.label;
      if (m.id === "tbar" && !state.studioMode) text = T("modeNeedsStudio", { mode: text });
      if (m.id === "filter_param" && !catalog) text = T("modeNeedsMf", { mode: text });
      return { value: m.id, text: text };
    });
    if (document.activeElement !== sel) {
      fillSelect(sel, items, editorDirty ? sel.value || current : current, "");
    }
  }

  function fieldRow(id, labelText, control) {
    const row = document.createElement("div");
    row.className = "row";
    const label = document.createElement("label");
    label.htmlFor = control.checkbox ? id + "-input" : id;
    label.textContent = labelText;
    row.appendChild(label);
    control.id = id;
    if (control.checkbox) control.checkbox.id = id + "-input";
    row.appendChild(control);
    return row;
  }

  function makeSelect(items, selected, placeholder) {
    const sel = document.createElement("select");
    fillSelect(sel, items, selected, placeholder);
    return sel;
  }

  function makeCheckbox(checked, hint) {
    const wrap = document.createElement("span");
    wrap.style.flex = "1";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = Boolean(checked);
    wrap.appendChild(cb);
    if (hint) {
      const h = document.createElement("span");
      h.className = "hint";
      h.textContent = " " + hint;
      wrap.appendChild(h);
    }
    wrap.checkbox = cb;
    return wrap;
  }

  function sceneLayers(sceneName) {
    if (!overviewCatalog || !Array.isArray(overviewCatalog.scenes)) return [];
    const scene = overviewCatalog.scenes.find(function (s) { return s.name === sceneName; });
    return scene ? scene.layers || [] : [];
  }

  function captureEditorDraft() {
    const draft = {};
    const fields = {
      "af-scene": "scene", "af-source-a": "source_a", "af-source-b": "source_b",
      "af-filter": "filter_name", "af-prop": "filter_prop", "af-from": "from_val",
      "af-to": "to_val", "af-curve": "curve", "af-cal-min": "cal_min", "af-cal-max": "cal_max"
    };
    for (const id of Object.keys(fields)) {
      const el = $(id);
      if (el) draft[fields[id]] = el.value;
    }
    for (const pair of [["af-enabled", "enabled"], ["af-bypass", "bypass_at_zero"], ["af-afv", "afv"]]) {
      const el = $(pair[0]);
      if (el && el.checkbox) draft[pair[1]] = el.checkbox.checked;
    }
    return draft;
  }

  function renderModeFields(mode, draft) {
    const host = $("assign-fields");
    if (!host) return;
    host.innerHTML = "";
    const generation = ++editorGeneration;
    if (!editorBaseline || (!editorDirty && !applying)) {
      editorBaseline = Object.assign({}, currentSlotObject() || {});
    }
    const slot = Object.assign({}, currentSlotObject() || {}, draft || {});
    const state = lastState || {};
    const catalog = Boolean(state.capabilities && state.capabilities.catalog) && overviewCatalog;
    const curves = (state.curves || []).map(function (c) { return { value: c.id, text: c.label }; });

    if (typeof slot.enabled === "boolean") {
      host.appendChild(fieldRow("af-enabled", T("enabled"), makeCheckbox(slot.enabled, T("enabledHint"))));
    }
    if (slot.cal_min !== undefined && slot.cal_max !== undefined) {
      const calibration = document.createElement("details");
      calibration.className = "editor";
      const summary = document.createElement("summary");
      summary.textContent = T("midiCalibration");
      calibration.appendChild(summary);
      for (const pair of [["af-cal-min", T("minimum"), "cal_min"], ["af-cal-max", T("maximum"), "cal_max"]]) {
        const input = document.createElement("input");
        input.type = "number";
        input.min = "0";
        input.step = "1";
        input.value = String(slot[pair[2]]);
        calibration.appendChild(fieldRow(pair[0], pair[1], input));
      }
      host.appendChild(calibration);
    }

    function noteNoCatalog() {
      if (catalog) return;
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = T(state.capabilities && state.capabilities.catalog ? "catalogLoading" : "catalogNeedsMf");
      host.appendChild(p);
    }

    function sceneControl(selected) {
      if (catalog) {
        return makeSelect(
          (overviewCatalog.scenes || []).map(function (s) { return { value: s.name, text: s.name }; }),
          selected,
          T("chooseScene")
        );
      }
      const inp = document.createElement("input");
      inp.type = "text";
      inp.value = selected || "";
      inp.placeholder = T("exactScene");
      return inp;
    }

    function layerControl(sceneName, selected, placeholder) {
      if (catalog) {
        return makeSelect(
          sceneLayers(sceneName).map(function (l) {
            return { value: l.name, text: l.has_audio ? T("layerHasAudio", { layer: l.name }) : l.name };
          }),
          selected,
          placeholder
        );
      }
      const inp = document.createElement("input");
      inp.type = "text";
      inp.value = selected || "";
      inp.placeholder = placeholder;
      return inp;
    }

    if (mode === "unassigned") {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = T("unassignedNote");
      host.appendChild(p);
      return;
    }

    if (mode === "tbar") {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = T(state.studioMode ? "tbarOn" : "tbarOff");
      host.appendChild(p);
      return;
    }

    if (mode === "crossfade_ab" || mode === "layer_opacity") {
      noteNoCatalog();
      // Older engines may report an empty scene; infer it from the catalog.
      let sceneName = slot.scene || "";
      if (!sceneName && catalog && slot.source_a) {
        const match = (overviewCatalog.scenes || []).find(function (sc) {
          return (sc.layers || []).some(function (l) { return l.name === slot.source_a; });
        });
        if (match) sceneName = match.name;
      }
      const sceneSel = sceneControl(sceneName);
      host.appendChild(fieldRow("af-scene", T("sceneLabel"), sceneSel));
      const aSel = layerControl(sceneSel.value, slot.source_a || "", T(mode === "crossfade_ab" ? "leftLayer" : "layer"));
      host.appendChild(fieldRow("af-source-a", T(mode === "crossfade_ab" ? "left" : "layer"), aSel));
      let bSel = null;
      if (mode === "crossfade_ab") {
        bSel = layerControl(sceneSel.value, slot.source_b || "", T("rightLayer"));
        host.appendChild(fieldRow("af-source-b", T("right"), bSel));
        host.appendChild(fieldRow("af-curve", T("feel"), makeSelect(curves, slot.curve || "dip_free", "")));
      }
      host.appendChild(fieldRow("af-afv", T("alsoFadeAudio"), makeCheckbox(slot.afv, T("alsoFadeAudioHint"))));
      const layerItems = function () {
        return sceneLayers(sceneSel.value).map(function (l) { return { value: l.name, text: l.has_audio ? T("layerHasAudio", { layer: l.name }) : l.name }; });
      };
      sceneSel.addEventListener("change", function () {
        if (!catalog) return;
        fillSelect(aSel, layerItems(), "", T(mode === "crossfade_ab" ? "leftLayer" : "layer"));
        if (bSel) fillSelect(bSel, layerItems(), "", T("rightLayer"));
      });
      return;
    }

    if (mode === "audio_volume") {
      noteNoCatalog();
      let ctrl;
      if (catalog) {
        ctrl = makeSelect(
          (overviewCatalog.audio_sources || []).map(function (a) {
            return { value: a.name, text: typeof a.db === "number" ? T("audioDb", { source: a.name, db: window.FadesterI18n.number(a.db, 1) }) : a.name };
          }),
          slot.source_a || "",
          T("chooseAudioSource")
        );
      } else {
        ctrl = document.createElement("input");
        ctrl.type = "text";
        ctrl.value = slot.source_a || "";
        ctrl.placeholder = T("exactAudioSource");
      }
      host.appendChild(fieldRow("af-source-a", T("source"), ctrl));
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = T("mixerLaw");
      host.appendChild(p);
      return;
    }

    if (mode === "filter_param") {
      if (!catalog) {
        noteNoCatalog();
        return;
      }
      const hosts = (overviewCatalog.filter_hosts || []).filter(function (h) { return h.filter_count > 0; });
      const hostSel = makeSelect(
        hosts.map(function (h) {
          const name = h.is_scene ? T("filterHostScene", { source: h.source }) : h.source;
          return { value: h.source, text: window.FadesterI18n.plural("filterHost", h.filter_count, { source: name }) };
        }),
        slot.source_a || "",
        T("chooseSourceOrScene")
      );
      host.appendChild(fieldRow("af-source-a", T("source"), hostSel));
      const filterSel = makeSelect([], slot.filter_name || "", T("chooseFilter"));
      host.appendChild(fieldRow("af-filter", T("filter"), filterSel));
      const propSel = makeSelect([], slot.filter_prop || "", T("chooseSetting"));
      host.appendChild(fieldRow("af-prop", T("setting"), propSel));
      const fromInp = document.createElement("input");
      fromInp.type = "number";
      fromInp.step = "any";
      fromInp.value = slot.from_val !== undefined ? String(slot.from_val) : "";
      host.appendChild(fieldRow("af-from", T("at0"), fromInp));
      const toInp = document.createElement("input");
      toInp.type = "number";
      toInp.step = "any";
      toInp.value = slot.to_val !== undefined ? String(slot.to_val) : "";
      host.appendChild(fieldRow("af-to", T("at100"), toInp));
      host.appendChild(fieldRow("af-bypass", T("bypassAt0"), makeCheckbox(slot.bypass_at_zero !== false, T("bypassHint"))));
      const rangeHint = document.createElement("p");
      rangeHint.className = "muted";
      rangeHint.id = "af-range-hint";
      host.appendChild(rangeHint);
      const fullRangeBtn = document.createElement("button");
      fullRangeBtn.type = "button";
      fullRangeBtn.id = "af-full-range";
      fullRangeBtn.className = "btn secondary";
      fullRangeBtn.textContent = T("useFullRange");
      fullRangeBtn.disabled = true;
      host.appendChild(fullRangeBtn);
      const catalogError = document.createElement("div");
      catalogError.id = "af-catalog-error";
      catalogError.style.display = "none";
      host.appendChild(catalogError);

      function propsFor(source, filterName) {
        const detail = sourceCatalogCache[source];
        if (!detail || !Array.isArray(detail.filters)) return [];
        const f = detail.filters.find(function (x) { return x.name === filterName; });
        return f ? f.properties || [] : [];
      }

      function fillProps(keepSelection) {
        const props = propsFor(hostSel.value, filterSel.value);
        const selected = keepSelection ? propSel.value || slot.filter_prop || "" : "";
        // Property labels and suffixes are OBS's own texts.
        fillSelect(propSel, props.map(function (p) {
          return { value: p.name, text: T(p.suffix ? "propOptionSuffix" : "propOption", { label: p.label || p.name, min: p.min, max: p.max, suffix: p.suffix || "" }) };
        }), selected, T("chooseSetting"));
        applyRangeHint();
      }

      function applyRangeHint() {
        const props = propsFor(hostSel.value, filterSel.value);
        const p = props.find(function (x) { return x.name === propSel.value; });
        if (!p) {
          rangeHint.textContent = "";
          fullRangeBtn.disabled = true;
          return;
        }
        fullRangeBtn.disabled = false;
        rangeHint.textContent = T(p.suffix ? "rangeHintSuffix" : "rangeHint", { label: p.label || p.name, min: p.min, max: p.max, suffix: p.suffix || "" });
        if (fromInp.value === "" && toInp.value === "") {
          fromInp.placeholder = String(p.min);
          toInp.placeholder = String(p.max);
        }
      }

      fullRangeBtn.addEventListener("click", function () {
        const p = propsFor(hostSel.value, filterSel.value).find(function (x) { return x.name === propSel.value; });
        if (!p) return;
        fromInp.value = String(p.min);
        toInp.value = String(p.max);
        markEditorDirty();
      });

      let sourceRequest = 0;
      function loadFilters(keepSelection) {
        const source = hostSel.value;
        const requestVersion = ++sourceRequest;
        const catalogVersion = catalogGeneration;
        setBanner(catalogError, "", "info");
        if (!source) {
          fillSelect(filterSel, [], "", T("chooseFilter"));
          fillSelect(propSel, [], "", T("chooseSetting"));
          return;
        }
        const render = function () {
          if (generation !== editorGeneration || catalogVersion !== catalogGeneration || requestVersion !== sourceRequest || hostSel.value !== source) return;
          const detail = sourceCatalogCache[source];
          const filters = detail && Array.isArray(detail.filters) ? detail.filters : [];
          const selected = keepSelection ? filterSel.value || slot.filter_name || "" : "";
          fillSelect(filterSel, filters.filter(function (f) { return (f.properties || []).length > 0; }).map(function (f) {
            return { value: f.name, text: f.enabled ? f.name : T("filterDisabled", { filter: f.name }) };
          }), selected, T("chooseFilter"));
          fillProps(keepSelection);
        };
        if (sourceCatalogCache[source]) {
          render();
          return;
        }
        request({ event: "getCatalog", source: source }).then(function (reply) {
          if (generation !== editorGeneration || catalogVersion !== catalogGeneration || requestVersion !== sourceRequest || hostSel.value !== source) return;
          if (reply && reply.data) sourceCatalogCache[source] = reply.data;
          else {
            setBanner(catalogError, (reply && reply.error) || T("noFilterList"), "err");
            return;
          }
          render();
        });
      }

      hostSel.addEventListener("change", function () { fromInp.value = ""; toInp.value = ""; loadFilters(false); });
      filterSel.addEventListener("change", function () { fromInp.value = ""; toInp.value = ""; fillProps(false); });
      propSel.addEventListener("change", function () { fromInp.value = ""; toInp.value = ""; applyRangeHint(); });
      loadFilters(true);
    }
  }

  function collectSetSlotFields(mode) {
    const fields = { target_mode: mode };
    function val(id) {
      const el = $(id);
      return el ? el.value : undefined;
    }
    function checked(id) {
      const el = $(id);
      return el && el.checkbox ? el.checkbox.checked : undefined;
    }
    const enabled = checked("af-enabled");
    if (typeof enabled === "boolean") fields.enabled = enabled;
    for (const pair of [["af-cal-min", "cal_min"], ["af-cal-max", "cal_max"]]) {
      const raw = val(pair[0]);
      if (raw !== undefined && raw !== "") fields[pair[1]] = Number(raw);
    }
    if (mode === "crossfade_ab" || mode === "layer_opacity") {
      fields.scene = val("af-scene") || "";
      fields.source_a = val("af-source-a") || "";
      if (mode === "crossfade_ab") {
        fields.source_b = val("af-source-b") || "";
        fields.curve = val("af-curve") || "dip_free";
      }
      const afv = checked("af-afv");
      if (typeof afv === "boolean") fields.afv = afv;
    } else if (mode === "audio_volume") {
      fields.source_a = val("af-source-a") || "";
    } else if (mode === "filter_param") {
      // While the catalog is loading these controls do not exist. Omission
      // preserves the binding; an actual empty control remains an explicit edit.
      for (const pair of [["af-source-a", "source_a"], ["af-filter", "filter_name"], ["af-prop", "filter_prop"]]) {
        const raw = val(pair[0]);
        if (raw !== undefined) fields[pair[1]] = raw;
      }
      const from = val("af-from");
      const to = val("af-to");
      if (from !== undefined && from !== "") fields.from_val = Number(from);
      if (to !== undefined && to !== "") fields.to_val = Number(to);
      const bypass = checked("af-bypass");
      if (typeof bypass === "boolean") fields.bypass_at_zero = bypass;
    }
    // Send only edits relative to the form's baseline. Other surfaces may have
    // changed untouched calibration or assignment fields while this draft was open.
    const patch = {};
    for (const key of Object.keys(fields)) {
      if (!editorBaseline || fields[key] !== editorBaseline[key]) patch[key] = fields[key];
    }
    // A target change auto-enables on the provider unless the checkbox is explicit.
    if (patch.target_mode !== undefined && typeof enabled === "boolean") patch.enabled = enabled;
    return patch;
  }

  function validateFields(mode, patch) {
    if (Object.keys(patch).length === 0) return T("noChanges");
    if (Object.keys(patch).length === 1 && typeof patch.enabled === "boolean") return "";
    const fields = Object.assign({}, currentSlotObject() || {}, patch);
    for (const key of ["from_val", "to_val", "cal_min", "cal_max"]) {
      if (fields[key] !== undefined && !Number.isFinite(fields[key])) return T("finiteNumber");
    }
    for (const key of ["cal_min", "cal_max"]) {
      if (fields[key] !== undefined && (!Number.isInteger(fields[key]) || fields[key] < 0)) return T("calibrationWhole");
    }
    if (fields.cal_min !== undefined && fields.cal_max !== undefined && fields.cal_max <= fields.cal_min) return T("calibrationOrder");
    if (mode === "crossfade_ab") {
      if (!fields.scene) return T("validChooseScene");
      if (!fields.source_a || !fields.source_b) return T("validChooseBoth");
      if (fields.source_a === fields.source_b) return T("validLayersDiffer");
    }
    if (mode === "layer_opacity") {
      if (!fields.scene) return T("validChooseScene");
      if (!fields.source_a) return T("validChooseLayer");
    }
    if (mode === "audio_volume" && !fields.source_a) return T("validChooseAudio");
    if (mode === "filter_param") {
      if (!fields.source_a) return T("validChooseSource");
      if (!fields.filter_name) return T("validChooseFilter");
      if (!fields.filter_prop) return T("validChooseSetting");
      if (typeof fields.from_val === "number" && fields.from_val === fields.to_val) return T("validRangeDiffer");
    }
    return "";
  }

  function refreshCatalog(force) {
    if (!lastState || !lastState.capabilities || !lastState.capabilities.catalog) return Promise.resolve();
    if (!lastState.status || lastState.status.kind !== "connected") return Promise.resolve();
    if (overviewCatalog && !force) return Promise.resolve();
    if (force) sourceCatalogCache = {};
    const requestVersion = ++catalogGeneration;
    const slotId = currentSettings.slot || "crossfader";
    return request({ event: "getCatalog" }).then(function (reply) {
      if (requestVersion !== catalogGeneration) return;
      if (reply && reply.data) {
        overviewCatalog = reply.data;
      } else if (reply && reply.error) {
        setBanner($("assign-result"), reply.error, "err");
      }
      const modeSel = $("assign-mode");
      if (modeSel && slotId === (currentSettings.slot || "crossfader") && $("assign-editor").open) {
        renderModeFields(modeSel.value, captureEditorDraft());
      }
    });
  }

  function refreshEditor(state) {
    const editor = $("assign-editor");
    if (!editor || editor.style.display === "none") return;
    buildModeSelect(state);
    if (!editor.open) return; // closed: nothing to draw yet
    if (editorDirty || applying) return; // operator is mid-edit; keep their fields
    const modeSel = $("assign-mode");
    renderModeFields(modeSel ? modeSel.value : "unassigned");
    refreshCatalog(false);
  }

  function bindEditor() {
    const editor = $("assign-editor");
    const modeSel = $("assign-mode");
    const applyBtn = $("assign-apply");
    const refreshBtn = $("assign-refresh");
    if (!editor || !modeSel) return;

    editor.addEventListener("toggle", function () {
      if (editor.open) {
        if (lastState) refreshEditor(lastState);
      }
    });
    modeSel.addEventListener("change", function () {
      markEditorDirty();
      renderModeFields(modeSel.value);
    });
    editor.addEventListener("input", markEditorDirty);
    const discardBtn = $("assign-discard");
    if (discardBtn) discardBtn.addEventListener("click", function () {
      resetEditorContext();
      if (lastState) refreshEditor(lastState);
    });
    if (refreshBtn) {
      refreshBtn.addEventListener("click", function () {
        refreshCatalog(true);
      });
    }
    if (applyBtn) {
      applyBtn.addEventListener("click", function () {
        if (editorConflict) {
          setBanner($("assign-result"), T("assignConflict"), "err");
          return;
        }
        const slotId = currentSettings.slot || "crossfader";
        const mode = modeSel.value;
        const fields = collectSetSlotFields(mode);
        const problem = validateFields(mode, fields);
        const resultEl = $("assign-result");
        if (problem) {
          setBanner(resultEl, problem, "err");
          return;
        }
        applyBtn.disabled = true;
        applying = true;
        const sequence = ++applySequence;
        const revision = editRevision;
        setBanner(resultEl, T("applying"), "info");
        request({ event: "setSlot", slot: slotId, fields: fields }).then(function (reply) {
          if (sequence !== applySequence || slotId !== (currentSettings.slot || "crossfader")) return;
          applying = false;
          applyBtn.disabled = false;
          if (reply && reply.ok) {
            editorBaseline = Object.assign({}, editorBaseline || {}, fields);
            if (revision === editRevision) {
              editorDirty = false;
              setBanner($("assign-draft"), "", "info");
            }
            const modeLabel = ((lastState && lastState.targetModes) || []).reduce(function (acc, m) {
              return m.id === mode ? m.label : acc;
            }, mode);
            // reply.label and reply.reason are Midi Fadester's texts; each sentence stands alone.
            setBanner(resultEl, [
              T("applied", { label: reply.label || modeLabel }),
              reply.available === false && reply.reason ? reply.reason : "",
              revision !== editRevision ? T("newerUnsaved") : ""
            ].filter(Boolean).join(" "), reply.available === false ? "warn" : "ok");
          } else {
            setBanner(resultEl, (reply && reply.error) || T("obsRejected"), "err");
          }
        });
      });
    }
  }

  function bindControllerPanel() {
    const loadBtn = $("profile-load");
    const sel = $("profile-select");
    if (!loadBtn || !sel) return;
    sel.addEventListener("change", function () { profileDraft = sel.value; });
    loadBtn.addEventListener("click", function () {
      const name = sel.value;
      const resultEl = $("profile-result");
      if (!name) {
        setBanner(resultEl, T("chooseProfileFirst"), "err");
        return;
      }
      loadBtn.disabled = true;
      profileLoading = true;
      setBanner(resultEl, T("loadingProfile"), "info");
      request({ event: "loadProfile", name: name }).then(function (reply) {
        loadBtn.disabled = false;
        profileLoading = false;
        if (reply && reply.ok) {
          if (profileDraft === name) profileDraft = null;
          setBanner(resultEl, T("profileLoaded", { name: reply.loaded || name }), "ok");
        } else {
          setBanner(resultEl, (reply && reply.error) || T("profileRejected"), "err");
        }
      });
    });
  }

  function bindConnectionPanel() {
    const btn = $("conn-test-btn");
    const hostEl = $("conn-host");
    const portEl = $("conn-port");
    const passEl = $("conn-password");

    function pushGlobalConn() {
      const payload = {
        event: "updateGlobalSettings",
        host: hostEl ? hostEl.value : "127.0.0.1",
        port: portEl ? Number(portEl.value) : 4455
      };
      // The password is sent only when the operator typed in the field, so
      // re-saving host or port never wipes a stored password, and a stored
      // password is never echoed back to this page.
      if (passwordDirty && passEl) {
        payload.password = passEl.value;
      }
      sendToPlugin(payload);
      passwordDirty = false;
    }

    if (passEl) {
      passEl.addEventListener("input", function () { passwordDirty = true; });
      passEl.addEventListener("change", pushGlobalConn);
    }
    if (hostEl) hostEl.addEventListener("change", pushGlobalConn);
    if (portEl) portEl.addEventListener("change", pushGlobalConn);
    if (btn) {
      btn.addEventListener("click", function () {
        pushGlobalConn();
        sendToPlugin({ event: "testConnection" });
      });
    }
  }

  function applyState(state) {
    function connectionIdentity(value) {
      const connection = value.connection || {};
      const status = value.status || {};
      return JSON.stringify([connection.host, connection.port, status.kind === "connected", status.buildCommit, status.fadesterVersion]);
    }
    const connectionChanged = lastState && connectionIdentity(lastState) !== connectionIdentity(state);
    if (connectionChanged) {
      overviewCatalog = null;
      sourceCatalogCache = {};
      catalogGeneration += 1;
      editorGeneration += 1;
      applySequence += 1;
      applying = false;
      if (editorDirty) {
        setBanner($("assign-result"), T("connChanged"), "warn");
      }
    }
    lastState = state;
    if (editorDirty && !applying && editorBaseline) {
      const current = currentSlotObject();
      const bindingKeys = ["target_mode", "scene", "source_a", "source_b", "filter_name", "filter_prop"];
      if (!current || bindingKeys.some(function (key) { return current[key] !== editorBaseline[key]; })) {
        editorConflict = true;
        setBanner($("assign-result"), T("assignConflict"), "err");
      }
    }
    const applyBtn = $("assign-apply");
    if (applyBtn) applyBtn.disabled = applying || editorConflict || !state.status || state.status.kind !== "connected";
    updateConnectionPanel(state);
    updateControllerPanel(state);
    populateSlotsDropdown(state);
    updateAssignmentSentence(state);
    refreshEditor(state);
    if (connectionChanged && editorDirty) refreshCatalog(false);
    if (typeof window.onFadesterState === "function") {
      window.onFadesterState(state, currentSettings);
    }
  }

  function applySlotValue(payload) {
    if (!lastState) return;
    const slot = (lastState.slots || []).find(function (s) { return s.id === payload.slot; });
    if (!slot) return;
    slot.value = payload.value;
    if (typeof payload.display_value === "string") slot.display_value = payload.display_value;
    updateAssignmentSentence(lastState);
  }

  window.initFadesterPropertyInspector = function (bindControlsFn) {
    renderSharedSections($("shared-sections"));
    bindEditor();
    bindControllerPanel();

    window.connectElgatoStreamDeckSocket = function (
      inPort,
      inPropertyInspectorUUID,
      inRegisterEvent,
      inInfo,
      inActionInfo
    ) {
      // Stream Deck's language first, so every text below is drawn in it.
      window.FadesterI18n.setLanguage(window.FadesterI18n.languageFromInfo(inInfo));
      uuid = inPropertyInspectorUUID;
      actionInfo = JSON.parse(inActionInfo || "{}");
      currentSettings = (actionInfo.payload && actionInfo.payload.settings) || {};

      ws = new WebSocket("ws://127.0.0.1:" + inPort);
      function saveAndRefresh(partial) {
        saveActionSettings(partial);
        if (partial && Object.prototype.hasOwnProperty.call(partial, "slot")) {
          lastSlotSignature = "";
          resetEditorContext();
          if (lastState) applyState(lastState);
        }
      }

      ws.onopen = function () {
        send({ event: inRegisterEvent, uuid: uuid });
        populateSlotsDropdown(null);
        bindControlsFn(currentSettings, saveAndRefresh);
        bindConnectionPanel();
        sendToPlugin({ event: "piReady" });
      };

      ws.onmessage = function (evt) {
        let msg = {};
        try {
          msg = JSON.parse(evt.data);
        } catch {
          return;
        }
        if (msg.event === "didReceiveSettings" && msg.payload) {
          const previousSlot = currentSettings.slot || "crossfader";
          currentSettings = msg.payload.settings || {};
          if (previousSlot !== (currentSettings.slot || "crossfader")) resetEditorContext();
          bindControlsFn(currentSettings, saveAndRefresh);
          lastSlotSignature = "";
          if (lastState) applyState(lastState);
        } else if (msg.event === "sendToPropertyInspector" && msg.payload) {
          const p = msg.payload;
          if (p.event === "fadesterState") {
            applyState(p);
          } else if (p.event === "slotValueChanged") {
            applySlotValue(p);
          } else if (p.requestId && pendingReplies.has(p.requestId)) {
            const cb = pendingReplies.get(p.requestId);
            pendingReplies.delete(p.requestId);
            cb(p);
          }
        }
      };
    };
  };
})();

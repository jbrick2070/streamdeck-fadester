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
        resolve({ error: "No reply from the plugin after 6 s." });
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
        option(selectedValue, selectedValue + " (not in OBS now)", true, false)
      );
    }
  }

  // ---------------------------------------------------------------- shared markup
  function renderSharedSections(mount) {
    if (!mount) return;
    mount.innerHTML = [
      '<h3>Slot assignment in OBS <span class="scope">shared by every surface</span></h3>',
      '<div id="assign-sentence" class="status-banner status-info"></div>',
      '<details id="assign-editor" class="editor">',
      "<summary>Change what this slot does</summary>",
      '<p class="muted">Changes apply in Midi Fadester for the APC40, Stream Deck and every other surface. Pickers list only what the live OBS catalog offers.</p>',
      '<div class="row"><label for="assign-mode">What it does</label><select id="assign-mode"></select></div>',
      '<div id="assign-fields"></div>',
      '<div class="row"><label></label><button id="assign-apply" class="btn" type="button">Apply in OBS</button><button id="assign-refresh" class="btn secondary" type="button">Refresh lists</button></div>',
      '<div id="assign-result" class="status-banner" style="display:none;"></div>',
      "</details>",

      '<h3>Controller <span class="scope">shared</span></h3>',
      '<div id="ctrl-status" class="status-banner status-info"></div>',
      '<details class="editor"><summary>Switch controller profile</summary>',
      '<p class="muted">Loading a profile resets slot defaults in Midi Fadester for every surface. Only the active profile reports what the connected desk can do; this list is the API contract’s known profiles. Only APC40 mkII is verified on real hardware.</p>',
      '<div class="row"><label for="profile-select">Profile</label><select id="profile-select"></select></div>',
      '<div class="row"><label></label><button id="profile-load" class="btn danger" type="button">Load profile</button></div>',
      '<div id="profile-result" class="status-banner" style="display:none;"></div>',
      "</details>",

      '<h3>OBS connection <span class="scope">shared</span></h3>',
      '<div id="conn-status" class="status-banner status-err">Waiting for the plugin…</div>',
      '<a id="conn-link" class="release-link" href="https://github.com/jbrick2070/midi-fadester/releases" target="_blank">Download Midi Fadester for OBS Studio 33</a>',
      '<div class="row"><label for="conn-host">Host</label><input type="text" id="conn-host" value="127.0.0.1" /></div>',
      '<div class="row"><label for="conn-port">Port</label><input type="number" id="conn-port" value="4455" min="1" max="65535" /></div>',
      '<div class="row"><label for="conn-password">Password</label><input type="password" id="conn-password" autocomplete="off" placeholder="Leave blank if authentication is off" /></div>',
      '<div class="row"><label></label><button id="conn-test-btn" class="btn" type="button">Save &amp; test</button><span class="hint" id="conn-hint"></span></div>'
    ].join("");
  }

  // ---------------------------------------------------------------- slot dropdown
  function slotOptionText(s) {
    let text = s.name || s.id;
    if (s.label && s.label !== s.name) {
      text += " — " + s.label;
    }
    if (s.available === false && s.reason) {
      text += " (" + s.reason + ")";
    } else if (s.live && s.target_mode === "unassigned") {
      text += " (not used)";
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
    const offlineTag = liveSlots ? "" : " (offline: contract defaults, connect OBS for live names)";
    appendGroup("Faders" + offlineTag, faders);
    appendGroup("FX & Knobs" + offlineTag, fx);

    if (allowAllFx && (fxSupported || selectedSlot === ALL_FX_ID || !liveSlots)) {
      const group = document.createElement("optgroup");
      group.label = "All FX";
      const text = fxSupported || !liveSlots
        ? "All FX — Clean / All FX Off"
        : "All FX — needs Midi Fadester 0.4.0+";
      group.appendChild(option(ALL_FX_ID, text, selectedSlot === ALL_FX_ID, false));
      selectEl.appendChild(group);
      if (selectedSlot === ALL_FX_ID) seen = true;
    }

    if (!seen && selectedSlot) {
      selectEl.appendChild(option(selectedSlot, selectedSlot + " (saved, not reported by OBS)", true, false));
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
      statusEl.textContent = "Controller state is reported by Midi Fadester once OBS is connected.";
      statusEl.className = "status-banner status-info";
    } else {
      const p = state.profile || {};
      const d = state.device || {};
      const line = document.createElement("div");
      line.textContent = "Profile: " + (p.displayName || p.slug || "unknown");
      line.appendChild(tierBadge(p.tier, p.tierLabel));
      statusEl.appendChild(line);
      const dev = document.createElement("div");
      if (d.connected) {
        dev.textContent = "MIDI: " + (d.name || "device") + " connected";
        statusEl.className = "status-banner status-ok";
      } else {
        dev.textContent = d.error
          ? "MIDI: " + d.error
          : "MIDI: " + (d.name ? d.name + " not found. Plug it in, then reconnect in OBS." : "no device configured in Midi Fadester");
        statusEl.className = "status-banner status-warn";
      }
      statusEl.appendChild(dev);
      const sm = document.createElement("div");
      sm.textContent = state.studioMode ? "Studio Mode on" : "Studio Mode off (T-bar slots unavailable)";
      statusEl.appendChild(sm);
    }

    if (profileSel && document.activeElement !== profileSel) {
      const active = state.profile ? state.profile.slug : "";
      fillSelect(
        profileSel,
        (state.knownProfiles || []).map(function (kp) {
          return {
            value: kp.slug,
            text: kp.displayName + " — " + kp.tierLabel + (kp.slug === active ? " (active)" : "")
          };
        }),
        active,
        ""
      );
    }
    const loadBtn = $("profile-load");
    if (loadBtn) loadBtn.disabled = !connected;
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
        passEl.placeholder = state.connection.passwordSet
          ? "Password saved (type to replace)"
          : "Leave blank if authentication is off";
      }
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
        ? "Last OBS error: " + state.lastErrorComment
        : "";
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
      setBanner(el, "All FX: cleans every assigned FX slot. Nothing to assign here.", "info");
      if (editor) editor.style.display = "none";
      return;
    }
    if (editor) editor.style.display = "";
    if (!connected) {
      setBanner(el, "Connect OBS to see and change what this slot does.", "info");
      return;
    }
    const slot = currentSlotObject();
    if (!slot) {
      setBanner(el, "Slot '" + slotId + "' is not reported by Midi Fadester.", "err");
      return;
    }
    const modeLabel = (state.targetModes || []).reduce(function (acc, m) {
      return m.id === slot.target_mode ? m.label : acc;
    }, slot.target_mode);
    let text = (slot.name || slot.id) + ": " + modeLabel;
    if (slot.label && slot.label !== slot.name) text += " — " + slot.label;
    if (slot.available === false) {
      setBanner(el, text + ". " + (slot.reason || "Unavailable."), slot.target_mode === "unassigned" ? "info" : "warn");
    } else {
      setBanner(el, text + (slot.display_value ? " — now " + slot.display_value : ""), "ok");
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
      if (m.id === "tbar" && !state.studioMode) text += " — needs Studio Mode";
      if (m.id === "filter_param" && !catalog) text += " — needs Midi Fadester 0.4.0+";
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
    label.htmlFor = id;
    label.textContent = labelText;
    row.appendChild(label);
    control.id = id;
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

  function renderModeFields(mode) {
    const host = $("assign-fields");
    if (!host) return;
    host.innerHTML = "";
    const slot = currentSlotObject() || {};
    const state = lastState || {};
    const catalog = Boolean(state.capabilities && state.capabilities.catalog) && overviewCatalog;
    const curves = (state.curves || []).map(function (c) { return { value: c.id, text: c.label }; });

    function noteNoCatalog() {
      if (catalog) return;
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = state.capabilities && state.capabilities.catalog
        ? "Loading the OBS catalog… (press Refresh lists if this stays)"
        : "Midi Fadester 0.4.0+ lists scenes, layers and sources here. Until then, type exact OBS names.";
      host.appendChild(p);
    }

    function sceneControl(selected) {
      if (catalog) {
        return makeSelect(
          (overviewCatalog.scenes || []).map(function (s) { return { value: s.name, text: s.name }; }),
          selected,
          "Choose a scene"
        );
      }
      const inp = document.createElement("input");
      inp.type = "text";
      inp.value = selected || "";
      inp.placeholder = "Exact scene name";
      return inp;
    }

    function layerControl(sceneName, selected, placeholder) {
      if (catalog) {
        return makeSelect(
          sceneLayers(sceneName).map(function (l) {
            return { value: l.name, text: l.name + (l.has_audio ? " (has audio)" : "") };
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
      p.textContent = "The slot will do nothing until it is set up again.";
      host.appendChild(p);
      return;
    }

    if (mode === "tbar") {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = state.studioMode
        ? "Fades Program to Preview like OBS’s T-bar. Nothing to pick."
        : "Studio Mode is off. Turn it on in OBS (View > Studio Mode) for this to work.";
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
      host.appendChild(fieldRow("af-scene", "Scene", sceneSel));
      const aSel = layerControl(sceneSel.value, slot.source_a || "", mode === "crossfade_ab" ? "Left layer" : "Layer");
      host.appendChild(fieldRow("af-source-a", mode === "crossfade_ab" ? "Left" : "Layer", aSel));
      let bSel = null;
      if (mode === "crossfade_ab") {
        bSel = layerControl(sceneSel.value, slot.source_b || "", "Right layer");
        host.appendChild(fieldRow("af-source-b", "Right", bSel));
        host.appendChild(fieldRow("af-curve", "Feel", makeSelect(curves, slot.curve || "dip_free", "")));
      }
      host.appendChild(fieldRow("af-afv", "Also fade audio", makeCheckbox(slot.afv, "when the layer has audio")));
      sceneSel.addEventListener("change", function () {
        if (!catalog) return;
        fillSelect(aSel, sceneLayers(sceneSel.value).map(function (l) { return { value: l.name, text: l.name + (l.has_audio ? " (has audio)" : "") }; }), "", mode === "crossfade_ab" ? "Left layer" : "Layer");
        if (bSel) fillSelect(bSel, sceneLayers(sceneSel.value).map(function (l) { return { value: l.name, text: l.name + (l.has_audio ? " (has audio)" : "") }; }), "", "Right layer");
      });
      return;
    }

    if (mode === "audio_volume") {
      noteNoCatalog();
      let ctrl;
      if (catalog) {
        ctrl = makeSelect(
          (overviewCatalog.audio_sources || []).map(function (a) {
            return { value: a.name, text: a.name + (typeof a.db === "number" ? " (" + a.db.toFixed(1) + " dB)" : "") };
          }),
          slot.source_a || "",
          "Choose an audio source"
        );
      } else {
        ctrl = document.createElement("input");
        ctrl.type = "text";
        ctrl.value = slot.source_a || "";
        ctrl.placeholder = "Exact audio source name";
      }
      host.appendChild(fieldRow("af-source-a", "Source", ctrl));
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "Follows OBS’s own mixer law (cubic).";
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
        hosts.map(function (h) { return { value: h.source, text: h.source + (h.is_scene ? " (scene)" : "") + " — " + h.filter_count + " filter" + (h.filter_count === 1 ? "" : "s") }; }),
        slot.source_a || "",
        "Choose a source or scene"
      );
      host.appendChild(fieldRow("af-source-a", "Source", hostSel));
      const filterSel = makeSelect([], slot.filter_name || "", "Choose a filter");
      host.appendChild(fieldRow("af-filter", "Filter", filterSel));
      const propSel = makeSelect([], slot.filter_prop || "", "Choose a setting");
      host.appendChild(fieldRow("af-prop", "Setting", propSel));
      const fromInp = document.createElement("input");
      fromInp.type = "number";
      fromInp.step = "any";
      fromInp.value = typeof slot.from_val === "number" ? String(slot.from_val) : "";
      host.appendChild(fieldRow("af-from", "At 0 %", fromInp));
      const toInp = document.createElement("input");
      toInp.type = "number";
      toInp.step = "any";
      toInp.value = typeof slot.to_val === "number" ? String(slot.to_val) : "";
      host.appendChild(fieldRow("af-to", "At 100 %", toInp));
      host.appendChild(fieldRow("af-bypass", "Bypass at 0 %", makeCheckbox(slot.bypass_at_zero !== false, "disables the filter when the fader is fully down")));
      const rangeHint = document.createElement("p");
      rangeHint.className = "muted";
      rangeHint.id = "af-range-hint";
      host.appendChild(rangeHint);

      function propsFor(source, filterName) {
        const detail = sourceCatalogCache[source];
        if (!detail || !Array.isArray(detail.filters)) return [];
        const f = detail.filters.find(function (x) { return x.name === filterName; });
        return f ? f.properties || [] : [];
      }

      function fillProps(keepSelection) {
        const props = propsFor(hostSel.value, filterSel.value);
        const selected = keepSelection ? propSel.value || slot.filter_prop || "" : "";
        fillSelect(propSel, props.map(function (p) {
          return { value: p.name, text: (p.label || p.name) + " (" + p.min + "–" + p.max + (p.suffix ? " " + p.suffix : "") + ")" };
        }), selected, "Choose a setting");
        applyRangeHint();
      }

      function applyRangeHint() {
        const props = propsFor(hostSel.value, filterSel.value);
        const p = props.find(function (x) { return x.name === propSel.value; });
        if (!p) {
          rangeHint.textContent = "";
          return;
        }
        rangeHint.textContent = (p.label || p.name) + ": " + p.min + " to " + p.max + (p.suffix ? " " + p.suffix : "") + ", now " + p.current + ". Leave the range blank to use the full range.";
        if (fromInp.value === "" && toInp.value === "") {
          fromInp.placeholder = String(p.min);
          toInp.placeholder = String(p.max);
        }
      }

      function loadFilters(keepSelection) {
        const source = hostSel.value;
        if (!source) {
          fillSelect(filterSel, [], "", "Choose a filter");
          fillSelect(propSel, [], "", "Choose a setting");
          return;
        }
        const render = function () {
          const detail = sourceCatalogCache[source];
          const filters = detail && Array.isArray(detail.filters) ? detail.filters : [];
          const selected = keepSelection ? filterSel.value || slot.filter_name || "" : "";
          fillSelect(filterSel, filters.filter(function (f) { return (f.properties || []).length > 0; }).map(function (f) {
            return { value: f.name, text: f.name + (f.enabled ? "" : " (disabled)") };
          }), selected, "Choose a filter");
          fillProps(keepSelection);
        };
        if (sourceCatalogCache[source]) {
          render();
          return;
        }
        request({ event: "getCatalog", source: source }).then(function (reply) {
          if (reply && reply.data) sourceCatalogCache[source] = reply.data;
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
      fields.source_a = val("af-source-a") || "";
      fields.filter_name = val("af-filter") || "";
      fields.filter_prop = val("af-prop") || "";
      const from = val("af-from");
      const to = val("af-to");
      if (from !== undefined && from !== "" && to !== undefined && to !== "") {
        fields.from_val = Number(from);
        fields.to_val = Number(to);
      }
      const bypass = checked("af-bypass");
      if (typeof bypass === "boolean") fields.bypass_at_zero = bypass;
    }
    return fields;
  }

  function validateFields(mode, fields) {
    if (mode === "crossfade_ab") {
      if (!fields.scene) return "Choose a scene.";
      if (!fields.source_a || !fields.source_b) return "Choose both layers.";
      if (fields.source_a === fields.source_b) return "Left and Right must be different layers.";
    }
    if (mode === "layer_opacity") {
      if (!fields.scene) return "Choose a scene.";
      if (!fields.source_a) return "Choose a layer.";
    }
    if (mode === "audio_volume" && !fields.source_a) return "Choose an audio source.";
    if (mode === "filter_param") {
      if (!fields.source_a) return "Choose a source.";
      if (!fields.filter_name) return "Choose a filter.";
      if (!fields.filter_prop) return "Choose a setting.";
      if (typeof fields.from_val === "number" && fields.from_val === fields.to_val) return "At 0 % and At 100 % must differ.";
    }
    return "";
  }

  function refreshCatalog(force) {
    if (!lastState || !lastState.capabilities || !lastState.capabilities.catalog) return Promise.resolve();
    if (overviewCatalog && !force) return Promise.resolve();
    if (force) sourceCatalogCache = {};
    return request({ event: "getCatalog" }).then(function (reply) {
      if (reply && reply.data) {
        overviewCatalog = reply.data;
      } else if (reply && reply.error) {
        setBanner($("assign-result"), reply.error, "err");
      }
      const modeSel = $("assign-mode");
      if (modeSel) renderModeFields(modeSel.value);
    });
  }

  function refreshEditor(state) {
    const editor = $("assign-editor");
    if (!editor || editor.style.display === "none") return;
    buildModeSelect(state);
    if (!editor.open) return; // closed: nothing to draw yet
    if (editorDirty) return; // operator is mid-edit; keep their fields
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
        editorDirty = false;
        if (lastState) refreshEditor(lastState);
      } else {
        editorDirty = false;
        setBanner($("assign-result"), "", "info");
      }
    });
    modeSel.addEventListener("change", function () {
      editorDirty = true;
      renderModeFields(modeSel.value);
    });
    editor.addEventListener("input", function () { editorDirty = true; });
    if (refreshBtn) {
      refreshBtn.addEventListener("click", function () {
        editorDirty = false;
        refreshCatalog(true);
      });
    }
    if (applyBtn) {
      applyBtn.addEventListener("click", function () {
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
        setBanner(resultEl, "Applying in OBS…", "info");
        request({ event: "setSlot", slot: slotId, fields: fields }).then(function (reply) {
          applyBtn.disabled = false;
          if (reply && reply.ok) {
            editorDirty = false;
            const tail = reply.available === false && reply.reason ? " " + reply.reason : "";
            const modeLabel = ((lastState && lastState.targetModes) || []).reduce(function (acc, m) {
              return m.id === mode ? m.label : acc;
            }, mode);
            setBanner(resultEl, "Applied: " + (reply.label || modeLabel) + "." + tail, reply.available === false ? "warn" : "ok");
          } else {
            setBanner(resultEl, (reply && reply.error) || "OBS rejected the change.", "err");
          }
        });
      });
    }
  }

  function bindControllerPanel() {
    const loadBtn = $("profile-load");
    const sel = $("profile-select");
    if (!loadBtn || !sel) return;
    loadBtn.addEventListener("click", function () {
      const name = sel.value;
      const resultEl = $("profile-result");
      if (!name) {
        setBanner(resultEl, "Choose a profile first.", "err");
        return;
      }
      loadBtn.disabled = true;
      setBanner(resultEl, "Loading profile in Midi Fadester…", "info");
      request({ event: "loadProfile", name: name }).then(function (reply) {
        loadBtn.disabled = false;
        if (reply && reply.ok) {
          setBanner(resultEl, "Loaded " + (reply.loaded || name) + ". Slot defaults were reset in Midi Fadester.", "ok");
        } else {
          setBanner(resultEl, (reply && reply.error) || "Midi Fadester rejected the profile.", "err");
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
    lastState = state;
    updateConnectionPanel(state);
    updateControllerPanel(state);
    populateSlotsDropdown(state);
    updateAssignmentSentence(state);
    refreshEditor(state);
    if (typeof window.onFadesterState === "function") {
      window.onFadesterState(state, currentSettings);
    }
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
      uuid = inPropertyInspectorUUID;
      actionInfo = JSON.parse(inActionInfo || "{}");
      currentSettings = (actionInfo.payload && actionInfo.payload.settings) || {};

      ws = new WebSocket("ws://127.0.0.1:" + inPort);
      function saveAndRefresh(partial) {
        saveActionSettings(partial);
        if (partial && Object.prototype.hasOwnProperty.call(partial, "slot")) {
          lastSlotSignature = "";
          editorDirty = false;
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
          currentSettings = msg.payload.settings || {};
          bindControlsFn(currentSettings, saveAndRefresh);
          lastSlotSignature = "";
          if (lastState) applyState(lastState);
        } else if (msg.event === "sendToPropertyInspector" && msg.payload) {
          const p = msg.payload;
          if (p.event === "fadesterState") {
            applyState(p);
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

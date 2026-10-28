// SPDX-License-Identifier: GPL-2.0-or-later
/* global WebSocket, window, document */

(function () {
  let ws = null;
  let uuid = "";
  let actionInfo = {};
  let currentSettings = {};

  function send(payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  function saveActionSettings(partial) {
    currentSettings = Object.assign({}, currentSettings, partial);
    send({
      event: "setSettings",
      context: uuid,
      payload: currentSettings
    });
  }

  function sendToPlugin(payload) {
    send({
      action: actionInfo.action,
      event: "sendToPlugin",
      context: uuid,
      payload: payload
    });
  }

  function populateSlotsDropdown(slots) {
    const selectEl = document.getElementById("slot-select");
    if (!selectEl) return;

    const selectedSlot = currentSettings.slot || "crossfader";
    const allowAllFx = selectEl.dataset.allowAllFx === "true";
    const fallbackSlots = [
      { id: "crossfader", name: "Crossfader", label: "", available: true, reason: "" },
      { id: "fader_1", name: "Fader 1", label: "", available: true, reason: "" },
      { id: "fader_2", name: "Fader 2", label: "", available: true, reason: "" },
      { id: "fader_3", name: "Fader 3", label: "", available: true, reason: "" },
      { id: "fader_4", name: "Fader 4", label: "", available: true, reason: "" },
      { id: "fader_5", name: "Fader 5", label: "", available: true, reason: "" },
      { id: "fader_6", name: "Fader 6", label: "", available: true, reason: "" },
      { id: "fader_7", name: "Fader 7", label: "", available: true, reason: "" },
      { id: "fader_8", name: "Fader 8", label: "", available: true, reason: "" },
      { id: "master", name: "Master", label: "", available: true, reason: "" }
    ];

    const list = Array.isArray(slots) && slots.length > 0 ? slots : fallbackSlots;
    selectEl.innerHTML = "";

    let currentReason = "";
    function appendSlotOption(parent, s) {
      const opt = document.createElement("option");
      opt.value = s.id;
      let text = s.name || s.id;
      if (s.label && s.label !== s.name) {
        text += " — " + s.label;
      }
      if (s.available === false && s.reason) {
        text += " (" + s.reason + ")";
      }
      opt.textContent = text;
      if (s.id === selectedSlot) {
        opt.selected = true;
        if (s.available === false && s.reason) {
          currentReason = s.reason;
        }
      }
      parent.appendChild(opt);
    }

    const faderSlots = list.filter((s) => s.kind !== "fx");
    const fxSlots = list.filter((s) => s.kind === "fx");

    if (faderSlots.length > 0) {
      const faderGroup = document.createElement("optgroup");
      faderGroup.label = "Faders";
      for (const s of faderSlots) {
        appendSlotOption(faderGroup, s);
      }
      selectEl.appendChild(faderGroup);
    }

    const showAllFx = allowAllFx && (fxSlots.length > 0 || selectedSlot === "__all_fx__");
    if (fxSlots.length > 0) {
      const fxGroup = document.createElement("optgroup");
      fxGroup.label = "FX & Knobs";
      for (const s of fxSlots) {
        appendSlotOption(fxGroup, s);
      }
      if (showAllFx) {
        appendSlotOption(fxGroup, {
          id: "__all_fx__",
          name: "All FX",
          label: "Clean / All FX Off",
          available: true,
          reason: ""
        });
      }
      selectEl.appendChild(fxGroup);
    } else if (showAllFx) {
      appendSlotOption(selectEl, {
        id: "__all_fx__",
        name: "All FX",
        label: "Clean / All FX Off",
        available: true,
        reason: ""
      });
    }

    const reasonBanner = document.getElementById("slot-reason-banner");
    if (reasonBanner) {
      if (currentReason) {
        reasonBanner.textContent = currentReason;
        reasonBanner.style.display = "block";
      } else {
        reasonBanner.textContent = "";
        reasonBanner.style.display = "none";
      }
    }
  }

  function updateConnectionStatusUI(statePayload) {
    const statusEl = document.getElementById("conn-status");
    const linkEl = document.getElementById("conn-link");
    const hostEl = document.getElementById("conn-host");
    const portEl = document.getElementById("conn-port");
    const passEl = document.getElementById("conn-password");

    if (statePayload.globalSettings) {
      if (hostEl && document.activeElement !== hostEl) {
        hostEl.value = statePayload.globalSettings.host || "127.0.0.1";
      }
      if (portEl && document.activeElement !== portEl) {
        portEl.value = String(statePayload.globalSettings.port || 4455);
      }
      if (passEl && document.activeElement !== passEl) {
        passEl.value = statePayload.globalSettings.password || "";
      }
    }

    if (statusEl && statePayload.status) {
      statusEl.textContent = statePayload.status.sentence || "";
      statusEl.className =
        "status-banner " +
        (statePayload.status.kind === "connected" ? "status-ok" : "status-err");
    }

    if (linkEl && statePayload.status) {
      if (statePayload.status.linkUrl) {
        linkEl.href = statePayload.status.linkUrl;
        linkEl.style.display = "inline-block";
      } else {
        linkEl.style.display = "none";
      }
    }

    populateSlotsDropdown(statePayload.slots);
  }

  window.initFadesterPropertyInspector = function (bindControlsFn) {
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
      ws.onopen = function () {
        send({ event: inRegisterEvent, uuid: uuid });
        populateSlotsDropdown([]);
        bindControlsFn(currentSettings, saveActionSettings);
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
          bindControlsFn(currentSettings, saveActionSettings);
        } else if (msg.event === "sendToPropertyInspector" && msg.payload) {
          if (msg.payload.event === "fadesterState") {
            updateConnectionStatusUI(msg.payload);
          }
        }
      };

      const saveConnBtn = document.getElementById("conn-test-btn");
      const hostEl = document.getElementById("conn-host");
      const portEl = document.getElementById("conn-port");
      const passEl = document.getElementById("conn-password");

      function pushGlobalConn() {
        sendToPlugin({
          event: "updateGlobalSettings",
          host: hostEl ? hostEl.value : "127.0.0.1",
          port: portEl ? Number(portEl.value) : 4455,
          password: passEl ? passEl.value : ""
        });
      }

      if (saveConnBtn) {
        saveConnBtn.addEventListener("click", function () {
          pushGlobalConn();
        });
      }
      if (hostEl) hostEl.addEventListener("change", pushGlobalConn);
      if (portEl) portEl.addEventListener("change", pushGlobalConn);
      if (passEl) passEl.addEventListener("change", pushGlobalConn);
    };
  };
})();

// SPDX-License-Identifier: GPL-2.0-or-later
// VJster settings page (docs/vjster/PLAN.md 3.8). Plain script for Stream
// Deck's property inspector: it shows the fields of the action it was opened
// for, saves them with setSettings, and shows the link status the plugin
// reports. No library, nothing loaded from the internet (R-ID-5).
/* global WebSocket, document, window */
(function () {
  "use strict";

  var PREFIX = "com.jbrick2070.vjster.";
  var STEPS = [
    ["0.05", "0.05x"],
    ["0.1", "0.1x"],
    ["0.25", "0.25x"],
    ["0.5", "0.5x"]
  ];
  var TARGETS = [
    ["browser", "Chrome tab"],
    ["obs", "OBS page"],
    ["both", "Both"]
  ];
  var LEVELS = [
    ["auto", "Auto"],
    ["hd2160", "2160p"],
    ["hd1440", "1440p"],
    ["hd1080", "1080p"],
    ["hd720", "720p"],
    ["large", "480p"],
    ["medium", "360p"],
    ["small", "240p"],
    ["tiny", "144p"]
  ];

  /** Field lists per action: [key, label, kind, options/default]. */
  var FIELDS = {
    speed: [
      ["label", "Strip label", "text", "SPEED"],
      ["step", "Turn step", "select", STEPS, "0.25"],
      ["fineStep", "Held-turn step", "select", STEPS, "0.05"],
      ["extended", "Extended range (0.1x to 16x, FX)", "check", false],
      ["hold", "Keep the speed on the next video", "check", true],
      ["target", "Control", "select", TARGETS, "browser"]
    ],
    quality: [
      ["label", "Strip label", "text", "QUALITY"],
      ["hold", "Keep the level on the next video", "check", true],
      ["target", "Control", "select", TARGETS, "browser"]
    ],
    "speed-preset": [
      ["rate", "Speed (0.1 to 16)", "number", 1],
      ["extended", "Write the video directly (needed below 0.25x or above 4x)", "check", false],
      ["hold", "Keep the speed on the next video", "check", true],
      ["target", "Control", "select", TARGETS, "browser"]
    ],
    "speed-step": [
      ["direction", "Direction", "select", [["1", "Faster"], ["-1", "Slower"]], "1"],
      ["step", "Step", "select", STEPS, "0.25"],
      ["extended", "Extended range", "check", false],
      ["target", "Control", "select", TARGETS, "browser"]
    ],
    "quality-preset": [
      ["level", "Level", "select", LEVELS, "auto"],
      ["hold", "Keep the level on the next video", "check", true],
      ["target", "Control", "select", TARGETS, "browser"]
    ],
    pin: [],
    transport: [["target", "Control", "select", TARGETS, "browser"]]
  };

  var ws = null;
  var context = "";
  var settings = {};
  var global = {};
  var kind = "";

  function send(message) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }

  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      e.setAttribute(k, attrs[k]);
    });
    if (text !== undefined) e.textContent = text;
    return e;
  }

  /** Numbers and booleans are stored as such; selects hold strings. */
  function readValue(field, input) {
    var key = field[0];
    var type = field[2];
    if (type === "check") return input.checked;
    if (type === "number") return Number(input.value);
    if (key === "step" || key === "fineStep") return Number(input.value);
    if (key === "direction") return Number(input.value);
    return input.value;
  }

  function render() {
    var box = document.getElementById("fields");
    box.textContent = "";
    var fields = FIELDS[kind] || [];
    if (fields.length === 0) {
      box.appendChild(el("p", { class: "note" }, kind === "pin" ? "Press to keep controlling the Chrome tab that is active now; press again to let go." : ""));
      return;
    }
    box.appendChild(el("h2", {}, "This action"));
    fields.forEach(function (field) {
      var key = field[0];
      var row = el("label", { class: "row" });
      row.appendChild(el("span", {}, field[1]));
      var input;
      var current = settings[key];
      if (field[2] === "select") {
        input = el("select", {});
        field[3].forEach(function (opt) {
          var o = el("option", { value: opt[0] }, opt[1]);
          input.appendChild(o);
        });
        input.value = current === undefined ? field[4] : String(current);
      } else if (field[2] === "check") {
        input = el("input", { type: "checkbox" });
        input.checked = current === undefined ? field[3] : current === true;
      } else if (field[2] === "number") {
        input = el("input", { type: "number", min: "0.1", max: "16", step: "0.05" });
        input.value = current === undefined ? String(field[3]) : String(current);
      } else {
        input = el("input", { type: "text", maxlength: "16" });
        input.value = current === undefined ? field[3] : String(current);
      }
      input.addEventListener("change", function () {
        settings[key] = readValue(field, input);
        send({ event: "setSettings", context: context, payload: settings });
      });
      row.appendChild(input);
      box.appendChild(row);
    });
  }

  function showStatus(s) {
    var box = document.getElementById("status");
    var words = {
      connected: "Chrome extension connected",
      "extension-off": "Waiting for the Chrome extension",
      "port-in-use": "Port " + s.port + " is in use by another program"
    };
    box.textContent = words[s.portInUse ? "port-in-use" : s.browser] || String(s.browser);
    box.className = "status " + (s.browser === "connected" ? "ok" : "bad");
    if (s.badIds > 0) {
      var allBad = s.badIds >= (s.extensionIds || []).length;
      box.textContent = allBad
        ? "No entry is a Chrome extension id: no extension can connect"
        : s.badIds + " entry(s) ignored: not a Chrome extension id";
      box.className = "status bad";
    }
    document.getElementById("port").value = String(s.port);
    document.getElementById("ext").value = (s.extensionIds || []).join(", ");
    var obs = document.getElementById("obs-status");
    if (!s.obsPage) {
      obs.textContent = "This copy of the plugin has no OBS page";
      obs.className = "status bad";
    } else {
      obs.textContent = s.obs === "connected" ? "OBS page connected" : "No OBS page connected";
      obs.className = "status " + (s.obs === "connected" ? "ok" : "bad");
    }
    // A port change changes the address: ask again for what was pasted, or show the placeholder.
    var pasted = document.getElementById("obs-video").value;
    if (pasted) send({ event: "sendToPlugin", action: PREFIX + kind, context: context, payload: { event: "obs-address", input: pasted } });
    else showAddress(s);
    document.getElementById("obs-always").checked = s.obsAlwaysOn === true;
  }

  document.getElementById("obs-always").addEventListener("change", function (event) {
    global.obsAlwaysOn = event.target.checked;
    send({ event: "setGlobalSettings", context: context, payload: global });
  });

  function showAddress(m) {
    var field = document.getElementById("obs-address");
    field.value = m.address || "";
    field.className = m.found ? "found" : "";
  }

  document.getElementById("obs-video").addEventListener("input", function (event) {
    send({ event: "sendToPlugin", action: PREFIX + kind, context: context, payload: { event: "obs-address", input: event.target.value } });
  });

  document.getElementById("obs-copy").addEventListener("click", function () {
    var field = document.getElementById("obs-address");
    field.select();
    var done = function () {
      document.getElementById("obs-copy").textContent = "Copied";
      window.setTimeout(function () {
        document.getElementById("obs-copy").textContent = "Copy address";
      }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(field.value).then(done, function () {
      if (document.execCommand("copy")) done();
    });
    else if (document.execCommand("copy")) done();
  });

  document.getElementById("save-global").addEventListener("click", function () {
    var port = Number(document.getElementById("port").value);
    var ids = document
      .getElementById("ext")
      .value.split(/[\s,]+/)
      .map(function (id) {
        return id.toLowerCase();
      })
      .filter(function (id) {
        return id.length > 0;
      });
    global.port = port >= 1024 && port <= 65535 ? port : 48150;
    global.extensionIds = ids;
    send({ event: "setGlobalSettings", context: context, payload: global });
    window.setTimeout(function () {
      send({ event: "sendToPlugin", action: PREFIX + kind, context: context, payload: { event: "status" } });
    }, 400);
  });

  window.connectElgatoStreamDeckSocket = function (inPort, inUUID, inRegisterEvent, inInfo, inActionInfo) {
    context = inUUID;
    var info = {};
    try {
      info = JSON.parse(inActionInfo);
    } catch (e) {
      info = {};
    }
    var action = typeof info.action === "string" ? info.action : "";
    kind = action.indexOf(PREFIX) === 0 ? action.slice(PREFIX.length) : "";
    settings = (info.payload && info.payload.settings) || {};
    render();

    ws = new WebSocket("ws://127.0.0.1:" + inPort);
    ws.onopen = function () {
      send({ event: inRegisterEvent, uuid: inUUID });
      send({ event: "getGlobalSettings", context: inUUID });
      send({ event: "sendToPlugin", action: action, context: inUUID, payload: { event: "status" } });
    };
    ws.onmessage = function (evt) {
      var m;
      try {
        m = JSON.parse(evt.data);
      } catch (e) {
        return;
      }
      if (m.event === "didReceiveGlobalSettings" && m.payload) global = m.payload.settings || {};
      if (m.event === "didReceiveSettings" && m.payload) {
        settings = m.payload.settings || {};
        render();
      }
      if (m.event === "sendToPropertyInspector" && m.payload && m.payload.event === "status") showStatus(m.payload);
      if (m.event === "sendToPropertyInspector" && m.payload && m.payload.event === "obs-address") showAddress(m.payload);
    };
  };
})();

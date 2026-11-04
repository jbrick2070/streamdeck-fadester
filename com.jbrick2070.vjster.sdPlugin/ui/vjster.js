// SPDX-License-Identifier: GPL-2.0-or-later
// VJster settings page (docs/vjster/PLAN.md 3.8). Plain script for Stream
// Deck's property inspector: it shows the fields of the action it was opened
// for, saves them with setSettings, and shows the link status the plugin
// reports. No library, nothing loaded from the internet (R-ID-5). Its texts
// come from i18n.js, loaded before it, in Stream Deck's language (PLAN.md 8.4)
// until the plugin says which language VJster is in (the Language choice,
// PLAN.md 9); a text that starts with "@" in the tables below is such a key.
/* global WebSocket, document, window */
(function () {
  "use strict";

  // Inside the Fadester plugin (the suite) the page is told its action ids and where its settings live (suite.js).
  var SUITE = window.VJSTER_SUITE || null;
  var PREFIX = SUITE ? SUITE.prefix : "com.jbrick2070.vjster.";
  var STEPS = [
    ["0.05", "0.05x"],
    ["0.1", "0.1x"],
    ["0.25", "0.25x"],
    ["0.5", "0.5x"]
  ];
  var TARGETS = [
    ["browser", "@targetBrowser"],
    ["obs", "@targetObs"],
    ["both", "@targetBoth"]
  ];
  var LEVELS = [
    ["auto", "@levelAuto"],
    ["hd2160", "2160p"],
    ["hd1440", "1440p"],
    ["hd1080", "1080p"],
    ["hd720", "720p"],
    ["large", "480p"],
    ["medium", "360p"],
    ["small", "240p"],
    ["tiny", "144p"]
  ];

  /**
   * Field lists per action: [key, label key, kind, options/default]. A text
   * field's default is the deck word it shows when left empty; it is never
   * stored, so an empty label stays unset (PLAN.md 8, Review round 1).
   */
  var FIELDS = {
    speed: [
      ["label", "fieldLabel", "text", "speed"],
      ["step", "fieldStep", "select", STEPS, "0.25"],
      ["fineStep", "fieldFineStep", "select", STEPS, "0.05"],
      ["extended", "fieldExtended", "check", false],
      ["hold", "fieldHoldSpeed", "check", true],
      ["target", "fieldControl", "select", TARGETS, "browser"]
    ],
    quality: [
      ["label", "fieldLabel", "text", "quality"],
      ["hold", "fieldHoldLevel", "check", true],
      ["target", "fieldControl", "select", TARGETS, "browser"]
    ],
    "speed-preset": [
      ["rate", "fieldRate", "number", 1],
      ["extended", "fieldDirect", "check", false],
      ["hold", "fieldHoldSpeed", "check", true],
      ["target", "fieldControl", "select", TARGETS, "browser"]
    ],
    "speed-step": [
      ["direction", "fieldDirection", "select", [["1", "@faster"], ["-1", "@slower"]], "1"],
      ["step", "fieldStepSize", "select", STEPS, "0.25"],
      ["extended", "fieldExtendedShort", "check", false],
      ["target", "fieldControl", "select", TARGETS, "browser"]
    ],
    "quality-preset": [
      ["level", "fieldLevel", "select", LEVELS, "auto"],
      ["hold", "fieldHoldLevel", "check", true],
      ["target", "fieldControl", "select", TARGETS, "browser"]
    ],
    pin: [],
    transport: [["target", "fieldControl", "select", TARGETS, "browser"]]
  };

  var STRINGS = window.VJSTER_PI_STRINGS || {};
  /** The Language choice's languages: Stream Deck's eight and Dutch, as the plugin stores and resolves them. */
  var PLUGIN_LANGUAGES = ["en", "de", "es", "fr", "ja", "ko", "zh_CN", "zh_TW", "nl"];
  /** The language the texts are in: Stream Deck's, its base language, or English; then the one the plugin resolved. */
  var lang = "en";

  function pickLanguage(wanted) {
    var w = typeof wanted === "string" ? wanted : "";
    if (Object.prototype.hasOwnProperty.call(STRINGS, w)) return w;
    var base = w.split(/[_-]/)[0];
    if (Object.prototype.hasOwnProperty.call(STRINGS, base)) return base;
    return "en";
  }

  function entry(language, part, key) {
    var table = Object.prototype.hasOwnProperty.call(STRINGS, language) ? STRINGS[language][part] : null;
    return table && Object.prototype.hasOwnProperty.call(table, key) && typeof table[key] === "string" ? table[key] : null;
  }

  /** The {placeholders} of a text, sorted, as one string. */
  function placeholdersOf(text) {
    return (text.match(/\{[A-Za-z0-9_]+\}/g) || []).sort().join();
  }

  /**
   * A text in the page's language; English where that one is missing, blank,
   * echoes its key or has other placeholders than English's, as the deck does
   * (R-LANG-5); the key itself only when English has nothing either.
   */
  function lookup(part, key) {
    var english = entry("en", part, key);
    var mine = entry(lang, part, key);
    if (mine !== null && mine.trim() !== "" && mine !== key && (english === null || placeholdersOf(mine) === placeholdersOf(english))) return mine;
    return english !== null && english !== "" ? english : key;
  }

  /** A settings page text with its {placeholders} filled; values are put in as given. */
  function t(key, values) {
    return lookup("pi", key).replace(/\{([A-Za-z0-9_]+)\}/g, function (all, name) {
      return values && Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : all;
    });
  }

  /** An option or field text: a key when it starts with "@", else shown as it is (numbers such as 0.25x). */
  function shown(text) {
    return text.charAt(0) === "@" ? t(text.slice(1)) : text;
  }

  /** Put the page's fixed texts in the current language. */
  function translatePage() {
    document.documentElement.setAttribute("lang", lang.replace("_", "-"));
    var nodes = document.querySelectorAll("[data-i18n]");
    for (var i = 0; i < nodes.length; i++) nodes[i].textContent = t(nodes[i].getAttribute("data-i18n"));
    var inputs = document.querySelectorAll("[data-i18n-placeholder]");
    for (var j = 0; j < inputs.length; j++) inputs[j].setAttribute("placeholder", t(inputs[j].getAttribute("data-i18n-placeholder")));
  }

  var ws = null;
  var context = "";
  var settings = {};
  var global = {};
  var kind = "";
  /** Re-words the action fields in place after a language change, keeping what is typed in them (R-LANG-4). */
  var relabels = [];
  /** The last link status, so its words can follow a language change. */
  var lastStatus = null;
  /** Per link box ("port", "ext"): it holds typed, unsaved text, so a status message leaves it alone. */
  var linkEdited = { port: false, ext: false };
  /** Per link box: it shows what the plugin uses (a status message filled it). */
  var linkShown = { port: false, ext: false };

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

  /** A node whose text comes from `wording`, worded again after a language change. */
  function worded(node, wording) {
    node.textContent = wording();
    relabels.push(function () {
      node.textContent = wording();
    });
    return node;
  }

  /** The default strip label shown as a placeholder: the deck word, in the deck's language. */
  function labelPlaceholder(field) {
    var word = field[3] === "speed" && settings.extended === true ? "fxSpeed" : field[3];
    var placeholder = lookup("deck", word);
    return placeholder === word ? "" : placeholder;
  }

  function render() {
    var box = document.getElementById("fields");
    box.textContent = "";
    relabels = [];
    var fields = FIELDS[kind] || [];
    if (fields.length === 0) {
      box.appendChild(
        worded(el("p", { class: "note" }), function () {
          return kind === "pin" ? t("pinNote") : "";
        })
      );
      return;
    }
    box.appendChild(
      worded(el("h2", {}), function () {
        return t("thisAction");
      })
    );
    fields.forEach(function (field) {
      var key = field[0];
      var row = el("label", { class: "row" });
      row.appendChild(
        worded(el("span", {}), function () {
          return t(field[1]);
        })
      );
      var input;
      var current = settings[key];
      if (field[2] === "select") {
        input = el("select", {});
        field[3].forEach(function (opt) {
          input.appendChild(
            worded(el("option", { value: opt[0] }), function () {
              return shown(opt[1]);
            })
          );
        });
        input.value = current === undefined ? field[4] : String(current);
      } else if (field[2] === "check") {
        input = el("input", { type: "checkbox" });
        input.checked = current === undefined ? field[3] : current === true;
      } else if (field[2] === "number") {
        input = el("input", { type: "number", min: "0.1", max: "16", step: "0.05" });
        input.value = current === undefined ? String(field[3]) : String(current);
      } else {
        // The default label is the placeholder, in the deck's language, never the value (R-I18N-2).
        input = el("input", { type: "text", maxlength: "16", placeholder: labelPlaceholder(field) });
        input.value = current === undefined ? "" : String(current);
        var text = input;
        relabels.push(function () {
          text.setAttribute("placeholder", labelPlaceholder(field));
        });
      }
      input.addEventListener("change", function () {
        var value = readValue(field, input);
        if (field[2] === "text" && String(value).trim() === "") delete settings[key];
        else settings[key] = value;
        send({ event: "setSettings", context: context, payload: settings });
      });
      row.appendChild(input);
      box.appendChild(row);
    });
  }

  /** The link status and OBS status in the page's language; nothing else is touched. */
  function wordStatus(s) {
    var box = document.getElementById("status");
    var words = {
      connected: t("statusConnected"),
      "extension-off": t("statusWaiting"),
      "port-in-use": t("statusPortInUse", { port: s.port })
    };
    box.textContent = words[s.portInUse ? "port-in-use" : s.browser] || String(s.browser);
    box.className = "status " + (s.browser === "connected" ? "ok" : "bad");
    if (s.badIds > 0) {
      var allBad = s.badIds >= (s.extensionIds || []).length;
      box.textContent = allBad ? t("noValidId") : t(s.badIds === 1 ? "badIdOne" : "badIdMany", { n: s.badIds });
      box.className = "status bad";
    }
    var obs = document.getElementById("obs-status");
    if (!s.obsPage) {
      obs.textContent = t("noObsPage");
      obs.className = "status bad";
    } else {
      obs.textContent = s.obs === "connected" ? t("obsConnected") : t("obsWaiting");
      obs.className = "status " + (s.obs === "connected" ? "ok" : "bad");
    }
  }

  /** True while the operator is in this link box or has typed there since the last save. */
  function editingLink(id) {
    var focused = document.activeElement;
    return linkEdited[id] || (focused !== undefined && focused !== null && focused.id === id);
  }

  function showStatus(s) {
    lastStatus = s;
    wordStatus(s);
    if (!editingLink("port")) {
      document.getElementById("port").value = String(s.port);
      linkShown.port = true;
    }
    if (!editingLink("ext")) {
      document.getElementById("ext").value = (s.extensionIds || []).join(", ");
      linkShown.ext = true;
    }
    // A port change changes the address: ask again for what was pasted, or show the placeholder.
    var pasted = document.getElementById("obs-video").value;
    if (pasted) send({ event: "sendToPlugin", action: PREFIX + kind, context: context, payload: { event: "obs-address", input: pasted } });
    else showAddress(s);
    document.getElementById("obs-always").checked = s.obsAlwaysOn === true;
  }

  /**
   * Writes the page's copy of the plugin-wide settings, without `language`: only the plugin saves the
   * Language choice, so a copy older than the last pick cannot undo it; what this copy omits, the plugin
   * keeps (R-LANG-8).
   */
  function writeGlobal() {
    var copy = {};
    Object.keys(global).forEach(function (k) {
      if (k !== "language") copy[k] = global[k];
    });
    // In the suite the page does not write the stored object (it holds Fadester's settings too): the plugin saves this part.
    if (SUITE) send({ event: "sendToPlugin", action: PREFIX + kind, context: context, payload: { event: "suiteGlobal", settings: copy } });
    else send({ event: "setGlobalSettings", context: context, payload: copy });
  }

  document.getElementById("obs-always").addEventListener("change", function (event) {
    global.obsAlwaysOn = event.target.checked;
    writeGlobal();
  });

  ["port", "ext"].forEach(function (id) {
    document.getElementById(id).addEventListener("input", function () {
      linkEdited[id] = true;
    });
  });

  // A pick asks the plugin to save and apply it; the page changes when the plugin answers.
  document.getElementById("language").addEventListener("change", function (event) {
    send({ event: "sendToPlugin", action: PREFIX + kind, context: context, payload: { event: "setLanguage", choice: event.target.value } });
  });

  /**
   * The plugin's answer: the choice and the language VJster draws in. The select follows the choice;
   * another language re-words the page in place: fixed texts, the action fields (typed values kept), the
   * statuses from the last report, then asks for the status again (R-LANG-4).
   */
  function showLanguage(m) {
    var picker = document.getElementById("language");
    picker.value = PLUGIN_LANGUAGES.indexOf(m.choice) !== -1 ? m.choice : "auto";
    picker.disabled = false;
    if (typeof m.resolved !== "string" || PLUGIN_LANGUAGES.indexOf(m.resolved) === -1 || m.resolved === lang) return;
    lang = m.resolved;
    translatePage();
    relabels.forEach(function (relabel) {
      relabel();
    });
    if (lastStatus) wordStatus(lastStatus);
    send({ event: "sendToPlugin", action: PREFIX + kind, context: context, payload: { event: "status" } });
  }

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
      document.getElementById("obs-copy").textContent = t("copied");
      window.setTimeout(function () {
        document.getElementById("obs-copy").textContent = t("copy");
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
    // A box the plugin never filled and nobody typed in is empty, not a port or an empty allow list: leave
    // it out then, and the plugin keeps what it has (R-LANG-8). Each box counts on its own, so typing a port
    // into a box that was focused before the first report writes no allow list.
    if (linkShown.port || linkEdited.port) global.port = port >= 1024 && port <= 65535 ? port : 48150;
    if (linkShown.ext || linkEdited.ext) global.extensionIds = ids;
    linkEdited = { port: false, ext: false };
    writeGlobal();
    window.setTimeout(function () {
      send({ event: "sendToPlugin", action: PREFIX + kind, context: context, payload: { event: "status" } });
    }, 400);
  });

  window.connectElgatoStreamDeckSocket = function (inPort, inUUID, inRegisterEvent, inInfo, inActionInfo) {
    context = inUUID;
    // Stream Deck's language, before anything is drawn (PLAN.md 8, Review round 1).
    try {
      var app = JSON.parse(inInfo).application;
      lang = pickLanguage(app && app.language);
    } catch (e) {
      lang = "en";
    }
    translatePage();
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
      if (m.event === "didReceiveGlobalSettings" && m.payload) {
        global = m.payload.settings || {};
        if (SUITE) global = global[SUITE.namespace] || {};
      }
      if (m.event === "didReceiveSettings" && m.payload) {
        settings = m.payload.settings || {};
        render();
      }
      if (m.event === "sendToPropertyInspector" && m.payload && m.payload.event === "language") showLanguage(m.payload);
      if (m.event === "sendToPropertyInspector" && m.payload && m.payload.event === "status") showStatus(m.payload);
      if (m.event === "sendToPropertyInspector" && m.payload && m.payload.event === "obs-address") showAddress(m.payload);
    };
  };
})();

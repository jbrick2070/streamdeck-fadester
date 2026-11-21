/* SPDX-License-Identifier: GPL-2.0-or-later */
/* global window, document */
/**
 * The plugin's version at the foot of every settings page, so a screenshot
 * says which build it is. direct-pi.js and pi-common.js call it with the
 * version the plugin sends in its state. On the direct pages the same version
 * is also in the line that opens the plugin's settings (direct-pi.js), which
 * is in view without opening anything.
 */
window.showFadesterPluginVersion = function (version) {
  if (!version || !document.body) return;
  let line = document.getElementById("plugin-version");
  if (!line) {
    line = document.createElement("p");
    line.id = "plugin-version";
    line.className = "muted";
    document.body.appendChild(line);
  }
  line.textContent = "Fadester for OBS v" + version;
};

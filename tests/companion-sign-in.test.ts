// SPDX-License-Identifier: GPL-2.0-or-later
// "Open when I sign in" in Fadester Companion (UI review U3-06). It is a setting of the computer, so it is off until
// the user ticks it, on every route: the ZIP build's Run value, the Store package's start-up task and the Mac's
// login item. The behaviour itself is checked by the panels' own self-tests (SignIn.cs Test, built by build.ps1).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
// CI's Windows runner checks files out with CRLF.
const read = (rel: string): string => readFileSync(join(root, rel), "utf8").replace(/\r\n/g, "\n");

describe("Fadester Companion: open when I sign in", () => {
  const signIn = read("tourbox/panel/SignIn.cs");
  const panel = read("tourbox/panel/FadesterTourBox.cs");
  const manifest = read("tourbox/store/AppxManifest.xml");
  const mac = read("tourbox/macos/panel/Panel.swift");

  it("the Store package declares the start-up task the panel asks for, switched off", () => {
    const id = /TaskId = "([A-Za-z]+)"/.exec(signIn)?.[1];
    expect(id).toBeTruthy();
    const task = /<uap5:StartupTask ([^>]*)\/>/.exec(manifest)?.[1] ?? "";
    expect(task).toContain(`TaskId="${id}"`);
    expect(task).toContain('Enabled="false"');
    expect(manifest).toContain('xmlns:uap5="http://schemas.microsoft.com/appx/manifest/uap/windows10/5"');
    expect(manifest).toMatch(/<uap5:Extension Category="windows\.startupTask" Executable="Fadester Companion\.exe"/);
  });

  it("the ZIP build writes only the current user's Run value, and only from the check box", () => {
    expect(signIn).toContain('@"Software\\Microsoft\\Windows\\CurrentVersion\\Run"');
    expect(signIn).not.toMatch(/Registry\.LocalMachine/);
    // The only caller of Set is the check box's own handler; reading never switches it on.
    expect(panel.match(/SignInStart\.Set\(/g)?.length).toBe(1);
    expect(panel).toMatch(/signIn\.CheckedChanged\+=async delegate \{ if\(!settingSignIn\) await SetSignIn\(signIn\.Checked\); \}/);
    expect(panel).toContain("SignInStart.Test();");
  });

  it("the box starts unticked and its words exist in all 13 languages", () => {
    expect(panel).toMatch(/signIn=new CheckBox \{Text=text\.Get\("openAtSignIn"\)/);
    expect(panel).not.toMatch(/signIn=new CheckBox \{[^}]*Checked=true/);
    const extra = read("tourbox/panel/PanelExtraText.cs");
    for (const key of ["openAtSignIn", "signInSettings", "signInFailed"]) {
      expect(read("tourbox/panel/PanelText.cs")).toContain(`{ "${key}", new[] {`);
      expect(extra.split(`{ "${key}", "`).length - 1, key).toBe(9);
    }
  });

  it("the Mac registers the app itself as a login item, from the check box only, on macOS 13 and later", () => {
    expect(mac).toContain("import ServiceManagement");
    expect(mac.match(/try service\.register\(\)/g)?.length).toBe(1);
    expect(mac).toMatch(/@objc private func openAtLoginToggled\(\) \{\n\s+guard #available\(macOS 13\.0, \*\), !previewMode else \{ return \}/);
    expect(mac).toContain("SMAppService.mainApp.status == .enabled ? .on : .off");
    // No helper bundle, entitlement or launch agent: nothing that needs a signing identity.
    expect(mac).not.toMatch(/SMLoginItemSetEnabled|LaunchAgents|loginItem\(identifier/);
  });
});

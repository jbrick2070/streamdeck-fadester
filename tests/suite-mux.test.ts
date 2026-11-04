// SPDX-License-Identifier: GPL-2.0-or-later
// The suite plugin's message router (src/suite/mux.ts, docs/SUITE.md): which child hears a message, how VJster's action ids are
// translated, and how the one stored settings object is shared.
import { describe, expect, it } from "vitest";
import { VJSTER_ACTIONS, VJSTER_KINDS, VJSTER_NAMESPACE, suiteActionId, vjsterActionId } from "../src/suite/actions.js";
import { WATCHDOG, parseLaunchArgs } from "../src/suite/launch-args.js";
import { SUITE_GLOBAL_EVENT, SuiteMux, type Child, type Message } from "../src/suite/mux.js";

const PLUGIN = "com.jbrick2070.fadester-for-obs.sdPlugin";
const FADE = "com.jbrick2070.fadester-for-obs.obs-fade";
const SPEED = suiteActionId("speed");

function rig() {
  const host: Message[] = [];
  const children: Record<Child, Message[]> = { fadester: [], vjster: [] };
  const mux = new SuiteMux({
    pluginUuid: PLUGIN,
    vjsterActions: VJSTER_ACTIONS,
    namespace: VJSTER_NAMESPACE,
    toHost: (message) => host.push(message),
    toChild: (child, message) => children[child].push(message)
  });
  return { mux, host, children };
}

describe("the action ids", () => {
  it("pair each of VJster's seven actions with the suite's name for it", () => {
    expect(Object.keys(VJSTER_ACTIONS)).toHaveLength(7);
    for (const kind of VJSTER_KINDS) expect(VJSTER_ACTIONS[suiteActionId(kind)]).toBe(vjsterActionId(kind));
    expect(suiteActionId("speed")).toBe("com.jbrick2070.fadester-for-obs.vjster-speed");
    expect(vjsterActionId("speed")).toBe("com.jbrick2070.vjster.speed");
  });
});

describe("messages from the host", () => {
  it("go to the plugin that owns the action, VJster's with its own id", () => {
    const { mux, children } = rig();
    mux.fromHost({ event: "willAppear", action: FADE, context: "c1", device: "d", payload: {} });
    mux.fromHost({ event: "willAppear", action: SPEED, context: "c2", device: "d", payload: {} });
    expect(children.fadester).toEqual([{ event: "willAppear", action: FADE, context: "c1", device: "d", payload: {} }]);
    expect(children.vjster).toEqual([{ event: "willAppear", action: "com.jbrick2070.vjster.speed", context: "c2", device: "d", payload: {} }]);
  });

  it("send a message with no action to the owner of its context, and anything else to both", () => {
    const { mux, children } = rig();
    mux.fromHost({ event: "willAppear", action: SPEED, context: "c2", payload: {} });
    children.vjster.length = 0;
    mux.fromHost({ event: "titleParametersDidChange", context: "c2", payload: {} });
    expect(children.vjster).toHaveLength(1);
    expect(children.fadester).toHaveLength(0);
    mux.fromHost({ event: "deviceDidConnect", device: "d" });
    mux.fromHost({ event: "systemDidWakeUp" });
    expect(children.fadester.map((m) => m.event)).toEqual(["deviceDidConnect", "systemDidWakeUp"]);
    expect(children.vjster.map((m) => m.event)).toEqual(["titleParametersDidChange", "deviceDidConnect", "systemDidWakeUp"]);
  });

  it("forget a context when its key goes away", () => {
    const { mux, children } = rig();
    mux.fromHost({ event: "willAppear", action: SPEED, context: "c2" });
    mux.fromHost({ event: "willDisappear", action: SPEED, context: "c2" });
    children.vjster.length = 0;
    mux.fromHost({ event: "titleParametersDidChange", context: "c2" });
    expect(children.vjster).toHaveLength(1);
    expect(children.fadester).toHaveLength(1); // no owner any more: both hear it
  });

  it("do not mistake a prototype name for a VJster action", () => {
    const { mux, children } = rig();
    mux.fromHost({ event: "keyDown", action: "constructor", context: "c9" });
    mux.fromHost({ event: "keyDown", action: "__proto__", context: "c9" });
    expect(children.fadester).toHaveLength(2);
    expect(children.vjster).toHaveLength(0);
  });
});

describe("the one stored settings object", () => {
  const stored = { host: "127.0.0.1", port: 4455, password: "pw", language: "de", vjster: { port: 48160, obsToken: "t" } };

  it("is read by Fadester without VJster's part and by VJster as only its own part, each answer carrying the read's id", () => {
    const { mux, host, children } = rig();
    mux.fromChild("fadester", { event: "getGlobalSettings", id: "f-1", context: PLUGIN });
    mux.fromChild("vjster", { event: "getGlobalSettings", id: "v-1", context: PLUGIN });
    expect(host).toEqual([{ event: "getGlobalSettings", context: PLUGIN, id: "suite-global-settings" }]); // one read for both
    mux.fromHost({ event: "didReceiveGlobalSettings", id: "suite-global-settings", payload: { settings: stored } });
    expect(children.fadester).toEqual([{ event: "didReceiveGlobalSettings", id: "f-1", payload: { settings: { host: "127.0.0.1", port: 4455, password: "pw", language: "de" } } }]);
    expect(children.vjster).toEqual([{ event: "didReceiveGlobalSettings", id: "v-1", payload: { settings: { port: 48160, obsToken: "t" } } }]);
  });

  it("answers a later read from what it knows, without asking the host again", () => {
    const { mux, host, children } = rig();
    mux.fromHost({ event: "didReceiveGlobalSettings", payload: { settings: stored } });
    children.fadester.length = 0;
    mux.fromChild("fadester", { event: "getGlobalSettings", id: "f-2" });
    expect(host).toEqual([]);
    expect(children.fadester).toHaveLength(1);
    expect(children.fadester[0].id).toBe("f-2");
  });

  it("tells both when the host says the settings changed (news carries no id)", () => {
    const { mux, children } = rig();
    mux.fromHost({ event: "didReceiveGlobalSettings", payload: { settings: stored } });
    expect(children.fadester[0].id).toBeUndefined();
    expect(children.vjster[0].id).toBeUndefined();
  });

  it("keeps VJster's part when Fadester saves, and Fadester's keys when VJster saves", () => {
    const { mux, host } = rig();
    mux.fromHost({ event: "didReceiveGlobalSettings", payload: { settings: stored } });
    host.length = 0;
    // Fadester writes the object it knows, which has no vjster part.
    mux.fromChild("fadester", { event: "setGlobalSettings", context: PLUGIN, payload: { host: "10.0.0.2", port: 4455, password: "new", language: "de" } });
    expect(host[0]).toEqual({ event: "setGlobalSettings", context: PLUGIN, payload: { host: "10.0.0.2", port: 4455, password: "new", language: "de", vjster: { port: 48160, obsToken: "t" } } });
    // VJster writes its own whole object.
    mux.fromChild("vjster", { event: "setGlobalSettings", context: PLUGIN, payload: { port: 48170, obsToken: "t2" } });
    expect(host[1]).toEqual({ event: "setGlobalSettings", context: PLUGIN, payload: { host: "10.0.0.2", port: 4455, password: "new", language: "de", vjster: { port: 48170, obsToken: "t2" } } });
    expect(mux.settings).toEqual(host[1].payload);
  });

  it("saves what VJster's settings page asks for under VJster's name, tells VJster, and does not pass the request on", () => {
    const { mux, host, children } = rig();
    mux.fromHost({ event: "didReceiveGlobalSettings", payload: { settings: stored } });
    host.length = 0;
    children.vjster.length = 0;
    children.fadester.length = 0;
    mux.fromHost({ event: "sendToPlugin", action: SPEED, context: "c2", payload: { event: SUITE_GLOBAL_EVENT, settings: { port: 48199 } } });
    expect(host).toEqual([{ event: "setGlobalSettings", context: PLUGIN, payload: { host: "127.0.0.1", port: 4455, password: "pw", language: "de", vjster: { port: 48199 } } }]);
    expect(children.vjster).toEqual([{ event: "didReceiveGlobalSettings", payload: { settings: { port: 48199 } } }]);
    expect(children.fadester).toEqual([]);
  });

  it("treats a page's save with nothing in it as an empty part, not an error", () => {
    const { mux, host } = rig();
    mux.fromHost({ event: "sendToPlugin", action: SPEED, context: "c2", payload: { event: SUITE_GLOBAL_EVENT, settings: "nonsense" } });
    expect(host[0].payload).toEqual({ vjster: {} });
  });

  it("does not take a settings-save message from a Fadester action", () => {
    const { mux, host, children } = rig();
    mux.fromHost({ event: "sendToPlugin", action: FADE, context: "c1", payload: { event: SUITE_GLOBAL_EVENT, settings: { port: 1 } } });
    expect(host).toEqual([]);
    expect(children.fadester).toHaveLength(1);
  });
});

describe("messages from a child", () => {
  it("never register a second time", () => {
    const { mux, host } = rig();
    mux.fromChild("vjster", { event: "registerPlugin", uuid: PLUGIN });
    expect(host).toEqual([]);
  });

  it("reach the host with VJster's action ids turned into the suite's", () => {
    const { mux, host } = rig();
    mux.fromChild("vjster", { event: "sendToPropertyInspector", action: "com.jbrick2070.vjster.speed", context: "c2", payload: { event: "status" } });
    mux.fromChild("vjster", { event: "setImage", context: "c2", payload: { image: "data:" } });
    mux.fromChild("fadester", { event: "switchToProfile", context: PLUGIN, device: "d", payload: { profile: "profiles/x" } });
    expect(host[0].action).toBe(SPEED);
    expect(host[1]).toEqual({ event: "setImage", context: "c2", payload: { image: "data:" } });
    expect(host[2]).toEqual({ event: "switchToProfile", context: PLUGIN, device: "d", payload: { profile: "profiles/x" } });
  });
});

describe("a child that starts again", () => {
  it("is given the decks, the settings and its own keys and dials, not the other's", () => {
    const { mux } = rig();
    mux.fromHost({ event: "deviceDidConnect", device: "d1", deviceInfo: {} });
    mux.fromHost({ event: "didReceiveGlobalSettings", payload: { settings: { host: "h", vjster: { port: 48160 } } } });
    mux.fromHost({ event: "willAppear", action: FADE, context: "c1", device: "d1", payload: {} });
    mux.fromHost({ event: "willAppear", action: SPEED, context: "c2", device: "d1", payload: {} });
    mux.fromHost({ event: "willAppear", action: SPEED, context: "c3", device: "d1", payload: {} });
    mux.fromHost({ event: "willDisappear", action: SPEED, context: "c3", device: "d1", payload: {} });
    expect(mux.replayFor("vjster").map((m) => `${m.event}:${m.context ?? ""}`)).toEqual(["deviceDidConnect:", "didReceiveGlobalSettings:", "willAppear:c2"]);
    expect(mux.replayFor("vjster")[2].action).toBe("com.jbrick2070.vjster.speed");
    expect(mux.replayFor("fadester").map((m) => `${m.event}:${m.context ?? ""}`)).toEqual(["deviceDidConnect:", "didReceiveGlobalSettings:", "willAppear:c1"]);
    mux.fromHost({ event: "deviceDidDisconnect", device: "d1" });
    expect(mux.replayFor("vjster").map((m) => m.event)).toEqual(["didReceiveGlobalSettings", "willAppear"]);
  });
});

describe("the launch line", () => {
  const info = JSON.stringify({ application: { language: "en" } });
  it("reads what Stream Deck and OpenDeck pass", () => {
    expect(parseLaunchArgs(["-port", "28196", "-pluginUUID", PLUGIN, "-registerEvent", "registerPlugin", "-info", info])).toEqual({ port: 28196, uuid: PLUGIN, registerEvent: "registerPlugin", info });
  });
  it("names what is missing or wrong", () => {
    expect(() => parseLaunchArgs([])).toThrow(/-port/);
    expect(() => parseLaunchArgs(["-port", "0", "-pluginUUID", "x", "-registerEvent", "r", "-info", "{}"])).toThrow(/not a port/);
    expect(() => parseLaunchArgs(["-port", "9", "-registerEvent", "r", "-info", "{}"])).toThrow(/-pluginUUID/);
  });
  it("gives each child a line that ends it when the suite is gone", () => {
    expect(WATCHDOG).toContain("SUITE_PARENT_PID");
    expect(WATCHDOG).toContain("process.exit(0)");
    expect(() => new Function(WATCHDOG.replace("setInterval", "(()=>{})"))).not.toThrow();
  });
});

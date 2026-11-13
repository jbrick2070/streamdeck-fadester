// SPDX-License-Identifier: GPL-2.0-or-later
import Foundation
import CoreFoundation

enum PanelFailure: Error, CustomStringConvertible {
    case message(String)
    var description: String { switch self { case .message(let value): return value } }
}

struct Settings {
    var port = 4455
    var musicInput = "", contentInput = "", micInput = "", mediaInput = ""
    var overlayScene = "", overlaySource = ""
    var anchors = ["", "", "", ""]
    var volumeStepDb = 1.0, duckDb = -12.0, faderStep = 0.05
    var transitionStepMs = 50, mixStepDb = 3.0, mixFadeMs = 600
    var mixEnabled = false
    var vjsterEnabled = true, vjsterPort = 48150
    var vjsterExtensionId = "", vjsterObsToken = Settings.newObsToken(), vjsterTarget = "both"
    var layer1Scene = "", layer1Source = "", layer2Scene = "", layer2Source = ""
    var opacityStep = 0.05

    static func newObsToken() -> String {
        (0..<16).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
    }
    static func videoId(from input: String) -> String? {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let idPattern = "^[A-Za-z0-9_-]{11}$"
        if trimmed.range(of: idPattern, options: .regularExpression) != nil {
            return trimmed != "videoseries" ? trimmed : nil
        }
        let lower = trimmed.lowercased()
        let withScheme = (lower.hasPrefix("http://") || lower.hasPrefix("https://")) ? trimmed : "https://" + trimmed
        guard let components = URLComponents(string: withScheme), let rawHost = components.host?.lowercased() else { return nil }
        let youtube = rawHost == "youtube.com" || rawHost.hasSuffix(".youtube.com")
            || rawHost == "youtube-nocookie.com" || rawHost.hasSuffix(".youtube-nocookie.com")
        let segments = components.path.split(separator: "/").map(String.init)
        var candidate: String?
        if rawHost == "youtu.be" {
            candidate = segments.first
        } else if youtube {
            if let v = components.queryItems?.first(where: { $0.name == "v" })?.value {
                candidate = v
            } else if segments.count >= 2, ["shorts", "embed", "live", "v"].contains(segments[0]) {
                candidate = segments[1]
            }
        }
        guard let id = candidate, id != "videoseries", id.range(of: idPattern, options: .regularExpression) != nil else { return nil }
        return id
    }
    func obsBrowserUrl(videoInput: String) throws -> String {
        try validate()
        guard vjsterObsToken.count == 32 else { throw PanelFailure.message("Generate or save a VJster OBS page token first.") }
        let video = Settings.videoId(from: videoInput) ?? "VIDEO_ID"
        return "http://127.0.0.1:\(vjsterPort)/obs?v=\(video)#token=\(vjsterObsToken)"
    }

    init() {}
    init(data: Data) throws {
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw PanelFailure.message("Settings must contain a JSON object.") }
        if let host = json["host"], host as? String != "127.0.0.1" { throw PanelFailure.message("This panel connects only to OBS on this Mac.") }
        func text(_ key: String, _ fallback: String = "") throws -> String {
            guard let value = json[key] else { return fallback }
            guard let text = value as? String else { throw PanelFailure.message("Invalid setting: \(key).") }; return text
        }
        func number(_ key: String, _ fallback: Double) throws -> Double {
            guard let value = json[key] else { return fallback }
            guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { throw PanelFailure.message("Invalid number: \(key).") }
            return number.doubleValue
        }
        func integer(_ key: String, _ fallback: Int) throws -> Int {
            let value = try number(key, Double(fallback))
            guard value.isFinite, value.rounded() == value, (-1_000_000...1_000_000).contains(value) else { throw PanelFailure.message("Invalid integer: \(key).") }
            return Int(value)
        }
        func boolean(_ key: String, _ fallback: Bool) throws -> Bool {
            guard let raw = json[key] else { return fallback }
            guard let value = raw as? NSNumber, CFGetTypeID(value) == CFBooleanGetTypeID() else { throw PanelFailure.message("Invalid boolean setting: \(key).") }
            return value.boolValue
        }
        port = try integer("port", port)
        musicInput = try text("musicInput"); contentInput = try text("contentInput"); micInput = try text("micInput"); mediaInput = try text("mediaInput")
        overlayScene = try text("overlayScene"); overlaySource = try text("overlaySource")
        if let raw = json["anchors"] {
            guard let list = raw as? [String], list.count == 4 else { throw PanelFailure.message("Settings need four D-pad assignments.") }; anchors = list
        }
        volumeStepDb = try number("volumeStepDb", volumeStepDb); duckDb = try number("duckDb", duckDb); faderStep = try number("faderStep", faderStep)
        transitionStepMs = try integer("transitionStepMs", transitionStepMs); mixStepDb = try number("mixStepDb", mixStepDb); mixFadeMs = try integer("mixFadeMs", mixFadeMs)
        mixEnabled = try boolean("mixEnabled", mixEnabled)
        vjsterEnabled = try boolean("vjsterEnabled", vjsterEnabled)
        vjsterPort = try integer("vjsterPort", vjsterPort)
        vjsterExtensionId = try text("vjsterExtensionId").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if json["vjsterObsToken"] != nil {
            vjsterObsToken = try text("vjsterObsToken").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        }
        let rawTarget = try text("vjsterTarget", "both").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        vjsterTarget = rawTarget.isEmpty ? "both" : rawTarget
        layer1Scene = try text("layer1Scene"); layer1Source = try text("layer1Source")
        layer2Scene = try text("layer2Scene"); layer2Source = try text("layer2Source")
        opacityStep = try number("opacityStep", opacityStep)
        try validate()
    }
    func validate() throws {
        guard (1...65535).contains(port), anchors.count == 4 else { throw PanelFailure.message("Use a port from 1 to 65535 and four scene assignments.") }
        guard volumeStepDb.isFinite, volumeStepDb > 0, volumeStepDb <= 12, duckDb.isFinite, (-100...0).contains(duckDb),
              faderStep.isFinite, faderStep > 0, faderStep <= 1, (1...5000).contains(transitionStepMs),
              mixStepDb.isFinite, mixStepDb > 0, mixStepDb <= 12, (0...10000).contains(mixFadeMs) else {
            throw PanelFailure.message("Check the level, fade and timing settings. Steps must be positive; duck is −100 to 0 dB.")
        }
        guard (1024...65535).contains(vjsterPort), opacityStep.isFinite, (0.01...0.5).contains(opacityStep) else {
            throw PanelFailure.message("Use a VJster port from 1024 to 65535 and Layer 2 opacity step from 1% to 50%.")
        }
        if vjsterEnabled && vjsterPort == port {
            throw PanelFailure.message("OBS port and VJster port cannot both be \(port).")
        }
        guard vjsterExtensionId.isEmpty || vjsterExtensionId.range(of: "^[a-p]{32}$", options: .regularExpression) != nil else {
            throw PanelFailure.message("A pinned VJster extension ID must be 32 lowercase letters a–p.")
        }
        guard vjsterObsToken.isEmpty || vjsterObsToken.range(of: "^[0-9a-f]{32}$", options: .regularExpression) != nil else {
            throw PanelFailure.message("A VJster OBS page token must be 32 hex digits.")
        }
        guard ["browser", "obs", "both"].contains(vjsterTarget) else {
            throw PanelFailure.message("VJster target must be browser, obs, or both.")
        }
    }
    func encoded() throws -> Data {
        try validate()
        return try JSONSerialization.data(withJSONObject: ["host":"127.0.0.1", "port":port,
            "musicInput":musicInput, "contentInput":contentInput, "micInput":micInput, "mediaInput":mediaInput,
            "overlayScene":overlayScene, "overlaySource":overlaySource, "anchors":anchors,
            "volumeStepDb":volumeStepDb, "duckDb":duckDb, "faderStep":faderStep, "transitionStepMs":transitionStepMs,
            "mixEnabled":mixEnabled, "mixStepDb":mixStepDb, "mixFadeMs":mixFadeMs,
            "vjsterEnabled":vjsterEnabled, "vjsterPort":vjsterPort, "vjsterExtensionId":vjsterExtensionId,
            "vjsterObsToken":vjsterObsToken, "vjsterTarget":vjsterTarget,
            "layer1Scene":layer1Scene, "layer1Source":layer1Source, "layer2Scene":layer2Scene, "layer2Source":layer2Source,
            "opacityStep":opacityStep], options: [.prettyPrinted, .sortedKeys])
    }
}

struct Catalog {
    var scenes: [String] = [], audio: [String] = [], media: [String] = []
    var items: [String: [String]] = [:]
    var program = "", preview = "", studio = false
}

enum LocalFiles {
    static let support = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/FadesterTourBox", isDirectory: true)
    static let settings = support.appendingPathComponent("panel-config.json")
    static func password(port: Int, override: String) throws -> String {
        if !override.isEmpty { return override }
        let file = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/obs-studio/plugin_config/obs-websocket/config.json")
        guard let data = try? Data(contentsOf: file), let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              json["server_enabled"] as? Bool == true, json["auth_required"] as? Bool == true,
              json["server_port"] as? Int == port, let value = json["server_password"] as? String, !value.isEmpty else {
            throw PanelFailure.message("Enable authenticated OBS WebSocket on this port, or enter its password for this session.")
        }
        return value
    }
    static func save(_ settings: Settings, to url: URL = LocalFiles.settings) throws {
        let directory = url.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions:0o700])
        try settings.encoded().write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions:0o600], ofItemAtPath: url.path)
    }
}

enum Lamp: Equatable { case green, amber, red, grey }

struct LightState: Equatable {
    let lamp: Lamp
    let text: String
    let button: String?
    let action: String?
    init(_ lamp: Lamp, _ text: String, button: String? = nil, action: String? = nil) {
        self.lamp = lamp; self.text = text; self.button = button; self.action = action
    }
}

/// Pure header readiness state machine (mirrors Windows Readiness in tourbox/panel/ShowMe.cs).
enum Readiness {
    static func obs(connected: Bool, running: Bool, problem: String?, studioOff: Bool, controlsOn: Bool) -> LightState {
        if connected {
            return studioOff && !controlsOn
                ? LightState(.amber, "OBS: turn on Studio Mode", button: "How to fix", action: "studio")
                : LightState(.green, "OBS: connected")
        }
        if !running {
            return LightState(.red, "OBS: not running", button: "Open OBS", action: "openObs")
        }
        if problem == "obs-bad-password" {
            return LightState(.amber, "OBS: password not accepted", button: "How to fix", action: "password")
        }
        if problem == nil {
            return LightState(.grey, "OBS: connecting…")
        }
        return LightState(.amber, "OBS: one setting to turn on", button: "How to fix", action: "server")
    }

    static func tourBox(consoleRunning: Bool) -> LightState {
        consoleRunning
            ? LightState(.green, "TourBox: ready")
            : LightState(.amber, "TourBox Console: closed", button: "Open Console", action: "openConsole")
    }

    static func vjster(enabled: Bool, controlsOn: Bool, connectedPeers: Int) -> LightState {
        if !enabled { return LightState(.grey, "VJster: off") }
        if !controlsOn { return LightState(.grey, "VJster: ready") }
        return connectedPeers > 0
            ? LightState(.green, "VJster: connected")
            : LightState(.amber, "VJster: waiting for player")
    }

    static func controls(running: Bool, armed: Bool) -> LightState {
        if !running { return LightState(.grey, "Controls: off", button: "Start", action: "start") }
        if !armed { return LightState(.amber, "Controls: starting…", button: "Stop", action: "stop") }
        return LightState(.green, "Controls: on", button: "Stop", action: "stop")
    }

    static func reminder(controlsOn: Bool, obsHidden: Bool, consoleRunning: Bool, frontIsObs: Bool) -> String? {
        guard controlsOn else { return nil }
        if obsHidden { return "Keep the main OBS window open, not hidden: the T-bar needs it." }
        if consoleRunning && !frontIsObs { return "TourBox: bring OBS to the front. Its preset only works while OBS is the active window." }
        return nil
    }

    static func obsProblem(from text: String) -> String {
        let lower = text.lowercased()
        if lower.contains("obs-bad-password") || lower.contains("did not accept authentication") || lower.contains("did not accept the password") {
            return "obs-bad-password"
        }
        if lower.contains("obs-auth-off") || lower.contains("authentication enabled") {
            return "obs-auth-off"
        }
        if lower.contains("obs-no-password") || lower.contains("enable authenticated obs websocket") {
            return "obs-no-password"
        }
        return "obs-no-answer"
    }

    static func vjsterPeers(after line: String, current: Set<String>) -> Set<String> {
        var next = current
        if line == "VJster: extension connected" { next.insert("browser") }
        else if line == "VJster: OBS page connected" { next.insert("obs") }
        else if line.hasPrefix("VJster: extension disconnected") { next.remove("browser") }
        else if line.hasPrefix("VJster: OBS page disconnected") { next.remove("obs") }
        else if line == "VJster link stopped" { next.removeAll() }
        return next
    }
}

struct ControlMapRow: Equatable {
    let category: String
    let control: String
    let gesture: String
    let action: String

    static func categoryName(for id: String) -> String {
        switch id.split(separator: ".").first.map(String.init) ?? "" {
        case "mix", "music", "content", "mic", "soundcheck", "undo": return "audio"
        case "fader": return "fade"
        case "media", "vjster": return "media"
        case "overlay", "layer1", "layer2": return "overlay"
        case "capture", "recording", "replay": return "capture"
        case "transition", "take": return "transition"
        case "anchor", "preview": return "scenes"
        default: return "diagnostics"
        }
    }

    static func formatControl(_ raw: String) -> String {
        if raw == "Tour menu" { return "Tour menu" }
        return raw.split(separator: "+").map { token -> String in
            let part = String(token)
            switch part {
            case "press": return "Press"
            case "up": return "D-pad Up"
            case "right": return "D-pad Right"
            case "down": return "D-pad Down"
            case "left": return "D-pad Left"
            case "c1", "c2": return part.uppercased()
            default: return part.prefix(1).uppercased() + part.dropFirst()
            }
        }.joined(separator: " + ")
    }

    static func formatGesture(_ raw: String) -> String {
        switch raw {
        case "press": return "Press"
        case "select": return "Select"
        case "cw": return "Clockwise"
        case "ccw": return "Counterclockwise"
        default: return raw
        }
    }

    static func load(data: Data) throws -> [ControlMapRow] {
        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let presets = root["presets"] as? [String: Any] else {
            throw PanelFailure.message("Cannot read presets/map.json.")
        }
        var rows: [ControlMapRow] = []
        for key in presets.keys.sorted() {
            guard let bank = presets[key] as? [String: Any] else { continue }
            for section in ["bindings", "nativeBindings", "menuBindings"] {
                guard let items = bank[section] as? [[String: Any]] else { continue }
                for item in items {
                    let id = (item["action"] as? String) ?? (item["function"] as? String) ?? ""
                    let control = item["control"] as? String ?? ""
                    let gesture = item["gesture"] as? String ?? ""
                    let label = item["label"] as? String ?? id
                    rows.append(ControlMapRow(category: categoryName(for: id), control: formatControl(control), gesture: formatGesture(gesture), action: label))
                }
            }
        }
        return rows
    }
}

func redact(_ value: String, secrets: [String]) -> String {
    var clean = value
    for secret in secrets.filter({ !$0.isEmpty }).sorted(by: { $0.count > $1.count }) {
        clean = clean.replacingOccurrences(of: secret, with: "[redacted]")
    }
    return clean.replacingOccurrences(of: "\r", with: " ").replacingOccurrences(of: "\n", with: " ")
}
func redact(_ value: String, secret: String) -> String { redact(value, secrets: [secret]) }

enum ModelTests {
    static func run() throws {
        func check(_ okay: Bool, _ label: String) throws { if !okay { throw PanelFailure.message("Self-test: " + label) } }
        var settings = Settings(); settings.musicInput = "Bed • 音楽"; settings.anchors[1] = "Guest / Δ"
        settings.layer1Scene = "Guest"; settings.layer1Source = "Cam A"; settings.layer2Scene = "Guest"; settings.layer2Source = "Clip B"
        settings.vjsterTarget = "obs"; settings.opacityStep = 0.1
        let roundtrip = try Settings(data: settings.encoded())
        try check(roundtrip.musicInput == settings.musicInput && roundtrip.anchors == settings.anchors && roundtrip.layer2Source == "Clip B" && roundtrip.vjsterTarget == "obs" && roundtrip.opacityStep == 0.1, "Unicode, VJster and layer assignments survive JSON")
        try check(roundtrip.vjsterObsToken.count == 32, "OBS page token is generated and roundtripped")
        try check(try settings.obsBrowserUrl(videoInput: "https://youtu.be/dQw4w9WgXcQ") == "http://127.0.0.1:48150/obs?v=dQw4w9WgXcQ#token=\(settings.vjsterObsToken)", "OBS Browser Source URL extraction")
        try check(Settings.videoId(from: "https://www.youtube.com/embed/videoseries?list=PL123") == nil, "playlist path is not a video id")
        try check(!String(data: try settings.encoded(), encoding: .utf8)!.contains("password"), "password is not a saved setting")
        for bad in ["{\"port\":0}", "{\"port\":true}", "{\"host\":\"example.com\"}", "{\"host\":true}", "{\"host\":null}", "{\"anchors\":[\"one\"]}", "{\"mixEnabled\":1}", "{\"faderStep\":0}", "{\"port\":48150,\"vjsterPort\":48150}", "{\"vjsterExtensionId\":\"bad\"}", "{\"vjsterObsToken\":\"zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz\"}", "{\"vjsterTarget\":\"tv\"}", "{\"opacityStep\":0.9}"] {
            do { _ = try Settings(data: Data(bad.utf8)); throw PanelFailure.message("accepted invalid settings") }
            catch PanelFailure.message(let text) { try check(text != "accepted invalid settings", "invalid settings rejected") }
        }
        let disabledClash = try Settings(data: Data("{\"port\":48150,\"vjsterPort\":48150,\"vjsterEnabled\":false}".utf8))
        try check(!disabledClash.vjsterEnabled && disabledClash.port == 48150, "clashing port allowed when VJster is disabled")
        settings.volumeStepDb = .nan
        do { _ = try settings.encoded(); throw PanelFailure.message("accepted nonfinite step") }
        catch PanelFailure.message(let text) { try check(text != "accepted nonfinite step", "nonfinite step rejected") }
        try check(redact("ERROR test-secret\nagain", secret: "test-secret") == "ERROR [redacted] again", "secret redaction")
        try check(redact("pw 1 tok 0123456789abcdef0123456789abcdef", secrets: ["1", "0123456789abcdef0123456789abcdef"]) == "pw [redacted] tok [redacted]", "longest-first multi-secret redaction")
        try check(Readiness.obs(connected: true, running: true, problem: nil, studioOff: false, controlsOn: false) == LightState(.green, "OBS: connected"), "OBS connected light")
        try check(Readiness.obs(connected: true, running: true, problem: nil, studioOff: true, controlsOn: false).action == "studio", "OBS Studio Mode light")
        try check(Readiness.obs(connected: false, running: false, problem: nil, studioOff: false, controlsOn: false) == LightState(.red, "OBS: not running", button: "Open OBS", action: "openObs"), "OBS closed light")
        try check(Readiness.obs(connected: false, running: true, problem: "obs-bad-password", studioOff: false, controlsOn: false).action == "password", "OBS bad password light")
        try check(Readiness.obs(connected: false, running: true, problem: nil, studioOff: false, controlsOn: false) == LightState(.grey, "OBS: connecting…"), "OBS connecting light")
        try check(Readiness.tourBox(consoleRunning: true) == LightState(.green, "TourBox: ready") && Readiness.tourBox(consoleRunning: false).action == "openConsole", "TourBox Console light")
        try check(Readiness.vjster(enabled: true, controlsOn: true, connectedPeers: 1) == LightState(.green, "VJster: connected") && Readiness.vjster(enabled: true, controlsOn: true, connectedPeers: 0).lamp == .amber, "VJster readiness light")
        try check(Readiness.controls(running: false, armed: false).action == "start" && Readiness.controls(running: true, armed: true) == LightState(.green, "Controls: on", button: "Stop", action: "stop"), "Controls readiness light")
        try check(Readiness.reminder(controlsOn: true, obsHidden: false, consoleRunning: true, frontIsObs: false) != nil && Readiness.reminder(controlsOn: true, obsHidden: false, consoleRunning: true, frontIsObs: true) == nil, "Frontmost OBS reminder")
        var peers = Readiness.vjsterPeers(after: "VJster: extension connected", current: [])
        peers = Readiness.vjsterPeers(after: "VJster: OBS page connected", current: peers)
        try check(peers.count == 2 && Readiness.vjsterPeers(after: "VJster: extension disconnected (closed)", current: peers) == ["obs"], "VJster peer tracking")
        let sampleMap = Data("{\"presets\":{\"master\":{\"bindings\":[{\"control\":\"side+knob\",\"gesture\":\"cw\",\"action\":\"vjster.speed.up\",\"label\":\"Video speed up\"}]}}}".utf8)
        let mapRows = try ControlMapRow.load(data: sampleMap)
        try check(mapRows == [ControlMapRow(category: "media", control: "Side + Knob", gesture: "Clockwise", action: "Video speed up")], "Control map formatting")
        print("PASS: panel settings, readiness lights, control map formatting, Unicode/layer/VJster assignments, strict ranges, secret-free serialization and log redaction. No files, OBS, shortcuts or GUI used.")
    }
}

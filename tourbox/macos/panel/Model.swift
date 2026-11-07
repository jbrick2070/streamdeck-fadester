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
        port = try integer("port", port)
        musicInput = try text("musicInput"); contentInput = try text("contentInput"); micInput = try text("micInput"); mediaInput = try text("mediaInput")
        overlayScene = try text("overlayScene"); overlaySource = try text("overlaySource")
        if let raw = json["anchors"] {
            guard let list = raw as? [String], list.count == 4 else { throw PanelFailure.message("Settings need four D-pad assignments.") }; anchors = list
        }
        volumeStepDb = try number("volumeStepDb", volumeStepDb); duckDb = try number("duckDb", duckDb); faderStep = try number("faderStep", faderStep)
        transitionStepMs = try integer("transitionStepMs", transitionStepMs); mixStepDb = try number("mixStepDb", mixStepDb); mixFadeMs = try integer("mixFadeMs", mixFadeMs)
        if let raw = json["mixEnabled"] {
            guard let value = raw as? NSNumber, CFGetTypeID(value) == CFBooleanGetTypeID() else { throw PanelFailure.message("Invalid whole-mix setting.") }; mixEnabled = value.boolValue
        }
        try validate()
    }
    func validate() throws {
        guard (1...65535).contains(port), anchors.count == 4 else { throw PanelFailure.message("Use a port from 1 to 65535 and four scene assignments.") }
        guard volumeStepDb.isFinite, volumeStepDb > 0, volumeStepDb <= 12, duckDb.isFinite, (-100...0).contains(duckDb),
              faderStep.isFinite, faderStep > 0, faderStep <= 1, (1...5000).contains(transitionStepMs),
              mixStepDb.isFinite, mixStepDb > 0, mixStepDb <= 12, (0...10000).contains(mixFadeMs) else {
            throw PanelFailure.message("Check the level, fade and timing settings. Steps must be positive; duck is −100 to 0 dB.")
        }
    }
    func encoded() throws -> Data {
        try validate()
        return try JSONSerialization.data(withJSONObject: ["host":"127.0.0.1", "port":port,
            "musicInput":musicInput, "contentInput":contentInput, "micInput":micInput, "mediaInput":mediaInput,
            "overlayScene":overlayScene, "overlaySource":overlaySource, "anchors":anchors,
            "volumeStepDb":volumeStepDb, "duckDb":duckDb, "faderStep":faderStep, "transitionStepMs":transitionStepMs,
            "mixEnabled":mixEnabled, "mixStepDb":mixStepDb, "mixFadeMs":mixFadeMs], options: [.prettyPrinted, .sortedKeys])
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

func redact(_ value: String, secret: String) -> String {
    let clean = secret.isEmpty ? value : value.replacingOccurrences(of: secret, with: "[redacted]")
    return clean.replacingOccurrences(of: "\r", with: " ").replacingOccurrences(of: "\n", with: " ")
}

enum ModelTests {
    static func run() throws {
        func check(_ okay: Bool, _ label: String) throws { if !okay { throw PanelFailure.message("Self-test: " + label) } }
        var settings = Settings(); settings.musicInput = "Bed • 音楽"; settings.anchors[1] = "Guest / Δ"
        let roundtrip = try Settings(data: settings.encoded())
        try check(roundtrip.musicInput == settings.musicInput && roundtrip.anchors == settings.anchors, "Unicode assignments survive JSON")
        try check(!String(data: try settings.encoded(), encoding: .utf8)!.contains("password"), "password is not a saved setting")
        for bad in ["{\"port\":0}", "{\"port\":true}", "{\"host\":\"example.com\"}", "{\"host\":true}", "{\"host\":null}", "{\"anchors\":[\"one\"]}", "{\"mixEnabled\":1}", "{\"faderStep\":0}"] {
            do { _ = try Settings(data: Data(bad.utf8)); throw PanelFailure.message("accepted invalid settings") }
            catch PanelFailure.message(let text) { try check(text != "accepted invalid settings", "invalid settings rejected") }
        }
        settings.volumeStepDb = .nan
        do { _ = try settings.encoded(); throw PanelFailure.message("accepted nonfinite step") }
        catch PanelFailure.message(let text) { try check(text != "accepted nonfinite step", "nonfinite step rejected") }
        try check(redact("ERROR test-secret\nagain", secret: "test-secret") == "ERROR [redacted] again", "secret redaction")
        print("PASS: panel settings, Unicode assignments, strict ranges, secret-free serialization and log redaction. No files, OBS, shortcuts or GUI used.")
    }
}

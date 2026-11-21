// SPDX-License-Identifier: GPL-2.0-or-later
import Foundation
import CoreFoundation
import CryptoKit

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
    // Stream Deck, OpenDeck and MIDI only: the host runs --mix-only (the Windows panel's "mixOnly").
    var mixOnly = false
    var vjsterEnabled = true, vjsterPort = 48150
    var vjsterExtensionId = "", vjsterObsToken = Settings.newObsToken(), vjsterTarget = "both"
    var layer1Scene = "", layer1Source = "", layer2Scene = "", layer2Source = ""
    var opacityStep = 0.05
    /// The OBS port fills itself in from OBS's own settings file (as the password does) until another one is typed.
    /// True for a first run; a settings file saved before this existed keeps the port it has.
    var portAuto = true
    /// Whether two settings agree on everything the host sets up at start, so a Save while it runs applies by reload alone.
    static func sameAtStart(_ a: Settings, _ b: Settings) -> Bool {
        a.port == b.port && a.faderStep == b.faderStep && a.mixEnabled == b.mixEnabled && a.mixOnly == b.mixOnly &&
        a.vjsterEnabled == b.vjsterEnabled && a.vjsterPort == b.vjsterPort && a.vjsterExtensionId == b.vjsterExtensionId &&
        a.vjsterObsToken == b.vjsterObsToken && a.vjsterTarget == b.vjsterTarget
    }

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
        if let host = json["host"], host as? String != "127.0.0.1" { throw PanelFailure.message("Fadester Companion connects only to OBS on this Mac.") }
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
        portAuto = try boolean("portAuto", false)
        musicInput = try text("musicInput"); contentInput = try text("contentInput"); micInput = try text("micInput"); mediaInput = try text("mediaInput")
        overlayScene = try text("overlayScene"); overlaySource = try text("overlaySource")
        if let raw = json["anchors"] {
            guard let list = raw as? [String], list.count == 4 else { throw PanelFailure.message("Settings need four D-pad assignments.") }; anchors = list
        }
        volumeStepDb = try number("volumeStepDb", volumeStepDb); duckDb = try number("duckDb", duckDb); faderStep = try number("faderStep", faderStep)
        transitionStepMs = try integer("transitionStepMs", transitionStepMs); mixStepDb = try number("mixStepDb", mixStepDb); mixFadeMs = try integer("mixFadeMs", mixFadeMs)
        mixEnabled = try boolean("mixEnabled", mixEnabled)
        mixOnly = try boolean("mixOnly", mixOnly)
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
        return try JSONSerialization.data(withJSONObject: ["host":"127.0.0.1", "port":port, "portAuto":portAuto,
            "musicInput":musicInput, "contentInput":contentInput, "micInput":micInput, "mediaInput":mediaInput,
            "overlayScene":overlayScene, "overlaySource":overlaySource, "anchors":anchors,
            "volumeStepDb":volumeStepDb, "duckDb":duckDb, "faderStep":faderStep, "transitionStepMs":transitionStepMs,
            "mixEnabled":mixEnabled, "mixOnly":mixOnly && mixEnabled, "mixStepDb":mixStepDb, "mixFadeMs":mixFadeMs,
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
    /// The Visual Sidechain meter as a VS-METER line ("" when the scan could not tell), as the Windows catalog's "visualSidechain".
    var visualSidechain = ""
}

enum PresetSyncState: Equatable { case neverSaved, current, updateAvailable }

enum LocalFiles {
    static let support = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/FadesterTourBox", isDirectory: true)
    static let settings = support.appendingPathComponent("panel-config.json")
    static let presetStamp = support.appendingPathComponent("saved-preset.sha256")
    /// The name TourBox Console's file window shows for the preset.
    static let presetFileName = "OBS Fadester for TourBox.tb"
    /// The file name every text and drawing shows for the preset: the one it was written under this time, which is
    /// "OBS Fadester for TourBox 2.tb" when an older, different copy was already there; the preset's own name before a save.
    static func shownPresetName(saved: URL?) -> String {
        let name = saved?.lastPathComponent ?? ""
        return name.isEmpty ? presetFileName : name
    }
    /// Puts the preset into a folder and returns where it is, without ever replacing a different file (QA-C01): a file
    /// of that name with the same bytes is used as it is; when its bytes differ (the user's own export, an older
    /// preset kept on purpose) the preset is written beside it as "OBS Fadester for TourBox 2.tb", then 3, as Finder
    /// numbers a copy.
    static func savePreset(_ bytes: Data, in folder: URL) throws -> URL {
        let stem = (presetFileName as NSString).deletingPathExtension
        let ending = (presetFileName as NSString).pathExtension
        for number in 1...99 {
            let name = number == 1 ? presetFileName : stem + " " + String(number) + "." + ending
            let url = folder.appendingPathComponent(name)
            if FileManager.default.fileExists(atPath: url.path) {
                if let existing = try? Data(contentsOf: url), existing == bytes { return url }
                continue
            }
            // Fails, rather than replaces, should a file of this name appear between the look and the write: the next
            // number is tried then. Any other failure (no such folder, no permission) is the caller's to handle.
            do {
                try bytes.write(to: url, options: .withoutOverwriting)
                return url
            } catch {
                if FileManager.default.fileExists(atPath: url.path) { continue }
                throw error
            }
        }
        throw PanelFailure.message("Too many copies of " + presetFileName + " in " + folder.lastPathComponent + ".")
    }
    /// Offline check of savePreset in a folder of its own under the temporary folder.
    static func presetSaveSelfTest() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("fadester-preset-test-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        // No file there: written under its own name.
        let first = try savePreset(Data("one".utf8), in: folder)
        guard first.lastPathComponent == presetFileName, try Data(contentsOf: first) == Data("one".utf8) else {
            throw PanelFailure.message("Self-test: the preset is saved under its own name")
        }
        // The same bytes are there: that file is used, nothing is written.
        let stamp = try FileManager.default.attributesOfItem(atPath: first.path)[.modificationDate] as? Date
        let again = try savePreset(Data("one".utf8), in: folder)
        guard again == first, try FileManager.default.contentsOfDirectory(atPath: folder.path) == [presetFileName],
              try FileManager.default.attributesOfItem(atPath: first.path)[.modificationDate] as? Date == stamp else {
            throw PanelFailure.message("Self-test: a preset that is already there with the same bytes is reused")
        }
        // A different file of that name: it stays as it is, and the preset goes beside it under the next number.
        let second = try savePreset(Data("two".utf8), in: folder)
        let third = try savePreset(Data("three".utf8), in: folder)
        let secondAgain = try savePreset(Data("two".utf8), in: folder)
        guard second.lastPathComponent == "OBS Fadester for TourBox 2.tb", third.lastPathComponent == "OBS Fadester for TourBox 3.tb", secondAgain == second,
              try Data(contentsOf: first) == Data("one".utf8), try Data(contentsOf: second) == Data("two".utf8), try Data(contentsOf: third) == Data("three".utf8),
              try FileManager.default.contentsOfDirectory(atPath: folder.path).count == 3 else {
            throw PanelFailure.message("Self-test: a different file of the preset's name is never replaced; the preset is written beside it")
        }
        // What the user reads names the file that was written this time, never the older one beside it (QA-R201).
        let stepsText = Readiness.importSteps(saved: second)
        let whyText = L("macImportWhySaved", folder.lastPathComponent, shownPresetName(saved: second))
        guard shownPresetName(saved: second) == "OBS Fadester for TourBox 2.tb", shownPresetName(saved: nil) == presetFileName,
              stepsText.contains("open OBS Fadester for TourBox 2.tb"), stepsText.contains(folder.lastPathComponent),
              whyText.contains("Saved OBS Fadester for TourBox 2.tb in"), !stepsText.contains("TourBox.tb"), !whyText.contains("TourBox.tb"),
              Readiness.importSteps(saved: nil).contains("open " + presetFileName), Readiness.importSteps(saved: nil).contains(L("macDownloads")) else {
            throw PanelFailure.message("Self-test: the import steps and the guide name the file that was written, also when it is a numbered copy")
        }
        do {
            _ = try savePreset(Data("x".utf8), in: folder.appendingPathComponent("missing"))
            throw PanelFailure.message("Self-test: a folder that cannot be written must fail, so the save dialog can take over")
        } catch PanelFailure.message(let text) { throw PanelFailure.message(text) } catch { }
    }
    static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
    static func presetSyncState(bundledHash: String, savedHash: String?) -> PresetSyncState {
        guard let saved = savedHash?.trimmingCharacters(in: .whitespacesAndNewlines), !saved.isEmpty else { return .neverSaved }
        return saved == bundledHash ? .current : .updateAvailable
    }
    static func recordPresetSaved(bundledHash: String) throws {
        try FileManager.default.createDirectory(at: support, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try Data((bundledHash + "\n").utf8).write(to: presetStamp, options: .atomic)
    }
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
    /// OBS's own WebSocket port, from the settings file OBS keeps on this Mac (the one its password is read from); nil when unknown.
    static func obsPort() -> Int? {
        let file = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/obs-studio/plugin_config/obs-websocket/config.json")
        return obsPort(from: try? Data(contentsOf: file))
    }
    static func obsPort(from data: Data?) -> Int? {
        guard let data = data, let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let number = json["server_port"] as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        let value = number.doubleValue
        guard value.isFinite, value.rounded() == value, (1...65535).contains(value) else { return nil }
        return Int(value)
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
        // Studio Mode off: the light's own button turns it on (it asks OBS, nothing else changes). Shown with the controls
        // on too: they start by themselves now, and Preview and the T-bar do nothing until Studio Mode is on.
        if connected {
            return studioOff
                ? LightState(.amber, L("liObsStudio"), button: L("btnTurnOn"), action: "studioOn")
                : LightState(.green, L("liObsOn"))
        }
        if !running {
            return LightState(.red, L("liObsClosed"), button: L("macBtnOpenObs"), action: "openObs")
        }
        if problem == "obs-bad-password" {
            return LightState(.amber, L("liObsPassword"), button: L("btnShowMe"), action: "password")
        }
        if problem == nil {
            return LightState(.grey, L("liObsLooking"))
        }
        return LightState(.amber, L("liObsSetting"), button: L("btnShowMe"), action: "server")
    }

    /// The Windows panel's Readiness.TourBox has the same states (and greys a closed Console while a game controller is in use).
    static func tourBox(consoleRunning: Bool, consoleInstalled: Bool = true, mixOnly: Bool = false, oldPreset: Bool = false, noPreset: Bool = false) -> LightState {
        if mixOnly { return LightState(.grey, L("liTbOff")) }
        // An older Fadester preset in Console: some controls do other things than the panel's map says (FIX-9).
        if consoleRunning && oldPreset { return LightState(.amber, L("liTbOld"), button: L("btnImportNew"), action: "importPreset") }
        // Console runs but holds no OBS Fadester preset (read from Console's own files, PresetAge): the TourBox does nothing
        // for OBS yet, so the light is not green. Unknown (files unreadable, a new Console format) stays "ready".
        if consoleRunning && noPreset { return LightState(.amber, L("liTbNone"), button: L("btnImport"), action: "importPreset") }
        if consoleRunning { return LightState(.green, L("liTbReady")) }
        if !consoleInstalled { return LightState(.amber, L("liTbMissing"), button: L("btnDownload"), action: "downloadConsole") }
        return LightState(.amber, L("liTbClosed"), button: L("btnOpenConsole"), action: "openConsole")
    }

    /// An optional section's state in a few words, beside its title, so a closed section still says what it does (U3-05).
    static func mixSummary(on: Bool, only: Bool) -> String { L(!on ? "off" : only ? "sumMixOnly" : "on") }
    static func vjsterSummary(on: Bool, target: String, port: Int) -> String { on ? L("sumVjster", target, String(port)) : L("off") }
    /// Whether the OBS port and password are worth showing: OBS runs here and refuses the sign-in or does not answer.
    static func needsObsFields(connected: Bool, running: Bool, problem: String?) -> Bool { !connected && running && problem != nil }
    /// The Setup page's three import steps, naming the folder and the file the preset was written to; before a save,
    /// Downloads and the preset's own name.
    static func importSteps(saved: URL?) -> String {
        let folder = saved?.deletingLastPathComponent().lastPathComponent ?? ""
        return L("macImportSteps", folder.isEmpty || folder == "/" ? L("macDownloads") : folder, LocalFiles.shownPresetName(saved: saved))
    }
    /// A light needs a closed part of the Setup page: it opens once per problem, so a part the user closed again stays closed.
    static func opensFold(needed: Bool, called: Bool, open: Bool) -> Bool { needed && !called && !open }
    /// The parts to open again at the next start: the ones the user opened, never one a light opened (QA-C04).
    static func foldsToRemember(_ folds: [(id: String, byUser: Bool)]) -> [String] { folds.filter { $0.byUser }.map { $0.id } }

    /// usedBefore: a video has been connected on this Mac at some time. VJster is on by default, so until then a missing
    /// video is not a fault (grey, with the same button), and a busy port is amber, not red. As on Windows.
    static func vjster(enabled: Bool, controlsOn: Bool, connectedPeers: Int, portBusy: Bool = false, mixOnly: Bool = false, usedBefore: Bool = true, onDeck: Bool = false) -> LightState {
        if !enabled || mixOnly { return LightState(.grey, L("liVjOff")) }
        // The suite's own Stream Deck or OpenDeck plugin holds the port: the deck has the video. No fault, so no red.
        if portBusy && onDeck { return LightState(.grey, L("liVjDeck"), button: L("btnShowMe"), action: "vjsterPort") }
        if portBusy { return LightState(usedBefore ? .red : .amber, L("liVjPort"), button: L("btnShowMe"), action: "vjsterPort") }
        if !controlsOn { return LightState(usedBefore ? .green : .grey, L("liVjReady")) }
        return connectedPeers > 0
            ? LightState(.green, L("liVjOn"))
            : LightState(usedBefore ? .amber : .grey, L("liVjWait"), button: L("btnShowMe"), action: "vjsterWait")
    }

    /// The host's own sentence when Preview or the T-bar is used with Studio Mode off (StudioFader.ReadScenesAsync).
    static func saysStudioOff(_ line: String) -> Bool { line.contains("Enable Studio Mode in OBS before using Preview or the T-bar.") }

    /// As on Windows (ShowMe.cs Readiness.Controls): with the controls off and OBS not connected the button is Try again,
    /// which reads OBS and then starts them. With VJster on, the host stays armed without OBS for Chrome's videos (FIX-8):
    /// amber "on, waiting for OBS", as on Windows.
    static func controls(running: Bool, armed: Bool, axTrusted: Bool = true, obsConnected: Bool = true) -> LightState {
        if !running {
            if !axTrusted { return LightState(.amber, L("macLiAxNeeded"), button: L("macBtnGrant"), action: "grantAx") }
            return obsConnected
                ? LightState(.grey, L("liCtlOff"), button: L("btnStart"), action: "start")
                : LightState(.grey, L("liCtlOff"), button: L("btnTryAgain"), action: "tryAgain")
        }
        if !armed { return LightState(.amber, L("macLiCtlStarting"), button: L("macBtnStop"), action: "stop") }
        if !obsConnected { return LightState(.amber, L("liCtlWaiting"), button: L("macBtnStop"), action: "stop") }
        return LightState(.green, L("liCtlOn"), button: L("macBtnStop"), action: "stop")
    }

    /// Whether the controls start by themselves at launch (FIX-5 and FIX-8, hand test 2026-11-17), as on Windows
    /// (ShowMe.cs Readiness.AutoStart). OBS need not be open while VJster is on: the host serves Chrome's videos without
    /// it and connects to OBS when it appears. Without VJster, or in mix-only mode, there is nothing to do before OBS
    /// answers, so those still wait for it. One Mac rule: never when Accessibility is still needed, so no system prompt
    /// appears at launch: a first run starts as soon as Accessibility is granted. On a first run too (the owner's decision,
    /// 2026-11-20), and never after the user pressed Stop ("off"). settingsSaved is no longer part of the rule; it is kept
    /// for the callers.
    static func autoStart(settingsSaved: Bool, settingsValid: Bool, remembered: String?, obsConnected: Bool, controlsOn: Bool, axReady: Bool,
                          vjsterOn: Bool = false, mixOnly: Bool = false) -> Bool {
        settingsValid && remembered != "off" && !controlsOn && axReady && (obsConnected || (vjsterOn && !mixOnly))
    }

    /// Like the Windows panel's Readiness.Reminder: nothing in Stream Deck-only mode, which needs neither the T-bar nor the
    /// TourBox preset; nothing while Chrome is in front (VJster's turn) or OBS is closed (nothing to bring forward), FIX-8.
    static func reminder(controlsOn: Bool, obsHidden: Bool, consoleRunning: Bool, frontIsObs: Bool, mixOnly: Bool = false,
                         frontIsChrome: Bool = false, obsRunning: Bool = true, autoSwitch: Bool? = nil, activeFadester: Bool? = nil) -> String? {
        guard controlsOn && !mixOnly else { return nil }
        // Auto Switch off (TourBox Console's customConfig): the selected preset serves every app in front, so OBS need not be
        // in front; but another selected preset makes every TourBox control do something else (hand test 2026-11-17).
        if consoleRunning && autoSwitch == false && activeFadester == false { return L("remindSelectPreset") }
        guard obsRunning else { return nil }
        if obsHidden { return L("macRemindObsHidden") }
        // Auto Switch unknown (Console's settings unreadable or in a new format): no strip rather than a wrong one.
        if consoleRunning && autoSwitch == true && !frontIsObs && !frontIsChrome { return L("remindObsFront") }
        return nil
    }

    static func banner(controlsOn: Bool, obsHidden: Bool, consoleRunning: Bool, frontIsObs: Bool, axTrusted: Bool = true, mixOnly: Bool = false,
                       frontIsChrome: Bool = false, obsRunning: Bool = true, autoSwitch: Bool? = nil, activeFadester: Bool? = nil) -> (text: String, button: String, action: String)? {
        if !controlsOn && !axTrusted {
            return (L("macAxBanner"), L("macBtnGrantAx"), "grantAx")
        }
        if let obsText = reminder(controlsOn: controlsOn, obsHidden: obsHidden, consoleRunning: consoleRunning, frontIsObs: frontIsObs, mixOnly: mixOnly,
                                  frontIsChrome: frontIsChrome, obsRunning: obsRunning, autoSwitch: autoSwitch, activeFadester: activeFadester) {
            if obsText == L("remindSelectPreset") { return (obsText, L("btnOpenConsole"), "openConsole") }
            return (obsText, L("btnBringObs"), "openObs")
        }
        return nil
    }

    /// A VS-METER line from the host (or a scan) as the meter line, in the panel's language; nil for any other line.
    /// The same words and bars as the Windows panel's FormatVsMeter.
    static func vsMeter(_ line: String) -> String? {
        guard line.hasPrefix("VS-METER: ") else { return nil }
        let body = line.dropFirst(10).trimmingCharacters(in: .whitespaces)
        switch body {
        case "not_loaded": return L("vsNotLoaded")
        case "panic": return L("vsPanic")
        case "no_audio": return L("vsNoAudio")
        default: break
        }
        let parts = body.split(separator: " ").map(String.init)
        guard parts.count >= 8, parts[0] == "active" else { return "" }
        let numbers = parts[1...7].compactMap { Int($0) }
        guard numbers.count == 7 else { return "" }
        let blocks = Array("▁▂▃▄▅▆▇█")
        let bars = numbers[3...6].map { String(blocks[max(0, min(7, ($0 * 7 + 50) / 100))]) }.joined()
        return L(numbers[1] != 0 ? "vsMeterLocked" : "vsMeterActive", numbers[0], numbers[2], bars)
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
        if line == "VJster: the Chrome extension connected" || line == "VJster: extension connected" {
            next.insert("browser")
        } else if line == "VJster: the OBS video page connected" || line == "VJster: OBS page connected" {
            next.insert("obs")
        } else if line.hasPrefix("VJster: the Chrome extension disconnected") || line.hasPrefix("VJster: extension disconnected") {
            next.remove("browser")
        } else if line.hasPrefix("VJster: the OBS video page disconnected") || line.hasPrefix("VJster: OBS page disconnected") {
            next.remove("obs")
        } else if line == "VJster link stopped" {
            next.removeAll()
        }
        return next
    }

    /// How a line starts that names a layer the host picked by itself (PanelLine.PickedMarker in the host).
    static let pickedMarker = "LAYER-PICKED "

    /// The layer the host picked by itself (DeskActions.FillLayers), from the one line it writes for that: the marker at
    /// the very start, then one JSON object (layer 1 or 2, scene, source). Empty for every other line. Activity text also
    /// carries video titles and other text from outside, so the sentence people read ("Layer 1 = scene › source (picked
    /// automatically…") is never searched: the host lets no free text start a line with the marker (PanelLine.Free).
    static func pickedLayers(_ line: String) -> [(layer: Int, scene: String, source: String)] {
        guard line.hasPrefix(pickedMarker),
              let object = try? JSONSerialization.jsonObject(with: Data(line.dropFirst(pickedMarker.count).utf8)),
              let fields = object as? [String: Any], fields.count == 3,
              let number = fields["layer"] as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
              let scene = fields["scene"] as? String, let source = fields["source"] as? String else { return [] }
        let layer = number.doubleValue
        guard layer == 1 || layer == 2,
              !scene.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return [] }
        return [(Int(layer), scene, source)]
    }

    static func hostFeedback(from line: String) -> String? {
        if line.hasPrefix("RESULT ") {
            guard let sep = line.range(of: ": ") else { return nil }
            let action = String(line[line.index(line.startIndex, offsetBy: 7)..<sep.lowerBound])
            let summary = String(line[sep.upperBound...]).trimmingCharacters(in: .whitespaces)
            guard !summary.isEmpty else { return nil }
            // P0 formats by the host's culture: "0%", or "0 %" with a (narrow) no-break space.
            if summary.range(of: #"· T-bar 0[\s\x{00A0}\x{202F}]?%$"#, options: .regularExpression) != nil {
                if action == "fader.back" || action == "fader.fineBack" {
                    return L("macTbarCw")
                }
            }
            return summary
        }
        if line.hasPrefix("REFUSED ") {
            guard let sep = line.range(of: ": ") else { return nil }
            let reason = String(line[sep.upperBound...]).trimmingCharacters(in: .whitespaces)
            if reason.localizedCaseInsensitiveContains("Choose a different Preview scene first") || reason.localizedCaseInsensitiveContains("Preview is the same scene as Program") {
                return L("macPreviewMatches")
            }
            if reason.localizedCaseInsensitiveContains("cancel/reset the fader") || reason.localizedCaseInsensitiveContains("stuck part-way, press Cancel") {
                return L("macTbarPaused")
            }
            return reason.isEmpty ? nil : reason
        }
        // A VJster line: "Video 1x · …", or since FIX-6 "<title> · [site · ]Video 1x · …" (bridge/VjsterDesk.cs Describe).
        if line.hasPrefix("Video ") || line.contains(" · Video ") {
            return line
        }
        return nil
    }

    /// The VJster port is held by the suite's own Stream Deck or OpenDeck plugin (the host asked it; VjsterDesk.PortInUseLine).
    static func vjsterOnDeck(after line: String, current: Bool) -> Bool {
        if line.hasPrefix("VJster port ") { return line.contains(" is held by the VJster actions of ") }
        if line.hasPrefix("The VJster port could not be opened") || line.hasPrefix("VJster link listening on ") || line == "VJster link stopped" { return false }
        return current
    }

    static func vjsterPortBusy(after line: String, current: Bool) -> Bool {
        if (line.hasPrefix("VJster port ") && (line.contains(" is in use") || line.contains(" is held by "))) || line.hasPrefix("The VJster port could not be opened") {
            return true
        }
        if line.hasPrefix("VJster link listening on ") || line == "VJster link stopped" {
            return false
        }
        return current
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
        if raw == "Tour menu" { return L("menu") }
        return raw.split(separator: "+").map { token -> String in
            let part = String(token)
            switch part {
            case "press", "up", "right", "down", "left": return L(part)
            case "c1", "c2": return part.uppercased()
            default: return part.prefix(1).uppercased() + part.dropFirst()
            }
        }.joined(separator: " + ")
    }

    static func formatGesture(_ raw: String) -> String {
        switch raw {
        case "press", "select", "cw", "ccw": return L(raw)
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
        try check(Readiness.mixSummary(on: false, only: false) == "Off" && Readiness.mixSummary(on: true, only: false) == "On" && Readiness.mixSummary(on: true, only: true) == "On, Stream Deck only" &&
                  Readiness.vjsterSummary(on: true, target: "Chrome & OBS page", port: 48150) == "On, Chrome & OBS page, port 48150" && Readiness.vjsterSummary(on: false, target: "x", port: 1) == "Off", "optional sections say their state in one line")
        try check(Readiness.needsObsFields(connected: false, running: true, problem: "obs-bad-password") && !Readiness.needsObsFields(connected: true, running: true, problem: nil) &&
                  !Readiness.needsObsFields(connected: false, running: false, problem: "obs-no-answer") && !Readiness.needsObsFields(connected: false, running: true, problem: nil), "the OBS port and password show when OBS refuses or does not answer")
        try check(Readiness.opensFold(needed: true, called: false, open: false) && !Readiness.opensFold(needed: true, called: true, open: false) &&
                  !Readiness.opensFold(needed: true, called: false, open: true) && !Readiness.opensFold(needed: false, called: false, open: false), "a light opens a closed part once per problem")
        try check(Readiness.foldsToRemember([("obs", false), ("mix", true), ("vjster", false)]) == ["mix"], "only the parts the user opened are remembered")
        try check(Readiness.obs(connected: true, running: true, problem: nil, studioOff: true, controlsOn: false) == LightState(.amber, "OBS: turn on Studio Mode", button: "Turn on", action: "studioOn") &&
                  Readiness.obs(connected: true, running: true, problem: nil, studioOff: true, controlsOn: true).action == "studioOn", "OBS Studio Mode light")
        try check(HostController.tbarReason("T-BAR: Accessibility denied; grant the responsible app The other controls work; the T-bar is looked at again when the Dial is turned.") == L("macTbarAx") &&
                  HostController.tbarReason("OFFLINE: OBS's native T-bar is not parked at zero; move it back to its start in OBS.") == L("macTbarZero") &&
                  HostController.tbarReason("T-BAR: OBS's T-bar can be read again; the Dial works.") == nil &&
                  HostController.tbarReason("RESULT music.up: Music up") == nil, "A waiting T-bar says why in the panel's words")
        try check(Readiness.saysStudioOff("REFUSED preview.next: Enable Studio Mode in OBS before using Preview or the T-bar.") && !Readiness.saysStudioOff("RESULT music.up: Music up"), "Studio Mode line")
        try check(LocalFiles.obsPort(from: Data("{\"server_port\":4466,\"server_password\":\"x\"}".utf8)) == 4466 && LocalFiles.obsPort(from: Data("{\"server_port\":0}".utf8)) == nil &&
                  LocalFiles.obsPort(from: Data("{\"server_port\":true}".utf8)) == nil && LocalFiles.obsPort(from: Data("{ half".utf8)) == nil && LocalFiles.obsPort(from: nil) == nil, "OBS's own port")
        let savedBefore = try Settings(data: Data("{\"port\":4455}".utf8)), firstRun = try Settings(data: Settings().encoded())
        try check(Settings().portAuto && !savedBefore.portAuto && firstRun.portAuto, "The port follows OBS on a first run only")
        try check(Readiness.obs(connected: false, running: false, problem: nil, studioOff: false, controlsOn: false) == LightState(.red, "OBS: not running", button: "Open OBS", action: "openObs"), "OBS closed light")
        try check(Readiness.obs(connected: false, running: true, problem: "obs-bad-password", studioOff: false, controlsOn: false).action == "password", "OBS bad password light")
        try check(Readiness.obs(connected: false, running: true, problem: nil, studioOff: false, controlsOn: false) == LightState(.grey, "OBS: connecting…"), "OBS connecting light")
        try check(Readiness.tourBox(consoleRunning: true) == LightState(.green, "TourBox: ready") && Readiness.tourBox(consoleRunning: false).action == "openConsole" && Readiness.tourBox(consoleRunning: false, consoleInstalled: false).action == "downloadConsole", "TourBox Console light")
        try check(Readiness.vjster(enabled: true, controlsOn: false, connectedPeers: 0) == LightState(.green, "VJster: ready"), "VJster ready before start")
        try check(Readiness.vjster(enabled: true, controlsOn: true, connectedPeers: 1) == LightState(.green, "VJster: connected") && Readiness.vjster(enabled: true, controlsOn: true, connectedPeers: 0).action == "vjsterWait", "VJster readiness light")
        try check(Readiness.vjster(enabled: true, controlsOn: true, connectedPeers: 0, portBusy: true).action == "vjsterPort", "VJster port busy light")
        try check(Readiness.vjster(enabled: true, controlsOn: true, connectedPeers: 0, usedBefore: false) == LightState(.grey, "VJster: waiting for video", button: "Show me", action: "vjsterWait") &&
                  Readiness.vjster(enabled: true, controlsOn: false, connectedPeers: 0, usedBefore: false) == LightState(.grey, "VJster: ready") &&
                  Readiness.vjster(enabled: true, controlsOn: true, connectedPeers: 0, portBusy: true, usedBefore: false).lamp == .amber &&
                  Readiness.vjster(enabled: true, controlsOn: true, connectedPeers: 1, usedBefore: false).lamp == .green, "VJster light before a video was ever connected")
        try check(Readiness.controls(running: false, armed: false, obsConnected: false).action == "tryAgain" &&
                  Readiness.controls(running: false, armed: false, axTrusted: false, obsConnected: false).action == "grantAx", "Controls light offers Try again while OBS is not connected")
        try check(Readiness.autoStart(settingsSaved: true, settingsValid: true, remembered: nil, obsConnected: true, controlsOn: false, axReady: true) &&
                  Readiness.autoStart(settingsSaved: true, settingsValid: true, remembered: "on", obsConnected: true, controlsOn: false, axReady: true) &&
                  !Readiness.autoStart(settingsSaved: true, settingsValid: true, remembered: "off", obsConnected: true, controlsOn: false, axReady: true) &&
                  Readiness.autoStart(settingsSaved: false, settingsValid: true, remembered: nil, obsConnected: true, controlsOn: false, axReady: true) &&
                  !Readiness.autoStart(settingsSaved: false, settingsValid: true, remembered: nil, obsConnected: true, controlsOn: false, axReady: false) &&
                  !Readiness.autoStart(settingsSaved: false, settingsValid: true, remembered: "off", obsConnected: true, controlsOn: false, axReady: true) &&
                  !Readiness.autoStart(settingsSaved: true, settingsValid: false, remembered: "on", obsConnected: true, controlsOn: false, axReady: true) &&
                  !Readiness.autoStart(settingsSaved: true, settingsValid: true, remembered: "on", obsConnected: false, controlsOn: false, axReady: true) &&
                  Readiness.autoStart(settingsSaved: true, settingsValid: true, remembered: "on", obsConnected: false, controlsOn: false, axReady: true, vjsterOn: true) &&
                  !Readiness.autoStart(settingsSaved: true, settingsValid: true, remembered: "on", obsConnected: false, controlsOn: false, axReady: true, vjsterOn: true, mixOnly: true) &&
                  !Readiness.autoStart(settingsSaved: true, settingsValid: true, remembered: "on", obsConnected: false, controlsOn: false, axReady: false, vjsterOn: true) &&
                  !Readiness.autoStart(settingsSaved: true, settingsValid: true, remembered: "on", obsConnected: true, controlsOn: true, axReady: true) &&
                  !Readiness.autoStart(settingsSaved: true, settingsValid: true, remembered: "on", obsConnected: true, controlsOn: false, axReady: false), "Auto-start decision")
        try check(Readiness.tourBox(consoleRunning: true, oldPreset: true).action == "importPreset" &&
                  Readiness.tourBox(consoleRunning: true, mixOnly: true, oldPreset: true).action == nil &&
                  Readiness.tourBox(consoleRunning: false, oldPreset: true).action == "openConsole", "TourBox light with an old preset")
        try check(Readiness.tourBox(consoleRunning: true, noPreset: true) == LightState(.amber, "TourBox: preset not imported", button: "Import", action: "importPreset") &&
                  Readiness.tourBox(consoleRunning: true, oldPreset: true, noPreset: true).text == "TourBox: old preset" &&
                  Readiness.tourBox(consoleRunning: false, noPreset: true).action == "openConsole" &&
                  Readiness.tourBox(consoleRunning: true, mixOnly: true, noPreset: true).action == nil, "TourBox light with no preset imported")
        try PresetAge.check(check)
        try check(Readiness.reminder(controlsOn: true, obsHidden: false, consoleRunning: true, frontIsObs: false, autoSwitch: false, activeFadester: true) == nil &&
                  Readiness.reminder(controlsOn: true, obsHidden: false, consoleRunning: true, frontIsObs: false, autoSwitch: true, activeFadester: true) == L("remindObsFront") &&
                  Readiness.reminder(controlsOn: true, obsHidden: false, consoleRunning: true, frontIsObs: false, obsRunning: false, autoSwitch: false, activeFadester: false) == L("remindSelectPreset") &&
                  Readiness.banner(controlsOn: true, obsHidden: false, consoleRunning: true, frontIsObs: true, autoSwitch: false, activeFadester: false)?.action == "openConsole" &&
                  Readiness.reminder(controlsOn: true, obsHidden: false, consoleRunning: false, frontIsObs: false, autoSwitch: false, activeFadester: false) == nil, "Reminder with Auto Switch")
        try check(Readiness.controls(running: true, armed: true, obsConnected: false) == LightState(.amber, L("liCtlWaiting"), button: L("macBtnStop"), action: "stop"), "Controls light while armed for videos only")
        try check(Readiness.reminder(controlsOn: true, obsHidden: false, consoleRunning: true, frontIsObs: false, autoSwitch: true) != nil &&
                  Readiness.reminder(controlsOn: true, obsHidden: false, consoleRunning: true, frontIsObs: false, frontIsChrome: true) == nil &&
                  Readiness.reminder(controlsOn: true, obsHidden: false, consoleRunning: true, frontIsObs: false, obsRunning: false) == nil, "No bring-OBS reminder with Chrome in front or OBS closed")
        try check(Readiness.controls(running: false, armed: false).action == "start" && Readiness.controls(running: false, armed: false, axTrusted: false).action == "grantAx" && Readiness.controls(running: true, armed: true) == LightState(.green, "Controls: on", button: "Stop", action: "stop"), "Controls readiness light")
        try check(Readiness.banner(controlsOn: false, obsHidden: false, consoleRunning: true, frontIsObs: false, axTrusted: false)?.action == "grantAx", "Accessibility banner before start")
        try check(HostController.explainHostError("ERROR: initialization: guardFailed(\"Accessibility denied; grant the responsible app\")").contains("Grant Accessibility"), "Host Accessibility error explanation")
        try check(Readiness.reminder(controlsOn: true, obsHidden: false, consoleRunning: true, frontIsObs: false, autoSwitch: true) != nil && Readiness.reminder(controlsOn: true, obsHidden: false, consoleRunning: true, frontIsObs: true) == nil, "Frontmost OBS reminder")
        try check(Readiness.reminder(controlsOn: true, obsHidden: true, consoleRunning: true, frontIsObs: false, mixOnly: true) == nil && Readiness.tourBox(consoleRunning: true, mixOnly: true) == LightState(.grey, "TourBox: off") && Readiness.vjster(enabled: true, controlsOn: true, connectedPeers: 1, mixOnly: true) == LightState(.grey, "VJster: off"), "Stream Deck-only lights and reminder")
        try check(Readiness.vsMeter("Music up") == nil && Readiness.vsMeter("VS-METER: not_loaded") == "Visual Sidechain: NOT LOADED" && Readiness.vsMeter("VS-METER: no_audio") == "Visual Sidechain: NO AUDIO" && Readiness.vsMeter("VS-METER: active 120 1 2 100 50 0 25") == "Visual Sidechain: 120 BPM [LOCK] · Beat 2/4 · █▅▁▃" && Readiness.vsMeter("VS-METER: active x") == "", "Visual Sidechain meter line")
        var mixOnlySettings = Settings(); mixOnlySettings.mixEnabled = true; mixOnlySettings.mixOnly = true
        let mixOnlyRoundtrip = try Settings(data: mixOnlySettings.encoded()), defaultRoundtrip = try Settings(data: Settings().encoded())
        try check(mixOnlyRoundtrip.mixOnly && !defaultRoundtrip.mixOnly, "Stream Deck-only setting roundtrips")
        var peers = Readiness.vjsterPeers(after: "VJster: the Chrome extension connected", current: [])
        peers = Readiness.vjsterPeers(after: "VJster: the OBS video page connected", current: peers)
        try check(peers.count == 2 && Readiness.vjsterPeers(after: "VJster: the Chrome extension disconnected (closed)", current: peers) == ["obs"], "VJster peer tracking")
        try check(Readiness.vjsterPeers(after: "VJster: the OBS video page disconnected (closed)", current: ["obs"]).isEmpty, "VJster OBS peer disconnect tracking")
        try check(Readiness.hostFeedback(from: "RESULT vjster.speed.up: Video 1.25x · 1080p · playing") == "Video 1.25x · 1080p · playing", "Host RESULT feedback")
        try check(Readiness.hostFeedback(from: "Clip · Video 1x · Auto (720p) · playing") == "Clip · Video 1x · Auto (720p) · playing" &&
                  Readiness.hostFeedback(from: "News · www.example.com · Video 1x · paused") == "News · www.example.com · Video 1x · paused", "VJster lines that name the video are feedback")
        try check(Readiness.hostFeedback(from: "RESULT fader.forward: T-bar right · T-bar 0%") == "T-bar right · T-bar 0%" &&
                  Readiness.hostFeedback(from: "RESULT fader.back: T-bar left · T-bar 0 %") == L("macTbarCw"), "T-bar hints: a finished throw reads as is, back at rest says turn clockwise")
        let picks = Readiness.pickedLayers(#"LAYER-PICKED {"layer":2,"scene":"Kit Visuals","source":"Kit \u203A Title"}"#)
        try check(picks.count == 1 && picks[0].layer == 2 && picks[0].scene == "Kit Visuals" && picks[0].source == "Kit › Title" && Readiness.pickedLayers("Music up").isEmpty, "Picked layer")
        // Only the host's own line counts: the sentence people read, a video title that copies it, or a marker that is
        // not at the very start of the line or is malformed, changes nothing.
        let forgedPicks = [
            "RESULT layer1.blend.next: Layer 1 blend: Additive Layer 1 = Kit Visuals › Kit Motion (picked automatically; change it on the Assignments tab)",
            "Layer 2 = Live › Camera (picked automatically · Video 1x · playing",
            #"> LAYER-PICKED {"layer":1,"scene":"a","source":"b"}"#, #" LAYER-PICKED {"layer":1,"scene":"a","source":"b"}"#,
            #"LAYER-PICKED {"layer":3,"scene":"a","source":"b"}"#, #"LAYER-PICKED {"layer":"1","scene":"a","source":"b"}"#,
            #"LAYER-PICKED {"layer":true,"scene":"a","source":"b"}"#, #"LAYER-PICKED {"layer":1,"scene":"a"}"#,
            #"LAYER-PICKED {"layer":1,"scene":"a","source":""}"#, #"LAYER-PICKED {"layer":1,"scene":"a","source":"b","more":1}"#,
            "LAYER-PICKED Layer 1 = a › b (picked automatically", "LAYER-PICKED "
        ]
        try check(forgedPicks.allSatisfy { Readiness.pickedLayers($0).isEmpty }, "Forged picked layers are refused")
        try check(Readiness.hostFeedback(from: "REFUSED fader.forward: Choose a different Preview scene first.")?.contains("Scroll") == true, "Same-scene Preview hint")
        let busy = Readiness.vjsterPortBusy(after: "VJster port 48150 is in use, probably by the VJster actions in your Stream Deck or OpenDeck software.", current: false)
        try check(busy && !Readiness.vjsterPortBusy(after: "VJster link listening on 127.0.0.1:48150", current: busy), "VJster port busy tracking")
        let deckLine = "VJster port 48150 is held by the VJster actions of Fadester for OBS on your Stream Deck or OpenDeck: the deck controls the video."
        try check(Readiness.vjsterPortBusy(after: deckLine, current: false) && Readiness.vjsterOnDeck(after: deckLine, current: false) &&
                  !Readiness.vjsterOnDeck(after: "VJster port 48150 is in use, probably by the VJster actions in your Stream Deck or OpenDeck software.", current: true) &&
                  !Readiness.vjsterOnDeck(after: "VJster link listening on 127.0.0.1:48150", current: true) && Readiness.vjsterOnDeck(after: "RESULT music.up: Music up", current: true) &&
                  Readiness.vjster(enabled: true, controlsOn: true, connectedPeers: 0, portBusy: true, onDeck: true) == LightState(.grey, L("liVjDeck"), button: L("btnShowMe"), action: "vjsterPort") &&
                  Readiness.vjster(enabled: true, controlsOn: true, connectedPeers: 0, portBusy: true).lamp == .red, "VJster held by the deck is a grey light")
        let sampleHash = LocalFiles.sha256Hex(Data("preset-v1".utf8))
        try check(LocalFiles.presetSyncState(bundledHash: sampleHash, savedHash: nil) == .neverSaved && LocalFiles.presetSyncState(bundledHash: sampleHash, savedHash: sampleHash) == .current && LocalFiles.presetSyncState(bundledHash: sampleHash, savedHash: "older") == .updateAvailable, "Preset freshness tracking")
        let sampleMap = Data("{\"presets\":{\"master\":{\"bindings\":[{\"control\":\"side+knob\",\"gesture\":\"cw\",\"action\":\"vjster.speed.up\",\"label\":\"Video speed up\"}]}}}".utf8)
        let mapRows = try ControlMapRow.load(data: sampleMap)
        try check(mapRows == [ControlMapRow(category: "media", control: "Side + Knob", gesture: "Clockwise", action: "Video speed up")], "Control map formatting")
        print("PASS: panel settings, readiness lights, control map formatting, Unicode/layer/VJster assignments, strict ranges, secret-free serialization and log redaction. No files, OBS, shortcuts or GUI used.")
    }
}

/// Whether TourBox Console holds an older OBS Fadester preset than the one this Companion ships (FIX-9, hand test
/// 2026-11-17: an old copy turned the Knob into the mix level instead of the video speed), as on Windows (PresetAge.cs).
/// Console keeps one ShortDesc per shortcut (modifiers and key code) in the .tb it imports and in the copy it stores; the
/// labels are translated, the shortcuts are not, so this works in every language.
/// unknown: Console's presets could not be read (yet), or none were found to judge. none: Console holds presets, and none
/// is an OBS Fadester preset.
enum PresetState { case unknown, none, current, old }

enum PresetAge {
    /// A stored preset counts as a Fadester preset when at least this many of its shortcuts make up at least this share of
    /// it; Console's factory presets share at most a tenth with ours.
    static let minShared = 10, minShare = 0.6

    static func shortcuts(_ xml: String) -> Set<String> {
        guard let block = try? NSRegularExpression(pattern: "<ShortDesc>(.*?)</ShortDesc>", options: [.dotMatchesLineSeparators]),
              let mods = try? NSRegularExpression(pattern: "<m>([0-9]+)</m>"), let key = try? NSRegularExpression(pattern: "<s>([0-9]+)</s>") else { return [] }
        let text = xml as NSString
        var found = Set<String>()
        for match in block.matches(in: xml, range: NSRange(location: 0, length: text.length)) {
            let inner = text.substring(with: match.range(at: 1)) as NSString
            let range = NSRange(location: 0, length: inner.length)
            guard let m = mods.firstMatch(in: inner as String, range: range), let s = key.firstMatch(in: inner as String, range: range) else { continue }
            found.insert(inner.substring(with: m.range(at: 1)) + ":" + inner.substring(with: s.range(at: 1)))
        }
        return found
    }

    /// unknown: nothing to judge (our own preset unreadable, or no stored preset found). none: Console holds presets and
    /// none is a Fadester preset. old: one of them lacks a shortcut of the shipped preset (Auto Switch may pick it).
    /// old also when Console's import copy shows the buttons laid out differently (0.12.11 swapped bare Side and Short without
    /// changing the set of shortcuts, hand test 2026-11-17), as on Windows. layouts[i] is stored[i]'s layout, or nil.
    static func judge(shipped: Set<String>, stored: [Set<String>], shippedLayout: String? = nil, layouts: [String?] = []) -> PresetState {
        guard !shipped.isEmpty, !stored.isEmpty else { return .unknown }
        var any = false
        for (i, preset) in stored.enumerated() {
            if !isFadester(shipped: shipped, preset: preset) { continue }
            any = true
            if !shipped.isSubset(of: preset) { return .old }
            if let want = shippedLayout, i < layouts.count, let have = layouts[i], have != want { return .old }
        }
        return any ? .current : .none
    }

    /// A preset's button layout: the configBytes of Console's XML (labels live apart, so it is the same in every language).
    static func layout(_ xml: String?) -> String? {
        guard let xml = xml, let start = xml.range(of: "<configBytes>"), let end = xml.range(of: "</configBytes>", range: start.upperBound..<xml.endIndex) else { return nil }
        return String(xml[start.upperBound..<end.lowerBound].filter { !$0.isWhitespace })
    }
    /// An import copy's layout, read again only when the file changes: the check runs every 5 s on the main thread.
    /// read is false only for a copy that exists but cannot be unzipped yet; no copy, or one without a layout, gives nil.
    private static var layoutCache: [String: (Date, String?)] = [:]
    static func cachedLayout(_ url: URL) -> (read: Bool, layout: String?) {
        guard let changed = (try? FileManager.default.attributesOfItem(atPath: url.path))?[.modificationDate] as? Date else { return (true, nil) }
        if let hit = layoutCache[url.path], hit.0 == changed { return (true, hit.1) }
        guard let text = unzip(url) else { return (false, nil) }
        let found = layout(text)
        layoutCache[url.path] = (changed, found)
        return (true, found)
    }
    /// The gzip of Console's XML (a shipped .tb, or Console's import copy), as text; nil when it cannot be read.
    static func unzip(_ url: URL) -> String? {
        let gzip = Process(), out = Pipe()
        gzip.executableURL = URL(fileURLWithPath: "/usr/bin/gzip")
        gzip.arguments = ["-dc", url.path]
        gzip.standardOutput = out; gzip.standardError = FileHandle.nullDevice
        do { try gzip.run() } catch { return nil }
        let data = out.fileHandleForReading.readDataToEndOfFile()
        gzip.waitUntilExit()
        guard gzip.terminationStatus == 0 else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// The preset this Companion ships (a gzip of Console's XML), or an empty set when it cannot be read.
    static func shipped(_ url: URL) -> Set<String> {
        let gzip = Process(), out = Pipe()
        gzip.executableURL = URL(fileURLWithPath: "/usr/bin/gzip")
        gzip.arguments = ["-dc", url.path]
        gzip.standardOutput = out; gzip.standardError = FileHandle.nullDevice
        do { try gzip.run() } catch { return [] }
        let data = out.fileHandleForReading.readDataToEndOfFile()
        gzip.waitUntilExit()
        guard gzip.terminationStatus == 0, let xml = String(data: data, encoding: .utf8) else { return [] }
        return shortcuts(xml)
    }

    /// Console's stored presets: ~/Library/Application Support/TourBox Console/presets/<number> (.bak files are its backups).
    /// complete is false when a preset file could not be read or is not finished (no closing </Preset> yet).
    /// layouts: each stored preset's button layout from Console's import copy (import/<number>), or nil without one.
    static func stored() -> (presets: [Set<String>], complete: Bool, layouts: [String?]) {
        let dir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/TourBox Console/presets")
        guard let names = try? FileManager.default.contentsOfDirectory(atPath: dir.path) else { return ([], true, []) }
        var presets: [Set<String>] = [], complete = true, layouts: [String?] = []
        for name in names where !name.isEmpty && name.allSatisfy(\.isNumber) {
            guard let xml = try? String(contentsOf: dir.appendingPathComponent(name), encoding: .utf8), xml.contains("</Preset>") else { complete = false; continue }
            presets.append(shortcuts(xml))
            let copy = dir.deletingLastPathComponent().appendingPathComponent("import/\(name)")
            let (read, found) = cachedLayout(copy)
            if !read { complete = false } // being written: keep the last answer
            layouts.append(found)
        }
        return (presets, complete, layouts)
    }

    /// What Console's files looked like when they were last read: every file in presets and import, customConfig and
    /// tableid, by name, size and time of last change. While it is the same, nothing is read or parsed again (the panel
    /// used to read every preset every 5 s on the main thread).
    static func stamp() -> String {
        let root = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/TourBox Console")
        var parts: [String] = []
        func describe(_ url: URL, _ label: String) -> String {
            guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path) else { return label + ":none" }
            let size = (attributes[.size] as? NSNumber)?.int64Value ?? -1
            let changed = (attributes[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0
            return "\(label):\(size):\(changed)"
        }
        for folder in ["presets", "import"] {
            let dir = root.appendingPathComponent(folder)
            guard let names = try? FileManager.default.contentsOfDirectory(atPath: dir.path) else { parts.append(folder + ":none"); continue }
            for name in names.sorted() { parts.append(describe(dir.appendingPathComponent(name), folder + "/" + name)) }
        }
        parts.append(describe(root.appendingPathComponent("customConfig"), "customConfig"))
        parts.append(describe(root.appendingPathComponent("tableid"), "tableid"))
        return parts.joined(separator: "|")
    }

    /// TourBox Console's Auto Switch (customConfig switchByProcess): true, false, or nil when its settings cannot be read.
    static func autoSwitch() -> Bool? { parseAutoSwitch(consoleFile("customConfig")) }
    static func parseAutoSwitch(_ xml: String?) -> Bool? {
        guard let xml = xml, let r = xml.range(of: #"<string>switchByProcess</string>\s*<string>(true|false)</string>"#, options: .regularExpression) else { return nil }
        return xml[r].contains("<string>true</string>")
    }
    /// Whether the preset Console has selected (its tableid file names presets/<number>) is a Fadester preset; nil when unknown.
    static func activeIsFadester(shipped: Set<String>) -> Bool? {
        guard !shipped.isEmpty, let id = consoleFile("tableid")?.trimmingCharacters(in: .whitespacesAndNewlines), !id.isEmpty, id.allSatisfy(\.isNumber),
              let xml = consoleFile("presets/\(id)"), xml.contains("</Preset>") else { return nil }
        return isFadester(shipped: shipped, preset: shortcuts(xml))
    }
    static func isFadester(shipped: Set<String>, preset: Set<String>) -> Bool {
        let shared = preset.intersection(shipped).count
        return shared >= minShared && Double(shared) >= minShare * Double(preset.count)
    }
    private static func consoleFile(_ name: String) -> String? {
        let url = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/TourBox Console/\(name)")
        return try? String(contentsOf: url, encoding: .utf8)
    }

    static func check(_ check: (Bool, String) throws -> Void) throws {
        func desc(_ pairs: [String]) -> String {
            pairs.map { p -> String in let part = p.split(separator: ":"); return "<ShortDesc><m>\(part[0])</m><s>\(part[1])</s><d>x</d></ShortDesc>" }.joined()
        }
        let shipped = shortcuts("<Preset>" + desc((1...20).map { "14:\($0)" }) + "</Preset>")
        let old = shortcuts(desc((1...15).map { "14:\($0)" }))
        let factory = shortcuts(desc((1...3).map { "14:\($0)" } + (100..<160).map { "2:\($0)" }))
        try check(shipped.count == 20 && shipped.contains("14:7"), "Preset shortcuts parse")
        try check(judge(shipped: shipped, stored: [factory]) == .none && judge(shipped: shipped, stored: [factory, shipped]) == .current &&
                  judge(shipped: shipped, stored: [old]) == .old && judge(shipped: shipped, stored: [shipped, old]) == .old &&
                  judge(shipped: [], stored: [old]) == .unknown && judge(shipped: shipped, stored: []) == .unknown, "Preset age decision")
        try check(judge(shipped: shipped, stored: [shipped], shippedLayout: "AAA", layouts: ["AAA"]) == .current &&
                  judge(shipped: shipped, stored: [shipped], shippedLayout: "AAA", layouts: ["BBB"]) == .old &&
                  judge(shipped: shipped, stored: [shipped], shippedLayout: "AAA", layouts: [nil]) == .current &&
                  layout("<TableTransfer><configBytes>QUJD\n  REVG</configBytes>") == "QUJDREVG" && layout("<Preset/>") == nil, "Preset layout")
        try check(parseAutoSwitch("<map><entry><string>switchByProcess</string>\n    <string>false</string></entry></map>") == false &&
                  parseAutoSwitch("<entry><string>switchByProcess</string><string>true</string></entry>") == true && parseAutoSwitch("<map/>") == nil &&
                  isFadester(shipped: shipped, preset: shipped) && !isFadester(shipped: shipped, preset: factory), "Console settings")
    }
}

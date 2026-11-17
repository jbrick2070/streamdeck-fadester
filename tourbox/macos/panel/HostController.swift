// SPDX-License-Identifier: GPL-2.0-or-later
import Foundation
import Darwin

struct RuntimePaths {
    let resources: URL
    var host: URL { resources.appendingPathComponent("runtime/FadesterMacHost") }
    var native: URL { resources.appendingPathComponent("runtime/Fadester Companion T-bar.app") }
    var input: URL { resources.appendingPathComponent("runtime/Fadester Companion Shortcuts.app") }
    var map: URL { resources.appendingPathComponent("presets/map.json") }
    var preset: URL { resources.appendingPathComponent("presets/OBS Fadester for TourBox.tb") }
    var icons: URL { resources.appendingPathComponent("artwork/icons") }
    var vjsterObsHtml: URL { resources.appendingPathComponent("vjster/obs/player.html") }
    var vjsterObsScript: URL { resources.appendingPathComponent("vjster/obs/player.js") }
    /// The TourBox preset in the panel's language (translated labels, the same shortcuts); English when that language has none.
    var localizedPreset: URL { localized("presets/\(PanelText.locale)/OBS Fadester for TourBox.tb", fallback: preset) }
    /// The Mac quick start in the panel's language; the full English guide (START-HERE.html) for English or a missing translation.
    var guide: URL { localized("guide/\(PanelText.locale).html", fallback: resources.appendingPathComponent("START-HERE.html")) }
    private func localized(_ path: String, fallback: URL) -> URL {
        let url = resources.appendingPathComponent(path)
        return PanelText.locale != "en" && FileManager.default.fileExists(atPath: url.path) ? url : fallback
    }
    /// In the built app: every panel language but English has its own Mac preset and quick start, and English falls back.
    static func selfTest(resources: URL) throws {
        let paths = RuntimePaths(resources: resources)
        guard FileManager.default.fileExists(atPath: paths.resources.appendingPathComponent("START-HERE.html").path) else { return } // not run from the app
        let previous = PanelText.locale
        defer { PanelText.use(previous) }
        for locale in PanelStrings.locales {
            PanelText.use(locale)
            let presetOk = locale == "en" ? paths.localizedPreset == paths.preset : paths.localizedPreset.path.hasSuffix("/presets/\(locale)/OBS Fadester for TourBox.tb")
            let guideOk = paths.guide.lastPathComponent == (locale == "en" ? "START-HERE.html" : "\(locale).html")
            guard presetOk && guideOk else { throw PanelFailure.message("Self-test: the \(locale) TourBox preset or quick guide is missing from the app.") }
        }
    }
    func validate() throws {
        for file in [host, native.appendingPathComponent("Contents/MacOS/FadesterNativeSlider"), input.appendingPathComponent("Contents/MacOS/FadesterMacShortcuts"), map, preset, vjsterObsHtml, vjsterObsScript] {
            guard FileManager.default.fileExists(atPath: file.path) else { throw PanelFailure.message(L("macIncomplete")) }
        }
    }
}

/// Owns exactly one child host. It never sends an OBS action or addresses another process.
@MainActor final class HostController {
    private var process: Process?
    private var input: Pipe?
    private var secret = ""
    private var armed = false
    // READY was seen once for the child this controller owns: a later DISARMED (a reconnect, OBS lost) is not a failed start.
    private var reachedReady = false
    private var stopping = false
    private var lastError: String?
    var changed: ((String, Bool) -> Void)?
    var line: ((String) -> Void)?
    var exited: (() -> Void)?
    var running: Bool { process != nil }
    var isArmed: Bool { armed }

    nonisolated static func explainHostError(_ text: String) -> String {
        if text.localizedCaseInsensitiveContains("Accessibility denied") {
            return L("macHostAx")
        }
        if text.localizedCaseInsensitiveContains("expected one OBS window") {
            return L("macHostOneWindow")
        }
        if text.localizedCaseInsensitiveContains("not parked at zero") {
            return L("macHostTbarZero")
        }
        if text.localizedCaseInsensitiveContains("expected exactly one native OBS T-bar") {
            return L("macHostStudio")
        }
        var clean = text
        if clean.hasPrefix("ERROR: ") { clean = String(clean.dropFirst(7)) }
        if clean.hasPrefix("initialization: ") { clean = String(clean.dropFirst(16)) }
        if clean.hasPrefix("guardFailed(\"") && clean.hasSuffix("\")") {
            clean = String(clean.dropFirst(13).dropLast(2))
        }
        clean = clean.trimmingCharacters(in: .whitespacesAndNewlines)
        return clean.isEmpty ? L("macHostStopped") : L("macHostStoppedReason", clean)
    }

    func start(paths: RuntimePaths, config: URL, password: String, mixEnabled: Bool, mixOnly: Bool = false, extraSecrets: [String] = []) throws {
        try paths.validate()
        guard process == nil else { throw PanelFailure.message("Stop the current controls first.") }
        var args: [String]
        if mixOnly {
            // Stream Deck, OpenDeck and MIDI only: no shortcut helper, native T-bar or VJster (the host's --mix-only).
            args = ["--run", "--config", config.path, "--mix-only"]
        } else {
            args = ["--run", "--config", config.path, "--native-app", paths.native.path, "--input-app", paths.input.path, "--map", paths.map.path]
            if !mixEnabled { args.append("--no-mix-provider") }
        }
        try launch(executable: paths.host, arguments: args, password: password, extraSecrets: extraSecrets)
    }
    func launch(executable: URL, arguments: [String], password: String, extraSecrets: [String] = []) throws {
        guard process == nil else { throw PanelFailure.message("A child host is already owned.") }
        let child = Process(), output = Pipe(), commands = Pipe(), drained = DispatchGroup()
        var environment = ProcessInfo.processInfo.environment
        environment.removeValue(forKey: "FADESTER_MAC_OBS_PASSWORD")
        environment.removeValue(forKey: "FADESTER_OBS_PASSWORD")
        if !password.isEmpty { environment["FADESTER_OBS_PASSWORD"] = password }
        child.environment = environment; child.executableURL = executable; child.arguments = arguments
        child.standardInput = commands; child.standardOutput = output; child.standardError = output
        secret = password; armed = false; reachedReady = false; stopping = false; lastError = nil; process = child; input = commands
        child.terminationHandler = { [weak self] owned in
            DispatchQueue.global(qos: .utility).async {
                _ = drained.wait(timeout: .now() + 2)
                DispatchQueue.main.async {
                    guard let self, self.process === owned else { return }
                    let reason = self.lastError ?? L("macHostStopped")
                    self.input = nil; self.process = nil; self.secret = ""; self.armed = false; self.stopping = false; self.lastError = nil
                    self.changed?(owned.terminationStatus == 0 ? L("stopped") : reason, false)
                    self.exited?()
                }
            }
        }
        drained.enter()
        do { try child.run() }
        catch { drained.leave(); process = nil; input = nil; secret = ""; throw PanelFailure.message(L("macHostNoStart")) }
        changed?(L("macHostConnecting"), true)
        let redactionSecrets = [password] + extraSecrets
        DispatchQueue.global(qos: .utility).async { [weak self] in
            defer { drained.leave() }
            var pending = [UInt8](), truncated = false, bytes = [UInt8](repeating: 0, count: 4096)
            let fd = output.fileHandleForReading.fileDescriptor
            while true {
                let count = bytes.withUnsafeMutableBytes { Darwin.read(fd, $0.baseAddress, $0.count) }
                if count < 0 && errno == EINTR { continue }
                if count <= 0 { break }
                for byte in bytes.prefix(count) {
                    if byte == 10 {
                        let raw = truncated ? "Host output exceeded its line limit." : String(decoding: pending, as: UTF8.self).trimmingCharacters(in: .newlines)
                        let text = redact(raw, secrets: redactionSecrets)
                        let ready = raw.range(of: "^READY [1-9][0-9]*$", options: .regularExpression) != nil
                        let disarmed = raw.hasPrefix("DISARMED ") || raw.hasPrefix("OFFLINE:")
                        pending.removeAll(keepingCapacity: true); truncated = false
                        DispatchQueue.main.async {
                            guard let self, self.process === child else { return }
                            if raw.hasPrefix("ERROR:") {
                                self.lastError = Self.explainHostError(text)
                            }
                            self.line?(text)
                            if ready && child.isRunning {
                                self.armed = true
                                self.reachedReady = true
                                self.lastError = nil
                                self.changed?(L("macHostArmed"), true)
                            } else if disarmed {
                                self.armed = false
                                if !self.stopping {
                                    self.changed?(L("macHostDisarmed"), true)
                                }
                            }
                        }
                    } else if !truncated {
                        if pending.count < 8192 { pending.append(byte) } else { pending.removeAll(); truncated = true }
                    }
                }
            }
            try? output.fileHandleForReading.close()
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 30) { [weak self, weak child] in
            guard let self, let child, self.process === child, child.isRunning, !self.reachedReady else { return }
            self.line?(L("macHostTimeout"))
            self.stop()
        }
    }
    func stop() {
        guard let owned = process else { return }
        stopping = true
        changed?(L("macHostStopping"), true)
        try? input?.fileHandleForWriting.write(contentsOf: Data("quit\n".utf8))
        try? input?.fileHandleForWriting.close(); input = nil
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self, weak owned] in
            guard let self, let owned, self.process === owned, owned.isRunning else { return }
            owned.terminate()
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self, weak owned] in
                guard let self, let owned, self.process === owned, owned.isRunning else { return }
                self.line?(L("macHostKilled"))
                _ = kill(owned.processIdentifier, SIGKILL)
            }
        }
    }
}

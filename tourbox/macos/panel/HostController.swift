// SPDX-License-Identifier: GPL-2.0-or-later
import Foundation
import Darwin

struct RuntimePaths {
    let resources: URL
    var host: URL { resources.appendingPathComponent("runtime/FadesterMacHost") }
    var native: URL { resources.appendingPathComponent("runtime/Fadester Native Slider Experimental.app") }
    var input: URL { resources.appendingPathComponent("runtime/Fadester Mac Shortcuts Experimental.app") }
    var map: URL { resources.appendingPathComponent("presets/map.json") }
    var preset: URL { resources.appendingPathComponent("presets/OBS Fadester for TourBox.tb") }
    var icons: URL { resources.appendingPathComponent("artwork/icons") }
    var vjsterObsHtml: URL { resources.appendingPathComponent("vjster/obs/player.html") }
    var vjsterObsScript: URL { resources.appendingPathComponent("vjster/obs/player.js") }
    func validate() throws {
        for file in [host, native.appendingPathComponent("Contents/MacOS/FadesterNativeSlider"), input.appendingPathComponent("Contents/MacOS/FadesterMacShortcuts"), map, preset, vjsterObsHtml, vjsterObsScript] {
            guard FileManager.default.fileExists(atPath: file.path) else { throw PanelFailure.message("Fadester Companion is incomplete. Rebuild or extract the entire app bundle.") }
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
    private var lastError: String?
    var changed: ((String, Bool) -> Void)?
    var line: ((String) -> Void)?
    var exited: (() -> Void)?
    var running: Bool { process != nil }
    var isArmed: Bool { armed }

    nonisolated static func explainHostError(_ text: String) -> String {
        if text.localizedCaseInsensitiveContains("Accessibility denied") {
            return "Accessibility needed: click Grant Accessibility… below (if Fadester Companion is already on, toggle it OFF then ON)."
        }
        if text.localizedCaseInsensitiveContains("expected one OBS window") {
            return "Close open OBS dialog or plugin windows so only the main OBS window is open, then click Start."
        }
        if text.localizedCaseInsensitiveContains("not parked at zero") {
            return "Move OBS’s T-bar slider back to the left/top end in Studio Mode, then click Start."
        }
        if text.localizedCaseInsensitiveContains("expected exactly one native OBS T-bar") {
            return "Turn on Studio Mode in OBS and keep the main OBS window visible, then click Start."
        }
        var clean = text
        if clean.hasPrefix("ERROR: ") { clean = String(clean.dropFirst(7)) }
        if clean.hasPrefix("initialization: ") { clean = String(clean.dropFirst(16)) }
        if clean.hasPrefix("guardFailed(\"") && clean.hasSuffix("\")") {
            clean = String(clean.dropFirst(13).dropLast(2))
        }
        clean = clean.trimmingCharacters(in: .whitespacesAndNewlines)
        return clean.isEmpty ? "Controls stopped. Review Activity for the reason." : "Controls stopped: \(clean)"
    }

    func start(paths: RuntimePaths, config: URL, password: String, mixEnabled: Bool, extraSecrets: [String] = []) throws {
        try paths.validate()
        guard process == nil else { throw PanelFailure.message("Stop the current controls first.") }
        var args = ["--run", "--config", config.path, "--native-app", paths.native.path, "--input-app", paths.input.path, "--map", paths.map.path]
        if !mixEnabled { args.append("--no-mix-provider") }
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
        secret = password; armed = false; reachedReady = false; lastError = nil; process = child; input = commands
        child.terminationHandler = { [weak self] owned in
            DispatchQueue.global(qos: .utility).async {
                _ = drained.wait(timeout: .now() + 2)
                DispatchQueue.main.async {
                    guard let self, self.process === owned else { return }
                    let reason = self.lastError ?? "Controls stopped. Review Activity for the reason."
                    self.input = nil; self.process = nil; self.secret = ""; self.armed = false; self.lastError = nil
                    self.changed?(owned.terminationStatus == 0 ? "Controls stopped." : reason, false)
                    self.exited?()
                }
            }
        }
        drained.enter()
        do { try child.run() }
        catch { drained.leave(); process = nil; input = nil; secret = ""; throw PanelFailure.message("The bundled control host could not start.") }
        changed?("Connecting… Controls are not armed yet.", true)
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
                                self.changed?("Connected — controls armed. Keep OBS in front.", true)
                            } else if disarmed {
                                self.armed = false
                                self.changed?("Controls disarmed. Check Activity before restarting.", true)
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
            self.line?("Startup did not reach Connected within 30 seconds. Stopping this host; check OBS, permission and Activity.")
            self.stop()
        }
    }
    func stop() {
        guard let owned = process else { return }
        changed?("Stopping controls… No fade or volume reset will be sent.", true)
        try? input?.fileHandleForWriting.write(contentsOf: Data("quit\n".utf8))
        try? input?.fileHandleForWriting.close(); input = nil
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self, weak owned] in
            guard let self, let owned, self.process === owned, owned.isRunning else { return }
            owned.terminate()
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self, weak owned] in
                guard let self, let owned, self.process === owned, owned.isRunning else { return }
                self.line?("The owned host did not exit after Stop; terminating that child. Check OBS before restarting.")
                _ = kill(owned.processIdentifier, SIGKILL)
            }
        }
    }
}

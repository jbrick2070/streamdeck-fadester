// SPDX-License-Identifier: GPL-2.0-or-later
import Carbon
import Foundation

enum InputFailure: Error, CustomStringConvertible {
    case invalid(String)
    var description: String { switch self { case .invalid(let reason): return reason } }
}
struct Shortcut: Equatable {
    let code: UInt32
    let action: String
    let label: String
    static let modifiers = UInt32(controlKey | optionKey | shiftKey)
    static let options = UInt32(kEventHotKeyExclusive)
}
enum ShortcutMap {
    static let keys: [String: UInt32] = [
        "A":0,"B":11,"C":8,"D":2,"E":14,"F":3,"G":5,"H":4,"I":34,"J":38,"K":40,"L":37,"M":46,
        "N":45,"O":31,"P":35,"Q":12,"R":15,"S":1,"T":17,"U":32,"V":9,"W":13,"X":7,"Y":16,"Z":6,
        "0":29,"1":18,"2":19,"3":20,"4":21,"5":23,"6":22,"7":26,"8":28,"9":25,
        "F1":122,"F2":120,"F3":99,"F4":118,"F5":96,"F6":97,"F7":98,"F8":100,"F9":101,"F10":109,"F11":103,"F12":111
    ] // HIToolbox/Events.h kVK_ANSI_* and kVK_F1..F12. Intended for the verified Mac preset key codes.
    static func parseChord(_ text: String) throws -> UInt32 {
        let parts = text.uppercased().split(separator: "+", omittingEmptySubsequences: false).map { String($0).trimmingCharacters(in: .whitespaces) }
        guard parts.count == 4, Set(parts.prefix(3)) == Set(["CTRL", "ALT", "SHIFT"]), let key = keys[parts[3]] else {
            throw InputFailure.invalid("Only unique Ctrl+Alt+Shift plus an ANSI letter/digit or F1..F12 is supported; Command is never substituted.")
        }
        return key
    }
    static func load(_ path: String) throws -> [Shortcut] {
        let data = try Data(contentsOf: URL(fileURLWithPath: path))
        guard data.count <= 512_000,
              let root = try JSONSerialization.jsonObject(with: data) as? [String: Any], root["version"] as? Int == 1,
              let presets = root["presets"] as? [String: [String: Any]], !presets.isEmpty else { throw InputFailure.invalid("Unsupported shortcut map.") }
        var seen: [UInt32: Shortcut] = [:]
        for preset in presets.values {
            guard let bindings = preset["bindings"] as? [[String: Any]] else { throw InputFailure.invalid("Missing shortcut bindings.") }
            let menu: [[String: Any]]
            if let raw = preset["menuBindings"] {
                guard let items = raw as? [[String: Any]] else { throw InputFailure.invalid("Invalid menu bindings.") }
                menu = items
            } else { menu = [] }
            for row in bindings + menu {
                guard let text = row["hotkey"] as? String, let action = row["action"] as? String,
                      action.utf8.count <= 64, action.range(of: "^[a-z][a-zA-Z0-9.]*$", options: .regularExpression) != nil else {
                    throw InputFailure.invalid("Binding must have a canonical action and shortcut.")
                }
                let code = try parseChord(text), item = Shortcut(code: code, action: action, label: text)
                if let prior = seen[code], prior.action != action { throw InputFailure.invalid("Two actions share a native shortcut.") }
                seen[code] = item
            }
        }
        guard !seen.isEmpty, seen.count <= 64 else { throw InputFailure.invalid("Invalid number of unique shortcuts.") }
        return seen.values.sorted { $0.code < $1.code }
    }
}

final class EventGate {
    private(set) var generation = 0
    private var highest = 0, armedAt = 0.0
    func arm(_ value: Int, uptime: Double) throws {
        guard value > highest && value <= Int(Int32.max) else { throw InputFailure.invalid("ARM generation must strictly increase.") }
        highest = value; generation = value; armedAt = uptime
    }
    func disarm() { generation = 0 }
    func line(action: String, eventTime: Double, uptime: Double, unixMs: Int64) -> String? {
        guard generation > 0, eventTime.isFinite, uptime.isFinite, eventTime >= armedAt,
              eventTime <= uptime + 0.01, uptime - eventTime <= 1.5 else { return nil }
        // Preserve the OS event age, not the later stdout-forwarding time.
        let stamp = unixMs - Int64((max(0, uptime - eventTime) * 1000).rounded())
        return "event \(generation) \(stamp) \(action)"
    }
}

enum InputSelfTests {
    static func run(map: String) throws {
        func check(_ okay: @autoclosure () -> Bool, _ why: String) throws { if !okay() { throw InputFailure.invalid("Self-test: " + why) } }
        let bindings = try ShortcutMap.load(map)
        try check(bindings.count == 47 && Set(bindings.map(\.action)).count == 47, "all 47 current canonical actions/chords")
        try check(Shortcut.modifiers == UInt32(controlKey | optionKey | shiftKey) && Shortcut.modifiers & UInt32(cmdKey) == 0, "Control/Option/Shift, no Command")
        try check(Shortcut.options == UInt32(kEventHotKeyExclusive) && Shortcut.options != 0, "exclusive registration cannot share another app's hotkey")
        let key = try ShortcutMap.parseChord("Ctrl+Alt+Shift+F4")
        try check(key == UInt32(kVK_F4), "Carbon F4 mapping")
        for bad in ["Cmd+Alt+Shift+A", "Ctrl+Ctrl+Shift+A", "Ctrl+Alt+Shift+F24", "Ctrl+A", "Ctrl+Alt+Shift+SPACE"] {
            do { _ = try ShortcutMap.parseChord(bad); throw InputFailure.invalid("accepted invalid chord") }
            catch InputFailure.invalid(let reason) { try check(reason != "accepted invalid chord", "invalid chord rejected") }
        }
        let gate = EventGate()
        try check(gate.line(action: "fader.forward", eventTime: 5, uptime: 5, unixMs: 10000) == nil, "starts disarmed")
        try gate.arm(1, uptime: 5)
        try check(gate.line(action: "fader.forward", eventTime: 4.99, uptime: 5.1, unixMs: 10000) == nil, "pre-arm OS event rejected")
        try check(gate.line(action: "fader.forward", eventTime: 5, uptime: 5.2, unixMs: 10000) == "event 1 9800 fader.forward", "event age retained for host 180ms guard")
        gate.disarm()
        try check(gate.line(action: "take", eventTime: 6, uptime: 6, unixMs: 11000) == nil, "disarm blocks input")
        try gate.arm(2, uptime: 7)
        try check(gate.line(action: "take", eventTime: 6.9, uptime: 7.1, unixMs: 12000) == nil, "old connection event not relabeled")
        try check(gate.line(action: "take", eventTime: 7, uptime: 9, unixMs: 12000) == nil, "stale OS queue ignored")
        try check(gate.line(action: "take", eventTime: 10, uptime: 9, unixMs: 12000) == nil, "future event ignored")
        do { try gate.arm(2, uptime: 9); throw InputFailure.invalid("accepted reused generation") }
        catch InputFailure.invalid(let reason) { try check(reason != "accepted reused generation", "generation reuse rejected") }
        var removed: [Int] = [], attempts = 0
        do {
            _ = try acquireShortcuts(Array(bindings.prefix(4)), register: { _ -> Int in
                attempts += 1
                if attempts == 3 { throw InputFailure.invalid("synthetic shortcut collision") }
                return attempts
            }, unregister: { removed.append($0) })
            throw InputFailure.invalid("accepted partial shortcut registration")
        } catch InputFailure.invalid(let reason) {
            try check(reason == "synthetic shortcut collision" && attempts == 3 && removed == [2, 1], "collision unwinds every prior registration")
        }
        print("PASS: 47 native chord mappings and synthetic timestamp/generation ingress checks. No global shortcuts registered, hardware observed, UI changed or OBS accessed.")
    }
}

func acquireShortcuts<Handle>(_ bindings: [Shortcut], register: (Shortcut) throws -> Handle, unregister: (Handle) -> Void) throws -> [Handle] {
    var handles: [Handle] = []
    do { for binding in bindings { handles.append(try register(binding)) }; return handles }
    catch { handles.reversed().forEach(unregister); throw error }
}

// Foundation read(upToCount:4096) can wait for a full buffer on an open stdin
// pipe. Commands are infrequent; one-byte reads guarantee newline delivery.
func readCommandLines(_ consume: (String) -> Bool) throws {
    var bytes = [UInt8](), overflow = false
    while let chunk = try FileHandle.standardInput.read(upToCount: 1), !chunk.isEmpty {
        let byte = chunk[chunk.startIndex]
        if byte == 10 {
            if bytes.last == 13 { bytes.removeLast() } // Accept one CR for C# CRLF writers.
            let line = overflow ? "" : String(bytes: bytes, encoding: .utf8) ?? ""
            if !consume(line) { return }
            bytes.removeAll(keepingCapacity: true); overflow = false
        } else if !overflow {
            if bytes.count < 80 { bytes.append(byte) } else { overflow = true; bytes.removeAll() }
        }
    }
}

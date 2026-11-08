// SPDX-License-Identifier: GPL-2.0-or-later
import Foundation

/// A bounded line reader for a long-lived control pipe. Larger Foundation reads
/// can wait to fill the requested count while the writer intentionally stays open.
enum NativeCommandLines {
    static func consume(_ input: FileHandle, receive: (String) -> Void) throws {
        var bytes = [UInt8](), overflow = false
        while let chunk = try input.read(upToCount: 1), let byte = chunk.first {
            if byte == 10 {
                if bytes.last == 13 { bytes.removeLast() } // One optional CR for CRLF.
                receive(overflow || bytes.count > 128 ? "" : String(bytes: bytes, encoding: .utf8) ?? "")
                bytes.removeAll(keepingCapacity: true); overflow = false
            } else if !overflow {
                // One extra byte permits a 128-byte command followed by CR.
                if bytes.count < 129 { bytes.append(byte) }
                else { bytes.removeAll(); overflow = true }
            }
        }
        // EOF never submits a partial command.
    }
}

protocol SliderAccess: AnyObject {
    func inspect() throws -> Int
    func setValue(_ desired: Int, permit: () throws -> Void) throws
}

enum Command {
    case read
    case move(expected: Int, desired: Int, sentAt: Int64)
    static func parse(_ line: String) -> Command? {
        guard line.utf8.count <= 128, line.utf8.allSatisfy({ $0 >= 32 && $0 < 127 }) else { return nil }
        if line == "READ" { return .read }
        let words = line.split(separator: " ", omittingEmptySubsequences: false)
        guard words.count == 4, words[0] == "MOVE",
              words.dropFirst().allSatisfy({ !$0.isEmpty && $0.utf8.allSatisfy({ $0 >= 48 && $0 <= 57 }) }),
              let expected = Int(words[1]), let desired = Int(words[2]), let timestamp = Int64(words[3]),
              (0...1023).contains(expected), (0...1023).contains(desired) else { return nil }
        return .move(expected: expected, desired: desired, sentAt: timestamp)
    }
}

final class SliderSession {
    private let slider: SliderAccess
    private let now: () -> Int64
    private var disarmed = false
    init(slider: SliderAccess, now: @escaping () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) }) {
        self.slider = slider; self.now = now
    }
    private func fresh(_ timestamp: Int64) -> Bool {
        let current = now()
        return timestamp >= current - 500 && timestamp <= current + 100
    }
    func handle(_ line: String) -> String {
        guard let command = Command.parse(line) else { return "ERR syntax: READ or MOVE expected desired unixMs" }
        guard !disarmed else { return "ERR disarmed: restart and revalidate the OBS session; never replay a failed write" }
        var invoked = false
        do {
            switch command {
            case .read:
                let value = try slider.inspect()
                guard (0...1023).contains(value) else { throw NativeFailure.guardFailed("invalid slider value") }
                return "OK \(value)"
            case .move(let expected, let desired, let timestamp):
                guard fresh(timestamp) else { throw NativeFailure.guardFailed("stale or future write") }
                let actual = try slider.inspect()
                guard actual == expected else { throw NativeFailure.guardFailed("external movement: actual \(actual), expected \(expected)") }
                guard fresh(timestamp) else { throw NativeFailure.guardFailed("write expired during validation") }
                // Equal-value requests verify parking only; they never reset a hand-moved slider.
                if desired == expected { return "OK \(actual)" }
                invoked = true
                try slider.setValue(desired) {
                    guard self.fresh(timestamp) else { throw NativeFailure.guardFailed("write expired immediately before setter") }
                }
                let after = try slider.inspect()
                guard after == desired else { throw NativeFailure.guardFailed("readback mismatch: actual \(after), requested \(desired)") }
                return "OK \(after)"
            }
        } catch {
            disarmed = true
            let detail = String(describing: error).replacingOccurrences(of: "\n", with: " ").replacingOccurrences(of: "\r", with: " ")
            return "ERR \(invoked ? "write unconfirmed" : "guard"): \(detail.prefix(300))"
        }
    }
}

enum NativeFailure: Error, CustomStringConvertible {
    case guardFailed(String)
    var description: String { switch self { case .guardFailed(let text): return text } }
}

// Parse lsof's explicit PID/file/name records, not human columns or process titles.
// macOS includes f even for -Fpn. The caller requests -Ffpn explicitly.
func listenerOwners(_ text: String, port: Int) throws -> Set<Int32> {
    var current: Int32?, owners = Set<Int32>()
    var file = false, name = false
    let allowed = Set(["127.0.0.1:\(port)", "[::1]:\(port)", "*:\(port)", "[::]:\(port)", "0.0.0.0:\(port)"])
    guard (1...65535).contains(port), text.utf8.count <= 65536 else { throw NativeFailure.guardFailed("invalid listener port or output size") }
    func decimal(_ value: Substring) -> Int32? {
        guard !value.isEmpty, value.utf8.allSatisfy({ $0 >= 48 && $0 <= 57 }) else { return nil }
        return Int32(value)
    }
    for line in text.split(separator: "\n") {
        if line.first == "p" {
            guard current == nil || (file && name) else { throw NativeFailure.guardFailed("incomplete listener record") }
            guard let pid = decimal(line.dropFirst()), pid > 0 else { throw NativeFailure.guardFailed("invalid listener PID") }
            current = pid; file = false; name = false
        } else if line.first == "f" {
            guard current != nil, !file || name, let descriptor = decimal(line.dropFirst()), descriptor >= 0 else {
                throw NativeFailure.guardFailed("invalid listener descriptor")
            }
            file = true; name = false
        } else if line.first == "n" {
            guard let pid = current, file, !name, allowed.contains(String(line.dropFirst())) else {
                throw NativeFailure.guardFailed("listener is not a matching loopback/wildcard endpoint")
            }
            owners.insert(pid); name = true
        } else { throw NativeFailure.guardFailed("unexpected listener field") }
    }
    guard current != nil, file, name else { throw NativeFailure.guardFailed("incomplete listener record") }
    return owners
}

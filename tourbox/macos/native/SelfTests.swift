// SPDX-License-Identifier: GPL-2.0-or-later
import Foundation

enum NativeSelfTests {
    private final class PipeResults: @unchecked Sendable {
        private let lock = NSLock()
        private var lines: [String] = []
        private var failure: String?
        let received = DispatchSemaphore(value: 0), ended = DispatchSemaphore(value: 0)
        func append(_ line: String) { lock.lock(); lines.append(line); lock.unlock(); received.signal() }
        func failed(_ error: Error) { lock.lock(); failure = String(describing: error); lock.unlock() }
        func snapshot() -> ([String], String?) { lock.lock(); defer { lock.unlock() }; return (lines, failure) }
    }
    private final class FakeSlider: SliderAccess {
        var value = 0, writes = 0, reads = 0
        var onRead: (() throws -> Void)?, onWrite: (() throws -> Void)?, beforeWrite: (() throws -> Void)?
        func inspect() throws -> Int { reads += 1; try onRead?(); return value }
        func setValue(_ desired: Int, permit: () throws -> Void) throws {
            try beforeWrite?(); try permit(); writes += 1; value = desired; try onWrite?()
        }
    }
    private static func check(_ condition: @autoclosure () -> Bool, _ reason: String) throws {
        if !condition() { throw NativeFailure.guardFailed("self-test: " + reason) }
    }
    private static func openPipe() throws {
        let pipe = Pipe(), result = PipeResults()
        DispatchQueue.global(qos: .userInitiated).async {
            defer { result.ended.signal() }
            do { try NativeCommandLines.consume(pipe.fileHandleForReading) { result.append($0) } }
            catch { result.failed(error) }
        }
        var ended = false
        defer {
            try? pipe.fileHandleForWriting.close()
            if !ended { _ = result.ended.wait(timeout: .now() + 2) }
            try? pipe.fileHandleForReading.close()
        }
        // The writer remains open for every acknowledgement below. With the old
        // read(upToCount:4096), this first wait fails instead of masking the bug at EOF.
        try pipe.fileHandleForWriting.write(contentsOf: Data("READ\n".utf8))
        try check(result.received.wait(timeout: .now() + 2) == .success, "READ must arrive before pipe EOF")
        try check(result.snapshot().0 == ["READ"], "LF frame")
        try pipe.fileHandleForWriting.write(contentsOf: Data("MO".utf8))
        try pipe.fileHandleForWriting.write(contentsOf: Data("VE 0 512 10000\r\n".utf8))
        try check(result.received.wait(timeout: .now() + 2) == .success, "fragmented CRLF must arrive before EOF")
        try check(result.snapshot().0.last == "MOVE 0 512 10000", "CRLF normalizes without changing command")
        try pipe.fileHandleForWriting.write(contentsOf: Data((String(repeating: "x", count: 130) + "\nREAD\n").utf8))
        try check(result.received.wait(timeout: .now() + 2) == .success, "overflow yields one invalid frame")
        try check(result.received.wait(timeout: .now() + 2) == .success, "reader recovers after overflow")
        try check(result.snapshot().0 == ["READ", "MOVE 0 512 10000", "", "READ"], "bounded overflow preserves next command")
        try pipe.fileHandleForWriting.write(contentsOf: Data("MOVE 0".utf8))
        try pipe.fileHandleForWriting.close()
        ended = result.ended.wait(timeout: .now() + 2) == .success
        try check(ended, "EOF terminates the reader")
        let state = result.snapshot()
        try check(state.0.count == 4 && state.1 == nil, "EOF discards partial frame without error")
    }
    static func run() throws {
        try openPipe()
        let clock: Int64 = 10_000
        for bad in ["", "read", "READ extra", "0 512", "MOVE -1 1 10000", "MOVE 0 1024 10000", "MOVE 0 1 NaN", "MOVE  0 1 10000", "MOVE 0 1 10000\n", String(repeating: "0", count: 129)] {
            try check(Command.parse(bad) == nil, "invalid command rejected: \(bad.prefix(20))")
        }
        let valid = FakeSlider(), session = SliderSession(slider: valid, now: { clock })
        try check(session.handle("READ") == "OK 0", "read")
        try check(session.handle("MOVE 0 512 10000") == "OK 512", "midpoint")
        try check(session.handle("MOVE 512 1023 10000") == "OK 1023", "endpoint does not auto-release")
        valid.value = 0 // Simulate an independently confirmed OBS frontend release.
        try check(session.handle("MOVE 0 0 10000") == "OK 0" && valid.writes == 2, "equal value verifies without setter")
        let external = FakeSlider(); external.value = 9
        let changed = SliderSession(slider: external, now: { clock })
        try check(changed.handle("MOVE 0 512 10000").contains("external movement"), "hand change refuses write")
        external.value = 0
        try check(changed.handle("MOVE 0 512 10000").contains("disarmed") && external.writes == 0, "external mismatch stays latched")
        for timestamp in [9499, 10101] {
            let source = FakeSlider(), stale = SliderSession(slider: source, now: { clock })
            try check(stale.handle("MOVE 0 512 \(timestamp)").contains("stale") && source.reads == 0, "stale/future request has no backend access")
        }
        var movingClock: Int64 = clock
        let slow = FakeSlider(); slow.onRead = { movingClock += 501 }
        let expired = SliderSession(slider: slow, now: { movingClock })
        try check(expired.handle("MOVE 0 512 10000").contains("expired") && slow.writes == 0, "expiry is checked after traversal")
        movingClock = clock
        let late = FakeSlider(); late.beforeWrite = { movingClock += 501 }
        let lateSession = SliderSession(slider: late, now: { movingClock })
        try check(lateSession.handle("MOVE 0 512 10000").contains("expired") && late.writes == 0, "expiry immediately before setter")
        let lostReply = FakeSlider(); lostReply.onWrite = { throw NativeFailure.guardFailed("synthetic reply loss") }
        let uncertain = SliderSession(slider: lostReply, now: { clock })
        try check(uncertain.handle("MOVE 0 512 10000").contains("write unconfirmed"), "uncertain write reported")
        try check(uncertain.handle("MOVE 512 0 10000").contains("disarmed") && lostReply.writes == 1, "uncertain write never retried/reset")
        let mismatch = FakeSlider(); mismatch.onWrite = { mismatch.value = 17 }
        try check(SliderSession(slider: mismatch, now: { clock }).handle("MOVE 0 512 10000").contains("readback mismatch"), "readback mismatch")
        let failedIdentity = FakeSlider(); failedIdentity.onRead = { throw NativeFailure.guardFailed("target identity changed") }
        let replaced = SliderSession(slider: failedIdentity, now: { clock })
        try check(replaced.handle("MOVE 0 512 10000").contains("identity changed") && failedIdentity.writes == 0, "process/window replacement refuses write")
        let observedOwner = try listenerOwners("p54303\nf30\nn*:4455\n", port: 4455)
        let sameOwner = try listenerOwners("p42\nf0\nn127.0.0.1:4455\nf12\nn[::1]:4455\n", port: 4455)
        let twoOwners = try listenerOwners("p42\nf3\nn*:4455\np99\nf4\nn[::1]:4455\n", port: 4455)
        try check(observedOwner == [54303], "observed macOS automatic descriptor field")
        try check(sameOwner == [42], "same PID dual-stack")
        try check(twoOwners == [42, 99], "multiple owners remain ambiguous")
        for invalid in ["", "p42\nf3\nn192.0.2.2:4455\n", "p42\nf3\nn*:4456\n", "n*:4455\n", "p0\nf3\nn*:4455\n",
                        "p42\nn*:4455\n", "f3\nn*:4455\n", "p42\nf-1\nn*:4455\n", "p42\nf+3\nn*:4455\n",
                        "p42\nf3r\nn*:4455\n", "p42\nf2147483648\nn*:4455\n", "p42\nf3\n",
                        "p42\nf3\np99\nf4\nn*:4455\n", "p42\nf3\nf4\nn*:4455\n",
                        "p42\nf3\nn*:4455\nn*:4455\n", "p42\nf3\nn*:4455\ncOBS\n"] {
            do { _ = try listenerOwners(invalid, port: 4455); throw NativeFailure.guardFailed("accepted invalid listener") }
            catch NativeFailure.guardFailed(let reason) { try check(reason != "accepted invalid listener", "listener rejection") }
        }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("fadester-native-lease-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        var first: NativeLease? = try NativeLease(pid: 123, directory: directory)
        try withExtendedLifetime(first) {
            do { _ = try NativeLease(pid: 123, directory: directory); throw NativeFailure.guardFailed("accepted second native owner") }
            catch NativeFailure.guardFailed(let reason) { try check(reason != "accepted second native owner", "single native owner") }
        }
        first = nil
        let next = try NativeLease(pid: 123, directory: directory)
        withExtendedLifetime(next) { }
        print("PASS: open-pipe LF/CRLF/fragmentation/overflow/EOF, synthetic native protocol, freshness, external moves, identity failure, uncertain writes, readback, endpoint/release parking and listener parsing. No AX/OBS/hardware access.")
    }
}

// SPDX-License-Identifier: GPL-2.0-or-later
import AppKit
import Carbon
import Foundation

private let signature: OSType = 0x46445442 // FDTB, local registration identity only.
private func emit(_ line: String) { print(line); fflush(stdout) }

private let hotkeyCallback: EventHandlerUPP = { _, event, context in
    guard let event, let context else { return OSStatus(eventNotHandledErr) }
    let listener = Unmanaged<Listener>.fromOpaque(context).takeUnretainedValue()
    var key = EventHotKeyID(signature: 0, id: 0)
    let result = GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil,
                                   MemoryLayout<EventHotKeyID>.size, nil, &key)
    guard result == noErr, key.signature == signature else { return OSStatus(eventNotHandledErr) }
    listener.pressed(id: key.id, eventTime: GetEventTime(event))
    return noErr
}

private final class Listener: NSObject, NSApplicationDelegate {
    let bindings: [Shortcut]
    private let gate = EventGate()
    private var registrations: [EventHotKeyRef] = []
    private var handler: EventHandlerRef?
    private var closing = false
    init(bindings: [Shortcut]) { self.bindings = bindings }
    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            var type = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
            let status = InstallEventHandler(GetApplicationEventTarget(), hotkeyCallback, 1, &type, Unmanaged.passUnretained(self).toOpaque(), &handler)
            guard status == noErr, handler != nil else { throw InputFailure.invalid("Cannot install shortcut handler (\(status)).") }
            var index: UInt32 = 0
            registrations = try acquireShortcuts(bindings, register: { binding in
                index += 1
                var reference: EventHotKeyRef?
                // CarbonEvents.h: options=0 permits multiple apps to receive the same
                // hotkey. Exclusive registration is required to fail on another owner.
                let result = RegisterEventHotKey(binding.code, binding.modifiers, EventHotKeyID(signature: signature, id: index), GetApplicationEventTarget(), Shortcut.options, &reference)
                guard result == noErr, let reference else {
                    throw InputFailure.invalid("Shortcut collision/unavailable: \(binding.action) (\(binding.label)), OSStatus \(result). All registrations released.")
                }
                return reference
            }, unregister: { _ = UnregisterEventHotKey($0) })
            emit("INPUT_READY \(registrations.count)")
            DispatchQueue.global(qos: .userInitiated).async { [self] in
                do {
                    try readCommandLines { line in
                        var keepReading = true
                        DispatchQueue.main.sync { self.command(line); keepReading = !self.closing }
                        return keepReading
                    }
                } catch { /* EOF/read failure releases registrations. */ }
                DispatchQueue.main.async { self.finish() }
            }
        } catch { emit("ERR \(error)"); finish(exitCode: 1) }
    }
    func pressed(id: UInt32, eventTime: EventTime) {
        guard !closing, id > 0, Int(id) <= bindings.count else { return }
        let now = GetCurrentEventTime(), unix = Int64(Date().timeIntervalSince1970 * 1000)
        if let line = gate.line(action: bindings[Int(id) - 1].action, eventTime: eventTime, uptime: now, unixMs: unix) { emit(line) }
    }
    private func command(_ line: String) {
        guard !closing else { return }
        if line == "DISARM" { gate.disarm(); emit("INPUT_DISARMED"); return }
        if line == "QUIT" { finish(); return }
        let words = line.split(separator: " ", omittingEmptySubsequences: false)
        if words.count == 2, words[0] == "ARM", words[1].utf8.allSatisfy({ $0 >= 48 && $0 <= 57 }), let generation = Int(words[1]) {
            do { try gate.arm(generation, uptime: GetCurrentEventTime()); emit("INPUT_ARMED \(generation)"); return }
            catch { emit("ERR \(error)"); finish(exitCode: 1); return }
        }
        emit("ERR expected ARM generation, DISARM or QUIT"); finish(exitCode: 1)
    }
    private func releaseKeys() {
        gate.disarm()
        registrations.forEach { _ = UnregisterEventHotKey($0) }; registrations.removeAll()
        if let handler { _ = RemoveEventHandler(handler); self.handler = nil }
    }
    private func finish(exitCode: Int32 = 0) {
        guard !closing else { return }; closing = true; releaseKeys()
        if exitCode != 0 { exit(exitCode) }
        NSApplication.shared.terminate(nil)
    }
    func applicationWillTerminate(_ notification: Notification) { releaseKeys() }
}

@main enum Main {
    static func main() {
        let args = Array(CommandLine.arguments.dropFirst())
        if args.isEmpty || args == ["--help"] {
            print("Experimental Fadester Mac shortcuts. --listen MAP explicitly registers the map's chords (Ctrl, Alt and Shift become Control, Option and Shift; never Command), initially disarmed. --self-test --map MAP performs synthetic checks only. No event tap, unrelated-key capture, Accessibility prompt or OBS connection.")
            return
        }
        do {
            if args == ["--self-test-stdio"] {
                // Exercise the production pipe reader only: no AppKit run loop or registrations.
                emit("PIPE_READY")
                try readCommandLines { line in emit("PIPE " + line); return line != "QUIT" }
                return
            }
            if args.count == 3 && args[0] == "--self-test" && args[1] == "--map" { try InputSelfTests.run(map: args[2]); return }
            guard args.count == 2, args[0] == "--listen" else { throw InputFailure.invalid("Invalid arguments; use --help.") }
            let bindings = try ShortcutMap.load(args[1])
            let app = NSApplication.shared, listener = Listener(bindings: bindings)
            app.setActivationPolicy(.prohibited); app.delegate = listener
            withExtendedLifetime(listener) { app.run() }
        } catch { fputs("ERR \(error)\n", stderr); exit(1) }
    }
}

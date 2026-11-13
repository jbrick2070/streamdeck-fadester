// SPDX-License-Identifier: GPL-2.0-or-later
import AppKit
import ApplicationServices
import Foundation

private let obsID = "com.obsproject.obs-studio"
private let sliderID = "OBSApp.OBSBasic.centralwidget.canvasEditor.QWidget.SliderIgnoreScroll"

private func failAX(_ operation: String, _ error: AXError) -> NativeFailure {
    .guardFailed("\(operation): AX error \(error.rawValue)")
}
private func attribute(_ element: AXUIElement, _ name: String) throws -> CFTypeRef {
    var result: CFTypeRef?
    let error = AXUIElementCopyAttributeValue(element, name as CFString, &result)
    guard error == .success, let result else { throw failAX("read \(name)", error) }
    return result
}
private func number(_ element: AXUIElement, _ name: String) throws -> Double {
    let raw = try attribute(element, name)
    let value: Double?
    if let n = raw as? NSNumber { value = n.doubleValue }
    else if let text = raw as? String { value = Double(text.trimmingCharacters(in: .whitespacesAndNewlines)) }
    else { value = nil }
    guard let value, value.isFinite else { throw NativeFailure.guardFailed("invalid \(name)") }
    return value
}
private struct ElementKey: Hashable {
    let element: AXUIElement
    func hash(into hasher: inout Hasher) { hasher.combine(CFHash(element)) }
    static func == (a: ElementKey, b: ElementKey) -> Bool { CFEqual(a.element, b.element) }
}

/// All entry points run serially on the application's main thread.
final class AXSlider: SliderAccess {
    private let pid: pid_t
    private let launched: Date
    private let executable: String
    private let lease: NativeLease
    private var pinnedWindow: AXUIElement?, pinnedSlider: AXUIElement?
    private var lastRead: Int?

    init(pid: Int32, port: Int) throws {
        self.pid = pid
        guard let app = NSRunningApplication(processIdentifier: pid), app.bundleIdentifier == obsID,
              !app.isTerminated, let launched = app.launchDate, let path = app.executableURL?.path,
              let bundleURL = app.bundleURL, let bundle = Bundle(url: bundleURL), bundle.bundleIdentifier == obsID,
              bundle.executableURL?.path == path else { throw NativeFailure.guardFailed("target PID is not a known OBS application instance") }
        self.launched = launched; self.executable = path
        try Self.verifyListener(pid: pid, port: port)
        lease = try NativeLease(pid: pid)
    }

    private static func verifyListener(pid: Int32, port: Int) throws {
        guard pid > 0, (1...65535).contains(port) else { throw NativeFailure.guardFailed("invalid target PID or port") }
        let process = Process(), output = Pipe(), errors = Pipe(), done = DispatchSemaphore(value: 0)
        process.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
        process.arguments = ["-nP", "-iTCP:\(port)", "-sTCP:LISTEN", "-Ffpn"]
        process.standardOutput = output; process.standardError = errors
        process.terminationHandler = { _ in done.signal() }
        try process.run()
        guard done.wait(timeout: .now() + 2) == .success else {
            process.terminate()
            if done.wait(timeout: .now() + 0.3) != .success { kill(process.processIdentifier, SIGKILL) }
            throw NativeFailure.guardFailed("local listener identification timed out")
        }
        guard process.terminationStatus == 0 else { throw NativeFailure.guardFailed("local OBS listener could not be identified") }
        let data = output.fileHandleForReading.readDataToEndOfFile()
        guard data.count <= 65536, let text = String(data: data, encoding: .utf8),
              try listenerOwners(text, port: port) == Set([pid]) else {
            throw NativeFailure.guardFailed("WebSocket port does not belong uniquely to the requested OBS PID")
        }
    }

    private func processIsPinned() throws {
        guard AXIsProcessTrusted() else { throw NativeFailure.guardFailed("Accessibility denied; grant the responsible app through normal macOS controls") }
        guard let app = NSRunningApplication(processIdentifier: pid), !app.isTerminated,
              app.bundleIdentifier == obsID, app.launchDate == launched, app.executableURL?.path == executable else {
            throw NativeFailure.guardFailed("OBS process exited or identity changed")
        }
    }
    private func owned(_ element: AXUIElement) throws {
        var owner: pid_t = 0
        let error = AXUIElementGetPid(element, &owner)
        guard error == .success, owner == pid else { throw failAX("element PID mismatch", error) }
        let timeout = AXUIElementSetMessagingTimeout(element, 0.20)
        guard timeout == .success else { throw failAX("set AX timeout", timeout) }
    }
    private func children(_ element: AXUIElement, _ name: String, limit: Int) throws -> [AXUIElement] {
        var count: CFIndex = 0
        let error = AXUIElementGetAttributeValueCount(element, name as CFString, &count)
        if name == kAXChildrenAttribute && (error == .attributeUnsupported || error == .noValue) { return [] }
        guard error == .success else { throw failAX("count \(name)", error) }
        guard count >= 0 && count <= limit else { throw NativeFailure.guardFailed("incomplete AX traversal: child/node limit") }
        if count == 0 { return [] }
        var values: CFArray?
        let read = AXUIElementCopyAttributeValues(element, name as CFString, 0, count, &values)
        guard read == .success, let result = values as? [AXUIElement], result.count == count else { throw failAX("read \(name)", read) }
        return result
    }
    private func validate(_ slider: AXUIElement, window: AXUIElement) throws -> Int {
        try owned(slider); try owned(window)
        guard try attribute(slider, kAXRoleAttribute) as? String == kAXSliderRole,
              try attribute(slider, kAXIdentifierAttribute) as? String == sliderID,
              try attribute(slider, kAXEnabledAttribute) as? Bool == true,
              try number(slider, kAXMinValueAttribute) == 0, try number(slider, kAXMaxValueAttribute) == 1023,
              CFEqual(try attribute(slider, kAXWindowAttribute), window) else {
            throw NativeFailure.guardFailed("native slider identity, window, range or enabled state changed")
        }
        var writable = DarwinBoolean(false)
        let error = AXUIElementIsAttributeSettable(slider, kAXValueAttribute as CFString, &writable)
        guard error == .success, writable.boolValue else { throw failAX("AXValue not settable", error) }
        let value = try number(slider, kAXValueAttribute)
        guard (0...1023).contains(value), value.rounded() == value else { throw NativeFailure.guardFailed("invalid native slider value") }
        return Int(value)
    }
    func inspect() throws -> Int {
        try processIsPinned()
        let app = AXUIElementCreateApplication(pid); try owned(app)
        let windows = try children(app, kAXWindowsAttribute, limit: 16)
        if let pinnedWindow, let pinnedSlider, windows.contains(where: { CFEqual($0, pinnedWindow) }) {
            if let value = try? validate(pinnedSlider, window: pinnedWindow) {
                try processIsPinned()
                lastRead = value
                return value
            }
            // OBS rebuilds the Studio Mode slider when Studio Mode is toggled off and on.
            self.pinnedWindow = nil; self.pinnedSlider = nil; self.lastRead = nil
        }
        var candidateWindows: [AXUIElement] = []
        for candidate in windows {
            try owned(candidate)
            if (try? attribute(candidate, kAXRoleAttribute) as? String) == kAXWindowRole {
                candidateWindows.append(candidate)
            }
        }
        guard !candidateWindows.isEmpty else { throw NativeFailure.guardFailed("invalid OBS root window") }
        let start = ProcessInfo.processInfo.systemUptime
        var found: [(AXUIElement, AXUIElement)] = []
        var seen = Set<ElementKey>()
        for window in candidateWindows {
            var queue: [(AXUIElement, Int)] = [(window, 0)], index = 0
            while index < queue.count {
                guard ProcessInfo.processInfo.systemUptime - start < 1.5 else { throw NativeFailure.guardFailed("incomplete AX traversal: deadline") }
                let (element, depth) = queue[index]; index += 1
                guard seen.insert(ElementKey(element: element)).inserted else { continue }
                try owned(element)
                if (try? attribute(element, kAXRoleAttribute) as? String) == kAXSliderRole,
                   (try? attribute(element, kAXIdentifierAttribute) as? String) == sliderID {
                    found.append((element, window))
                }
                let room = 3000 - seen.count - (queue.count - index)
                guard room > 0 else { throw NativeFailure.guardFailed("incomplete AX traversal: child/node limit") }
                let descendants = try children(element, kAXChildrenAttribute, limit: min(128, room))
                guard depth < 30 || descendants.isEmpty else { throw NativeFailure.guardFailed("incomplete AX traversal: depth") }
                queue.append(contentsOf: descendants.map { ($0, depth + 1) })
            }
        }
        guard found.count == 1 else { throw NativeFailure.guardFailed("expected exactly one native OBS T-bar") }
        let (slider, window) = found[0]
        let value = try validate(slider, window: window)
        try processIsPinned()
        pinnedWindow = window; pinnedSlider = slider; lastRead = value
        return value
    }
    func setValue(_ desired: Int, permit: () throws -> Void) throws {
        guard (0...1023).contains(desired), let slider = pinnedSlider, let window = pinnedWindow, let expected = lastRead else {
            throw NativeFailure.guardFailed("write requires a pinned, inspected slider")
        }
        try processIsPinned()
        // Narrow the AX read/write race; AX offers no atomic compare-and-swap.
        guard try validate(slider, window: window) == expected else { throw NativeFailure.guardFailed("native slider moved immediately before write") }
        try permit()
        let error = AXUIElementSetAttributeValue(slider, kAXValueAttribute as CFString, NSNumber(value: desired))
        guard error == .success else { throw failAX("set AXValue", error) }
    }
}

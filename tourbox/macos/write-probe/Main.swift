// SPDX-License-Identifier: GPL-2.0-or-later
import AppKit
import ApplicationServices
import Foundation

private let probeID = "io.github.jbrick2070.fadester-tourbox.native-write-probe"
private let obsID = "com.obsproject.obs-studio"
private let sliderID = "OBSApp.OBSBasic.centralwidget.canvasEditor.QWidget.SliderIgnoreScroll"

private enum Failure: Error, CustomStringConvertible {
    case guardFailed(String)
    case ax(String, AXError)
    var description: String {
        switch self {
        case .guardFailed(let reason): return reason
        case .ax(let operation, let code): return "\(operation): AX error \(code.rawValue)"
        }
    }
}

private func attribute(_ element: AXUIElement, _ name: String) throws -> CFTypeRef {
    var value: CFTypeRef?
    let error = AXUIElementCopyAttributeValue(element, name as CFString, &value)
    guard error == .success, let value else { throw Failure.ax("Read \(name)", error) }
    return value
}

private func number(_ element: AXUIElement, _ name: String) throws -> Double {
    let value = try attribute(element, name)
    let result: Double?
    if let n = value as? NSNumber { result = n.doubleValue }
    else if let s = value as? String { result = Double(s.trimmingCharacters(in: .whitespacesAndNewlines)) }
    else { result = nil }
    guard let result, result.isFinite else { throw Failure.guardFailed("\(name) is not a finite number.") }
    return result
}

private func owned(_ element: AXUIElement, pid: pid_t) throws {
    var actual: pid_t = 0
    let error = AXUIElementGetPid(element, &actual)
    guard error == .success else { throw Failure.ax("Read element PID", error) }
    guard actual == pid else { throw Failure.guardFailed("Accessibility element belongs to a different process.") }
    let timeout = AXUIElementSetMessagingTimeout(element, 0.25)
    guard timeout == .success else { throw Failure.ax("Set messaging timeout", timeout) }
}

private func childElements(_ element: AXUIElement, attribute name: String, limit: Int) throws -> [AXUIElement] {
    var count: CFIndex = 0
    let error = AXUIElementGetAttributeValueCount(element, name as CFString, &count)
    if name == kAXChildrenAttribute && (error == .attributeUnsupported || error == .noValue) { return [] }
    guard error == .success else { throw Failure.ax("Count \(name)", error) }
    guard count >= 0 && count <= limit else { throw Failure.guardFailed("Accessibility traversal limit reached; uniqueness is unproven.") }
    if count == 0 { return [] }
    var result: CFArray?
    let read = AXUIElementCopyAttributeValues(element, name as CFString, 0, count, &result)
    guard read == .success, let values = result as? [AXUIElement], values.count == count else {
        throw Failure.ax("Read complete \(name)", read)
    }
    return values
}

private struct ElementKey: Hashable {
    let value: AXUIElement
    func hash(into hasher: inout Hasher) { hasher.combine(CFHash(value)) }
    static func == (a: ElementKey, b: ElementKey) -> Bool { CFEqual(a.value, b.value) }
}

private struct Target {
    let pid: pid_t
    let executable: String
    let launched: Date
    let window: AXUIElement
    let slider: AXUIElement
    let value: Double
    func matches(_ other: Target) -> Bool {
        pid == other.pid && executable == other.executable && launched == other.launched &&
            CFEqual(window, other.window) && CFEqual(slider, other.slider)
    }
    var metadata: [String: Any] {
        ["pid": Int(pid), "bundleIdentifier": obsID, "executablePath": executable,
         "launchDate": ISO8601DateFormatter().string(from: launched), "sliderIdentifier": sliderID,
         "value": value, "minimum": 0, "maximum": 1023, "enabled": true, "settable": true]
    }
}

private func inspectTarget() throws -> Target {
    guard AXIsProcessTrusted() else { throw Failure.guardFailed("Accessibility is not granted to this separate write-probe app.") }
    let apps = NSRunningApplication.runningApplications(withBundleIdentifier: obsID)
    guard apps.count == 1, let app = apps.first, !app.isTerminated,
          let executable = app.executableURL?.path, let launched = app.launchDate else {
        throw Failure.guardFailed("Exactly one running OBS process with a known launch identity is required.")
    }
    let pid = app.processIdentifier
    let application = AXUIElementCreateApplication(pid)
    try owned(application, pid: pid)
    let windows = try childElements(application, attribute: kAXWindowsAttribute, limit: 16)
    guard windows.count == 1 else { throw Failure.guardFailed("Exactly one OBS window is required; close OBS dialogs before inspecting.") }
    let window = windows[0]
    try owned(window, pid: pid)
    guard try attribute(window, kAXRoleAttribute) as? String == kAXWindowRole else {
        throw Failure.guardFailed("OBS root is not an AXWindow.")
    }
    let began = ProcessInfo.processInfo.systemUptime
    var queue: [(AXUIElement, Int)] = [(window, 0)], index = 0
    var seen = Set<ElementKey>(), matches: [AXUIElement] = []
    while index < queue.count {
        guard ProcessInfo.processInfo.systemUptime - began < 8 else { throw Failure.guardFailed("Inspection exceeded eight seconds; uniqueness is unproven.") }
        let (element, depth) = queue[index]; index += 1
        guard seen.insert(ElementKey(value: element)).inserted else { continue }
        try owned(element, pid: pid)
        let role = try attribute(element, kAXRoleAttribute) as? String
        if role == kAXSliderRole {
            // A slider without readable identity is not safe to ignore for uniqueness.
            let identifier = try attribute(element, kAXIdentifierAttribute) as? String
            if identifier == sliderID { matches.append(element) }
        }
        let children = try childElements(element, attribute: kAXChildrenAttribute, limit: min(128, 3000 - queue.count))
        guard depth < 30 || children.isEmpty else { throw Failure.guardFailed("Inspection exceeded depth limit; uniqueness is unproven.") }
        queue.append(contentsOf: children.map { ($0, depth + 1) })
    }
    guard matches.count == 1 else { throw Failure.guardFailed("Exactly one slider with the full expected identifier is required.") }
    let slider = matches[0]
    guard try number(slider, kAXMinValueAttribute) == 0, try number(slider, kAXMaxValueAttribute) == 1023,
          try attribute(slider, kAXEnabledAttribute) as? Bool == true else {
        throw Failure.guardFailed("Expected an enabled native T-bar with exact range 0..1023.")
    }
    var settable = DarwinBoolean(false)
    let writable = AXUIElementIsAttributeSettable(slider, kAXValueAttribute as CFString, &settable)
    guard writable == .success, settable.boolValue else { throw Failure.ax("AXValue must be settable", writable) }
    let ownerWindow = try attribute(slider, kAXWindowAttribute)
    guard CFEqual(ownerWindow, window) else { throw Failure.guardFailed("Slider does not report the inspected OBS window as its owner.") }
    let value = try number(slider, kAXValueAttribute)
    guard (0...1023).contains(value), value.rounded() == value else { throw Failure.guardFailed("Slider value must be an integer from 0 through 1023.") }
    return Target(pid: pid, executable: executable, launched: launched, window: window, slider: slider, value: value)
}

private func saveReport(_ event: [String: Any]) throws -> String {
    let base = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    let directory = base.appendingPathComponent("FadesterTourBox/NativeSliderWriteProbe", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    let path = directory.appendingPathComponent("latest.json")
    let data = try JSONSerialization.data(withJSONObject: event, options: [.prettyPrinted, .sortedKeys])
    try data.write(to: path, options: .atomic)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path.path)
    let history = directory.appendingPathComponent("history.jsonl")
    if !FileManager.default.fileExists(atPath: history.path) {
        guard FileManager.default.createFile(atPath: history.path, contents: nil, attributes: [.posixPermissions: 0o600]) else {
            throw Failure.guardFailed("Could not create the private report history.")
        }
    }
    let line = try JSONSerialization.data(withJSONObject: event, options: [.sortedKeys])
    let file = try FileHandle(forWritingTo: history)
    defer { try? file.close() }
    try file.seekToEnd(); try file.write(contentsOf: line); try file.write(contentsOf: Data([10])); try file.synchronize()
    return String(decoding: data, as: UTF8.self)
}

private final class Engine {
    private var pinned: Target?
    private var expected: Double?
    func perform(_ action: String) -> (String, Bool, Bool) {
        var report: [String: Any] = ["schemaVersion": 1, "createdAt": ISO8601DateFormatter().string(from: Date()),
            "probeBundleIdentifier": probeID, "action": action, "accessibilityTrusted": AXIsProcessTrusted(), "writeAttempted": false]
        do {
            if action == "inspect" {
                pinned = nil; expected = nil
                let target = try inspectTarget(); report["target"] = target.metadata
                guard target.value == 0 else { throw Failure.guardFailed("Inspection is read-only. Set the native OBS slider to zero yourself before arming.") }
                pinned = target; expected = 0
                report["result"] = "Armed at zero. Only the Set 512 button can attempt a write."
            } else {
                let before: Double = action == "half" ? 0 : 512
                let desired: Double = action == "half" ? 512 : 0
                guard action == "half" || action == "zero", let original = pinned, expected == before else {
                    throw Failure.guardFailed("No matching armed write sequence. Inspect at zero first.")
                }
                // Never replay after a failed call, mismatch, process restart or UI recreation.
                expected = nil
                let fresh = try inspectTarget(); report["target"] = fresh.metadata
                guard fresh.matches(original), fresh.value == before else { throw Failure.guardFailed("OBS identity, window, slider or expected starting value changed; no write sent.") }
                report["expectedValue"] = before; report["desiredValue"] = desired
                report["result"] = "Validated write intent."
                _ = try saveReport(report) // A failed audit write prevents the control write.
                // Final read narrows (but cannot eliminate) the AX read/write race.
                guard try number(fresh.slider, kAXValueAttribute) == before else { throw Failure.guardFailed("Slider changed immediately before the write; no write sent.") }
                let error = AXUIElementSetAttributeValue(fresh.slider, kAXValueAttribute as CFString, NSNumber(value: desired))
                report["writeAttempted"] = true; report["writeAXError"] = error.rawValue
                do { report["readback"] = try number(fresh.slider, kAXValueAttribute) }
                catch { report["readbackError"] = String(describing: error) }
                guard error == .success else { throw Failure.ax("Set AXValue (not retried)", error) }
                guard let actual = report["readback"] as? Double, actual == desired else {
                    throw Failure.guardFailed("Native value did not read back as requested. No retry or automatic reset will be sent.")
                }
                let confirmed = try inspectTarget()
                guard confirmed.matches(original), confirmed.value == desired else { throw Failure.guardFailed("Post-write identity or value changed; further writes are disarmed.") }
                if desired == 512 { expected = 512 }
                else { pinned = nil }
                report["result"] = desired == 512 ? "AXValue reads 512. Observe the actual OBS handle and renderer, then explicitly Reset 0." :
                    "AXValue reads 0. No endpoint release or OBS WebSocket request was issued. Inspect again for a new sequence."
            }
        } catch {
            expected = nil
            report["error"] = String(describing: error)
            report["result"] = "Disarmed. No retry or automatic cleanup write. If OBS moved, reset it with its own controls."
        }
        do { return (try saveReport(report), expected == 0, expected == 512) }
        catch { expected = nil; return ("Report save failed; further writes disarmed: \(error)", false, false) }
    }
}

private final class Delegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    private var output: NSTextView!
    private var buttons: [NSButton] = []
    private let engine = Engine()
    private let work = DispatchQueue(label: "FadesterNativeWriteProbe.serial")

    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 850, height: 650), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Fadester Native Write Probe — Development Only"
        window.minSize = NSSize(width: 760, height: 500); window.center()
        let intro = NSTextField(wrappingLabelWithString: "Explicit OBS write proof. Use only the disposable, idle OBS fixture with Studio Mode and the native T-bar at zero. This separate app needs its own Accessibility grant. Inspect only arms a unique current target. Set 512 and Reset 0 each send one AXValue write after full revalidation. No release, retry, automatic reset, keyboard input or WebSocket command is sent. Closing this app does not reset OBS.")
        let request = NSButton(title: "Request Accessibility…", target: self, action: #selector(permission))
        let inspect = NSButton(title: "1. Inspect / arm at 0", target: self, action: #selector(inspect))
        let half = NSButton(title: "2. Set 512", target: self, action: #selector(half))
        let zero = NSButton(title: "3. Reset 0", target: self, action: #selector(zero))
        buttons = [request, inspect, half, zero]; half.isEnabled = false; zero.isEnabled = false
        let controls = NSStackView(views: buttons); controls.orientation = .horizontal; controls.spacing = 12
        let path = NSTextField(wrappingLabelWithString: "Reports: ~/Library/Application Support/FadesterTourBox/NativeSliderWriteProbe/{latest.json,history.jsonl}")
        let scroll = NSScrollView(); scroll.hasVerticalScroller = true; scroll.borderType = .bezelBorder
        output = NSTextView(); output.isEditable = false; output.isSelectable = true
        output.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .regular)
        output.autoresizingMask = [.width]; output.textContainer?.widthTracksTextView = true; scroll.documentView = output
        output.string = "Accessibility: \(AXIsProcessTrusted() ? "granted" : "not granted"). No OBS inspection or write has run."
        let stack = NSStackView(views: [intro, controls, path, scroll]); stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false; window.contentView!.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor, constant: -20),
            stack.topAnchor.constraint(equalTo: window.contentView!.topAnchor, constant: 20),
            stack.bottomAnchor.constraint(equalTo: window.contentView!.bottomAnchor, constant: -20),
            intro.widthAnchor.constraint(equalTo: stack.widthAnchor), path.widthAnchor.constraint(equalTo: stack.widthAnchor),
            scroll.widthAnchor.constraint(equalTo: stack.widthAnchor), scroll.heightAnchor.constraint(greaterThanOrEqualToConstant: 280)])
        window.makeKeyAndOrderFront(nil)
    }
    @objc private func permission() {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(options)
        output.string = "Use macOS to grant this separate app permission yourself, then Inspect. No OBS read or write was performed."
    }
    private func perform(_ action: String) {
        buttons.forEach { $0.isEnabled = false }; output.string = "Validating OBS target…"
        work.async { [weak self] in
            guard let self else { return }
            let (report, half, zero) = self.engine.perform(action)
            DispatchQueue.main.async {
                self.output.string = report
                self.buttons[0].isEnabled = true; self.buttons[1].isEnabled = true
                self.buttons[2].isEnabled = half; self.buttons[3].isEnabled = zero
            }
        }
    }
    @objc private func inspect() { perform("inspect") }
    @objc private func half() { perform("half") }
    @objc private func zero() { perform("zero") }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

guard CommandLine.arguments.count == 1 else {
    fputs("Development GUI only. There is no command-line write mode.\n", stderr); exit(2)
}
let app = NSApplication.shared
private let delegate = Delegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()

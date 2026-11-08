// SPDX-License-Identifier: GPL-2.0-or-later
import AppKit
import ApplicationServices
import Foundation

private let probeID = "io.github.jbrick2070.fadester-tourbox.native-probe"
private let obsID = "com.obsproject.obs-studio"

private func trusted() -> Bool { AXIsProcessTrusted() }

private func readAttribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var result: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name as CFString, &result) == .success ? result : nil
}

private func textAttribute(_ element: AXUIElement, _ name: String) -> String? {
    guard let value = readAttribute(element, name) as? String else { return nil }
    return String(value.prefix(512))
}

// Qt's Cocoa accessibility provider can return min/max as strings rather than numbers.
private func numberAttribute(_ element: AXUIElement, _ name: String) -> Double? {
    let value = readAttribute(element, name)
    let result: Double?
    if let number = value as? NSNumber { result = number.doubleValue }
    else if let string = value as? String { result = Double(string.trimmingCharacters(in: .whitespacesAndNewlines)) }
    else { result = nil }
    return result?.isFinite == true ? result : nil
}

private func children(_ element: AXUIElement, _ attribute: String, remaining: Int) -> [AXUIElement] {
    guard remaining > 0 else { return [] }
    var count: CFIndex = 0
    guard AXUIElementGetAttributeValueCount(element, attribute as CFString, &count) == .success else { return [] }
    var result: CFArray?
    let amount = min(count, min(remaining, 128))
    guard amount > 0, AXUIElementCopyAttributeValues(element, attribute as CFString, 0, amount, &result) == .success else { return [] }
    return result as? [AXUIElement] ?? []
}

private func inspectOBS(_ app: NSRunningApplication) -> [String: Any] {
    let pid = app.processIdentifier
    let application = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(application, 0.25)
    let started = ProcessInfo.processInfo.systemUptime
    let nodeLimit = 3000, depthLimit = 30, timeLimit = 8.0
    var queue = children(application, kAXWindowsAttribute, remaining: 32).map { ($0, 0) }
    var seen = Set<CFHashCode>(), index = 0, visited = 0
    var sliders: [[String: Any]] = []
    var stopReason = "completed"
    while index < queue.count {
        if visited >= nodeLimit { stopReason = "node limit"; break }
        if ProcessInfo.processInfo.systemUptime - started >= timeLimit { stopReason = "time limit"; break }
        let (element, depth) = queue[index]
        index += 1
        guard seen.insert(CFHash(element)).inserted else { continue }
        var owner: pid_t = 0
        guard AXUIElementGetPid(element, &owner) == .success, owner == pid else { continue }
        AXUIElementSetMessagingTimeout(element, 0.25)
        visited += 1
        if textAttribute(element, kAXRoleAttribute) == kAXSliderRole {
            var settable = DarwinBoolean(false)
            let settableError = AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &settable)
            sliders.append([
                "identifier": textAttribute(element, kAXIdentifierAttribute) as Any? ?? NSNull(),
                "role": kAXSliderRole,
                "subrole": textAttribute(element, kAXSubroleAttribute) as Any? ?? NSNull(),
                "value": numberAttribute(element, kAXValueAttribute) as Any? ?? NSNull(),
                "minimum": numberAttribute(element, kAXMinValueAttribute) as Any? ?? NSNull(),
                "maximum": numberAttribute(element, kAXMaxValueAttribute) as Any? ?? NSNull(),
                "enabled": (readAttribute(element, kAXEnabledAttribute) as? Bool) as Any? ?? NSNull(),
                "valueSettable": settableError == .success ? settable.boolValue : false,
                "settableAXError": settableError.rawValue,
                "depth": depth
            ])
        }
        if depth < depthLimit {
            let room = nodeLimit - queue.count
            queue.append(contentsOf: children(element, kAXChildrenAttribute, remaining: room).map { ($0, depth + 1) })
        }
    }
    if queue.count >= nodeLimit && stopReason == "completed" { stopReason = "queue limit" }
    return [
        "pid": Int(pid), "bundleIdentifier": obsID,
        "bundlePath": app.bundleURL?.path as Any? ?? NSNull(),
        "visitedNodes": visited, "elapsedSeconds": ProcessInfo.processInfo.systemUptime - started,
        "stopReason": stopReason, "sliders": sliders,
        "limits": ["nodes": nodeLimit, "depth": depthLimit, "seconds": timeLimit, "childrenPerNode": 128] as [String: Any]
    ]
}

private func reportLocation() throws -> URL {
    let base = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    let folder = base.appendingPathComponent("FadesterTourBox/NativeSliderProbe", isDirectory: true)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    return folder.appendingPathComponent("latest.json")
}

private func makeReport() -> [String: Any] {
    let hasPermission = trusted()
    // No system-wide AX element, frontmost-app lookup, or other application tree.
    let apps = NSRunningApplication.runningApplications(withBundleIdentifier: obsID)
    return [
        "schemaVersion": 1, "createdAt": ISO8601DateFormatter().string(from: Date()),
        "probeBundleIdentifier": probeID, "os": ProcessInfo.processInfo.operatingSystemVersionString,
        "accessibilityTrusted": hasPermission, "readOnly": true,
        "obsProcessCount": apps.count, "processLimit": 4,
        "note": hasPermission ? "Only OBS slider metadata was read. No control values were written." : "Accessibility is not granted. No OBS AX tree was read. Grant it manually, then inspect again.",
        "processes": hasPermission ? apps.prefix(4).map(inspectOBS) : []
    ]
}

private final class ProbeDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    private var status: NSTextField!
    private var output: NSTextView!
    private var inspectButton: NSButton!

    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 800, height: 620),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Fadester OBS Native Slider — Read-only Probe"
        window.minSize = NSSize(width: 620, height: 430)
        window.center()
        let introduction = NSTextField(wrappingLabelWithString:
            "Development probe: inspect OBS sliders without changing them. Request Accessibility only if needed, grant permission yourself in macOS, then click Inspect OBS. This does not grant permissions, launch OBS, move its controls, or test hardware.")
        status = NSTextField(wrappingLabelWithString: trustDescription())
        let request = NSButton(title: "Request Accessibility…", target: self, action: #selector(requestPermission))
        inspectButton = NSButton(title: "Inspect OBS", target: self, action: #selector(inspect))
        let controls = NSStackView(views: [request, inspectButton])
        controls.orientation = .horizontal
        controls.spacing = 12
        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true
        scroll.borderType = .bezelBorder
        output = NSTextView()
        output.isEditable = false
        output.isSelectable = true
        output.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .regular)
        output.autoresizingMask = [.width]
        output.textContainer?.widthTracksTextView = true
        scroll.documentView = output
        let stack = NSStackView(views: [introduction, controls, status, scroll])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false
        let content = window.contentView!
        content.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -20),
            stack.topAnchor.constraint(equalTo: content.topAnchor, constant: 20),
            stack.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -20),
            introduction.widthAnchor.constraint(equalTo: stack.widthAnchor),
            status.widthAnchor.constraint(equalTo: stack.widthAnchor),
            scroll.widthAnchor.constraint(equalTo: stack.widthAnchor),
            scroll.heightAnchor.constraint(greaterThanOrEqualToConstant: 220)
        ])
        window.makeKeyAndOrderFront(nil)
    }

    private func trustDescription() -> String {
        "Accessibility: \(trusted() ? "granted" : "not granted"). Reports: ~/Library/Application Support/FadesterTourBox/NativeSliderProbe/latest.json"
    }

    @objc private func requestPermission() {
        // The supported system prompt is the only permission action. There is no
        // TCC database access, settings automation, or automatic consent.
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(options)
        status.stringValue = trustDescription() + " If prompted, complete the macOS permission step manually."
    }

    @objc private func inspect() {
        inspectButton.isEnabled = false
        status.stringValue = "Inspecting only OBS processes; each traversal is bounded."
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let report = makeReport()
            let result: String
            do {
                let data = try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
                let location = try reportLocation()
                try data.write(to: location, options: .atomic)
                try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: location.path)
                result = String(decoding: data, as: UTF8.self)
            } catch { result = "Could not save the probe report: \(error.localizedDescription)" }
            DispatchQueue.main.async {
                guard let self else { return }
                self.output.string = result
                self.status.stringValue = self.trustDescription()
                self.inspectButton.isEnabled = true
            }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

if CommandLine.arguments.dropFirst().elementsEqual(["--trust-status"]) {
    // SSH/build verification only. No window, prompt, report write, or OBS AX read.
    let value: [String: Any] = ["probeBundleIdentifier": probeID, "accessibilityTrusted": trusted(), "readOnly": true]
    let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    print(String(decoding: data, as: UTF8.self))
} else if CommandLine.arguments.count != 1 {
    fputs("Use the .app normally, or --trust-status for a prompt-free permission check.\n", stderr)
    exit(2)
} else {
    let application = NSApplication.shared
    let delegate = ProbeDelegate()
    application.delegate = delegate
    application.setActivationPolicy(.regular)
    application.run()
}

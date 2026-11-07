// SPDX-License-Identifier: GPL-2.0-or-later
import AppKit
import ApplicationServices
import Foundation

private let bundleID = "io.github.jbrick2070.fadester-tourbox.native-slider.experimental"

private final class PermissionWindow: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    private var state: NSTextField!
    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 640, height: 240), styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "Fadester Native Slider — Experimental Component"; window.center()
        let intro = NSTextField(wrappingLabelWithString: "This development component lets a future Fadester Mac host move OBS's real T-bar. This window does not inspect or control OBS. Permission is granted only through macOS, never automatically. The existing read-only and write probes are separate apps and remain unchanged.")
        state = NSTextField(wrappingLabelWithString: status())
        let request = NSButton(title: "Request Accessibility…", target: self, action: #selector(request))
        let refresh = NSButton(title: "Check Permission", target: self, action: #selector(check))
        let row = NSStackView(views: [request, refresh]); row.orientation = .horizontal; row.spacing = 12
        let stack = NSStackView(views: [intro, row, state]); stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 18
        stack.translatesAutoresizingMaskIntoConstraints = false; window.contentView!.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor, constant: -20),
            stack.topAnchor.constraint(equalTo: window.contentView!.topAnchor, constant: 20),
            intro.widthAnchor.constraint(equalTo: stack.widthAnchor), state.widthAnchor.constraint(equalTo: stack.widthAnchor)])
        window.makeKeyAndOrderFront(nil)
    }
    private func status() -> String { "Accessibility: \(AXIsProcessTrusted() ? "granted for this launch" : "not granted"). Bundle: \(bundleID)" }
    @objc private func request() {
        _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
        state.stringValue = status() + " Complete any permission step yourself."
    }
    @objc private func check() { state.stringValue = status() }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

private final class PipeDelegate: NSObject, NSApplicationDelegate {
    private let pid: Int32, port: Int
    private var session: SliderSession?
    private var initializationFailure: String?
    init(pid: Int32, port: Int) { self.pid = pid; self.port = port }
    private func reply(_ line: String) {
        // Lazily bind after the first valid command, then pin any initialization failure.
        if Command.parse(line) == nil { print("ERR syntax: READ or MOVE expected desired unixMs"); fflush(stdout); return }
        if session == nil && initializationFailure == nil {
            do { session = SliderSession(slider: try AXSlider(pid: pid, port: port)) }
            catch { initializationFailure = String(describing: error).replacingOccurrences(of: "\n", with: " ") }
        }
        print(session?.handle(line) ?? "ERR initialization: \(initializationFailure ?? "unavailable")")
        fflush(stdout)
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        DispatchQueue.global(qos: .userInitiated).async { [self] in
            do {
                try NativeCommandLines.consume(FileHandle.standardInput) { line in
                    DispatchQueue.main.sync { self.reply(line) }
                }
            } catch { /* Lost transport ends ownership; never reset a visible bar on exit. */ }
            DispatchQueue.main.async { NSApplication.shared.terminate(nil) }
        }
    }
}

@main enum Main {
    static func main() {
        let args = Array(CommandLine.arguments.dropFirst())
        if args == ["--self-test"] {
            do { try NativeSelfTests.run() } catch { fputs("\(error)\n", stderr); exit(1) }
            return
        }
        if args == ["--help"] {
            print("Experimental Fadester Native Slider: open the app for a manual permission window, or --stdio --obs-pid PID --obs-port PORT for the private protocol. --self-test uses only synthetic state. No automatic permission, release, reset or retry.")
            return
        }
        let app = NSApplication.shared
        let delegate: NSApplicationDelegate
        if args.isEmpty { delegate = PermissionWindow(); app.setActivationPolicy(.regular) }
        else if args.count == 5, args[0] == "--stdio", args[1] == "--obs-pid", let pid = Int32(args[2]), pid > 0,
                args[3] == "--obs-port", let port = Int(args[4]), (1...65535).contains(port) {
            delegate = PipeDelegate(pid: pid, port: port); app.setActivationPolicy(.prohibited)
        } else { fputs("Invalid arguments; use --help. No OBS access attempted.\n", stderr); exit(2) }
        app.delegate = delegate
        withExtendedLifetime(delegate) { app.run() }
    }
}

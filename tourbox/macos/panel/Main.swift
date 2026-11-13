// SPDX-License-Identifier: GPL-2.0-or-later
import AppKit

@MainActor enum LifecycleTests {
    static func run(executable: URL) async throws {
        try await exercise(executable: executable, password: "token-test-only", fastFailure: false)
        try await exercise(executable: executable, password: "1", fastFailure: false)
        try await exercise(executable: executable, password: "token-test-only", fastFailure: true)
        print("PASS: owned child READY/open-pipe quit, numeric-password control frames, log redaction and immediate startup-failure output. No actual host, OBS, helpers or GUI.")
    }
    private static func exercise(executable: URL, password: String, fastFailure: Bool) async throws {
        let host = HostController()
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            var finished = false, armed = false, redacted = false
            func complete(_ result: Result<Void, Error>) {
                guard !finished else { return }; finished = true; continuation.resume(with: result)
            }
            let original = fastFailure ? "ERROR: synthetic startup failure token-test-only" : "Test token-test-only"
            host.line = { text in if text == redact(original, secret: password) { redacted = true } }
            host.changed = { text, _ in
                if text.hasPrefix("Connected") { armed = true; host.stop() }
            }
            host.exited = {
                complete((fastFailure ? !armed : armed) && redacted ? .success(()) : .failure(PanelFailure.message("Host lifecycle test lost status or final redacted output.")))
            }
            do { try host.launch(executable: executable, arguments: [fastFailure ? "--self-test-host-fail-child" : "--self-test-host-child"], password: password) }
            catch { complete(.failure(error)) }
            DispatchQueue.main.asyncAfter(deadline: .now() + 10) {
                guard !finished else { return }; host.stop(); complete(.failure(PanelFailure.message("Host lifecycle test timed out.")))
            }
        }
    }
}

@main @MainActor enum Main {
    static func main() {
        let args = Array(CommandLine.arguments.dropFirst())
        if args == ["--self-test-host-fail-child"] { print("ERROR: synthetic startup failure token-test-only"); fflush(stdout); exit(1) }
        if args == ["--self-test-host-child"] {
            print("Test token-test-only"); print("READY 1"); fflush(stdout)
            while let line = readLine() { if line == "quit" { print("STOPPED"); fflush(stdout); return } }
            return
        }
        if args == ["--self-test"] {
            Task {
                do {
                    try ModelTests.run()
                    try await LifecycleTests.run(executable: URL(fileURLWithPath: CommandLine.arguments[0]))
                    exit(0)
                } catch { fputs("\(error)\n", stderr); exit(1) }
            }
            dispatchMain()
        }
        if args.count == 2 && args[0] == "--self-test-discovery", let port = Int(args[1]) {
            Task {
                do {
                    guard let secret = ProcessInfo.processInfo.environment["FADESTER_TEST_PASSWORD"], !secret.isEmpty else { throw PanelFailure.message("Synthetic discovery test password missing.") }
                    let client = try ObsDiscovery(port: port), catalog = try await client.scan(password: secret)
                    guard catalog.scenes == ["Opening", "Guest"], catalog.audio == ["Music • 音楽"], catalog.media == ["Clips"], catalog.items["Guest"] == ["Lower third"], catalog.program == "Opening", catalog.preview == "Guest", catalog.studio else { throw PanelFailure.message("Synthetic catalog did not match expected roles.") }
                    print("PASS: authenticated read-only WebSocket discovery, non-audio rejection, media NONE handling and Unicode names against the fake server."); exit(0)
                } catch { fputs("Synthetic discovery check failed.\n", stderr); exit(1) }
            }
            dispatchMain()
        }
        if (args.count == 3 || args.count == 4) && args[0] == "--render-preview" {
            let app = NSApplication.shared; app.setActivationPolicy(.prohibited); app.appearance = NSAppearance(named: .aqua)
            do {
                try Panel(preview: true).render(to: URL(fileURLWithPath: args[1]))
                try Panel(preview: true).render(to: URL(fileURLWithPath: args[2]), tab: 1)
                if args.count == 4 { try Panel(preview: true).render(to: URL(fileURLWithPath: args[3]), tab: 2) }
                print("Rendered offline Fadester Companion previews using synthetic names. No window shown, settings read or OBS connection.")
            } catch { fputs("Preview rendering failed: \(error)\n", stderr); exit(1) }
            return
        }
        guard args.isEmpty else { fputs("Use no arguments for Fadester Companion, or --self-test for offline checks.\n", stderr); exit(2) }
        let app = NSApplication.shared, delegate = Panel()
        app.setActivationPolicy(.regular); app.delegate = delegate
        let menu = NSMenu(), item = NSMenuItem(), application = NSMenu()
        application.addItem(withTitle: "Quit Fadester Companion", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        item.submenu = application; menu.addItem(item); app.mainMenu = menu
        withExtendedLifetime(delegate) { app.run() }
    }
}

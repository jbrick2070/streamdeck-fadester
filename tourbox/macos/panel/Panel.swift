// SPDX-License-Identifier: GPL-2.0-or-later
import AppKit

private final class FlippedDocument: NSView { override var isFlipped: Bool { true } }
private final class PanelBackground: NSView {
    override var isOpaque: Bool { true }
    override func draw(_ dirtyRect: NSRect) { NSColor.windowBackgroundColor.setFill(); dirtyRect.fill() }
}

@MainActor final class Panel: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private let previewMode: Bool
    private let paths: RuntimePaths
    private var settings = Settings(), catalog = Catalog(), invalidSettings = false, scanning = false, terminating = false
    private var scanTask: Task<Void, Never>?
    private let host = HostController()
    private var window: NSWindow!
    private var tabs: NSTabView!
    private var navigation: [NSButton] = []
    private var status = NSTextField(labelWithString: "Controls stopped. Start only when your test scenes are ready.")
    private var snapshot = NSTextField(wrappingLabelWithString: "Read OBS to load real scene and source names. This scan changes nothing in OBS.")
    private var port = NSTextField(string: "4455"), password = NSSecureTextField(string: "")
    private var mix = NSButton(checkboxWithTitle: "Enable whole-mix control", target: nil, action: nil)
    private var vjster = NSButton(checkboxWithTitle: "Enable VJster video control", target: nil, action: nil)
    private var vjsterPort = NSTextField(string: "48150"), vjsterExtensionId = NSTextField(string: ""), vjsterVideo = NSTextField(string: "")
    private var vjsterTarget = NSPopUpButton(frame: .zero, pullsDown: false)
    private var fields: [String: NSTextField] = [:], choices: [String: NSPopUpButton] = [:]
    private var scanButton: NSButton!, startButton: NSButton!, stopButton: NSButton!, saveButton: NSButton!, copyObsUrlButton: NSButton!
    private var activity = NSTextView()
    private var edits: [NSControl] = []
    init(preview: Bool = false) {
        previewMode = preview
        paths = RuntimePaths(resources: Bundle.main.resourceURL ?? Bundle.main.bundleURL)
        super.init()
        if preview {
            catalog.scenes = ["Opening", "Guest", "Closing"]; catalog.audio = ["Music bed", "Microphone", "Guest audio"]; catalog.media = ["Clips"]
            catalog.items = ["Guest":["Lower third", "Guest camera"]]
            settings.musicInput = "Music bed"; settings.contentInput = "Guest audio"; settings.micInput = "Microphone"; settings.mediaInput = "Clips"
            settings.overlayScene = "Guest"; settings.overlaySource = "Lower third"; settings.anchors = ["Opening","Guest","Closing",""]
            settings.layer1Scene = "Guest"; settings.layer1Source = "Guest camera"; settings.layer2Scene = "Guest"; settings.layer2Source = "Lower third"
        }
        if !preview, FileManager.default.fileExists(atPath: LocalFiles.settings.path) {
            do { settings = try Settings(data: Data(contentsOf: LocalFiles.settings)) }
            catch { invalidSettings = true }
        }
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        build(); window.center(); window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
    }
    func build() {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 920, height: 800), styleMask: [.titled,.closable,.miniaturizable,.resizable], backing: .buffered, defer: false)
        window.contentView = PanelBackground(frame: NSRect(x: 0, y: 0, width: 920, height: 800))
        window.title = "OBS Fadester for TourBox — Experimental Mac"; window.minSize = NSSize(width: 760, height: 660); window.delegate = self
        let root = NSStackView(); root.orientation = .vertical; root.alignment = .leading; root.spacing = 12
        root.edgeInsets = NSEdgeInsets(top: 20, left: 24, bottom: 18, right: 24)
        root.translatesAutoresizingMaskIntoConstraints = false; window.contentView!.addSubview(root)
        NSLayoutConstraint.activate([root.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor), root.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor), root.topAnchor.constraint(equalTo: window.contentView!.topAnchor), root.bottomAnchor.constraint(equalTo: window.contentView!.bottomAnchor)])
        let title = NSTextField(labelWithString: "OBS Fadester for TourBox"); title.font = .boldSystemFont(ofSize: 24)
        root.addArrangedSubview(title)
        let subtitle = label("Experimental Mac edition · One master preset · Scenes, audio, VJster video and layers")
        subtitle.textColor = .secondaryLabelColor; root.addArrangedSubview(subtitle)
        status.font = .systemFont(ofSize: 13, weight: .semibold); status.lineBreakMode = .byTruncatingTail
        root.addArrangedSubview(status); status.widthAnchor.constraint(equalTo: root.widthAnchor, constant: -48).isActive = true
        navigation = ["Setup", "Assignments", "Activity"].enumerated().map { index, name in
            let control = button(name, #selector(selectTab(_:))); control.tag = index; control.setButtonType(.pushOnPushOff)
            control.widthAnchor.constraint(equalToConstant: 130).isActive = true; control.state = index == 0 ? .on : .off; return control
        }
        root.addArrangedSubview(horizontal(navigation))
        tabs = NSTabView(); tabs.tabViewType = .noTabsNoBorder; tabs.translatesAutoresizingMaskIntoConstraints = false
        addTab(tabs, "Setup", setup()); addTab(tabs, "Assignments", assignments()); addTab(tabs, "Activity", activityPage())
        root.addArrangedSubview(tabs)
        NSLayoutConstraint.activate([tabs.widthAnchor.constraint(equalTo: root.widthAnchor, constant: -48), tabs.heightAnchor.constraint(greaterThanOrEqualToConstant: 420)])
        tabs.setContentHuggingPriority(.defaultLow, for: .vertical)
        saveButton = button("Save settings", #selector(save)); startButton = button("Save & start controls", #selector(start)); stopButton = button("Stop controls", #selector(stop))
        startButton.bezelStyle = .rounded; startButton.keyEquivalent = ""; stopButton.isEnabled = false
        let footer = horizontal([saveButton, startButton, stopButton, button("Quick guide", #selector(guide))]); root.addArrangedSubview(footer)
        root.addArrangedSubview(label("Stopping releases shortcuts. It does not finish a fade, reset OBS, or restore audio levels.", small: true))
        loadFields(); fillChoices()
        host.line = { [weak self] in self?.note($0) }
        host.changed = { [weak self] text, _ in self?.status.stringValue = text; self?.updateEnabled() }
        host.exited = { [weak self] in
            guard let self else { return }; self.updateEnabled()
            if self.terminating { NSApp.reply(toApplicationShouldTerminate: true) }
        }
        if invalidSettings {
            status.stringValue = "Saved settings could not be read. Nothing will be overwritten."
            note("Repair or remove panel-config.json in ~/Library/Application Support/FadesterTourBox before saving. Your file has not been changed.")
        }
        updateEnabled()
    }
    private func label(_ text: String, small: Bool = false) -> NSTextField {
        let value = NSTextField(wrappingLabelWithString: text); value.font = .systemFont(ofSize: small ? 11 : 13); value.maximumNumberOfLines = 0
        value.setContentCompressionResistancePriority(.required, for: .vertical); return value
    }
    private func button(_ text: String, _ action: Selector) -> NSButton { NSButton(title: text, target: self, action: action) }
    private func horizontal(_ views: [NSView]) -> NSStackView { let row = NSStackView(views: views); row.orientation = .horizontal; row.spacing = 12; row.alignment = .centerY; return row }
    private func column() -> NSStackView { let stack = NSStackView(); stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 12; return stack }
    private func heading(_ title: String, in stack: NSStackView) { let text = label(title); text.font = .boldSystemFont(ofSize: 15); stack.addArrangedSubview(text) }
    private func paragraph(_ text: String, in stack: NSStackView) { let field = label(text); stack.addArrangedSubview(field); field.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true }
    private func addTab(_ tabs: NSTabView, _ name: String, _ content: NSView) {
        let item = NSTabViewItem(identifier: name); item.label = name; item.view = content; tabs.addTabViewItem(item)
    }
    @objc private func selectTab(_ sender: NSButton) {
        tabs.selectTabViewItem(at: sender.tag)
        for button in navigation { button.state = button.tag == sender.tag ? .on : .off }
    }
    private func scrolling(_ stack: NSStackView) -> NSScrollView {
        let scroll = NSScrollView(); scroll.hasVerticalScroller = true; scroll.drawsBackground = false
        let document = FlippedDocument(); document.translatesAutoresizingMaskIntoConstraints = false; scroll.documentView = document
        stack.translatesAutoresizingMaskIntoConstraints = false; document.addSubview(stack)
        NSLayoutConstraint.activate([document.widthAnchor.constraint(equalTo: scroll.contentView.widthAnchor), stack.leadingAnchor.constraint(equalTo: document.leadingAnchor, constant: 18), stack.trailingAnchor.constraint(equalTo: document.trailingAnchor, constant: -24), stack.topAnchor.constraint(equalTo: document.topAnchor, constant: 20), stack.bottomAnchor.constraint(equalTo: document.bottomAnchor, constant: -24)])
        return scroll
    }
    private func setup() -> NSView {
        let stack = column()
        heading("1  Import the Mac master", in: stack)
        paragraph("Save the included preset, then use Import beside Preset List in TourBox Console. Link OBS Fadester for TourBox to OBS Studio and enable Auto Switch. This is the Mac preset: Control + Option + Shift, with no Command key.", in: stack)
        stack.addArrangedSubview(button("Save Mac preset…", #selector(exportPreset)))
        heading("2  Connect to this Mac’s OBS", in: stack)
        paragraph("In OBS, open Tools → WebSocket Server Settings. Enable the server and keep authentication on. Read scenes and inputs below to choose actual names; this scan makes no OBS changes.", in: stack)
        port.widthAnchor.constraint(equalToConstant: 90).isActive = true; password.widthAnchor.constraint(equalToConstant: 230).isActive = true
        password.placeholderString = "Optional session password"
        stack.addArrangedSubview(horizontal([label("Port"), port, label("Password"), password])); edits += [port,password]
        paragraph("Leave the password blank to use OBS’s matching local settings. A typed password stays in this app’s memory; it is never saved to the settings file or Activity.", in: stack)
        scanButton = button("Read scenes and inputs from OBS", #selector(scan)); stack.addArrangedSubview(scanButton)
        snapshot.textColor = .secondaryLabelColor; stack.addArrangedSubview(snapshot); snapshot.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
        heading("3  Allow the visible native crossfader", in: stack)
        paragraph("The native slider component needs macOS Accessibility permission. Open its permission window and grant it through System Settings. TourBox Console also needs its own permissions. This app never grants either permission for you.", in: stack)
        stack.addArrangedSubview(button("Open native slider permission window", #selector(permission)))
        paragraph("For manual fades use OBS 33.0.0 or 33.0.1, Studio Mode, Fade, two different scenes and a visible native T-bar parked at its starting end. Close OBS dialogs. Start refuses unavailable native control; it never substitutes an invisible fade.", in: stack)
        heading("4  VJster video control (Chrome & OBS Browser Source)", in: stack)
        vjsterPort.widthAnchor.constraint(equalToConstant: 90).isActive = true
        vjsterTarget.widthAnchor.constraint(greaterThanOrEqualToConstant: 210).isActive = true
        vjsterTarget.removeAllItems()
        for (titleText, code) in [("Chrome & OBS page", "both"), ("Chrome extension only", "browser"), ("OBS Browser Source only", "obs")] {
            vjsterTarget.addItem(withTitle: titleText); vjsterTarget.lastItem?.representedObject = code
        }
        stack.addArrangedSubview(horizontal([vjster, label("Port"), vjsterPort, label("Target"), vjsterTarget]))
        vjsterExtensionId.widthAnchor.constraint(equalToConstant: 310).isActive = true
        vjsterExtensionId.placeholderString = "Optional 32-letter Chrome extension ID"
        stack.addArrangedSubview(horizontal([label("Pinned extension ID"), vjsterExtensionId]))
        vjsterVideo.widthAnchor.constraint(equalToConstant: 310).isActive = true
        vjsterVideo.placeholderString = "YouTube URL or 11-character video ID"
        copyObsUrlButton = button("Copy OBS Browser Source URL", #selector(copyObsUrl))
        stack.addArrangedSubview(horizontal([label("OBS video URL / ID"), vjsterVideo, copyObsUrlButton]))
        edits += [vjster, vjsterPort, vjsterTarget, vjsterExtensionId]
        paragraph("Raised Knob steps playback speed (press + turn for fine 0.05x, press to reset 1x); Top + Scroll steps quality; Top + Tall toggles play/pause. Works with the VJster Chrome extension on YouTube and/or directly in an OBS Browser Source using the copied URL (no Midi Fadester plugin required).", in: stack)
        heading("Optional  Whole-mix control", in: stack)
        stack.addArrangedSubview(mix); edits.append(mix)
        paragraph("Off by default. When enabled, Side + Knob and compatible local clients can fade public OBS mixer inputs together. This affects every track and monitor fed by them. Start may resume monitoring an existing mix; Stop never raises the sound. Enable only after reviewing your inputs.", in: stack)
        number("Group step (dB)", key: "mixStepDb", in: stack); number("Group fade (ms)", key: "mixFadeMs", in: stack)
        paragraph("Then Save & start controls, select the master in Console, and bring OBS forward. Connected means the host acknowledged that controls are armed. Physical combinations and full Mac rehearsal remain experimental.", in: stack)
        return scrolling(stack)
    }
    private func choice(_ title: String, key: String, in stack: NSStackView) {
        let popup = NSPopUpButton(frame: .zero, pullsDown: false); popup.widthAnchor.constraint(greaterThanOrEqualToConstant: 350).isActive = true
        let text = label(title); text.widthAnchor.constraint(equalToConstant: 145).isActive = true
        choices[key] = popup; edits.append(popup); stack.addArrangedSubview(horizontal([text,popup]))
        if key == "overlayScene" { popup.target = self; popup.action = #selector(overlayChanged) }
        else if key == "layer1Scene" { popup.target = self; popup.action = #selector(layer1Changed) }
        else if key == "layer2Scene" { popup.target = self; popup.action = #selector(layer2Changed) }
    }
    private func number(_ title: String, key: String, in stack: NSStackView) {
        let field = NSTextField(string: ""); field.widthAnchor.constraint(equalToConstant: 100).isActive = true
        let text = label(title); text.widthAnchor.constraint(equalToConstant: 145).isActive = true
        fields[key] = field; edits.append(field); stack.addArrangedSubview(horizontal([text,field]))
    }
    private func assignments() -> NSView {
        let stack = column(); heading("Choose sources by name", in: stack)
        paragraph("Read OBS in Setup first. Unassigned roles do nothing. Missing saved targets stay visible as unavailable; nothing is silently reassigned. Stop controls before changing settings.", in: stack)
        for (name,key) in [("Music / bed","musicInput"),("Content / guest","contentInput"),("Microphone","micInput"),("Media / Playlister","mediaInput"),("Overlay scene","overlayScene"),("Overlay source","overlaySource"),("Layer 1 scene","layer1Scene"),("Layer 1 source","layer1Source"),("Layer 2 scene","layer2Scene"),("Layer 2 source","layer2Source")] { choice(name,key:key,in:stack) }
        for (index,name) in ["Up","Right","Down","Left"].enumerated() { choice("D-pad \(name)",key:"anchor\(index)",in:stack) }
        heading("Adjust the feel", in: stack)
        for (name,key) in [("Music step (dB)","volumeStepDb"),("Duck ceiling (dB)","duckDb"),("Ticks per full fade","ticks"),("Timing step (ms)","transitionStepMs"),("Layer 2 opacity (%)","opacityPct")] { number(name,key:key,in:stack) }
        paragraph("Knob/Dial press-and-turn use quarter steps. Duck does not raise an already quiet source. Top + Dial rides Layer 2 opacity; Top + Knob / Top + Side + Knob step Layer 1 / Layer 2 blend modes. Overlay actions affect the selected item, including when that scene is live. Mic mute is one-way; unmute in OBS.", in: stack)
        return scrolling(stack)
    }
    private func activityPage() -> NSView {
        let scroll = NSScrollView(); scroll.hasVerticalScroller = true; scroll.hasHorizontalScroller = false
        activity.isEditable = false; activity.isSelectable = true; activity.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        activity.textContainerInset = NSSize(width: 14, height: 14); activity.isVerticallyResizable = true; activity.isHorizontallyResizable = false
        activity.autoresizingMask = [.width]; activity.textContainer?.widthTracksTextView = true
        scroll.documentView = activity; return scroll
    }
    private func loadFields() {
        port.stringValue = String(settings.port); mix.state = settings.mixEnabled ? .on : .off
        vjster.state = settings.vjsterEnabled ? .on : .off; vjsterPort.stringValue = String(settings.vjsterPort)
        vjsterExtensionId.stringValue = settings.vjsterExtensionId
        if let item = vjsterTarget.itemArray.first(where: { $0.representedObject as? String == settings.vjsterTarget }) { vjsterTarget.select(item) }
        let values: [String:Double] = ["volumeStepDb":settings.volumeStepDb,"duckDb":settings.duckDb,"ticks":1/settings.faderStep,"transitionStepMs":Double(settings.transitionStepMs),"mixStepDb":settings.mixStepDb,"mixFadeMs":Double(settings.mixFadeMs),"opacityPct":settings.opacityStep * 100]
        for (key,value) in values { fields[key]?.stringValue = String(format: "%g", value) }
    }
    private func selected(_ key: String) -> String { choices[key]?.selectedItem?.representedObject as? String ?? "" }
    private func fill(_ key: String, _ values: [String], keep: String) {
        guard let popup = choices[key] else { return }; popup.removeAllItems()
        popup.addItem(withTitle: "Unassigned"); popup.lastItem?.representedObject = ""
        for value in Array(Set(values)).sorted() { popup.addItem(withTitle: value); popup.lastItem?.representedObject = value }
        if !keep.isEmpty && !values.contains(keep) { popup.addItem(withTitle: "Unavailable — " + keep); popup.lastItem?.representedObject = keep }
        if let item = popup.itemArray.first(where: { $0.representedObject as? String == keep }) { popup.select(item) }
    }
    private func fillChoices() {
        for (key,value) in [("musicInput",settings.musicInput),("contentInput",settings.contentInput),("micInput",settings.micInput)] { fill(key,catalog.audio,keep:value) }
        fill("mediaInput",catalog.media,keep:settings.mediaInput); fill("overlayScene",catalog.scenes,keep:settings.overlayScene)
        fill("overlaySource",catalog.items[settings.overlayScene] ?? [],keep:settings.overlaySource)
        fill("layer1Scene",catalog.scenes,keep:settings.layer1Scene); fill("layer1Source",catalog.items[settings.layer1Scene] ?? [],keep:settings.layer1Source)
        fill("layer2Scene",catalog.scenes,keep:settings.layer2Scene); fill("layer2Source",catalog.items[settings.layer2Scene] ?? [],keep:settings.layer2Source)
        for index in 0..<4 { fill("anchor\(index)",catalog.scenes,keep:settings.anchors[index]) }
    }
    @objc private func overlayChanged() { fill("overlaySource",catalog.items[selected("overlayScene")] ?? [],keep:"") }
    @objc private func layer1Changed() { fill("layer1Source",catalog.items[selected("layer1Scene")] ?? [],keep:"") }
    @objc private func layer2Changed() { fill("layer2Source",catalog.items[selected("layer2Scene")] ?? [],keep:"") }
    private func current() throws -> Settings {
        var result = settings
        guard let value = Int(port.stringValue.trimmingCharacters(in: .whitespaces)) else { throw PanelFailure.message("Enter a whole-number local port.") }; result.port = value
        guard let vjPort = Int(vjsterPort.stringValue.trimmingCharacters(in: .whitespaces)) else { throw PanelFailure.message("Enter a whole-number VJster port (1024–65535).") }; result.vjsterPort = vjPort
        result.vjsterEnabled = vjster.state == .on
        result.vjsterTarget = vjsterTarget.selectedItem?.representedObject as? String ?? "both"
        result.vjsterExtensionId = vjsterExtensionId.stringValue.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if result.vjsterObsToken.isEmpty { result.vjsterObsToken = Settings.newObsToken() }
        result.musicInput = selected("musicInput"); result.contentInput = selected("contentInput"); result.micInput = selected("micInput"); result.mediaInput = selected("mediaInput")
        result.overlayScene = selected("overlayScene"); result.overlaySource = selected("overlaySource")
        result.layer1Scene = selected("layer1Scene"); result.layer1Source = selected("layer1Source")
        result.layer2Scene = selected("layer2Scene"); result.layer2Source = selected("layer2Source")
        result.anchors = (0..<4).map { selected("anchor\($0)") }
        func number(_ key: String) throws -> Double {
            guard let text = fields[key]?.stringValue, let value = Double(text.trimmingCharacters(in: .whitespaces)), value.isFinite else { throw PanelFailure.message("Enter a valid number for \(key). Use a decimal point.") }; return value
        }
        result.volumeStepDb = try number("volumeStepDb"); result.duckDb = try number("duckDb")
        let ticks = try number("ticks"); guard (1...1000).contains(ticks) else { throw PanelFailure.message("Use 1–1000 ticks per full fade.") }; result.faderStep = 1/ticks
        let opacityPct = try number("opacityPct"); guard (1...50).contains(opacityPct) else { throw PanelFailure.message("Use 1–50% for Layer 2 opacity step.") }; result.opacityStep = opacityPct / 100.0
        let timing = try number("transitionStepMs"), duration = try number("mixFadeMs")
        guard timing.rounded() == timing, (1...5000).contains(timing), duration.rounded() == duration, (0...10000).contains(duration) else { throw PanelFailure.message("Timing and group fade must be whole milliseconds in the shown ranges.") }
        result.transitionStepMs = Int(timing); result.mixFadeMs = Int(duration); result.mixStepDb = try number("mixStepDb"); result.mixEnabled = mix.state == .on
        try result.validate(); return result
    }
    private func updateEnabled() {
        let editable = !host.running && !scanning
        edits.forEach { $0.isEnabled = editable }
        scanButton?.isEnabled = editable
        saveButton?.isEnabled = editable && !invalidSettings; startButton?.isEnabled = editable && !invalidSettings && !previewMode
        stopButton?.isEnabled = host.running
    }
    private func note(_ text: String) {
        let safe = redact(text, secrets: [password.stringValue, settings.vjsterObsToken])
        let line = DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .medium) + "  " + safe + "\n"
        activity.textStorage?.append(NSAttributedString(string: line))
        if activity.string.count > 60_000 { activity.string = String(activity.string.suffix(45_000)) }
        activity.scrollToEndOfDocument(nil)
    }
    private func failure(_ error: Error) { let text = (error as? PanelFailure)?.description ?? "Could not complete this step. Check local OBS, its authenticated port, permissions and Activity."; status.stringValue = text; note(text) }
    @objc private func save() {
        guard !invalidSettings && !host.running && !previewMode else { return }
        do { settings = try current(); try LocalFiles.save(settings); status.stringValue = "Settings saved. Controls remain stopped."; note(status.stringValue) } catch { failure(error) }
    }
    @objc private func start() {
        guard !invalidSettings && !host.running && !scanning && !previewMode else { return }
        do {
            let proposed = try current(), secret = try LocalFiles.password(port: proposed.port, override: password.stringValue)
            try paths.validate(); try LocalFiles.save(proposed); settings = proposed
            try host.start(paths: paths, config: LocalFiles.settings, password: secret, mixEnabled: proposed.mixEnabled, extraSecrets: [proposed.vjsterObsToken])
        } catch { failure(error); updateEnabled() }
    }
    @objc private func stop() { host.stop() }
    @objc private func copyObsUrl() {
        guard !previewMode else { return }
        do {
            let active: Settings
            if host.running {
                active = settings
            } else {
                active = try current()
                settings = active
                if !invalidSettings { try LocalFiles.save(active) }
            }
            let url = try active.obsBrowserUrl(videoInput: vjsterVideo.stringValue)
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(url, forType: .string)
            let hasId = Settings.videoId(from: vjsterVideo.stringValue) != nil
            status.stringValue = hasId ? "Copied OBS Browser Source URL to clipboard." : "Copied OBS Browser Source URL (replace VIDEO_ID if left blank)."
            note(status.stringValue)
        } catch { failure(error) }
    }
    @objc private func scan() {
        guard !host.running && !scanning && !previewMode else { return }
        do {
            settings = try current(); let secret = try LocalFiles.password(port: settings.port, override: password.stringValue)
            let client = try ObsDiscovery(port: settings.port)
            scanning = true; updateEnabled(); status.stringValue = "Reading OBS… No scenes or levels are being changed."
            scanTask = Task { [weak self] in
                guard let self else { return }
                do {
                    self.catalog = try await client.scan(password: secret); self.fillChoices()
                    self.snapshot.stringValue = "Program: \(self.catalog.program)   ·   Preview: \(self.catalog.preview)\nStudio Mode: \(self.catalog.studio ? "on" : "off")   ·   \(self.catalog.scenes.count) scenes, \(self.catalog.audio.count) audio inputs. Snapshot from this scan."
                    self.status.stringValue = "OBS read successfully. Choose assignments, then start when ready."; self.note(self.status.stringValue)
                } catch { self.failure(error) }
                self.scanning = false; self.scanTask = nil; self.updateEnabled()
            }
        } catch { failure(error) }
    }
    @objc private func exportPreset() {
        guard !previewMode else { return }
        let save = NSSavePanel(); save.nameFieldStringValue = "OBS Fadester for TourBox.tb"; save.title = "Save the Mac TourBox preset"
        save.directoryURL = FileManager.default.homeDirectoryForCurrentUser
        if save.runModal() == .OK, let url = save.url {
            do { try Data(contentsOf: paths.preset).write(to: url, options: .atomic); note("Mac preset saved. Import it in TourBox Console; no Console settings were changed.") } catch { failure(error) }
        }
    }
    @objc private func permission() {
        guard !previewMode else { return }
        guard FileManager.default.fileExists(atPath: paths.native.path) else { failure(PanelFailure.message("The native permission component is missing from this bundle.")); return }
        NSWorkspace.shared.openApplication(at: paths.native, configuration: .init()) { _, error in
            if error != nil { DispatchQueue.main.async { self.note("Could not open the native permission window. Check that the complete app was extracted.") } }
        }
    }
    @objc private func guide() { if !previewMode { NSWorkspace.shared.open(paths.resources.appendingPathComponent("START-HERE.html")) } }
    func windowShouldClose(_ sender: NSWindow) -> Bool { NSApp.terminate(nil); return false }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        scanTask?.cancel()
        if host.running { terminating = true; host.stop(); return .terminateLater }
        return .terminateNow
    }
    func render(to url: URL, tab: Int = 0) throws {
        build(); selectTab(navigation[tab]); window.contentView!.layoutSubtreeIfNeeded()
        guard let image = window.contentView!.bitmapImageRepForCachingDisplay(in: window.contentView!.bounds) else { throw PanelFailure.message("Preview image could not be created.") }
        window.contentView!.cacheDisplay(in: window.contentView!.bounds, to: image)
        guard let png = image.representation(using: .png, properties: [:]) else { throw PanelFailure.message("Preview PNG unavailable.") }
        try png.write(to: url)
    }
}

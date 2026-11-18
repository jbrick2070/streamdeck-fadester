// SPDX-License-Identifier: GPL-2.0-or-later
import AppKit
import ApplicationServices

private let navyColor = NSColor(srgbRed: 26 / 255, green: 34 / 255, blue: 51 / 255, alpha: 1)
private let accentColor = NSColor(srgbRed: 38 / 255, green: 90 / 255, blue: 158 / 255, alpha: 1)
private let stripColor = NSColor(srgbRed: 241 / 255, green: 244 / 255, blue: 249 / 255, alpha: 1)
private let reminderBgColor = NSColor(srgbRed: 255 / 255, green: 241 / 255, blue: 214 / 255, alpha: 1)
private let reminderFgColor = NSColor(srgbRed: 107 / 255, green: 74 / 255, blue: 0 / 255, alpha: 1)

private final class FlippedDocument: NSView { override var isFlipped: Bool { true } }

private final class PanelBackground: NSView {
    override var isOpaque: Bool { true }
    override func draw(_ dirtyRect: NSRect) { NSColor.white.setFill(); dirtyRect.fill() }
}

private final class RoundedCardView: NSView {
    var fill: NSColor
    var radius: CGFloat
    init(fill: NSColor, radius: CGFloat = 6) {
        self.fill = fill; self.radius = radius
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
    }
    @available(*, unavailable) required init?(coder: NSCoder) { nil }
    override func draw(_ dirtyRect: NSRect) {
        fill.setFill()
        NSBezierPath(roundedRect: bounds, xRadius: radius, yRadius: radius).fill()
    }
}

private final class LampDotView: NSView {
    var lamp: Lamp = .grey { didSet { if oldValue != lamp { needsDisplay = true } } }
    override var intrinsicContentSize: NSSize { NSSize(width: 12, height: 12) }
    override func draw(_ dirtyRect: NSRect) {
        let color: NSColor
        switch lamp {
        case .green: color = NSColor(srgbRed: 76 / 255, green: 194 / 255, blue: 110 / 255, alpha: 1)
        case .amber: color = NSColor(srgbRed: 244 / 255, green: 176 / 255, blue: 48 / 255, alpha: 1)
        case .red: color = NSColor(srgbRed: 236 / 255, green: 86 / 255, blue: 74 / 255, alpha: 1)
        case .grey: color = NSColor(srgbRed: 150 / 255, green: 156 / 255, blue: 170 / 255, alpha: 1)
        }
        color.setFill()
        NSBezierPath(ovalIn: bounds.insetBy(dx: 0.5, dy: 0.5)).fill()
    }
}

private final class PillActionButton: NSControl {
    var titleText: String = "" { didSet { invalidateIntrinsicContentSize(); needsDisplay = true } }
    var fill: NSColor = accentColor { didSet { needsDisplay = true } }
    var onClick: (() -> Void)?
    override var intrinsicContentSize: NSSize {
        let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.boldSystemFont(ofSize: 11.5)]
        let width = ceil((titleText as NSString).size(withAttributes: attrs).width) + 20
        return NSSize(width: max(54, width), height: 24)
    }
    override func resetCursorRects() {
        if isEnabled { addCursorRect(bounds, cursor: .pointingHand) }
    }
    override func mouseDown(with event: NSEvent) {
        guard isEnabled else { return }
        alphaValue = 0.82
        defer { alphaValue = 1.0 }
        let point = convert(event.locationInWindow, from: nil)
        if bounds.contains(point) { onClick?() }
    }
    override func draw(_ dirtyRect: NSRect) {
        let bg = isEnabled ? fill : NSColor(srgbRed: 180 / 255, green: 186 / 255, blue: 198 / 255, alpha: 1)
        bg.setFill()
        NSBezierPath(roundedRect: bounds, xRadius: 5, yRadius: 5).fill()
        let attrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.boldSystemFont(ofSize: 11.5),
            .foregroundColor: NSColor.white
        ]
        let size = (titleText as NSString).size(withAttributes: attrs)
        let rect = NSRect(x: (bounds.width - size.width) / 2, y: (bounds.height - size.height) / 2, width: size.width, height: size.height)
        (titleText as NSString).draw(in: rect, withAttributes: attrs)
    }
}

@MainActor private final class LightView: NSView {
    private let dot = LampDotView()
    private let words = NSTextField(labelWithString: "")
    private let actionButton = PillActionButton()
    private var actionId: String?
    var onAction: ((String) -> Void)?

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        translatesAutoresizingMaskIntoConstraints = false
        words.font = .boldSystemFont(ofSize: 12.5)
        words.textColor = navyColor
        actionButton.isHidden = true
        actionButton.onClick = { [weak self] in
            if let id = self?.actionId { self?.onAction?(id) }
        }
        let row = NSStackView(views: [dot, words, actionButton])
        row.orientation = .horizontal; row.alignment = .centerY; row.spacing = 6
        row.translatesAutoresizingMaskIntoConstraints = false
        addSubview(row)
        NSLayoutConstraint.activate([
            dot.widthAnchor.constraint(equalToConstant: 12),
            dot.heightAnchor.constraint(equalToConstant: 12),
            row.leadingAnchor.constraint(equalTo: leadingAnchor),
            row.trailingAnchor.constraint(equalTo: trailingAnchor),
            row.topAnchor.constraint(equalTo: topAnchor, constant: 2),
            row.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -2)
        ])
    }
    @available(*, unavailable) required init?(coder: NSCoder) { nil }

    func display(_ state: LightState, enabled: Bool = true) {
        dot.lamp = state.lamp
        words.stringValue = state.text
        actionId = state.action
        if let title = state.button {
            actionButton.titleText = title
            actionButton.fill = state.action == "stop" ? NSColor(srgbRed: 184 / 255, green: 58 / 255, blue: 52 / 255, alpha: 1) : accentColor
            actionButton.isEnabled = enabled
            actionButton.isHidden = false
        } else {
            actionButton.isHidden = true
        }
        setAccessibilityLabel(state.text)
    }
}

@MainActor private final class FeedbackHud {
    private let panel: NSPanel
    private let textField = NSTextField(wrappingLabelWithString: "")
    private let meterField = NSTextField(labelWithString: "")
    var isVisible: Bool { panel.isVisible }

    init() {
        panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 420, height: 82),
            styleMask: [.titled, .closable, .utilityWindow, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.title = L("lastAction")
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        let card = RoundedCardView(fill: navyColor, radius: 0)
        panel.contentView = card
        textField.font = .boldSystemFont(ofSize: 13)
        textField.textColor = .white
        textField.maximumNumberOfLines = 2
        textField.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(textField)
        meterField.font = .systemFont(ofSize: 11.5)
        meterField.textColor = NSColor(srgbRed: 196 / 255, green: 210 / 255, blue: 232 / 255, alpha: 1)
        meterField.lineBreakMode = .byTruncatingTail
        meterField.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(meterField)
        NSLayoutConstraint.activate([
            textField.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 12),
            textField.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -12),
            textField.topAnchor.constraint(equalTo: card.topAnchor, constant: 10),
            meterField.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 12),
            meterField.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -12),
            meterField.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -8)
        ])
        if let screen = NSScreen.main?.visibleFrame {
            panel.setFrameOrigin(NSPoint(x: screen.maxX - 416, y: screen.maxY - 92))
        }
    }

    func set(_ value: String) { textField.stringValue = value }
    func setMeter(_ value: String) { meterField.stringValue = value }
    func show() { panel.orderFrontRegardless() }
    func close() { panel.close() }
}

@MainActor final class Panel: NSObject, NSApplicationDelegate, NSWindowDelegate, NSTableViewDataSource, NSTableViewDelegate {
    private let previewMode: Bool
    private let paths: RuntimePaths
    private var settings = Settings(), catalog = Catalog(), invalidSettings = false, scanning = false, terminating = false
    private var obsConnected = false, obsRunning = false, obsHidden = false, studioOff = false, tourboxConsoleRunning = false, tourboxConsoleInstalled = true, frontIsObs = false, frontIsChrome = false, vjsterPortBusy = false, axTrusted = true
    private var bannerActionId = "openObs"
    private var obsProblem: String?
    private var vjsterPeers: Set<String> = []
    private var lastSavedPreset: URL?
    private var bundledPresetHash = ""
    private var savedPresetHash: String?
    private var autoTries = 0
    /// Try again was pressed with the controls off: the next scan that reads OBS starts them.
    private var startAfterScan = false
    /// Whether the user last started ("on") or stopped ("off") the controls; kept apart from panel-config.json, which start() rewrites.
    private var rememberedControls: String? { UserDefaults.standard.string(forKey: "fadester.controlsLastAction") }
    private func rememberControls(_ onOff: String) { UserDefaults.standard.set(onOff, forKey: "fadester.controlsLastAction") }
    private var nextAutoScan = Date.distantFuture
    private var watchTimer: Timer?
    private var scanTask: Task<Void, Never>?
    private let host = HostController()
    private var hud: FeedbackHud?
    private var importGuideWindow: TourBoxImportWindow?
    private var showMeWindow: ObsShowMeWindow?
    private var window: NSWindow!
    private var tabs: NSTabView!
    private var navigation: [NSButton] = []
    private var obsLight = LightView(), tourboxLight = LightView(), vjsterLight = LightView(), controlsLight = LightView()
    private var diagramView = SetupDiagramView()
    private var reminderCard = RoundedCardView(fill: reminderBgColor, radius: 5)
    private var reminderLabel = NSTextField(wrappingLabelWithString: "")
    private var reminderAction = PillActionButton()
    private var status = NSTextField(labelWithString: L("macLookingForObs"))
    private var snapshot = NSTextField(wrappingLabelWithString: L("macSnapshotHint"))
    // The Visual Sidechain meter (P1-3), from a scan or the running controls' VS-METER lines, as on Windows.
    private var vsLine = NSTextField(labelWithString: "")
    private var vsStatus = ""
    private var importNote = NSTextField(wrappingLabelWithString: "")
    private var port = NSTextField(string: "4455"), password = NSSecureTextField(string: "")
    private var mix = NSButton(checkboxWithTitle: L("enableMix"), target: nil, action: nil)
    // Stream Deck, OpenDeck and MIDI only (the host's --mix-only), as on Windows.
    private var mixOnly = NSButton(checkboxWithTitle: L("mixOnly"), target: nil, action: nil)
    private var vjster = NSButton(checkboxWithTitle: L("enableVjster"), target: nil, action: nil)
    private var vjsterPort = NSTextField(string: "48150"), vjsterExtensionId = NSTextField(string: ""), vjsterVideo = NSTextField(string: "")
    private var vjsterTarget = NSPopUpButton(frame: .zero, pullsDown: false)
    private var fields: [String: NSTextField] = [:], choices: [String: NSPopUpButton] = [:]
    private var scanButton: NSButton!, primaryButton: NSButton!, saveButton: NSButton!, copyObsUrlButton: NSButton!, firstFourButton: NSButton!, savePresetStepButton: NSButton!, openConsoleStepButton: NSButton!, grantAxButton: NSButton!
    private var axStatusLabel = NSTextField(wrappingLabelWithString: "")
    private var activity = NSTextView()
    private var mapRows: [ControlMapRow] = []
    private var glyphs: [String: NSImage] = [:]
    private var mapTable = NSTableView()
    private var edits: [NSControl] = []

    init(preview: Bool = false) {
        previewMode = preview
        paths = RuntimePaths(resources: Bundle.main.resourceURL ?? Bundle.main.bundleURL)
        super.init()
        if preview {
            catalog.scenes = ["Opening", "Guest", "Closing"]; catalog.audio = ["Music bed", "Microphone", "Guest audio"]; catalog.media = ["Clips"]
            catalog.items = ["Guest": ["Lower third", "Guest camera"]]
            catalog.program = "Opening"; catalog.preview = "Guest"; catalog.studio = true
            settings.musicInput = "Music bed"; settings.contentInput = "Guest audio"; settings.micInput = "Microphone"; settings.mediaInput = "Clips"
            settings.overlayScene = "Guest"; settings.overlaySource = "Lower third"; settings.anchors = ["Opening", "Guest", "Closing", ""]
            settings.layer1Scene = "Guest"; settings.layer1Source = "Guest camera"; settings.layer2Scene = "Guest"; settings.layer2Source = "Lower third"
            obsConnected = true; obsRunning = true; tourboxConsoleRunning = true
            status.stringValue = L("obsReady", 3)
            snapshot.stringValue = L("sceneSummary", "Opening", "Guest", L("on"))
            vsStatus = Readiness.vsMeter("VS-METER: active 120 1 2 80 60 40 20") ?? ""
        }
        if !preview {
            axTrusted = AXIsProcessTrusted()
        }
        if !preview, let presetBytes = try? Data(contentsOf: paths.localizedPreset) {
            bundledPresetHash = LocalFiles.sha256Hex(presetBytes)
            savedPresetHash = try? String(contentsOf: LocalFiles.presetStamp, encoding: .utf8)
        }
        if !preview, FileManager.default.fileExists(atPath: LocalFiles.settings.path) {
            do { settings = try Settings(data: Data(contentsOf: LocalFiles.settings)) }
            catch { invalidSettings = true }
        }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        build()
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        guard !previewMode else { return }
        watchDesktop()
        watchTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.watchDesktop() }
        }
        if !invalidSettings && obsRunning {
            performScan(silentIfOffline: true)
        } else if !invalidSettings && !obsRunning {
            status.stringValue = L("macStartObs")
            // No OBS: VJster can still control Chrome's videos, so the controls may start now (FIX-8).
            autoStartIfWanted()
        }
    }

    /// The app's version (CFBundleShortVersionString in Info.plist); "" when the bundle does not say.
    static func appVersion() -> String {
        (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String)?.trimmingCharacters(in: .whitespaces) ?? ""
    }

    func build() {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 920, height: 856), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: .aqua)
        window.contentView = PanelBackground(frame: NSRect(x: 0, y: 0, width: 920, height: 856))
        let version = Panel.appVersion()
        window.title = version.isEmpty ? "Fadester Companion" : "Fadester Companion " + version
        window.minSize = NSSize(width: 780, height: 660)
        window.delegate = self

        let root = NSStackView()
        root.orientation = .vertical; root.alignment = .leading; root.spacing = 8
        root.edgeInsets = NSEdgeInsets(top: 14, left: 18, bottom: 14, right: 18)
        root.translatesAutoresizingMaskIntoConstraints = false
        window.contentView!.addSubview(root)
        NSLayoutConstraint.activate([
            root.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor),
            root.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor),
            root.topAnchor.constraint(equalTo: window.contentView!.topAnchor),
            root.bottomAnchor.constraint(equalTo: window.contentView!.bottomAnchor)
        ])

        // 1. Top dark navy header banner (matches Windows Fadester Companion).
        let headerCard = RoundedCardView(fill: navyColor, radius: 6)
        let titleLabel = NSTextField(labelWithString: "Fadester Companion")
        titleLabel.font = .boldSystemFont(ofSize: 21)
        titleLabel.textColor = .white
        status.font = .systemFont(ofSize: 13, weight: .regular)
        status.textColor = NSColor(srgbRed: 228 / 255, green: 234 / 255, blue: 245 / 255, alpha: 1)
        status.lineBreakMode = .byTruncatingTail
        let headerText = NSStackView(views: [titleLabel, status])
        headerText.orientation = .vertical; headerText.alignment = .leading; headerText.spacing = 4
        headerText.translatesAutoresizingMaskIntoConstraints = false
        var headerViews: [NSView] = []
        if let appIcon = NSApplication.shared.applicationIconImage, !previewMode {
            let iconView = NSImageView(image: appIcon)
            iconView.imageScaling = .scaleProportionallyUpOrDown
            iconView.translatesAutoresizingMaskIntoConstraints = false
            NSLayoutConstraint.activate([iconView.widthAnchor.constraint(equalToConstant: 42), iconView.heightAnchor.constraint(equalToConstant: 42)])
            headerViews.append(iconView)
        }
        headerViews.append(headerText)
        let headerRow = NSStackView(views: headerViews)
        headerRow.orientation = .horizontal; headerRow.alignment = .centerY; headerRow.spacing = 12
        headerRow.translatesAutoresizingMaskIntoConstraints = false
        headerCard.addSubview(headerRow)
        // The version, top right, so a screenshot or a question about this window always says which build it is.
        let versionLabel = NSTextField(labelWithString: version.isEmpty ? "" : "v" + version)
        versionLabel.font = .systemFont(ofSize: 12, weight: .regular)
        versionLabel.textColor = NSColor(srgbRed: 190 / 255, green: 200 / 255, blue: 220 / 255, alpha: 1)
        versionLabel.translatesAutoresizingMaskIntoConstraints = false
        headerCard.addSubview(versionLabel)
        root.addArrangedSubview(headerCard)
        NSLayoutConstraint.activate([
            headerCard.widthAnchor.constraint(equalTo: root.widthAnchor, constant: -36),
            headerRow.leadingAnchor.constraint(equalTo: headerCard.leadingAnchor, constant: 16),
            headerRow.trailingAnchor.constraint(equalTo: headerCard.trailingAnchor, constant: -16),
            headerRow.topAnchor.constraint(equalTo: headerCard.topAnchor, constant: 12),
            headerRow.bottomAnchor.constraint(equalTo: headerCard.bottomAnchor, constant: -12),
            versionLabel.topAnchor.constraint(equalTo: headerCard.topAnchor, constant: 12),
            versionLabel.trailingAnchor.constraint(equalTo: headerCard.trailingAnchor, constant: -16),
            status.widthAnchor.constraint(lessThanOrEqualTo: headerCard.widthAnchor, constant: -90)
        ])

        // 2. Top live readiness indicator strip (OBS, TourBox, VJster, Controls + quick Start/Stop).
        let lightsCard = RoundedCardView(fill: stripColor, radius: 6)
        for light in [obsLight, tourboxLight, vjsterLight, controlsLight] {
            light.onAction = { [weak self] action in self?.handleLightAction(action) }
        }
        let lightsRow = NSStackView(views: [obsLight, tourboxLight, vjsterLight, controlsLight, NSView()])
        lightsRow.orientation = .horizontal; lightsRow.alignment = .centerY; lightsRow.spacing = 20
        lightsRow.translatesAutoresizingMaskIntoConstraints = false
        lightsCard.addSubview(lightsRow)
        root.addArrangedSubview(lightsCard)
        NSLayoutConstraint.activate([
            lightsCard.widthAnchor.constraint(equalTo: root.widthAnchor, constant: -36),
            lightsRow.leadingAnchor.constraint(equalTo: lightsCard.leadingAnchor, constant: 14),
            lightsRow.trailingAnchor.constraint(equalTo: lightsCard.trailingAnchor, constant: -14),
            lightsRow.topAnchor.constraint(equalTo: lightsCard.topAnchor, constant: 8),
            lightsRow.bottomAnchor.constraint(equalTo: lightsCard.bottomAnchor, constant: -8)
        ])

        // 3. Contextual amber reminder strip (shown only when OBS is hidden or behind another app while controls run).
        reminderLabel.font = .boldSystemFont(ofSize: 12.5)
        reminderLabel.textColor = reminderFgColor
        reminderAction.titleText = L("btnBringObs")
        reminderAction.fill = accentColor
        reminderAction.onClick = { [weak self] in
            guard let self else { return }
            self.handleLightAction(self.bannerActionId)
        }
        let reminderRow = NSStackView(views: [reminderLabel, NSView(), reminderAction])
        reminderRow.orientation = .horizontal; reminderRow.alignment = .centerY; reminderRow.spacing = 12
        reminderRow.translatesAutoresizingMaskIntoConstraints = false
        reminderCard.addSubview(reminderRow)
        reminderCard.isHidden = true
        root.addArrangedSubview(reminderCard)
        NSLayoutConstraint.activate([
            reminderCard.widthAnchor.constraint(equalTo: root.widthAnchor, constant: -36),
            reminderRow.leadingAnchor.constraint(equalTo: reminderCard.leadingAnchor, constant: 12),
            reminderRow.trailingAnchor.constraint(equalTo: reminderCard.trailingAnchor, constant: -12),
            reminderRow.topAnchor.constraint(equalTo: reminderCard.topAnchor, constant: 6),
            reminderRow.bottomAnchor.constraint(equalTo: reminderCard.bottomAnchor, constant: -6)
        ])

        // 4. Tab navigation (Setup, Assignments, Control map, Activity).
        navigation = [L("setup"), L("assignments"), L("controlMap"), L("activity")].enumerated().map { index, name in
            let control = button(name, #selector(selectTab(_:)))
            control.tag = index; control.setButtonType(.pushOnPushOff)
            control.widthAnchor.constraint(equalToConstant: 132).isActive = true
            control.state = index == 0 ? .on : .off
            return control
        }
        root.addArrangedSubview(horizontal(navigation))

        tabs = NSTabView(); tabs.tabViewType = .noTabsNoBorder; tabs.translatesAutoresizingMaskIntoConstraints = false
        addTab(tabs, L("setup"), setup())
        addTab(tabs, L("assignments"), assignments())
        addTab(tabs, L("controlMap"), controlMapPage())
        addTab(tabs, L("activity"), activityPage())
        root.addArrangedSubview(tabs)
        NSLayoutConstraint.activate([
            tabs.widthAnchor.constraint(equalTo: root.widthAnchor, constant: -36),
            tabs.heightAnchor.constraint(greaterThanOrEqualToConstant: 400)
        ])
        tabs.setContentHuggingPriority(.defaultLow, for: .vertical)

        // 5. Footer bar (matches Windows Fadester Companion).
        primaryButton = button(L("saveStart"), #selector(toggleControls))
        primaryButton.bezelStyle = .rounded
        primaryButton.bezelColor = accentColor
        primaryButton.contentTintColor = .white
        primaryButton.keyEquivalent = ""
        saveButton = button(L("save"), #selector(save))
        let feedbackButton = button(L("feedback"), #selector(toggleFeedback))
        let guideButton = button(L("guide"), #selector(guide))
        root.addArrangedSubview(horizontal([primaryButton, saveButton, feedbackButton, guideButton]))
        root.addArrangedSubview(label(L("keepOpen"), small: true))

        vjster.target = self; vjster.action = #selector(vjsterToggled)
        mix.target = self; mix.action = #selector(mixToggled)
        mixOnly.target = self; mixOnly.action = #selector(mixOnlyToggled)
        loadFields(); fillChoices(); readControlMap()

        host.line = { [weak self] rawLine in
            guard let self else { return }
            self.handleHostLine(rawLine)
        }
        host.changed = { [weak self] text, _ in
            guard let self else { return }
            // Armed with OBS (READY), or for Chrome's videos only while OBS is away (VIDEO-READY, FIX-8).
            if self.host.isArmed {
                self.obsConnected = self.host.isObsLive
                if self.host.isObsLive { self.obsProblem = nil }
            }
            self.setStatus(text)
            self.updateEnabled()
        }
        host.exited = { [weak self] in
            guard let self else { return }
            self.setMeter("")
            self.vjsterPeers.removeAll()
            self.vjsterPortBusy = false
            self.updateEnabled()
            if self.terminating { NSApp.reply(toApplicationShouldTerminate: true); return }
            // Without VJster the host stops when OBS goes away: look for OBS again, and the next scan that reads it starts the controls,
            // unless the user pressed Stop (FIX-5).
            self.obsConnected = false
            if self.obsRunning { self.autoTries = 4; self.nextAutoScan = Date().addingTimeInterval(3.5) }
        }
        if invalidSettings {
            setStatus(L("macSettingsUnreadable"))
            note(L("macSettingsRepair"))
        }
        updateEnabled()
    }

    private func setStatus(_ text: String) {
        status.stringValue = text
        hud?.set(text)
    }

    /// The Visual Sidechain meter line in Setup and in the feedback window ("" hides it).
    private func setMeter(_ text: String) {
        vsStatus = text
        vsLine.stringValue = text
        vsLine.isHidden = text.isEmpty
        hud?.setMeter(text)
    }

    private func label(_ text: String, small: Bool = false) -> NSTextField {
        let value = NSTextField(wrappingLabelWithString: text)
        value.font = .systemFont(ofSize: small ? 11.5 : 13)
        value.textColor = small ? .secondaryLabelColor : .labelColor
        value.maximumNumberOfLines = 0
        value.setContentCompressionResistancePriority(.required, for: .vertical)
        return value
    }
    private func button(_ text: String, _ action: Selector) -> NSButton { NSButton(title: text, target: self, action: action) }
    private func horizontal(_ views: [NSView]) -> NSStackView {
        let row = NSStackView(views: views); row.orientation = .horizontal; row.spacing = 12; row.alignment = .centerY; return row
    }
    private func column() -> NSStackView {
        let stack = NSStackView(); stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 10; return stack
    }
    private func heading(_ title: String, in stack: NSStackView) {
        let text = label(title); text.font = .boldSystemFont(ofSize: 14.5); text.textColor = navyColor; stack.addArrangedSubview(text)
    }
    private func subheading(_ title: String, in stack: NSStackView) {
        let text = label(title); text.font = .boldSystemFont(ofSize: 13); text.textColor = accentColor; stack.addArrangedSubview(text)
    }
    private func paragraph(_ text: String, in stack: NSStackView) {
        let field = label(text); stack.addArrangedSubview(field); field.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
    }
    private func addTab(_ tabs: NSTabView, _ name: String, _ content: NSView) {
        let item = NSTabViewItem(identifier: name); item.label = name; item.view = content; tabs.addTabViewItem(item)
    }
    @objc private func selectTab(_ sender: NSButton) {
        tabs.selectTabViewItem(at: sender.tag)
        for item in navigation { item.state = item.tag == sender.tag ? .on : .off }
    }
    private func scrolling(_ stack: NSStackView) -> NSScrollView {
        let scroll = NSScrollView(); scroll.hasVerticalScroller = true; scroll.drawsBackground = true; scroll.backgroundColor = .white
        let document = FlippedDocument(); document.translatesAutoresizingMaskIntoConstraints = false; scroll.documentView = document
        stack.translatesAutoresizingMaskIntoConstraints = false; document.addSubview(stack)
        NSLayoutConstraint.activate([
            document.widthAnchor.constraint(equalTo: scroll.contentView.widthAnchor),
            stack.leadingAnchor.constraint(equalTo: document.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: document.trailingAnchor, constant: -22),
            stack.topAnchor.constraint(equalTo: document.topAnchor, constant: 14),
            stack.bottomAnchor.constraint(equalTo: document.bottomAnchor, constant: -20)
        ])
        return scroll
    }

    private func setup() -> NSView {
        let stack = column()
        diagramView.onAction = { [weak self] action in self?.handleDiagramAction(action) }
        stack.addArrangedSubview(diagramView)
        diagramView.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true

        heading(L("connectTitle"), in: stack)
        paragraph(L("connectHint"), in: stack)
        port.widthAnchor.constraint(equalToConstant: 86).isActive = true
        password.widthAnchor.constraint(equalToConstant: 220).isActive = true
        password.placeholderString = L("macPasswordPlaceholder")
        stack.addArrangedSubview(horizontal([label(L("port")), port, label(L("password")), password]))
        edits += [port, password]
        paragraph(L("macPasswordHint"), in: stack)
        scanButton = button(L("discover"), #selector(scan))
        stack.addArrangedSubview(scanButton)
        snapshot.font = .boldSystemFont(ofSize: 12.5)
        snapshot.textColor = navyColor
        stack.addArrangedSubview(snapshot)
        snapshot.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
        vsLine.font = .systemFont(ofSize: 12.5, weight: .medium)
        vsLine.textColor = accentColor
        vsLine.stringValue = vsStatus
        vsLine.isHidden = vsStatus.isEmpty
        stack.addArrangedSubview(vsLine)

        heading(L("macControllerTitle"), in: stack)
        subheading(L("macPresetTitle"), in: stack)
        paragraph(L("macPresetSteps"), in: stack)
        savePresetStepButton = button(L("macSavePreset"), #selector(saveAndGuidePreset))
        savePresetStepButton.bezelStyle = .rounded
        savePresetStepButton.bezelColor = accentColor
        openConsoleStepButton = button(L("macOpenConsoleStep"), #selector(openOrDownloadConsole))
        let showGuideBtn = button(L("btnShowWhere"), #selector(showImportGuide))
        stack.addArrangedSubview(horizontal([savePresetStepButton, openConsoleStepButton, showGuideBtn]))
        let downloadConsoleBtn = button(L("macDownloadConsole"), #selector(downloadTourBoxConsole))
        let presetSquareBtn = button(L("macPresetSquare"), #selector(openPresetSquare))
        stack.addArrangedSubview(horizontal([label(L("macTourBoxInfo"), small: true), downloadConsoleBtn, presetSquareBtn]))
        if LocalFiles.presetSyncState(bundledHash: bundledPresetHash, savedHash: savedPresetHash) == .updateAvailable {
            importNote.stringValue = L("macPresetUpdated")
            importNote.isHidden = false
        } else {
            importNote.isHidden = true
        }
        importNote.font = .systemFont(ofSize: 12, weight: .medium)
        importNote.textColor = accentColor
        stack.addArrangedSubview(importNote)
        importNote.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true

        subheading(L("macAxTitle"), in: stack)
        paragraph(L("macAxHint"), in: stack)
        grantAxButton = button(L("macAxGrant"), #selector(grantAccessibility))
        grantAxButton.bezelStyle = .rounded
        axStatusLabel.font = .systemFont(ofSize: 12, weight: .semibold)
        stack.addArrangedSubview(horizontal([grantAxButton, button(L("macNativeHelper"), #selector(permission)), axStatusLabel]))

        heading(L("cueTitle"), in: stack)
        paragraph(L("macCueHint"), in: stack)

        heading(L("vjsterTitle"), in: stack)
        vjsterPort.widthAnchor.constraint(equalToConstant: 86).isActive = true
        vjsterTarget.widthAnchor.constraint(greaterThanOrEqualToConstant: 205).isActive = true
        vjsterTarget.removeAllItems()
        for (titleText, code) in [(L("vjsterTargetBoth"), "both"), (L("vjsterTargetBrowser"), "browser"), (L("vjsterTargetObs"), "obs")] {
            vjsterTarget.addItem(withTitle: titleText); vjsterTarget.lastItem?.representedObject = code
        }
        stack.addArrangedSubview(vjster)
        stack.addArrangedSubview(horizontal([label(L("vjsterPort")), vjsterPort, label(L("vjsterTarget")), vjsterTarget]))
        vjsterExtensionId.widthAnchor.constraint(equalToConstant: 300).isActive = true
        vjsterExtensionId.placeholderString = L("macExtensionPlaceholder")
        stack.addArrangedSubview(horizontal([label(L("vjsterExtensionId")), vjsterExtensionId]))
        vjsterVideo.widthAnchor.constraint(equalToConstant: 300).isActive = true
        vjsterVideo.placeholderString = L("macVideoPlaceholder")
        copyObsUrlButton = button(L("copyObsUrl"), #selector(copyObsUrl))
        stack.addArrangedSubview(horizontal([label(L("vjsterVideo")), vjsterVideo, copyObsUrlButton]))
        edits += [vjster, vjsterPort, vjsterTarget, vjsterExtensionId]
        paragraph(L("macVjsterHint"), in: stack)

        heading(L("mixTitle"), in: stack)
        stack.addArrangedSubview(mix); edits.append(mix)
        paragraph(L("mixHint"), in: stack)
        stack.addArrangedSubview(mixOnly); edits.append(mixOnly)
        number(L("mixStep"), key: "mixStepDb", in: stack)
        number(L("mixFade"), key: "mixFadeMs", in: stack)
        return scrolling(stack)
    }

    private func choice(_ title: String, key: String, in stack: NSStackView) {
        let popup = NSPopUpButton(frame: .zero, pullsDown: false)
        popup.widthAnchor.constraint(greaterThanOrEqualToConstant: 340).isActive = true
        let text = label(title); text.widthAnchor.constraint(equalToConstant: 195).isActive = true
        choices[key] = popup; edits.append(popup); stack.addArrangedSubview(horizontal([text, popup]))
        if key == "overlayScene" { popup.target = self; popup.action = #selector(overlayChanged) }
        else if key == "layer1Scene" { popup.target = self; popup.action = #selector(layer1Changed) }
        else if key == "layer2Scene" { popup.target = self; popup.action = #selector(layer2Changed) }
    }
    private func number(_ title: String, key: String, in stack: NSStackView) {
        let field = NSTextField(string: ""); field.widthAnchor.constraint(equalToConstant: 105).isActive = true
        let text = label(title); text.widthAnchor.constraint(equalToConstant: 195).isActive = true
        fields[key] = field; edits.append(field); stack.addArrangedSubview(horizontal([text, field]))
    }

    private func assignments() -> NSView {
        let stack = column()
        heading(L("assignTitle"), in: stack)
        paragraph(L("assignHint"), in: stack)
        for key in ["musicInput", "contentInput", "micInput", "mediaInput", "overlayScene", "overlaySource"] { choice(L(key), key: key, in: stack) }
        for (index, direction) in ["up", "right", "down", "left"].enumerated() {
            choice(L("anchorField", index + 1, L(direction)), key: "anchor\(index)", in: stack)
        }
        firstFourButton = button(L("assignFirstFour"), #selector(assignFirstFour))
        stack.addArrangedSubview(firstFourButton); edits.append(firstFourButton)

        heading(L("layersTitle"), in: stack)
        paragraph(L("layersHint"), in: stack)
        for key in ["layer1Scene", "layer1Source", "layer2Scene", "layer2Source"] { choice(L(key), key: key, in: stack) }

        heading(L("adjust"), in: stack)
        for (name, key) in [
            ("musicStep", "volumeStepDb"),
            ("duckCeiling", "duckDb"),
            ("fadeTicks", "ticks"),
            ("timingStep", "transitionStepMs"),
            ("opacityStep", "opacityPct")
        ] { number(L(name), key: key, in: stack) }
        paragraph(L("adjustHint"), in: stack)
        return scrolling(stack)
    }

    private func controlMapPage() -> NSView {
        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true
        scroll.hasHorizontalScroller = false
        mapTable.usesAlternatingRowBackgroundColors = true
        mapTable.rowHeight = 30
        mapTable.intercellSpacing = NSSize(width: 8, height: 2)
        mapTable.selectionHighlightStyle = .regular
        let iconCol = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("icon"))
        iconCol.title = ""; iconCol.width = 32; iconCol.minWidth = 32; iconCol.maxWidth = 32
        let ctlCol = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("control"))
        ctlCol.title = L("control"); ctlCol.width = 185; ctlCol.minWidth = 120
        let gesCol = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("gesture"))
        gesCol.title = L("gesture"); gesCol.width = 155; gesCol.minWidth = 100
        let actCol = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("action"))
        actCol.title = L("action"); actCol.width = 430; actCol.minWidth = 200
        for col in [iconCol, ctlCol, gesCol, actCol] { mapTable.addTableColumn(col) }
        mapTable.dataSource = self
        mapTable.delegate = self
        scroll.documentView = mapTable
        return scroll
    }

    func numberOfRows(in tableView: NSTableView) -> Int { mapRows.count }

    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        guard row >= 0 && row < mapRows.count, let id = tableColumn?.identifier.rawValue else { return nil }
        let entry = mapRows[row]
        if id == "icon" {
            let holder = NSView(frame: NSRect(x: 0, y: 0, width: 32, height: 30))
            if let image = glyph(for: entry.category) {
                let iv = NSImageView(image: image)
                iv.imageScaling = .scaleProportionallyUpOrDown
                iv.frame = NSRect(x: 4, y: 3, width: 24, height: 24)
                holder.addSubview(iv)
            }
            return holder
        }
        let textValue: String
        switch id {
        case "control": textValue = entry.control
        case "gesture": textValue = entry.gesture
        default: textValue = entry.action
        }
        let cell = NSTableCellView(frame: NSRect(x: 0, y: 0, width: 200, height: 30))
        let field = NSTextField(labelWithString: textValue)
        field.font = id == "control" ? .systemFont(ofSize: 12.5, weight: .medium) : .systemFont(ofSize: 12.5)
        field.lineBreakMode = .byTruncatingTail
        field.translatesAutoresizingMaskIntoConstraints = false
        cell.addSubview(field)
        NSLayoutConstraint.activate([
            field.leadingAnchor.constraint(equalTo: cell.leadingAnchor, constant: 2),
            field.trailingAnchor.constraint(equalTo: cell.trailingAnchor, constant: -4),
            field.centerYAnchor.constraint(equalTo: cell.centerYAnchor)
        ])
        return cell
    }

    private func glyph(for category: String) -> NSImage? {
        if let cached = glyphs[category] { return cached }
        let file = paths.icons.appendingPathComponent(category + ".png")
        guard let image = NSImage(contentsOf: file) else { return nil }
        glyphs[category] = image
        return image
    }

    private func readControlMap() {
        // The action names in the panel's language: build.sh bundles each language's map.json, as the Windows panel has them.
        let localized = paths.resources.appendingPathComponent("presets/\(PanelText.locale)/map.json")
        let file = PanelText.locale != "en" && FileManager.default.fileExists(atPath: localized.path) ? localized : paths.map
        guard FileManager.default.fileExists(atPath: file.path) else { return }
        do {
            mapRows = try ControlMapRow.load(data: Data(contentsOf: file))
            mapTable.reloadData()
        } catch {
            note(L("mapUnreadable"))
        }
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
        mixOnly.state = settings.mixEnabled && settings.mixOnly ? .on : .off
        vjster.state = settings.vjsterEnabled ? .on : .off; vjsterPort.stringValue = String(settings.vjsterPort)
        vjsterExtensionId.stringValue = settings.vjsterExtensionId
        if let item = vjsterTarget.itemArray.first(where: { $0.representedObject as? String == settings.vjsterTarget }) { vjsterTarget.select(item) }
        let values: [String: Double] = [
            "volumeStepDb": settings.volumeStepDb,
            "duckDb": settings.duckDb,
            "ticks": 1 / settings.faderStep,
            "transitionStepMs": Double(settings.transitionStepMs),
            "mixStepDb": settings.mixStepDb,
            "mixFadeMs": Double(settings.mixFadeMs),
            "opacityPct": settings.opacityStep * 100
        ]
        for (key, value) in values { fields[key]?.stringValue = String(format: "%g", value) }
    }

    private func selected(_ key: String) -> String { choices[key]?.selectedItem?.representedObject as? String ?? "" }

    private func fill(_ key: String, _ values: [String], keep: String) {
        guard let popup = choices[key] else { return }
        popup.removeAllItems()
        popup.addItem(withTitle: L("macUnassigned")); popup.lastItem?.representedObject = ""
        for value in Array(Set(values)).sorted() { popup.addItem(withTitle: value); popup.lastItem?.representedObject = value }
        if !keep.isEmpty && !values.contains(keep) { popup.addItem(withTitle: L("macUnavailable", keep)); popup.lastItem?.representedObject = keep }
        if let item = popup.itemArray.first(where: { $0.representedObject as? String == keep }) { popup.select(item) }
    }

    private func fillChoices(preserveEdits: Bool = false) {
        func keep(_ key: String, _ saved: String) -> String { preserveEdits ? selected(key) : saved }
        for (key, value) in [("musicInput", settings.musicInput), ("contentInput", settings.contentInput), ("micInput", settings.micInput)] {
            fill(key, catalog.audio, keep: keep(key, value))
        }
        fill("mediaInput", catalog.media, keep: keep("mediaInput", settings.mediaInput))
        let ovScene = keep("overlayScene", settings.overlayScene), ovSource = keep("overlaySource", settings.overlaySource)
        fill("overlayScene", catalog.scenes, keep: ovScene)
        fill("overlaySource", catalog.items[ovScene] ?? [], keep: ovSource)
        let l1Scene = keep("layer1Scene", settings.layer1Scene), l1Source = keep("layer1Source", settings.layer1Source)
        fill("layer1Scene", catalog.scenes, keep: l1Scene)
        fill("layer1Source", catalog.items[l1Scene] ?? [], keep: l1Source)
        let l2Scene = keep("layer2Scene", settings.layer2Scene), l2Source = keep("layer2Source", settings.layer2Source)
        fill("layer2Scene", catalog.scenes, keep: l2Scene)
        fill("layer2Source", catalog.items[l2Scene] ?? [], keep: l2Source)
        for index in 0..<4 { fill("anchor\(index)", catalog.scenes, keep: keep("anchor\(index)", settings.anchors[index])) }
    }

    @objc private func overlayChanged() { fill("overlaySource", catalog.items[selected("overlayScene")] ?? [], keep: "") }
    @objc private func layer1Changed() { fill("layer1Source", catalog.items[selected("layer1Scene")] ?? [], keep: "") }
    @objc private func layer2Changed() { fill("layer2Source", catalog.items[selected("layer2Scene")] ?? [], keep: "") }
    @objc private func vjsterToggled() { refreshIndicators() }
    @objc private func mixToggled() {
        if mix.state != .on { mixOnly.state = .off }
        updateEnabled()
    }
    @objc private func mixOnlyToggled() { refreshIndicators() }
    /// Stream Deck-only mode: chosen, and possible (it needs All OBS mixer inputs).
    private var mixOnlyChosen: Bool { mix.state == .on && mixOnly.state == .on }

    @objc private func assignFirstFour() {
        guard !catalog.scenes.isEmpty else {
            let msg = L("discoverFirst")
            setStatus(msg); note(msg); return
        }
        for index in 0..<4 {
            let target = index < catalog.scenes.count ? catalog.scenes[index] : ""
            if let popup = choices["anchor\(index)"], let item = popup.itemArray.first(where: { $0.representedObject as? String == target }) {
                popup.select(item)
            }
        }
        let msg = L("assignPreviewed")
        setStatus(msg); note(msg)
    }

    private func current() throws -> Settings {
        var result = settings
        guard let value = Int(port.stringValue.trimmingCharacters(in: .whitespaces)) else { throw PanelFailure.message(L("macErrPort")) }; result.port = value
        guard let vjPort = Int(vjsterPort.stringValue.trimmingCharacters(in: .whitespaces)) else { throw PanelFailure.message(L("macErrVjPort")) }; result.vjsterPort = vjPort
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
            guard let text = fields[key]?.stringValue, let value = Double(text.trimmingCharacters(in: .whitespaces)), value.isFinite else { throw PanelFailure.message(L("macErrNumber", key)) }; return value
        }
        result.volumeStepDb = try number("volumeStepDb"); result.duckDb = try number("duckDb")
        let ticks = try number("ticks"); guard (1...1000).contains(ticks) else { throw PanelFailure.message(L("macErrTicks")) }; result.faderStep = 1 / ticks
        let opacityPct = try number("opacityPct"); guard (1...50).contains(opacityPct) else { throw PanelFailure.message(L("macErrOpacity")) }; result.opacityStep = opacityPct / 100.0
        let timing = try number("transitionStepMs"), duration = try number("mixFadeMs")
        guard timing.rounded() == timing, (1...5000).contains(timing), duration.rounded() == duration, (0...10000).contains(duration) else { throw PanelFailure.message(L("macErrTiming")) }
        result.transitionStepMs = Int(timing); result.mixFadeMs = Int(duration); result.mixStepDb = try number("mixStepDb"); result.mixEnabled = mix.state == .on
        result.mixOnly = mixOnlyChosen
        try result.validate(); return result
    }

    private func refreshIndicators() {
        let controlsOn = host.running
        let canAct = !scanning && !invalidSettings && !previewMode
        let consoleReady = tourboxConsoleInstalled || tourboxConsoleRunning
        let obsState = Readiness.obs(connected: obsConnected, running: obsRunning, problem: obsProblem, studioOff: studioOff, controlsOn: controlsOn)
        let onlyMix = mixOnlyChosen
        // Stream Deck-only mode needs no Accessibility: it moves no T-bar.
        let axReady = axTrusted || onlyMix
        let tbState = Readiness.tourBox(consoleRunning: tourboxConsoleRunning, consoleInstalled: consoleReady, mixOnly: onlyMix)
        let vjEnabled = vjster.state == .on
        let vjState = Readiness.vjster(enabled: vjEnabled, controlsOn: controlsOn, connectedPeers: vjsterPeers.count, portBusy: vjsterPortBusy, mixOnly: onlyMix)
        let ctlState = Readiness.controls(running: controlsOn, armed: host.isArmed, axTrusted: axReady, obsConnected: obsConnected)

        let syncState: PresetSyncState = lastSavedPreset != nil
            ? .current
            : (bundledPresetHash.isEmpty ? .neverSaved : LocalFiles.presetSyncState(bundledHash: bundledPresetHash, savedHash: savedPresetHash))
        obsLight.display(obsState, enabled: !scanning)
        tourboxLight.display(tbState, enabled: true)
        vjsterLight.display(vjState, enabled: true)
        controlsLight.display(ctlState, enabled: controlsOn || !axReady || canAct)
        mixOnly.isEnabled = mix.state == .on && !controlsOn && !scanning
        savePresetStepButton?.title = syncState == .updateAvailable ? L("macSavePresetUpdated") : L("macSavePreset")
        openConsoleStepButton?.title = consoleReady ? L("macOpenConsoleStep") : L("macDownloadConsoleStep")
        grantAxButton?.bezelColor = axTrusted ? nil : accentColor
        axStatusLabel.stringValue = axTrusted ? L("macAxGranted") : L("macAxNeeded")
        axStatusLabel.textColor = axTrusted ? NSColor(srgbRed: 40 / 255, green: 140 / 255, blue: 72 / 255, alpha: 1) : reminderFgColor
        importGuideWindow?.update(savedPreset: lastSavedPreset, consoleInstalled: consoleReady)

        let parsedVjPort = Int(vjsterPort.stringValue.trimmingCharacters(in: .whitespaces)) ?? settings.vjsterPort
        diagramView.state = SetupDiagramView.State(
            obsLamp: obsState.lamp,
            obsRunning: obsRunning,
            obsConnected: obsConnected,
            studioOff: studioOff,
            frontIsObs: frontIsObs,
            obsAction: obsState.action ?? "server",
            tourBoxLamp: tbState.lamp,
            consoleRunning: tourboxConsoleRunning,
            consoleInstalled: consoleReady,
            presetSync: syncState,
            vjsterLamp: vjState.lamp,
            vjsterEnabled: vjEnabled,
            vjsterPort: parsedVjPort,
            vjsterConnected: !vjsterPeers.isEmpty,
            vjsterPortBusy: vjsterPortBusy,
            controlsLamp: ctlState.lamp,
            controlsRunning: controlsOn,
            controlsArmed: host.isArmed,
            axTrusted: axReady,
            canStart: canAct
        )

        if let banner = Readiness.banner(controlsOn: controlsOn, obsHidden: obsHidden, consoleRunning: tourboxConsoleRunning, frontIsObs: frontIsObs, axTrusted: axReady, mixOnly: onlyMix,
                                           frontIsChrome: frontIsChrome, obsRunning: obsRunning) {
            reminderLabel.stringValue = banner.text
            reminderAction.titleText = banner.button
            bannerActionId = banner.action
            reminderCard.isHidden = false
        } else {
            reminderCard.isHidden = true
        }
    }

    private func watchDesktop() {
        guard !previewMode else { return }
        axTrusted = AXIsProcessTrusted()
        let apps = NSWorkspace.shared.runningApplications
        let obsApp = apps.first {
            $0.bundleIdentifier == "com.obsproject.obs-studio" || $0.localizedName == "OBS" || $0.localizedName == "OBS Studio"
        }
        let wasObsRunning = obsRunning
        obsRunning = obsApp != nil
        obsHidden = obsApp?.isHidden == true
        tourboxConsoleRunning = apps.contains {
            ($0.localizedName?.localizedCaseInsensitiveContains("TourBox Console") == true) || ($0.bundleIdentifier?.localizedCaseInsensitiveContains("tourbox") == true)
        }
        tourboxConsoleInstalled = tourboxConsoleRunning
            || FileManager.default.fileExists(atPath: "/Applications/TourBox Console.app")
            || (NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.tourbox.ui.launch") != nil)
        if let front = NSWorkspace.shared.frontmostApplication {
            frontIsObs = front.bundleIdentifier == "com.obsproject.obs-studio" || front.localizedName == "OBS" || front.localizedName == "OBS Studio"
            frontIsChrome = front.bundleIdentifier == "com.google.Chrome"
        } else {
            frontIsObs = false; frontIsChrome = false
        }
        if obsRunning && !wasObsRunning && !host.running && !obsConnected {
            autoTries = 4
            nextAutoScan = Date().addingTimeInterval(3.5)
        }
        if !obsRunning && !host.running {
            obsConnected = false; studioOff = false; obsProblem = nil; autoTries = 0
            snapshot.stringValue = L("macObsNotRunning")
            if !vsStatus.isEmpty { setMeter("") }
        }
        if obsConnected || host.running { autoTries = 0 }
        if autoTries > 0 && !scanning && !invalidSettings && Date() >= nextAutoScan && (obsProblem == nil || obsProblem == "obs-no-answer") {
            autoTries -= 1
            nextAutoScan = Date().addingTimeInterval(4.5)
            performScan(silentIfOffline: true)
        }
        refreshIndicators()
    }

    private func handleHostLine(_ safeLine: String) {
        // The meter's lines come up to 5 times a second: they update the meter line, never Activity (as on Windows).
        if let meter = Readiness.vsMeter(safeLine) {
            setMeter(meter)
            return
        }
        vjsterPeers = Readiness.vjsterPeers(after: safeLine, current: vjsterPeers)
        vjsterPortBusy = Readiness.vjsterPortBusy(after: safeLine, current: vjsterPortBusy)
        if safeLine.hasPrefix("OFFLINE:") {
            obsConnected = false
            setMeter("")
            let problem = Readiness.obsProblem(from: safeLine)
            obsProblem = problem == "obs-no-answer" ? nil : problem
        } else if safeLine.hasPrefix("ERROR:") {
            let problem = Readiness.obsProblem(from: safeLine)
            if problem != "obs-no-answer" || safeLine.localizedCaseInsensitiveContains("WebSocket") {
                obsProblem = problem
            }
        }
        if let feedback = Readiness.hostFeedback(from: safeLine) {
            setStatus(feedback)
        }
        refreshIndicators()
        note(safeLine)
    }

    private func bringObsToFront() {
        guard !previewMode else { return }
        if let obsApp = NSWorkspace.shared.runningApplications.first(where: {
            $0.bundleIdentifier == "com.obsproject.obs-studio" || $0.localizedName == "OBS" || $0.localizedName == "OBS Studio"
        }) {
            obsApp.unhide()
            obsApp.activate(options: [.activateAllWindows])
            return
        }
        let obsUrl = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.obsproject.obs-studio") ?? URL(fileURLWithPath: "/Applications/OBS.app")
        if FileManager.default.fileExists(atPath: obsUrl.path) {
            NSWorkspace.shared.openApplication(at: obsUrl, configuration: .init(), completionHandler: nil)
        } else {
            setStatus(L("macObsAppMissing"))
        }
    }

    private func handleDiagramAction(_ action: String) {
        guard !previewMode else { return }
        switch action {
        case "savePreset": saveAndGuidePreset()
        case "guide": showImportGuide()
        case "scan": scan()
        case "copyObsUrl": copyObsUrl()
        default: handleLightAction(action)
        }
    }

    private func handleLightAction(_ action: String) {
        guard !previewMode else { return }
        switch action {
        case "start": rememberControls("on"); start()
        case "stop": rememberControls("off"); stop()
        case "tryAgain":
            rememberControls("on")
            if host.running { return }
            startAfterScan = true
            performScan(silentIfOffline: false)
        case "openObs": bringObsToFront()
        case "openConsole": openTourBoxConsole()
        case "downloadConsole": downloadTourBoxConsole()
        case "grantAx": grantAccessibility()
        case "studio", "password", "server", "vjsterWait", "vjsterPort":
            openObsShowMe(mode: action)
        default: break
        }
    }

    private func openObsShowMe(mode: String) {
        showMeWindow?.close()
        let canvasMode: ShowMeCanvas.Mode
        let title: String
        let detail: String
        let buttonTitle: String?
        let action: (() -> Void)?
        switch mode {
        case "studio":
            canvasMode = .obsStudio
            title = L("showStudioTitle")
            detail = L("showStudioHint")
            buttonTitle = L("discover")
            action = { [weak self] in self?.scan() }
        case "password":
            canvasMode = .obsPassword
            title = L("showPasswordTitle")
            detail = L("obsBadPassword")
            buttonTitle = L("discover")
            action = { [weak self] in self?.scan() }
        case "vjsterWait":
            canvasMode = .vjsterWait
            title = L("showVjWaitTitle")
            detail = L("showVjWaitHint")
            buttonTitle = L("copyObsUrl")
            action = { [weak self] in self?.copyObsUrl() }
        case "vjsterPort":
            let activePort = Int(vjsterPort.stringValue.trimmingCharacters(in: .whitespaces)) ?? settings.vjsterPort
            canvasMode = .vjsterPort(port: activePort)
            title = L("showVjPortTitle", activePort)
            detail = L("showVjPortHint")
            buttonTitle = nil
            action = nil
        default:
            canvasMode = .obsServer
            title = L("showServerTitle")
            detail = obsProblem == "obs-no-password" ? L("obsNoPassword") : obsProblem == "obs-auth-off" ? L("obsAuthOff") : L("obsNoAnswer")
            buttonTitle = L("discover")
            action = { [weak self] in self?.scan() }
        }
        let win = ObsShowMeWindow(mode: canvasMode, title: title, detail: detail, actionTitle: buttonTitle, onAction: action)
        showMeWindow = win
        win.show(relativeTo: window)
    }

    private func updateEnabled() {
        let editable = !host.running && !scanning
        edits.forEach { $0.isEnabled = editable }
        scanButton?.isEnabled = editable && !invalidSettings && !previewMode
        saveButton?.isEnabled = editable && !invalidSettings && !previewMode
        if host.running {
            primaryButton?.title = L("stop")
            primaryButton?.bezelColor = NSColor(srgbRed: 184 / 255, green: 58 / 255, blue: 52 / 255, alpha: 1)
            primaryButton?.isEnabled = !previewMode
        } else {
            primaryButton?.title = L("saveStart")
            primaryButton?.bezelColor = accentColor
            primaryButton?.isEnabled = editable && !invalidSettings && !previewMode
        }
        refreshIndicators()
    }

    private func note(_ text: String) {
        let safe = redact(text, secrets: [password.stringValue, settings.vjsterObsToken])
        let line = DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .medium) + "  " + safe + "\n"
        activity.textStorage?.append(NSAttributedString(string: line))
        if activity.string.count > 60_000 { activity.string = String(activity.string.suffix(45_000)) }
        activity.scrollToEndOfDocument(nil)
    }

    private func failure(_ error: Error) {
        let text = (error as? PanelFailure)?.description ?? L("macErrGeneric")
        setStatus(text); note(text)
    }

    @objc private func toggleControls() {
        if host.running { rememberControls("off"); stop() } else { rememberControls("on"); start() }
    }

    @objc private func toggleFeedback() {
        guard !previewMode else { return }
        if let existing = hud, existing.isVisible {
            existing.close(); return
        }
        if hud == nil { hud = FeedbackHud() }
        hud?.set(status.stringValue)
        hud?.setMeter(vsStatus)
        hud?.show()
    }

    @objc private func save() {
        guard !invalidSettings && !host.running && !previewMode else { return }
        do {
            settings = try current(); try LocalFiles.save(settings)
            setStatus(L("saved")); note(status.stringValue)
        } catch { failure(error) }
    }

    @objc private func start() {
        guard !invalidSettings && !host.running && !scanning && !previewMode else { return }
        do {
            let proposed = try current()
            // OBS not set up (or not installed): with VJster on, start anyway for Chrome's videos; the host keeps looking for OBS (FIX-8).
            let secret: String
            do { secret = try LocalFiles.password(port: proposed.port, override: password.stringValue) }
            catch where proposed.vjsterEnabled && !proposed.mixOnly { secret = "" }
            try paths.validate(); try LocalFiles.save(proposed); settings = proposed
            axTrusted = AXIsProcessTrusted()
            if !axTrusted && !proposed.mixOnly {
                grantAccessibility()
                updateEnabled()
                return
            }
            vjsterPeers.removeAll()
            vjsterPortBusy = false
            try host.start(paths: paths, config: LocalFiles.settings, password: secret, mixEnabled: proposed.mixEnabled, mixOnly: proposed.mixOnly, extraSecrets: [proposed.vjsterObsToken])
            updateEnabled()
        } catch { failure(error); updateEnabled() }
    }

    @objc private func stop() { host.stop(); updateEnabled() }

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
            setStatus(L(hasId ? "obsUrlCopied" : "obsUrlCopiedBlank"))
            note(status.stringValue)
        } catch { failure(error) }
    }

    @objc private func scan() { performScan(silentIfOffline: false) }

    private func performScan(silentIfOffline: Bool) {
        guard !host.running && !scanning && !previewMode && !invalidSettings else { return }
        let targetPort: Int
        if let parsed = Int(port.stringValue.trimmingCharacters(in: .whitespaces)), (1...65535).contains(parsed) {
            targetPort = parsed
        } else {
            if !silentIfOffline { failure(PanelFailure.message(L("macErrPort"))) }
            return
        }
        let secret: String
        do {
            secret = try LocalFiles.password(port: targetPort, override: password.stringValue)
        } catch {
            obsConnected = false
            obsProblem = Readiness.obsProblem(from: (error as? PanelFailure)?.description ?? "")
            refreshIndicators()
            if !silentIfOffline { failure(error) }
            return
        }
        let client: ObsDiscovery
        do { client = try ObsDiscovery(port: targetPort) }
        catch { if !silentIfOffline { failure(error) }; return }

        scanning = true
        obsProblem = nil
        updateEnabled()
        setStatus(L("macReading"))
        scanTask = Task { [weak self] in
            guard let self else { return }
            do {
                self.catalog = try await client.scan(password: secret)
                self.fillChoices(preserveEdits: true)
                self.obsConnected = true
                self.obsRunning = true
                self.obsProblem = nil
                self.studioOff = !self.catalog.studio
                self.snapshot.stringValue = L("sceneSummary", self.catalog.program, self.catalog.preview, L(self.catalog.studio ? "on" : "off"))
                self.setMeter(Readiness.vsMeter(self.catalog.visualSidechain) ?? "")
                let readyMsg = L("obsReady", self.catalog.scenes.count)
                self.setStatus(readyMsg)
                self.note(readyMsg)
            } catch {
                self.obsConnected = false
                let desc = (error as? PanelFailure)?.description ?? error.localizedDescription
                self.obsProblem = Readiness.obsProblem(from: desc)
                self.snapshot.stringValue = ""
                self.setMeter("")
                if !silentIfOffline || self.obsProblem == "obs-bad-password" || self.obsProblem == "obs-auth-off" {
                    self.failure(error)
                } else {
                    self.setStatus(self.obsRunning ? L("macWaitingWs", targetPort) : L("macObsNotRunning"))
                }
            }
            self.scanning = false; self.scanTask = nil; self.updateEnabled()
            // After the scan, OBS or not: with VJster on, the host serves Chrome's videos without OBS (FIX-8).
            let asked = self.startAfterScan
            self.startAfterScan = false
            guard !self.host.running else { return }
            if asked { if self.obsConnected || (self.vjster.state == .on && !self.mixOnlyChosen) { self.start() }; return }
            self.autoStartIfWanted()
        }
    }

    /// Start the controls by themselves if Readiness.autoStart allows it (FIX-5, FIX-8).
    private func autoStartIfWanted() {
        guard !host.running && !scanning && !previewMode else { return }
        let axReady = AXIsProcessTrusted() || mixOnlyChosen
        if Readiness.autoStart(settingsSaved: FileManager.default.fileExists(atPath: LocalFiles.settings.path), settingsValid: !invalidSettings,
                               remembered: rememberedControls, obsConnected: obsConnected, controlsOn: host.running, axReady: axReady,
                               vjsterOn: vjster.state == .on, mixOnly: mixOnlyChosen) {
            start()
            if host.running { setStatus(L("autoStarted")); note(L("autoStarted")) }
        }
    }

    private func openTourBoxConsole() {
        let console = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.tourbox.ui.launch") ?? URL(fileURLWithPath: "/Applications/TourBox Console.app")
        if FileManager.default.fileExists(atPath: console.path) {
            NSWorkspace.shared.openApplication(at: console, configuration: .init(), completionHandler: nil)
        } else {
            downloadTourBoxConsole()
        }
    }

    @objc private func downloadTourBoxConsole() {
        guard !previewMode, let url = URL(string: "https://www.tourboxtech.com/en/downloads/") else { return }
        NSWorkspace.shared.open(url)
        setStatus(L("consoleDownloadOpened"))
        note(L("consoleDownloadOpened") + " https://www.tourboxtech.com/en/downloads/")
    }

    @objc private func openPresetSquare() {
        guard !previewMode, let url = URL(string: "https://www.tourboxtech.com/en/presets/") else { return }
        NSWorkspace.shared.open(url)
        setStatus(L("macPresetSquareOpened"))
        note(L("macPresetSquareOpened") + " https://www.tourboxtech.com/en/presets/")
    }

    @objc private func openOrDownloadConsole() {
        guard !previewMode else { return }
        if lastSavedPreset == nil && savedPresetHash == nil {
            importNote.stringValue = L("macNeedPreset")
            importNote.isHidden = false
        }
        if tourboxConsoleInstalled || tourboxConsoleRunning {
            openTourBoxConsole()
        } else {
            downloadTourBoxConsole()
        }
    }

    private func savePresetDialog() -> URL? {
        guard !previewMode else { return nil }
        let save = NSSavePanel()
        save.nameFieldStringValue = "OBS Fadester for TourBox.tb"
        save.title = L("macSaveDialogTitle")
        save.message = L("macSaveDialogMessage")
        guard save.runModal() == .OK, let url = save.url else { return nil }
        do {
            let presetBytes = try Data(contentsOf: paths.localizedPreset)
            try presetBytes.write(to: url, options: .atomic)
            let hash = LocalFiles.sha256Hex(presetBytes)
            bundledPresetHash = hash
            savedPresetHash = hash
            try? LocalFiles.recordPresetSaved(bundledHash: hash)
            lastSavedPreset = url
            let folder = url.deletingLastPathComponent().lastPathComponent
            importNote.stringValue = L("macPresetSaved", url.path)
            importNote.isHidden = false
            setStatus(L("macPresetSavedStatus", folder))
            note(L("macPresetSaved", url.path))
            refreshIndicators()
            return url
        } catch {
            failure(error)
            return nil
        }
    }

    @objc private func saveAndGuidePreset() {
        if savePresetDialog() != nil {
            showImportGuide()
        }
    }

    @objc private func showImportGuide() {
        guard !previewMode else { return }
        let consoleReady = tourboxConsoleInstalled || tourboxConsoleRunning
        if let existing = importGuideWindow {
            existing.update(savedPreset: lastSavedPreset, consoleInstalled: consoleReady)
            existing.show(relativeTo: window)
            return
        }
        let guide = TourBoxImportWindow(
            savedPreset: lastSavedPreset,
            consoleInstalled: consoleReady,
            onSavePreset: { [weak self] in self?.savePresetDialog() },
            onOpenConsole: { [weak self] in self?.openTourBoxConsole() },
            onDownloadConsole: { [weak self] in self?.downloadTourBoxConsole() }
        )
        importGuideWindow = guide
        guide.show(relativeTo: window)
    }

    @objc private func grantAccessibility() {
        guard !previewMode else { return }
        let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        axTrusted = AXIsProcessTrustedWithOptions(opts)
        if !axTrusted, let settingsUrl = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
            NSWorkspace.shared.open(settingsUrl)
        }
        let msg = axTrusted
            ? L("macAxGrantedMsg")
            : L("macAxEnableMsg")
        setStatus(msg)
        note(msg)
        refreshIndicators()
    }

    @objc private func permission() {
        guard !previewMode else { return }
        guard FileManager.default.fileExists(atPath: paths.native.path) else { failure(PanelFailure.message(L("macNativeMissing"))); return }
        NSWorkspace.shared.openApplication(at: paths.native, configuration: .init()) { _, error in
            if error != nil { DispatchQueue.main.async { self.note(L("macNativeOpenFailed")) } }
        }
    }

    @objc private func guide() { if !previewMode { NSWorkspace.shared.open(paths.guide) } }

    func windowShouldClose(_ sender: NSWindow) -> Bool { NSApp.terminate(nil); return false }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        watchTimer?.invalidate(); watchTimer = nil
        hud?.close(); hud = nil
        importGuideWindow?.close(); importGuideWindow = nil
        showMeWindow?.close(); showMeWindow = nil
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

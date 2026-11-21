// SPDX-License-Identifier: GPL-2.0-or-later
import AppKit
import ServiceManagement
import ApplicationServices

private func rgb(_ red: CGFloat, _ green: CGFloat, _ blue: CGFloat) -> NSColor { NSColor(srgbRed: red / 255, green: green / 255, blue: blue / 255, alpha: 1) }
/// One colour for the light appearance and one for the dark one: the window follows the Mac's Appearance setting.
/// The colour is chosen each time it is drawn, so switching the Mac between Light and Dark needs no restart.
private func adaptive(light: NSColor, dark: NSColor) -> NSColor {
    NSColor(name: nil) { appearance in appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua ? dark : light }
}
/// The header, the feedback window and the buttons: the same in both appearances (white text on them).
private let navyColor = rgb(26, 34, 51)
private let accentColor = rgb(38, 90, 158)
/// Text that is navy on the light window: headings, the lights' words, the Program/Preview line.
private let inkColor = adaptive(light: rgb(26, 34, 51), dark: rgb(226, 232, 244))
/// Text that is the accent blue on the light window: sub-headings, the meter line, the preset note.
private let accentTextColor = adaptive(light: rgb(38, 90, 158), dark: rgb(128, 176, 240))
private let panelColor = adaptive(light: .white, dark: rgb(30, 33, 40))
private let stripColor = adaptive(light: rgb(241, 244, 249), dark: rgb(44, 50, 63))
private let reminderBgColor = adaptive(light: rgb(255, 241, 214), dark: rgb(84, 62, 14))
private let reminderFgColor = adaptive(light: rgb(107, 74, 0), dark: rgb(255, 220, 150))
private let grantedColor = adaptive(light: rgb(40, 140, 72), dark: rgb(110, 210, 140))

private final class FlippedDocument: NSView { override var isFlipped: Bool { true } }

private final class PanelBackground: NSView {
    override var isOpaque: Bool { true }
    override func draw(_ dirtyRect: NSRect) { panelColor.setFill(); dirtyRect.fill() }
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
        words.textColor = inkColor
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

/// A part of the Setup page that stays closed until asked for (U3-05), as on Windows: a numbered step's Details link, or
/// an optional section's title with its state in a few words and Show / Hide.
@MainActor private final class SetupFold: NSObject {
    let id: String
    let section: Bool
    let link = NSButton(title: "", target: nil, action: nil)
    let summary = NSTextField(labelWithString: "")
    let content = NSStackView()
    private(set) var open = false
    /// A light asked for this part and it was opened for that: a later Hide by the user then stays.
    var called = false
    var toggled: (() -> Void)?

    init(id: String, section: Bool) {
        self.id = id; self.section = section
        super.init()
        link.isBordered = false
        link.target = self; link.action = #selector(clicked)
        content.orientation = .vertical; content.alignment = .leading; content.spacing = 10
        summary.font = .systemFont(ofSize: 12.5)
        summary.textColor = .secondaryLabelColor
        set(false)
    }

    func set(_ value: Bool) {
        open = value
        let words = L(value ? "foldHide" : section ? "foldShow" : "foldDetails") + (value ? " ▴" : " ▾")
        link.attributedTitle = NSAttributedString(string: words, attributes: [.foregroundColor: accentTextColor, .font: NSFont.systemFont(ofSize: 12.5)])
        content.isHidden = !value
    }

    @objc private func clicked() { set(!open); toggled?() }
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
        panel.title = titledWithVersion(L("lastAction"))
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
    private var obsConnected = false, obsRunning = false, obsHidden = false, studioOff = false, tourboxConsoleRunning = false, tourboxConsoleInstalled = true, frontIsObs = false, frontIsChrome = false, vjsterPortBusy = false, vjsterOnDeck = false, axTrusted = true
    private var bannerActionId = "openObs"
    private var obsProblem: String?
    private var vjsterPeers: Set<String> = []
    private var lastSavedPreset: URL?
    private var bundledPresetHash = ""
    private var savedPresetHash: String?
    private var autoTries = 0
    /// Try again was pressed with the controls off: the next scan that reads OBS starts them.
    private var startAfterScan = false
    // Whether Console holds an older OBS Fadester preset than ours (Model.swift PresetAge, FIX-9): read every few seconds, said once.
    private var presetState = PresetState.unknown, shippedShortcuts: Set<String>?, presetCheckAt = Date.distantPast, toldOldPreset = false
    /// What Console's files looked like at the last complete read (PresetAge.stamp): unchanged, they are not read again.
    private var presetStamp: String?
    /// A video has been connected to VJster on this Mac at some time: until then its light does not nag.
    private var vjsterUsed: Bool {
        get { UserDefaults.standard.bool(forKey: "fadester.vjsterSeen") }
        set { UserDefaults.standard.set(newValue, forKey: "fadester.vjsterSeen") }
    }
    /// Studio Mode off is read again every 10 s while the controls run, so turning it on in OBS by hand clears the light.
    /// Twelve looks 10 s apart (two minutes) after the light turned amber, then one a minute: someone who works without
    /// Studio Mode must not have OBS asked every 10 s for the whole show.
    private var studioCheckAt = Date.distantPast, studioChecksLeft = 0
    /// The port last filled in from OBS's own settings file; another value in the box was typed by hand.
    private var filledPort: Int?
    /// The menu-bar icon: with the controls on, closing the window hides it and the show goes on.
    private var statusItem: NSStatusItem?
    private var statusToggle: NSMenuItem?
    /// TourBox Console's Auto Switch and whether its selected preset is ours (Model.swift PresetAge): they decide the reminder strip.
    private var startedWith: Settings?
    private var catalogAt = Date.distantPast
    private var consoleAutoSwitch: Bool?, activeFadester: Bool?, shippedLayout: String?
    /// Whether the user last started ("on") or stopped ("off") the controls; kept apart from panel-config.json, which start() rewrites.
    private var rememberedControls: String? { UserDefaults.standard.string(forKey: "fadester.controlsLastAction") }
    private func rememberControls(_ onOff: String) { UserDefaults.standard.set(onOff, forKey: "fadester.controlsLastAction") }
    private var nextAutoScan = Date.distantFuture
    private var nextSlowScan = Date.distantPast
    private var watchTimer: Timer?
    private var scanTask: Task<Void, Never>?
    private let host = HostController()
    private var hud: FeedbackHud?
    private var importGuideWindow: TourBoxImportWindow?
    /// "Open when I sign in" (U3-06): a login item of the app itself, off until ticked. macOS 13 and later.
    private var openAtLogin = NSButton(checkboxWithTitle: L("openAtSignIn"), target: nil, action: nil)
    /// The folded parts of the Setup page, and which of them the user left open (a preference of this window, not a setting of the controls).
    private var folds: [SetupFold] = []
    private var obsFold: SetupFold?, mixFold: SetupFold?, vjFold: SetupFold?
    private var openFolds: [String] { UserDefaults.standard.stringArray(forKey: "fadester.openFolds") ?? [] }
    private var showMeWindow: ObsShowMeWindow?
    private var window: NSWindow!
    private var tabs: NSTabView!
    private var navigation: [NSButton] = []
    private var obsLight = LightView(), tourboxLight = LightView(), vjsterLight = LightView(), controlsLight = LightView()
    private var diagramView = SetupDiagramView()
    private var reminderCard = RoundedCardView(fill: reminderBgColor, radius: 5)
    private var reminderLabel = NSTextField(wrappingLabelWithString: "")
    private var reminderAction = PillActionButton()
    private var status = NSTextField(wrappingLabelWithString: L("macLookingForObs"))
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
        // Never taller or wider than the screen it opens on (a 13-inch laptop has less room than the window asks for).
        if let room = (window.screen ?? NSScreen.main)?.visibleFrame, window.frame.height > room.height || window.frame.width > room.width {
            window.setFrame(NSRect(x: room.minX, y: room.minY, width: min(window.frame.width, room.width), height: min(window.frame.height, room.height)), display: false)
        }
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        guard !previewMode else { return }
        makeStatusItem()
        followObsPort()
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

    /// The icon in the menu bar (top right of the screen): Open, Start or Stop, and Quit. It is what brings the window
    /// back after it was closed with the controls on.
    private func makeStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let icon = NSApplication.shared.applicationIconImage.copy() as? NSImage {
            icon.size = NSSize(width: 18, height: 18)
            item.button?.image = icon
        } else {
            item.button?.title = "F"
        }
        item.button?.toolTip = window.title
        let menu = NSMenu()
        let open = NSMenuItem(title: L("trayOpen"), action: #selector(showWindow), keyEquivalent: "")
        open.target = self; menu.addItem(open)
        let toggle = NSMenuItem(title: L("saveStart"), action: #selector(toggleControls), keyEquivalent: "")
        toggle.target = self; menu.addItem(toggle)
        menu.addItem(.separator())
        menu.addItem(withTitle: L("macQuit"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "")
        item.menu = menu
        statusItem = item; statusToggle = toggle
    }

    @objc private func showWindow() {
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    /// A click on the Dock icon with the window closed brings it back.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag && !previewMode { showWindow() }
        return true
    }

    /// The OBS port fills itself in from OBS's own settings file, as the password does, until a port is typed by hand
    /// (that is how another OBS is chosen). Never while the controls run, and never onto VJster's port.
    private func followObsPort() {
        guard settings.portAuto, !host.running, !previewMode, !invalidSettings else { return }
        // A value that is not the one filled in last was typed: it stays, and current() saves that choice.
        if let filled = filledPort, port.stringValue.trimmingCharacters(in: .whitespaces) != String(filled) { return }
        if filledPort == nil && port.stringValue.trimmingCharacters(in: .whitespaces) != String(settings.port) { return }
        guard let found = LocalFiles.obsPort() else { filledPort = filledPort ?? settings.port; return }
        let vjPort = Int(vjsterPort.stringValue.trimmingCharacters(in: .whitespaces)) ?? settings.vjsterPort
        if vjster.state == .on && found == vjPort { filledPort = filledPort ?? settings.port; return }
        port.stringValue = String(found); filledPort = found
    }

    /// The app's version (CFBundleShortVersionString in Info.plist); "" when the bundle does not say.
    static func appVersion() -> String {
        (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String)?.trimmingCharacters(in: .whitespaces) ?? ""
    }

    func build() {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 920, height: 856), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        // Light or dark with the Mac (System Settings → Appearance). The setup diagram and the Show-me windows are
        // drawn in fixed colours on their own light card, so they stay light.
        diagramView.appearance = NSAppearance(named: .aqua)
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
        // Two lines, then an ellipsis, as on Windows; the whole message is the tooltip and the newest line in Activity.
        status.isSelectable = false
        status.maximumNumberOfLines = 2
        status.lineBreakMode = .byWordWrapping
        status.cell?.truncatesLastVisibleLine = true
        status.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
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
            status.widthAnchor.constraint(lessThanOrEqualTo: headerCard.widthAnchor, constant: -100)
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
        // The box shows what macOS has: System Settings → General → Login Items can switch it off too.
        if #available(macOS 13.0, *) {
            openAtLogin.target = self; openAtLogin.action = #selector(openAtLoginToggled)
            openAtLogin.state = !previewMode && SMAppService.mainApp.status == .enabled ? .on : .off
            root.addArrangedSubview(openAtLogin)
        }
        root.addArrangedSubview(label(L("macKeepOpen"), small: true))

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
                let wasLive = self.obsConnected
                self.obsConnected = self.host.isObsLive
                if self.host.isObsLive { self.obsProblem = nil }
                if self.host.isObsLive && !wasLive { self.performScan(silentIfOffline: true, listsOnly: true) }
            }
            self.setStatus(text)
            self.updateEnabled()
        }
        host.exited = { [weak self] in
            guard let self else { return }
            self.setMeter("")
            self.vjsterPeers.removeAll()
            self.vjsterPortBusy = false; self.vjsterOnDeck = false
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
        status.toolTip = text // the line is cut at the window's width; the whole message is here and in Activity
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
        let text = label(title); text.font = .boldSystemFont(ofSize: 14.5); text.textColor = inkColor; stack.addArrangedSubview(text)
    }
    private func subheading(_ title: String, in stack: NSStackView) {
        let text = label(title); text.font = .boldSystemFont(ofSize: 13); text.textColor = accentTextColor; stack.addArrangedSubview(text)
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
        // An old list is read again on the way to a page, as on Windows when Assignments opens (hand test 2026-11-17).
        if host.running && obsConnected && Date().timeIntervalSince(catalogAt) > 10 { performScan(silentIfOffline: true, listsOnly: true) }
    }
    private func scrolling(_ stack: NSStackView) -> NSScrollView {
        let scroll = NSScrollView(); scroll.hasVerticalScroller = true; scroll.drawsBackground = true; scroll.backgroundColor = panelColor
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

    /// Starts a folded part under what was just added: with a title an optional section, without one a step's Details.
    private func fold(_ id: String, title: String? = nil, in stack: NSStackView) -> SetupFold {
        let part = SetupFold(id: id, section: title != nil)
        if let title {
            let text = NSTextField(labelWithString: title)
            text.font = .boldSystemFont(ofSize: 14.5); text.textColor = inkColor
            text.lineBreakMode = .byTruncatingTail
            text.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
            stack.addArrangedSubview(horizontal([text, part.summary, part.link]))
        } else {
            stack.addArrangedSubview(part.link)
        }
        stack.addArrangedSubview(part.content)
        part.content.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
        part.toggled = { [weak self] in
            guard let self, !self.previewMode else { return }
            UserDefaults.standard.set(self.folds.filter { $0.open }.map { $0.id }, forKey: "fadester.openFolds")
        }
        if !previewMode && openFolds.contains(id) { part.set(true) }
        folds.append(part)
        return part
    }
    /// A light asks for something inside a closed part: open it, once per problem.
    private func call(_ part: SetupFold?, needed: Bool) {
        guard let part else { return }
        if Readiness.opensFold(needed: needed, called: part.called, open: part.open) { part.set(true) }
        part.called = needed
    }

    private func setup() -> NSView {
        let stack = column()
        diagramView.onAction = { [weak self] action in self?.handleDiagramAction(action) }
        stack.addArrangedSubview(diagramView)
        diagramView.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true

        // Each step is one sentence and its button; the port and password OBS already gave, the long explanations and
        // the two optional sections are folded away until asked for, or until a light needs them (U3-05, as on Windows).
        heading(L("connectTitle"), in: stack)
        paragraph(L("connectShort"), in: stack)
        scanButton = button(L("discover"), #selector(scan))
        stack.addArrangedSubview(scanButton)
        snapshot.font = .boldSystemFont(ofSize: 12.5)
        snapshot.textColor = inkColor
        stack.addArrangedSubview(snapshot)
        snapshot.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
        vsLine.font = .systemFont(ofSize: 12.5, weight: .medium)
        vsLine.textColor = accentTextColor
        vsLine.stringValue = vsStatus
        vsLine.isHidden = vsStatus.isEmpty
        stack.addArrangedSubview(vsLine)
        let obsPart = fold("obs", in: stack)
        obsFold = obsPart
        paragraph(L("connectHint"), in: obsPart.content)
        port.widthAnchor.constraint(equalToConstant: 86).isActive = true
        password.widthAnchor.constraint(equalToConstant: 220).isActive = true
        password.placeholderString = L("macPasswordPlaceholder")
        obsPart.content.addArrangedSubview(horizontal([label(L("port")), port, label(L("password")), password]))
        edits += [port, password]
        paragraph(L("macPasswordHint"), in: obsPart.content)

        heading(L("macControllerTitle"), in: stack)
        subheading(L("macPresetTitle"), in: stack)
        savePresetStepButton = button(L("macSavePreset"), #selector(saveAndGuidePreset))
        savePresetStepButton.bezelStyle = .rounded
        savePresetStepButton.bezelColor = accentColor
        openConsoleStepButton = button(L("macOpenConsoleStep"), #selector(openOrDownloadConsole))
        let showGuideBtn = button(L("btnShowWhere"), #selector(showImportGuide))
        stack.addArrangedSubview(horizontal([savePresetStepButton, openConsoleStepButton, showGuideBtn]))
        if LocalFiles.presetSyncState(bundledHash: bundledPresetHash, savedHash: savedPresetHash) == .updateAvailable {
            importNote.stringValue = L("macPresetUpdated")
            importNote.isHidden = false
        } else {
            importNote.isHidden = true
        }
        importNote.font = .systemFont(ofSize: 12, weight: .medium)
        importNote.textColor = accentTextColor
        stack.addArrangedSubview(importNote)
        importNote.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
        let presetPart = fold("tourbox", in: stack)
        paragraph(L("macPresetSteps"), in: presetPart.content)
        paragraph(L("importAutoHint"), in: presetPart.content)
        let downloadConsoleBtn = button(L("macDownloadConsole"), #selector(downloadTourBoxConsole))
        let presetSquareBtn = button(L("macPresetSquare"), #selector(openPresetSquare))
        presetPart.content.addArrangedSubview(horizontal([label(L("macTourBoxInfo"), small: true), downloadConsoleBtn, presetSquareBtn]))

        subheading(L("macAxTitle"), in: stack)
        paragraph(L("macAxHint"), in: stack)
        grantAxButton = button(L("macAxGrant"), #selector(grantAccessibility))
        grantAxButton.bezelStyle = .rounded
        axStatusLabel.font = .systemFont(ofSize: 12, weight: .semibold)
        stack.addArrangedSubview(horizontal([grantAxButton, button(L("macNativeHelper"), #selector(permission)), axStatusLabel]))

        heading(L("cueTitle"), in: stack)
        paragraph(L("macCueShort"), in: stack)
        let cuePart = fold("cue", in: stack)
        paragraph(L("macCueHint"), in: cuePart.content)
        // Assign your inputs is one sentence here, with the button that opens its tab.
        paragraph(L("inputsHint"), in: stack)
        let toAssignments = button(L("assignments"), #selector(selectTab(_:)))
        toAssignments.tag = 1
        stack.addArrangedSubview(toAssignments)

        // The optional sections, in the order of the Windows panel: Whole mix, VJster. Each is one line until opened.
        let mixPart = fold("mix", title: L("mixTitle"), in: stack)
        mixFold = mixPart
        mixPart.content.addArrangedSubview(mix); edits.append(mix)
        paragraph(L("mixHint"), in: mixPart.content)
        mixPart.content.addArrangedSubview(mixOnly); edits.append(mixOnly)
        number(L("mixStep"), key: "mixStepDb", in: mixPart.content)
        number(L("mixFade"), key: "mixFadeMs", in: mixPart.content)

        let vjPart = fold("vjster", title: L("vjsterTitle"), in: stack)
        vjFold = vjPart
        let vjStack = vjPart.content
        vjsterPort.widthAnchor.constraint(equalToConstant: 86).isActive = true
        vjsterTarget.widthAnchor.constraint(greaterThanOrEqualToConstant: 205).isActive = true
        vjsterTarget.removeAllItems()
        for (titleText, code) in [(L("vjsterTargetBoth"), "both"), (L("vjsterTargetBrowser"), "browser"), (L("vjsterTargetObs"), "obs")] {
            vjsterTarget.addItem(withTitle: titleText); vjsterTarget.lastItem?.representedObject = code
        }
        vjStack.addArrangedSubview(vjster)
        vjStack.addArrangedSubview(horizontal([label(L("vjsterPort")), vjsterPort, label(L("vjsterTarget")), vjsterTarget]))
        vjsterExtensionId.widthAnchor.constraint(equalToConstant: 300).isActive = true
        vjsterExtensionId.placeholderString = L("macExtensionPlaceholder")
        vjStack.addArrangedSubview(horizontal([label(L("vjsterExtensionId")), vjsterExtensionId]))
        vjsterVideo.widthAnchor.constraint(equalToConstant: 300).isActive = true
        vjsterVideo.placeholderString = L("macVideoPlaceholder")
        copyObsUrlButton = button(L("copyObsUrl"), #selector(copyObsUrl))
        vjStack.addArrangedSubview(horizontal([label(L("vjsterVideo")), vjsterVideo, copyObsUrlButton]))
        edits += [vjster, vjsterPort, vjsterTarget, vjsterExtensionId]
        paragraph(L("macVjsterHint"), in: vjStack)
        vjsterTarget.target = self; vjsterTarget.action = #selector(vjsterToggled)
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
        activity.textColor = .labelColor; activity.backgroundColor = .textBackgroundColor
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
    /// Ticked or cleared by the user. The app registers itself as a login item (no helper, no entitlement); when macOS
    /// wants the user's approval, say so and open Login Items.
    @objc private func openAtLoginToggled() {
        guard #available(macOS 13.0, *), !previewMode else { return }
        let service = SMAppService.mainApp
        let wanted = openAtLogin.state == .on
        do {
            if wanted { try service.register() } else { try service.unregister() }
        } catch {
            let message = L("signInFailed", error.localizedDescription)
            setStatus(message); note(message)
        }
        if wanted && service.status == .requiresApproval {
            setStatus(L("macLoginApprove")); note(L("macLoginApprove"))
            SMAppService.openSystemSettingsLoginItems()
        }
        openAtLogin.state = service.status == .enabled ? .on : .off
    }
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
        if result.portAuto && value != (filledPort ?? settings.port) { result.portAuto = false }
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
        let onlyMix = mixOnlyChosen
        // Stream Deck-only mode serves OBS's mixer and needs no Studio Mode: its light does not ask for it.
        let obsState = Readiness.obs(connected: obsConnected, running: obsRunning, problem: obsProblem, studioOff: studioOff && !onlyMix, controlsOn: controlsOn)
        // Stream Deck-only mode needs no Accessibility: it moves no T-bar.
        let axReady = axTrusted || onlyMix
        let tbState = Readiness.tourBox(consoleRunning: tourboxConsoleRunning, consoleInstalled: consoleReady, mixOnly: onlyMix, oldPreset: presetState == .old, noPreset: presetState == .none)
        let vjEnabled = vjster.state == .on
        let vjState = Readiness.vjster(enabled: vjEnabled, controlsOn: controlsOn, connectedPeers: vjsterPeers.count, portBusy: vjsterPortBusy, mixOnly: onlyMix, usedBefore: vjsterUsed, onDeck: vjsterOnDeck)
        let ctlState = Readiness.controls(running: controlsOn, armed: host.isArmed, axTrusted: axReady, obsConnected: obsConnected)

        let syncState: PresetSyncState = lastSavedPreset != nil
            ? .current
            : (bundledPresetHash.isEmpty ? .neverSaved : LocalFiles.presetSyncState(bundledHash: bundledPresetHash, savedHash: savedPresetHash))
        obsLight.display(obsState, enabled: !scanning)
        tourboxLight.display(tbState, enabled: true)
        vjsterLight.display(vjState, enabled: true)
        controlsLight.display(ctlState, enabled: controlsOn || !axReady || canAct)
        mixOnly.isEnabled = mix.state == .on && !controlsOn && !scanning
        mixFold?.summary.stringValue = Readiness.mixSummary(on: mix.state == .on, only: onlyMix)
        vjFold?.summary.stringValue = Readiness.vjsterSummary(on: vjEnabled, target: vjsterTarget.titleOfSelectedItem ?? "",
                                                              port: Int(vjsterPort.stringValue.trimmingCharacters(in: .whitespaces)) ?? settings.vjsterPort)
        // The port and password are needed when OBS runs and refuses the sign-in or does not answer; VJster's fields when its light is amber or red.
        call(obsFold, needed: Readiness.needsObsFields(connected: obsConnected, running: obsRunning, problem: obsProblem))
        call(vjFold, needed: vjState.lamp == .amber || vjState.lamp == .red)
        savePresetStepButton?.title = syncState == .updateAvailable ? L("macSavePresetUpdated") : L("macSavePreset")
        openConsoleStepButton?.title = consoleReady ? L("macOpenConsoleStep") : L("macDownloadConsoleStep")
        grantAxButton?.bezelColor = axTrusted ? nil : accentColor
        axStatusLabel.stringValue = axTrusted ? L("macAxGranted") : L("macAxNeeded")
        axStatusLabel.textColor = axTrusted ? grantedColor : reminderFgColor
        importGuideWindow?.update(savedPreset: lastSavedPreset, consoleInstalled: consoleReady)

        let parsedVjPort = Int(vjsterPort.stringValue.trimmingCharacters(in: .whitespaces)) ?? settings.vjsterPort
        diagramView.state = SetupDiagramView.State(
            obsLamp: obsState.lamp,
            obsRunning: obsRunning,
            obsConnected: obsConnected,
            studioOff: studioOff && !onlyMix,
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
                                           frontIsChrome: frontIsChrome && vjster.state == .on, obsRunning: obsRunning,
                                           autoSwitch: consoleAutoSwitch, activeFadester: activeFadester) {
            reminderLabel.stringValue = banner.text
            reminderAction.titleText = banner.button
            bannerActionId = banner.action
            reminderCard.isHidden = false
        } else {
            reminderCard.isHidden = true
        }
    }

    /// Compare Console's stored presets with the one this Companion ships, every 5 s (Console writes them when they change), FIX-9.
    private func checkPresetAge() {
        presetCheckAt = Date().addingTimeInterval(5)
        // Nothing in Console's folder changed since the last complete read: nothing is opened or parsed again.
        let stamp = PresetAge.stamp()
        if stamp != presetStamp || (shippedShortcuts?.isEmpty ?? true) {
            // An unreadable shipped preset is read again next time rather than turning the check off for good.
            if shippedShortcuts?.isEmpty ?? true { shippedShortcuts = PresetAge.shipped(paths.localizedPreset) }
            // A preset Console is still writing (or a file it holds) keeps the last answer instead of a false one.
            consoleAutoSwitch = PresetAge.autoSwitch(); activeFadester = PresetAge.activeIsFadester(shipped: shippedShortcuts ?? [])
            if shippedLayout == nil { shippedLayout = PresetAge.layout(PresetAge.unzip(paths.localizedPreset)) }
            let (stored, complete, layouts) = PresetAge.stored()
            guard complete else { return }
            presetState = PresetAge.judge(shipped: shippedShortcuts ?? [], stored: stored, shippedLayout: shippedLayout, layouts: layouts)
            presetStamp = stamp
        }
        // Said once, and only where the TourBox light shows it: Console running and not in Stream Deck-only mode.
        if presetState == .old && !toldOldPreset && tourboxConsoleRunning && !mixOnlyChosen { toldOldPreset = true; note(L("tbOldNote")) }
        if presetState != .old { toldOldPreset = false }
    }

    private func watchDesktop() {
        defer { if !previewMode && Date() >= presetCheckAt { checkPresetAge() } }
        guard !previewMode else { return }
        let wasTrusted = axTrusted
        axTrusted = AXIsProcessTrusted()
        // Accessibility was just granted: the controls start now, as they would have at launch (never after Stop).
        if axTrusted && !wasTrusted { autoStartIfWanted() }
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
        // Without VJster, or in Stream Deck-only mode, the host ends when OBS goes away and the four tries above are
        // soon used up: while OBS runs and Stop was not pressed, keep looking every 15 s (F-04).
        if obsRunning && !host.running && !obsConnected && autoTries == 0 && !scanning && !invalidSettings && rememberedControls != "off" &&
            (obsProblem == nil || obsProblem == "obs-no-answer") && Date() >= nextSlowScan {
            nextSlowScan = Date().addingTimeInterval(15)
            performScan(silentIfOffline: true)
        }
        // Studio Mode off is on the OBS light: look again now and then, so turning it on in OBS itself clears the light.
        if host.running && obsConnected && studioOff && !mixOnlyChosen && !scanning && Date() >= studioCheckAt {
            if studioChecksLeft > 0 { studioChecksLeft -= 1 }
            // Ten seconds apart for the first twelve looks, then one a minute, so turning Studio Mode on by hand later still clears the light.
            studioCheckAt = Date().addingTimeInterval(studioChecksLeft > 0 ? 10 : 60)
            performScan(silentIfOffline: true, listsOnly: true)
        }
        refreshIndicators()
    }

    private func handleHostLine(_ safeLine: String) {
        if safeLine == "SETTINGS-RELOADED" { return } // the Save note already said so, as on Windows
        // The meter's lines come up to 5 times a second: they update the meter line, never Activity (as on Windows).
        if let meter = Readiness.vsMeter(safeLine) {
            setMeter(meter)
            return
        }
        // The host's own line for a layer it picked: never shown (the result that follows says the same in words).
        if safeLine.hasPrefix(Readiness.pickedMarker) {
            takePickedLayers(safeLine)
            return
        }
        vjsterPeers = Readiness.vjsterPeers(after: safeLine, current: vjsterPeers)
        vjsterPortBusy = Readiness.vjsterPortBusy(after: safeLine, current: vjsterPortBusy)
        vjsterOnDeck = Readiness.vjsterOnDeck(after: safeLine, current: vjsterOnDeck)
        // The first video ever connected here: from now on a missing one is worth an amber light.
        if !vjsterPeers.isEmpty && !vjsterUsed { vjsterUsed = true }
        // Preview or the T-bar was used with Studio Mode off: the OBS light says so, with its Turn on button.
        if Readiness.saysStudioOff(safeLine) && !studioOff { studioOff = true; studioChecksLeft = 12; studioCheckAt = Date().addingTimeInterval(10) }
        // The T-bar is unavailable for a reason the panel can explain (the other controls keep working): say it in the
        // status line, in the panel's language, not only as an English line on the Activity tab (F-02).
        if let reason = HostController.tbarReason(safeLine) { setStatus(reason) }
        if safeLine.hasPrefix("T-BAR:") {
            // Not an OBS failure: OBS stays connected and only the T-bar waits.
        } else if safeLine.hasPrefix("OFFLINE:") {
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

    /// A layer the host picked by itself (DeskActions.FillLayers), from the line the host writes for the panel alone
    /// (Readiness.pickedLayers; never from Activity text, which also carries video titles), as on Windows: shown on the
    /// Assignments page and saved, so the next start keeps it. The host already uses it.
    private func takePickedLayers(_ line: String) {
        let picks = Readiness.pickedLayers(line)
        guard !picks.isEmpty else { return }
        for pick in picks {
            if pick.layer == 1 { settings.layer1Scene = pick.scene; settings.layer1Source = pick.source }
            else { settings.layer2Scene = pick.scene; settings.layer2Source = pick.source }
            fill("layer\(pick.layer)Scene", catalog.scenes.contains(pick.scene) ? catalog.scenes : catalog.scenes + [pick.scene], keep: pick.scene)
            let items = catalog.items[pick.scene] ?? []
            fill("layer\(pick.layer)Source", items.contains(pick.source) ? items : items + [pick.source], keep: pick.source)
        }
        do { try LocalFiles.save(settings) } catch { failure(error) }
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
        case "importPreset": saveAndGuidePreset()
        case "downloadConsole": downloadTourBoxConsole()
        case "grantAx": grantAccessibility()
        case "studioOn": turnOnStudio()
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

    /// The OBS light's Turn on button: asks OBS to switch Studio Mode on, then reads OBS again. Only on that click.
    private func turnOnStudio() {
        guard !scanning && !previewMode && !invalidSettings else { return }
        let targetPort = host.running ? settings.port : (Int(port.stringValue.trimmingCharacters(in: .whitespaces)) ?? settings.port)
        let secret: String, client: ObsDiscovery
        do {
            secret = try LocalFiles.password(port: targetPort, override: password.stringValue)
            client = try ObsDiscovery(port: targetPort)
        } catch { failure(error); return }
        scanning = true; updateEnabled()
        Task { [weak self] in
            guard let self else { return }
            var turnedOn = false
            do { try await client.turnOnStudioMode(password: secret); turnedOn = true }
            catch { self.failure(error) }
            self.scanning = false
            if turnedOn {
                self.studioOff = false
                let said = L("studioTurnedOn"); self.setStatus(said); self.note(said)
            }
            self.updateEnabled()
            if turnedOn { self.performScan(silentIfOffline: true, listsOnly: self.host.running) }
        }
    }

    private func updateEnabled() {
        // Editing and Save stay open while the controls run: Save hands the new settings to the running host.
        let editable = !scanning
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
        statusToggle?.title = primaryButton?.title ?? L("saveStart")
        refreshIndicators()
    }

    /// The last Activity line, so the same message again becomes one line with a count, as on Windows (ActivityText).
    private var lastNote = "", lastNoteCount = 0, lastNoteRange: NSRange?
    /// Activity lines carry their font and a colour that follows the light or dark appearance (text added without
    /// attributes is black, whatever the window's colour).
    private static let activityAttributes: [NSAttributedString.Key: Any] = [
        .font: NSFont.monospacedSystemFont(ofSize: 12, weight: .regular), .foregroundColor: NSColor.labelColor
    ]

    private func note(_ text: String) {
        let safe = redact(text, secrets: [password.stringValue, settings.vjsterObsToken])
        let repeated = safe == lastNote && lastNoteRange != nil
        lastNoteCount = repeated ? lastNoteCount + 1 : 1; lastNote = safe
        let shown = lastNoteCount > 1 ? safe + " (×\(lastNoteCount))" : safe
        let line = DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .medium) + "  " + shown + "\n"
        guard let storage = activity.textStorage else { return }
        if repeated, let range = lastNoteRange, NSMaxRange(range) <= storage.length {
            storage.replaceCharacters(in: range, with: NSAttributedString(string: line, attributes: Self.activityAttributes))
            lastNoteRange = NSRange(location: range.location, length: (line as NSString).length)
        } else {
            lastNoteRange = NSRange(location: storage.length, length: (line as NSString).length)
            storage.append(NSAttributedString(string: line, attributes: Self.activityAttributes))
        }
        if activity.string.count > 60_000 { activity.string = String(activity.string.suffix(45_000)); lastNoteRange = nil }
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

    /// Save. Running controls take the new assignments, inputs, anchors and steps at once ("reload", hand test 2026-11-17),
    /// as on Windows; the settings the host sets up at start (port, VJster, the mixer mode, the fade step) need Stop and Start.
    @objc private func save() {
        guard !invalidSettings && !previewMode else { return }
        do {
            let next = try current()
            settings = next; try LocalFiles.save(settings)
            if host.running {
                host.reload()
                // Compared with what the running host started with, so a second Save still says a restart is due.
                setStatus(L(Settings.sameAtStart(startedWith ?? next, next) ? "savedApplied" : "savedRestart"))
            } else {
                setStatus(L("saved"))
            }
            note(status.stringValue)
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
            vjsterPortBusy = false; vjsterOnDeck = false
            try host.start(paths: paths, config: LocalFiles.settings, password: secret, mixEnabled: proposed.mixEnabled, mixOnly: proposed.mixOnly, extraSecrets: [proposed.vjsterObsToken])
            startedWith = proposed
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

    /// The Read scenes button: while the controls run it reads the saved port and changes no light, but still says what happened.
    @objc private func scan() { performScan(silentIfOffline: false, listsOnly: host.running, loud: true) }

    /// listsOnly: a refresh of the Assignments lists by itself while the controls run (OBS just answered the host, hand test
    /// 2026-11-17: the lists stayed empty until Read scenes was clicked). It changes no light and starts nothing.
    private func performScan(silentIfOffline: Bool, listsOnly: Bool = false, loud: Bool = false) {
        guard (listsOnly || !host.running) && !scanning && !previewMode && !invalidSettings else { return }
        if !listsOnly { followObsPort() }
        let targetPort: Int
        // A refresh while the controls run asks the OBS the host uses (the saved port), not an unsaved edit.
        if listsOnly { targetPort = settings.port } else if let parsed = Int(port.stringValue.trimmingCharacters(in: .whitespaces)), (1...65535).contains(parsed) {
            targetPort = parsed
        } else {
            if !silentIfOffline { failure(PanelFailure.message(L("macErrPort"))) }
            return
        }
        let secret: String
        do {
            secret = try LocalFiles.password(port: targetPort, override: password.stringValue)
        } catch {
            if listsOnly { if loud { failure(error) }; return } // a refresh changes no light
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
        if !listsOnly { obsProblem = nil } // a list refresh changes no light
        updateEnabled()
        if !listsOnly { setStatus(L("macReading")) }
        scanTask = Task { [weak self] in
            guard let self else { return }
            do {
                self.catalog = try await client.scan(password: secret)
                self.fillChoices(preserveEdits: true)
                self.catalogAt = Date()
                if listsOnly {
                    if !self.catalog.studio && !self.studioOff { self.studioChecksLeft = 12; self.studioCheckAt = Date().addingTimeInterval(10) }
                    self.studioOff = !self.catalog.studio // the OBS light's Studio Mode state follows every read
                    if loud { let msg = L("obsConnected", self.catalog.scenes.count); self.setStatus(msg); self.note(msg) } // controls already on
                    self.scanning = false; self.scanTask = nil; self.updateEnabled(); return
                }
                self.obsConnected = true
                self.obsRunning = true
                self.obsProblem = nil
                if !self.catalog.studio && !self.studioOff { self.studioChecksLeft = 12; self.studioCheckAt = Date().addingTimeInterval(10) }
                self.studioOff = !self.catalog.studio
                self.snapshot.stringValue = L("sceneSummary", self.catalog.program, self.catalog.preview, L(self.catalog.studio ? "on" : "off"))
                self.setMeter(Readiness.vsMeter(self.catalog.visualSidechain) ?? "")
                let readyMsg = L("obsReady", self.catalog.scenes.count)
                self.setStatus(readyMsg)
                self.note(readyMsg)
            } catch {
                if listsOnly { if loud { self.failure(error) }; self.scanning = false; self.scanTask = nil; self.updateEnabled(); return }
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

    /// With the controls on, closing the window only hides it: the show goes on, and the icon in the menu bar (or the Dock
    /// icon) brings it back. Quit, in the menu bar icon's menu or the app menu, stops the controls and ends the app.
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if host.running && statusItem != nil { window.orderOut(nil); return false }
        NSApp.terminate(nil); return false
    }

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

// SPDX-License-Identifier: GPL-2.0-or-later
import AppKit

@MainActor final class ShowMeCanvas: NSView {
    enum Mode {
        case tourboxImport(folderName: String)
        case obsServer
        case obsPassword
        case obsStudio
        case vjsterWait
        case vjsterPort(port: Int)
    }

    var mode: Mode { didSet { needsDisplay = true } }
    private var timer: Timer?
    private let startTime = ProcessInfo.processInfo.systemUptime
    var fixedTime: CGFloat? { didSet { needsDisplay = true } }

    override var isFlipped: Bool { true }
    override var intrinsicContentSize: NSSize { NSSize(width: 540, height: 264) }

    init(mode: Mode) {
        self.mode = mode
        super.init(frame: NSRect(x: 0, y: 0, width: 540, height: 264))
        translatesAutoresizingMaskIntoConstraints = false
    }
    @available(*, unavailable) required init?(coder: NSCoder) { nil }

    func startAnimation() {
        guard timer == nil else { return }
        timer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.needsDisplay = true }
        }
    }

    func stopAnimation() {
        timer?.invalidate()
        timer = nil
    }

    private var cycleLength: CGFloat {
        switch mode {
        case .tourboxImport: return 10.5
        case .obsStudio: return 8.5
        case .obsPassword: return 9.5
        case .obsServer: return 9.0
        case .vjsterWait, .vjsterPort: return 8.0
        }
    }

    private static func ease(_ t: CGFloat, _ a: CGFloat, _ b: CGFloat) -> CGFloat {
        if t <= a { return 0 }
        if t >= b { return 1 }
        let x = (t - a) / (b - a)
        return x * x * (3 - 2 * x)
    }

    private static func mix(_ p: NSPoint, _ q: NSPoint, _ k: CGFloat) -> NSPoint {
        NSPoint(x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k)
    }

    private struct Hop {
        let from: CGFloat
        let to: CGFloat
        let target: NSPoint
    }

    private static func walk(_ t: CGFloat, start: NSPoint, steps: [Hop]) -> NSPoint {
        var at = start
        for s in steps {
            if t < s.from { break }
            at = mix(at, s.target, ease(t, s.from, s.to))
        }
        return at
    }

    private static func center(_ r: NSRect) -> NSPoint {
        NSPoint(x: r.midX, y: r.midY)
    }

    private func fill(_ rect: NSRect, _ color: NSColor, radius: CGFloat = 6) {
        color.setFill()
        if radius <= 0 {
            rect.fill()
        } else {
            NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius).fill()
        }
    }

    private func stroke(_ rect: NSRect, _ color: NSColor, radius: CGFloat = 6, width: CGFloat = 1.2) {
        color.setStroke()
        let p = NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius)
        p.lineWidth = width
        p.stroke()
    }

    private func text(_ string: String, at point: NSPoint, size: CGFloat = 11.5, bold: Bool = false, color: NSColor) {
        let attrs: [NSAttributedString.Key: Any] = [
            .font: bold ? NSFont.boldSystemFont(ofSize: size) : NSFont.systemFont(ofSize: size),
            .foregroundColor: color
        ]
        (string as NSString).draw(at: point, withAttributes: attrs)
    }

    private func textWidth(_ string: String, size: CGFloat = 11.5, bold: Bool = false) -> CGFloat {
        let attrs: [NSAttributedString.Key: Any] = [
            .font: bold ? NSFont.boldSystemFont(ofSize: size) : NSFont.systemFont(ofSize: size)
        ]
        return ceil((string as NSString).size(withAttributes: attrs).width)
    }

    private func drawTrafficLights(x: CGFloat, y: CGFloat) {
        let colors: [NSColor] = [
            NSColor(srgbRed: 236 / 255, green: 106 / 255, blue: 94 / 255, alpha: 1),
            NSColor(srgbRed: 245 / 255, green: 191 / 255, blue: 79 / 255, alpha: 1),
            NSColor(srgbRed: 98 / 255, green: 197 / 255, blue: 84 / 255, alpha: 1)
        ]
        for (i, c) in colors.enumerated() {
            c.setFill()
            NSBezierPath(ovalIn: NSRect(x: x + CGFloat(i) * 14, y: y, width: 9, height: 9)).fill()
        }
    }

    private func drawImportGlyph(in rect: NSRect, color: NSColor) {
        color.setStroke()
        let tray = NSBezierPath()
        tray.lineWidth = 1.7
        tray.lineCapStyle = .round
        tray.lineJoinStyle = .round
        let x = rect.minX, y = rect.minY, w = rect.width, h = rect.height
        tray.move(to: NSPoint(x: x + 3, y: y + h * 0.58))
        tray.line(to: NSPoint(x: x + 3, y: y + h - 3))
        tray.line(to: NSPoint(x: x + w - 3, y: y + h - 3))
        tray.line(to: NSPoint(x: x + w - 3, y: y + h * 0.58))
        tray.move(to: NSPoint(x: x + w / 2, y: y + 2.5))
        tray.line(to: NSPoint(x: x + w / 2, y: y + h - 5.5))
        tray.move(to: NSPoint(x: x + w / 2 - 3.6, y: y + h - 9))
        tray.line(to: NSPoint(x: x + w / 2, y: y + h - 5.2))
        tray.line(to: NSPoint(x: x + w / 2 + 3.6, y: y + h - 9))
        tray.stroke()
    }

    private func drawCheckBadge(center: NSPoint, scale: CGFloat) {
        guard scale > 0 else { return }
        let r = 24 * scale
        let green = NSColor(srgbRed: 76 / 255, green: 194 / 255, blue: 110 / 255, alpha: 1)
        green.setFill()
        NSBezierPath(ovalIn: NSRect(x: center.x - r, y: center.y - r, width: r * 2, height: r * 2)).fill()
        if scale >= 0.85 {
            NSColor.white.setStroke()
            let check = NSBezierPath()
            check.lineWidth = 4.2
            check.lineCapStyle = .round
            check.lineJoinStyle = .round
            check.move(to: NSPoint(x: center.x - 10, y: center.y + 1))
            check.line(to: NSPoint(x: center.x - 2, y: center.y + 9))
            check.line(to: NSPoint(x: center.x + 12, y: center.y - 7))
            check.stroke()
        }
    }

    private func drawPointer(at p: NSPoint, clicks: [CGFloat], t: CGFloat) {
        for c in clicks {
            let k = (t - c) / 0.45
            if k < 0 || k > 1 { continue }
            let alpha = 0.85 * (1 - k)
            let ringColor = NSColor(srgbRed: 47 / 255, green: 126 / 255, blue: 246 / 255, alpha: alpha)
            ringColor.setStroke()
            let rad = 7 + 15 * k
            let ring = NSBezierPath(ovalIn: NSRect(x: p.x - rad, y: p.y - rad, width: rad * 2, height: rad * 2))
            ring.lineWidth = 2.4
            ring.stroke()
        }
        let shape: [NSPoint] = [
            NSPoint(x: 0, y: 0),
            NSPoint(x: 0, y: 18),
            NSPoint(x: 4.8, y: 13.8),
            NSPoint(x: 8.0, y: 21),
            NSPoint(x: 11.0, y: 19.6),
            NSPoint(x: 8.0, y: 12.6),
            NSPoint(x: 13.8, y: 12.6)
        ]
        let poly = NSBezierPath()
        for (i, pt) in shape.enumerated() {
            let shifted = NSPoint(x: p.x + pt.x, y: p.y + pt.y)
            if i == 0 { poly.move(to: shifted) } else { poly.line(to: shifted) }
        }
        poly.close()
        NSColor.white.setFill()
        poly.fill()
        NSColor(srgbRed: 20 / 255, green: 24 / 255, blue: 33 / 255, alpha: 1).setStroke()
        poly.lineWidth = 1.3
        poly.stroke()
    }

    override func draw(_ dirtyRect: NSRect) {
        let bg = NSColor(srgbRed: 244 / 255, green: 246 / 255, blue: 251 / 255, alpha: 1)
        fill(bounds, bg, radius: 8)
        stroke(bounds.insetBy(dx: 0.5, dy: 0.5), NSColor(srgbRed: 214 / 255, green: 220 / 255, blue: 232 / 255, alpha: 1), radius: 8, width: 1)

        let t: CGFloat
        if let fixed = fixedTime {
            t = fixed
        } else {
            let elapsed = CGFloat(ProcessInfo.processInfo.systemUptime - startTime)
            t = elapsed.truncatingRemainder(dividingBy: cycleLength)
        }

        switch mode {
        case .tourboxImport(let folderName):
            drawTourBoxImport(t: t, folderName: folderName)
        case .obsServer:
            drawObsServer(t: t, passwordMode: false)
        case .obsPassword:
            drawObsServer(t: t, passwordMode: true)
        case .obsStudio:
            drawObsStudio(t: t)
        case .vjsterWait:
            drawVjsterGuide(t: t, busyPort: nil)
        case .vjsterPort(let port):
            drawVjsterGuide(t: t, busyPort: port)
        }
    }

    private func drawTourBoxImport(t: CGFloat, folderName: String) {
        let frame = NSColor(srgbRed: 28 / 255, green: 31 / 255, blue: 41 / 255, alpha: 1)
        let bar = NSColor(srgbRed: 39 / 255, green: 43 / 255, blue: 56 / 255, alpha: 1)
        let sidebar = NSColor(srgbRed: 34 / 255, green: 38 / 255, blue: 50 / 255, alpha: 1)
        let card = NSColor(srgbRed: 47 / 255, green: 52 / 255, blue: 68 / 255, alpha: 1)
        let blue = NSColor(srgbRed: 47 / 255, green: 118 / 255, blue: 228 / 255, alpha: 1)
        let green = NSColor(srgbRed: 76 / 255, green: 194 / 255, blue: 110 / 255, alpha: 1)
        let ink = NSColor(srgbRed: 232 / 255, green: 236 / 255, blue: 245 / 255, alpha: 1)
        let muted = NSColor(srgbRed: 148 / 255, green: 156 / 255, blue: 176 / 255, alpha: 1)

        // TourBox Console outer window
        let win = NSRect(x: 14, y: 12, width: 512, height: 240)
        fill(win, frame, radius: 8)
        fill(NSRect(x: 14, y: 12, width: 512, height: 28), bar, radius: 8)
        fill(NSRect(x: 14, y: 28, width: 512, height: 12), bar, radius: 0)
        drawTrafficLights(x: 26, y: 21)
        text("TourBox Console", at: NSPoint(x: 218, y: 18), size: 11.5, bold: true, color: ink)

        // Left Preset List column (matches TourBox Console 5.12 layout)
        let leftCol = NSRect(x: 24, y: 48, width: 226, height: 194)
        fill(leftCol, sidebar, radius: 6)

        // Preset List header + [↗] [↙ Import] [+] buttons
        text("Preset List", at: NSPoint(x: 34, y: 56), size: 11.5, bold: true, color: ink)
        let exportBtn = NSRect(x: 168, y: 54, width: 20, height: 20)
        let importBtn = NSRect(x: 193, y: 54, width: 22, height: 20)
        let plusBtn = NSRect(x: 220, y: 54, width: 20, height: 20)
        fill(exportBtn, card, radius: 4)
        text("↗", at: NSPoint(x: exportBtn.minX + 4.5, y: exportBtn.minY + 2), size: 11, bold: true, color: muted)
        fill(plusBtn, card, radius: 4)
        text("+", at: NSPoint(x: plusBtn.minX + 5.5, y: plusBtn.minY + 1), size: 12.5, bold: true, color: muted)

        let importHot = t < 3.4
        fill(importBtn, importHot ? blue : card, radius: 4)
        if importHot {
            stroke(importBtn.insetBy(dx: -2, dy: -2), NSColor(srgbRed: 244 / 255, green: 176 / 255, blue: 48 / 255, alpha: 1), radius: 6, width: 2)
        }
        drawImportGlyph(in: importBtn.insetBy(dx: 3, dy: 2), color: .white)

        if importHot {
            let callout = NSRect(x: 258, y: 50, width: 176, height: 28)
            fill(callout, NSColor(srgbRed: 244 / 255, green: 176 / 255, blue: 48 / 255, alpha: 1), radius: 6)
            text("1. Click middle Import icon", at: NSPoint(x: callout.minX + 10, y: callout.minY + 6), size: 11.2, bold: true, color: NSColor(srgbRed: 32 / 255, green: 24 / 255, blue: 8 / 255, alpha: 1))
        }

        // Auto Switch card below Preset List
        let autoBox = NSRect(x: 32, y: 82, width: 210, height: 34)
        fill(autoBox, card.withAlphaComponent(0.75), radius: 5)
        text("Auto Switch", at: NSPoint(x: 40, y: 91), size: 11, bold: true, color: ink)
        let toggleRect = NSRect(x: 202, y: 90, width: 32, height: 17)
        fill(toggleRect, blue, radius: 8.5)
        fill(NSRect(x: toggleRect.maxX - 15, y: 92, width: 13, height: 13), .white, radius: 6.5)

        // Preset row: OBS Fadester for TourBox + [Not Linked] -> [OBS]
        let imported = t >= 6.8
        let linkPopoverOpen = t >= 7.55 && t < 9.15
        let linked = t >= 9.15
        let presetRow = NSRect(x: 32, y: 124, width: 210, height: 34)
        let notLinkedBtn = NSRect(x: 176, y: 131, width: 60, height: 20)
        if imported {
            fill(presetRow, NSColor(srgbRed: 72 / 255, green: 76 / 255, blue: 88 / 255, alpha: 1), radius: 5)
            text("OBS Fadester for…", at: NSPoint(x: 40, y: 133), size: 10.8, bold: true, color: .white)
            if linked {
                fill(notLinkedBtn, green, radius: 4)
                text("✓ OBS", at: NSPoint(x: notLinkedBtn.minX + 12, y: notLinkedBtn.minY + 2.5), size: 10.2, bold: true, color: .white)
            } else {
                fill(notLinkedBtn, NSColor(srgbRed: 238 / 255, green: 229 / 255, blue: 174 / 255, alpha: 1), radius: 4)
                text("Not Linked", at: NSPoint(x: notLinkedBtn.minX + 5, y: notLinkedBtn.minY + 3), size: 9.8, bold: true, color: NSColor(srgbRed: 32 / 255, green: 28 / 255, blue: 14 / 255, alpha: 1))
            }
        } else {
            let row1 = NSRect(x: 32, y: 124, width: 210, height: 32)
            fill(row1, card, radius: 5)
            text("Default Preset", at: NSPoint(x: 40, y: 132), size: 10.8, bold: false, color: muted)
        }

        // Stylized TourBox hardware preview on the right side (shown when popover is closed)
        let rightArea = NSRect(x: 262, y: 114, width: 252, height: 128)
        fill(rightArea, sidebar, radius: 6)
        let bodyRect = NSRect(x: 326, y: 126, width: 124, height: 104)
        fill(bodyRect, card, radius: 18)
        stroke(bodyRect, muted.withAlphaComponent(0.35), radius: 18, width: 1.2)
        fill(NSRect(x: 344, y: 170, width: 42, height: 42), frame, radius: 21)
        fill(NSRect(x: 396, y: 140, width: 32, height: 32), frame, radius: 16)
        fill(NSRect(x: 348, y: 138, width: 30, height: 16), frame, radius: 5)
        fill(NSRect(x: 404, y: 186, width: 26, height: 12), blue.withAlphaComponent(0.75), radius: 4)

        // Scene 3 (7.55 .. 9.15s): TourBox Console "Running applications" link popover
        let obsAppRow = NSRect(x: 270, y: 146, width: 232, height: 26)
        let saveLinkBtn = NSRect(x: 396, y: 208, width: 96, height: 24)
        if linkPopoverOpen {
            let pop = NSRect(x: 258, y: 48, width: 256, height: 194)
            fill(pop, NSColor(srgbRed: 36 / 255, green: 39 / 255, blue: 48 / 255, alpha: 1), radius: 7)
            stroke(pop, muted.withAlphaComponent(0.5), radius: 7, width: 1.2)
            text("Running applications", at: NSPoint(x: 270, y: 58), size: 11, bold: true, color: ink)
            text("FadesterTourBoxPanel  (skip)", at: NSPoint(x: 276, y: 88), size: 10.2, bold: false, color: muted)
            text("Google Chrome", at: NSPoint(x: 276, y: 116), size: 10.2, bold: false, color: muted)
            let obsChosen = t >= 8.2
            fill(obsAppRow, obsChosen ? blue : card, radius: 5)
            text("●  OBS   ← Pick OBS!", at: NSPoint(x: 278, y: 151), size: 11, bold: true, color: .white)
            fill(NSRect(x: 286, y: 208, width: 96, height: 24), card, radius: 5)
            text("Cancel", at: NSPoint(x: 315, y: 213), size: 10.5, bold: false, color: muted)
            fill(saveLinkBtn, obsChosen ? blue : card, radius: 5)
            text("Save", at: NSPoint(x: 430, y: 213), size: 10.8, bold: true, color: .white)
        }

        // Scene 2 (3.4 .. 6.8s): macOS File Open sheet slides down
        let openSheetVisible = t >= 3.4 && t < 6.8
        let sheet = NSRect(x: 68, y: 44, width: 404, height: 190)
        let folderItem = NSRect(x: 78, y: 98, width: 112, height: 26)
        let fileItem = NSRect(x: 204, y: 84, width: 254, height: 28)
        let openBtn = NSRect(x: 392, y: 198, width: 66, height: 26)
        if openSheetVisible {
            fill(NSRect(x: 14, y: 40, width: 512, height: 212), NSColor.black.withAlphaComponent(0.38), radius: 6)
            fill(sheet, .white, radius: 8)
            stroke(sheet, NSColor(srgbRed: 190 / 255, green: 198 / 255, blue: 212 / 255, alpha: 1), radius: 8, width: 1.2)
            text("Import Preset (.tb)", at: NSPoint(x: 84, y: 54), size: 11.5, bold: true, color: NSColor(srgbRed: 26 / 255, green: 34 / 255, blue: 51 / 255, alpha: 1))

            // Left Finder sidebar
            let finderSide = NSRect(x: 74, y: 78, width: 120, height: 148)
            fill(finderSide, NSColor(srgbRed: 241 / 255, green: 244 / 255, blue: 249 / 255, alpha: 1), radius: 5)
            text("Favorites", at: NSPoint(x: 84, y: 82), size: 9.5, bold: true, color: .secondaryLabelColor)
            let folderSelected = t >= 4.25
            if folderSelected { fill(folderItem, blue.withAlphaComponent(0.18), radius: 5) }
            let cleanFolder = folderName.count > 12 ? String(folderName.prefix(12)) + "…" : folderName
            text("📁 " + cleanFolder, at: NSPoint(x: 84, y: 103), size: 11, bold: true, color: NSColor(srgbRed: 26 / 255, green: 34 / 255, blue: 51 / 255, alpha: 1))
            text("Applications", at: NSPoint(x: 84, y: 130), size: 10.5, bold: false, color: .secondaryLabelColor)
            text("Documents", at: NSPoint(x: 84, y: 152), size: 10.5, bold: false, color: .secondaryLabelColor)

            // Right file list
            let fileSelected = t >= 5.2
            fill(fileItem, fileSelected ? blue : NSColor(srgbRed: 246 / 255, green: 248 / 255, blue: 252 / 255, alpha: 1), radius: 5)
            text("OBS Fadester for TourBox.tb", at: NSPoint(x: 214, y: 90), size: 11.2, bold: true, color: fileSelected ? .white : NSColor(srgbRed: 26 / 255, green: 34 / 255, blue: 51 / 255, alpha: 1))

            let cancelBtn = NSRect(x: 320, y: 198, width: 64, height: 26)
            fill(cancelBtn, NSColor(srgbRed: 234 / 255, green: 238 / 255, blue: 244 / 255, alpha: 1), radius: 5)
            text("Cancel", at: NSPoint(x: 333, y: 204), size: 11, bold: false, color: .darkGray)
            fill(openBtn, blue, radius: 5)
            text("Open", at: NSPoint(x: 410, y: 204), size: 11, bold: true, color: .white)
        }

        if t >= 9.4 {
            drawCheckBadge(center: NSPoint(x: 388, y: 178), scale: Self.ease(t, 9.4, 9.75))
        }

        let rest = NSPoint(x: 350, y: 155)
        let steps: [Hop] = [
            Hop(from: 0.8, to: 1.9, target: Self.center(importBtn)),
            Hop(from: 3.5, to: 4.2, target: Self.center(folderItem)),
            Hop(from: 4.5, to: 5.15, target: Self.center(fileItem)),
            Hop(from: 5.5, to: 6.2, target: Self.center(openBtn)),
            Hop(from: 6.95, to: 7.5, target: Self.center(notLinkedBtn)),
            Hop(from: 7.7, to: 8.15, target: Self.center(obsAppRow)),
            Hop(from: 8.45, to: 8.95, target: Self.center(saveLinkBtn)),
            Hop(from: 9.3, to: 9.9, target: NSPoint(x: 460, y: 210))
        ]
        let clicks: [CGFloat] = [2.0, 4.25, 5.2, 6.25, 7.55, 8.2, 9.0]
        drawPointer(at: Self.walk(t, start: rest, steps: steps), clicks: clicks, t: t)
    }

    private func drawObsWindowBase(menuHot: Bool) -> NSRect {
        let frame = NSColor(srgbRed: 30 / 255, green: 32 / 255, blue: 41 / 255, alpha: 1)
        let bar = NSColor(srgbRed: 43 / 255, green: 46 / 255, blue: 56 / 255, alpha: 1)
        let docks = NSColor(srgbRed: 37 / 255, green: 40 / 255, blue: 50 / 255, alpha: 1)
        let ghost = NSColor(srgbRed: 78 / 255, green: 83 / 255, blue: 98 / 255, alpha: 1)
        let picture = NSColor(srgbRed: 17 / 255, green: 19 / 255, blue: 24 / 255, alpha: 1)
        let ink = NSColor(srgbRed: 225 / 255, green: 228 / 255, blue: 236 / 255, alpha: 1)
        let blue = NSColor(srgbRed: 47 / 255, green: 111 / 255, blue: 214 / 255, alpha: 1)

        // macOS menu bar at very top + OBS window below
        fill(NSRect(x: 14, y: 10, width: 512, height: 24), bar, radius: 6)
        text("   OBS", at: NSPoint(x: 24, y: 15), size: 11, bold: true, color: ink)
        var x: CGFloat = 86
        for w in [28, 30, 34, 42, 46] as [CGFloat] {
            fill(NSRect(x: x, y: 19, width: w, height: 6), ghost, radius: 3)
            x += w + 12
        }
        let toolsW = textWidth("Tools", size: 11, bold: true) + 14
        let tools = NSRect(x: x - 4, y: 12, width: toolsW, height: 20)
        if menuHot { fill(tools, blue, radius: 4) }
        text("Tools", at: NSPoint(x: tools.minX + 7, y: 15), size: 11, bold: true, color: ink)

        fill(NSRect(x: 14, y: 40, width: 512, height: 212), frame, radius: 8)
        drawTrafficLights(x: 26, y: 49)
        text("OBS 33.0.1", at: NSPoint(x: 236, y: 46), size: 11, bold: false, color: ghost)
        fill(NSRect(x: 28, y: 68, width: 484, height: 118), picture, radius: 4)
        fill(NSRect(x: 180, y: 96, width: 180, height: 62), NSColor(srgbRed: 52 / 255, green: 84 / 255, blue: 140 / 255, alpha: 1), radius: 6)
        fill(NSRect(x: 28, y: 194, width: 234, height: 48), docks, radius: 4)
        fill(NSRect(x: 278, y: 194, width: 234, height: 48), docks, radius: 4)
        return tools
    }

    private func drawCheckbox(in rect: NSRect, checked: Bool) {
        let blue = NSColor(srgbRed: 47 / 255, green: 111 / 255, blue: 214 / 255, alpha: 1)
        let ghost = NSColor(srgbRed: 98 / 255, green: 104 / 255, blue: 122 / 255, alpha: 1)
        fill(rect, checked ? blue : NSColor(srgbRed: 30 / 255, green: 32 / 255, blue: 41 / 255, alpha: 1), radius: 3)
        stroke(rect, checked ? blue : ghost, radius: 3, width: 1)
        if checked {
            NSColor.white.setStroke()
            let p = NSBezierPath()
            p.lineWidth = 2
            p.lineCapStyle = .round
            p.move(to: NSPoint(x: rect.minX + 3, y: rect.minY + 7))
            p.line(to: NSPoint(x: rect.minX + 6, y: rect.minY + 10))
            p.line(to: NSPoint(x: rect.minX + 11, y: rect.minY + 4))
            p.stroke()
        }
    }

    private func drawObsServer(t: CGFloat, passwordMode: Bool) {
        let menuOpen = t >= 1.8 && t < 3.25
        let dialogOpen = t >= 3.25 && t < (passwordMode ? 6.9 : 6.35)
        let tools = drawObsWindowBase(menuHot: menuOpen)
        let bar = NSColor(srgbRed: 43 / 255, green: 46 / 255, blue: 56 / 255, alpha: 1)
        let ghost = NSColor(srgbRed: 78 / 255, green: 83 / 255, blue: 98 / 255, alpha: 1)
        let blue = NSColor(srgbRed: 47 / 255, green: 111 / 255, blue: 214 / 255, alpha: 1)
        let ink = NSColor(srgbRed: 225 / 255, green: 228 / 255, blue: 236 / 255, alpha: 1)

        let menuBox = NSRect(x: min(tools.minX, 286), y: 34, width: 226, height: 108)
        let wsRow = NSRect(x: menuBox.minX + 4, y: menuBox.minY + 68, width: menuBox.width - 8, height: 22)
        if menuOpen {
            fill(menuBox, bar, radius: 5)
            stroke(menuBox, ghost, radius: 5, width: 1)
            for i in 0..<4 where i != 3 {
                fill(NSRect(x: menuBox.minX + 12, y: menuBox.minY + 12 + CGFloat(i) * 22, width: 105, height: 6), ghost, radius: 3)
            }
            if t >= 2.85 { fill(wsRow, blue, radius: 4) }
            text("WebSocket Server Settings", at: NSPoint(x: wsRow.minX + 8, y: wsRow.minY + 4), size: 11, bold: true, color: ink)
        }

        let box = NSRect(x: 96, y: 60, width: 348, height: 176)
        let enableBox = NSRect(x: box.minX + 20, y: box.minY + 44, width: 14, height: 14)
        let authBox = NSRect(x: box.minX + 20, y: box.minY + 72, width: 14, height: 14)
        let infoBtn = NSRect(x: box.minX + 20, y: box.minY + 102, width: 136, height: 24)
        let okBtn = NSRect(x: box.maxX - 76, y: box.maxY - 34, width: 60, height: 24)
        let copyBtn = NSRect(x: box.minX + 214, y: box.minY + 136, width: 52, height: 22)

        if dialogOpen {
            fill(box, bar, radius: 6)
            stroke(box, ghost, radius: 6, width: 1)
            text("WebSocket Server Settings", at: NSPoint(x: box.minX + 18, y: box.minY + 12), size: 11.5, bold: true, color: ink)
            drawCheckbox(in: enableBox, checked: passwordMode || t >= 4.5)
            text("Enable WebSocket server", at: NSPoint(x: enableBox.maxX + 8, y: enableBox.minY - 1), size: 11, bold: false, color: ink)
            drawCheckbox(in: authBox, checked: true)
            text("Enable Authentication", at: NSPoint(x: authBox.maxX + 8, y: authBox.minY - 1), size: 11, bold: false, color: ink)
            if passwordMode {
                fill(infoBtn, (t >= 4.35 && t < 4.75) ? blue : ghost, radius: 4)
                text("Show Connect Info", at: NSPoint(x: infoBtn.minX + 10, y: infoBtn.minY + 5), size: 10.8, bold: true, color: ink)
            }
            fill(okBtn, (!passwordMode && t >= 5.95 && t < 6.3) ? blue : ghost, radius: 4)
            text("OK", at: NSPoint(x: okBtn.minX + 21, y: okBtn.minY + 5), size: 11, bold: true, color: ink)
        }

        if passwordMode && t >= 4.7 && t < 6.9 {
            let pop = NSRect(x: box.minX + 20, y: box.minY + 130, width: 254, height: 34)
            fill(pop, NSColor(srgbRed: 26 / 255, green: 30 / 255, blue: 40 / 255, alpha: 1), radius: 5)
            stroke(pop, blue, radius: 5, width: 1.2)
            text("••••••••••••", at: NSPoint(x: pop.minX + 12, y: pop.minY + 9), size: 12, bold: true, color: ink)
            fill(copyBtn, t >= 6.05 ? blue : ghost, radius: 4)
            text("Copy", at: NSPoint(x: copyBtn.minX + 11, y: copyBtn.minY + 4), size: 10.5, bold: true, color: ink)
        }

        if passwordMode && t >= 6.9 {
            let k = Self.ease(t, 6.9, 7.4)
            let card = NSRect(x: 530 - 224 * k, y: 92, width: 208, height: 74)
            fill(card, .white, radius: 8)
            stroke(card, blue, radius: 8, width: 1.2)
            text("OBS password (optional)", at: NSPoint(x: card.minX + 12, y: card.minY + 10), size: 11, bold: true, color: NSColor(srgbRed: 26 / 255, green: 34 / 255, blue: 51 / 255, alpha: 1))
            let field = NSRect(x: card.minX + 12, y: card.minY + 36, width: 184, height: 24)
            fill(field, NSColor(srgbRed: 244 / 255, green: 246 / 255, blue: 250 / 255, alpha: 1), radius: 4)
            stroke(field, blue, radius: 4, width: 1)
            let dots = Int(round(12 * Self.ease(t, 7.5, 8.4)))
            text(String(repeating: "•", count: dots), at: NSPoint(x: field.minX + 8, y: field.minY + 4), size: 12, bold: true, color: NSColor(srgbRed: 26 / 255, green: 34 / 255, blue: 51 / 255, alpha: 1))
        }

        if !passwordMode && t >= 6.5 {
            drawCheckBadge(center: NSPoint(x: 270, y: 132), scale: Self.ease(t, 6.5, 6.85))
        }

        let rest = NSPoint(x: 340, y: 155)
        let steps: [Hop] = passwordMode
            ? [
                Hop(from: 0.9, to: 1.7, target: Self.center(tools)),
                Hop(from: 2.1, to: 2.9, target: Self.center(wsRow)),
                Hop(from: 3.5, to: 4.3, target: Self.center(infoBtn)),
                Hop(from: 5.2, to: 6.0, target: Self.center(copyBtn)),
                Hop(from: 6.9, to: 7.6, target: NSPoint(x: 416, y: 140))
            ]
            : [
                Hop(from: 0.9, to: 1.7, target: Self.center(tools)),
                Hop(from: 2.1, to: 2.9, target: Self.center(wsRow)),
                Hop(from: 3.5, to: 4.4, target: Self.center(enableBox)),
                Hop(from: 5.0, to: 5.8, target: Self.center(okBtn)),
                Hop(from: 6.5, to: 7.4, target: rest)
            ]
        let clicks: [CGFloat] = passwordMode ? [1.75, 3.0, 4.4, 6.1] : [1.75, 3.0, 4.5, 6.0]
        drawPointer(at: Self.walk(t, start: rest, steps: steps), clicks: clicks, t: t)
    }

    private func drawObsStudio(t: CGFloat) {
        _ = drawObsWindowBase(menuHot: false)
        let ghost = NSColor(srgbRed: 78 / 255, green: 83 / 255, blue: 98 / 255, alpha: 1)
        let blue = NSColor(srgbRed: 47 / 255, green: 111 / 255, blue: 214 / 255, alpha: 1)
        let ink = NSColor(srgbRed: 225 / 255, green: 228 / 255, blue: 236 / 255, alpha: 1)
        let studioBtn = NSRect(x: 396, y: 204, width: 102, height: 24)
        let fadeBox = NSRect(x: 42, y: 204, width: 152, height: 24)
        let split = Self.ease(t, 2.2, 2.8)
        if split > 0 {
            fill(NSRect(x: 28, y: 68, width: 484, height: 118), NSColor(srgbRed: 17 / 255, green: 19 / 255, blue: 24 / 255, alpha: 1), radius: 4)
            let bar = Self.ease(t, 4.8, 5.8) - Self.ease(t, 6.0, 7.0)
            fill(NSRect(x: 36, y: 74, width: 210, height: 104), NSColor(srgbRed: 52 / 255, green: 84 / 255, blue: 140 / 255, alpha: 1), radius: 5)
            fill(NSRect(x: 294, y: 74, width: 210, height: 104), NSColor(srgbRed: (104 - 52 * bar) / 255, green: (66 + 18 * bar) / 255, blue: (132 + 8 * bar) / 255, alpha: 1), radius: 5)
            fill(NSRect(x: 268, y: 82, width: 4, height: 88), ghost, radius: 2)
            fill(NSRect(x: 261, y: 82 + 80 * bar, width: 18, height: 8), ink, radius: 3)
        }
        fill(studioBtn, t >= 1.9 ? blue : ghost, radius: 4)
        text("Studio Mode", at: NSPoint(x: studioBtn.minX + 14, y: studioBtn.minY + 5), size: 11, bold: true, color: ink)
        fill(fadeBox, NSColor(srgbRed: 30 / 255, green: 32 / 255, blue: 41 / 255, alpha: 1), radius: 4)
        stroke(fadeBox, (t >= 3.85 && t < 4.7) ? blue : ghost, radius: 4, width: 1.2)
        text("Fade", at: NSPoint(x: fadeBox.minX + 10, y: fadeBox.minY + 5), size: 11, bold: true, color: ink)
        let rest = NSPoint(x: 340, y: 135)
        let steps: [Hop] = [
            Hop(from: 1.0, to: 1.8, target: Self.center(studioBtn)),
            Hop(from: 3.0, to: 3.8, target: Self.center(fadeBox)),
            Hop(from: 4.8, to: 5.6, target: rest)
        ]
        drawPointer(at: Self.walk(t, start: rest, steps: steps), clicks: [1.9, 3.9], t: t)
    }

    private func drawVjsterGuide(t: CGFloat, busyPort: Int?) {
        let navy = NSColor(srgbRed: 26 / 255, green: 34 / 255, blue: 51 / 255, alpha: 1)
        let blue = NSColor(srgbRed: 47 / 255, green: 118 / 255, blue: 228 / 255, alpha: 1)
        let green = NSColor(srgbRed: 76 / 255, green: 194 / 255, blue: 110 / 255, alpha: 1)
        let card = NSRect(x: 24, y: 22, width: 492, height: 220)
        fill(card, navy, radius: 8)
        drawTrafficLights(x: 38, y: 34)
        if let port = busyPort {
            text("Port \(port) is currently held by another app (such as Stream Deck)", at: NSPoint(x: 38, y: 58), size: 13, bold: true, color: .white)
            let box1 = NSRect(x: 38, y: 94, width: 224, height: 124)
            let box2 = NSRect(x: 278, y: 94, width: 224, height: 124)
            fill(box1, NSColor(srgbRed: 39 / 255, green: 48 / 255, blue: 69 / 255, alpha: 1), radius: 6)
            fill(box2, NSColor(srgbRed: 39 / 255, green: 48 / 255, blue: 69 / 255, alpha: 1), radius: 6)
            text("Option A: Quit Stream Deck", at: NSPoint(x: 50, y: 108), size: 12, bold: true, color: green)
            text("Quit Elgato Stream Deck (or remove\nVJster actions from the active\npage), then click Stop & Start.", at: NSPoint(x: 50, y: 134), size: 11, bold: false, color: .white)
            text("Option B: Pick a second port", at: NSPoint(x: 290, y: 108), size: 12, bold: true, color: blue)
            text("Change VJster port (e.g. 48151)\nin Setup and in the Chrome\nVJster extension Options page.", at: NSPoint(x: 290, y: 134), size: 11, bold: false, color: .white)
        } else {
            text("Connect a YouTube video to Fadester Companion", at: NSPoint(x: 38, y: 58), size: 13, bold: true, color: .white)
            let box1 = NSRect(x: 38, y: 94, width: 224, height: 124)
            let box2 = NSRect(x: 278, y: 94, width: 224, height: 124)
            fill(box1, NSColor(srgbRed: 39 / 255, green: 48 / 255, blue: 69 / 255, alpha: 1), radius: 6)
            fill(box2, NSColor(srgbRed: 39 / 255, green: 48 / 255, blue: 69 / 255, alpha: 1), radius: 6)
            text("In Google Chrome", at: NSPoint(x: 50, y: 108), size: 12, bold: true, color: green)
            text("1. Ensure VJster extension is on.\n2. Open or refresh a YouTube video\n    and press Play.", at: NSPoint(x: 50, y: 134), size: 11, bold: false, color: .white)
            text("Or directly in OBS Studio", at: NSPoint(x: 290, y: 108), size: 12, bold: true, color: blue)
            text("1. Click Copy OBS Browser Source URL.\n2. Add a Browser Source in OBS and\n    paste that URL.", at: NSPoint(x: 290, y: 134), size: 11, bold: false, color: .white)
            if t >= 4.5 {
                drawCheckBadge(center: NSPoint(x: 270, y: 66), scale: Self.ease(t, 4.5, 4.9))
            }
        }
    }
}

private final class SheetBackground: NSView {
    override var isOpaque: Bool { true }
    override func draw(_ dirtyRect: NSRect) { NSColor.white.setFill(); dirtyRect.fill() }
}

@MainActor final class TourBoxImportWindow {
    private let panel: NSPanel
    private let canvas: ShowMeCanvas
    private let whyLabel = NSTextField(wrappingLabelWithString: "")
    private let stepsSummary = NSTextField(wrappingLabelWithString: "")
    private var stepButtons: [NSButton] = []
    private var saveBtn: NSButton!
    private var openBtn: NSButton!
    private var revealBtn: NSButton!
    private var savedPreset: URL?
    private var consoleInstalled: Bool
    private let onSavePreset: () -> URL?
    private let onOpenConsole: () -> Void
    private let onDownloadConsole: () -> Void

    init(
        savedPreset: URL?,
        consoleInstalled: Bool,
        onSavePreset: @escaping () -> URL?,
        onOpenConsole: @escaping () -> Void,
        onDownloadConsole: @escaping () -> Void
    ) {
        self.savedPreset = savedPreset
        self.consoleInstalled = consoleInstalled
        self.onSavePreset = onSavePreset
        self.onOpenConsole = onOpenConsole
        self.onDownloadConsole = onDownloadConsole
        let initialFolder = Self.folderLabel(for: savedPreset)
        canvas = ShowMeCanvas(mode: .tourboxImport(folderName: initialFolder))
        panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 580, height: 504),
            styleMask: [.titled, .closable, .utilityWindow],
            backing: .buffered,
            defer: false
        )
        panel.appearance = NSAppearance(named: .aqua)
        panel.title = "Import into TourBox Console — 3 quick clicks"
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false

        let root = SheetBackground(frame: NSRect(x: 0, y: 0, width: 580, height: 504))
        panel.contentView = root

        let stack = NSStackView()
        stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 10
        stack.edgeInsets = NSEdgeInsets(top: 16, left: 20, bottom: 16, right: 20)
        stack.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            stack.topAnchor.constraint(equalTo: root.topAnchor),
            stack.bottomAnchor.constraint(equalTo: root.bottomAnchor)
        ])

        whyLabel.font = .systemFont(ofSize: 12.5)
        stack.addArrangedSubview(whyLabel)
        whyLabel.widthAnchor.constraint(equalToConstant: 540).isActive = true

        // Interactive step selector pills (click any step to pause & inspect, or Loop animation)
        let titles = ["1. Click Import [↙]", "2. Pick .tb File", "3. Not Linked → OBS", "▶ Loop"]
        stepButtons = titles.enumerated().map { idx, title in
            let b = NSButton(title: title, target: self, action: #selector(selectStep(_:)))
            b.tag = idx
            b.setButtonType(.pushOnPushOff)
            b.font = .systemFont(ofSize: 11.5, weight: .semibold)
            b.state = idx == 3 ? .on : .off
            return b
        }
        let stepRow = NSStackView(views: stepButtons)
        stepRow.orientation = .horizontal; stepRow.spacing = 8
        stack.addArrangedSubview(stepRow)

        stack.addArrangedSubview(canvas)
        NSLayoutConstraint.activate([
            canvas.widthAnchor.constraint(equalToConstant: 540),
            canvas.heightAnchor.constraint(equalToConstant: 264)
        ])

        stepsSummary.font = .systemFont(ofSize: 12, weight: .medium)
        stack.addArrangedSubview(stepsSummary)
        stepsSummary.widthAnchor.constraint(equalToConstant: 540).isActive = true

        saveBtn = NSButton(title: "1. Save Preset (.tb)…", target: self, action: #selector(saveTapped))
        saveBtn.bezelStyle = .rounded
        openBtn = NSButton(title: "2. Open TourBox Console", target: self, action: #selector(primaryTapped))
        openBtn.bezelStyle = .rounded
        revealBtn = NSButton(title: "Show in Finder", target: self, action: #selector(revealFile))
        revealBtn.bezelStyle = .rounded
        let closeBtn = NSButton(title: "Close", target: self, action: #selector(closeTapped))
        let actions = NSStackView(views: [saveBtn, openBtn, revealBtn, NSView(), closeBtn])
        actions.orientation = .horizontal; actions.spacing = 10
        stack.addArrangedSubview(actions)
        actions.widthAnchor.constraint(equalToConstant: 540).isActive = true

        refreshCopy()
    }

    private static func folderLabel(for url: URL?) -> String {
        guard let url else { return "Downloads" }
        let name = url.deletingLastPathComponent().lastPathComponent
        return name.isEmpty || name == "/" ? "Downloads" : name
    }

    func update(savedPreset: URL?, consoleInstalled: Bool) {
        self.savedPreset = savedPreset
        self.consoleInstalled = consoleInstalled
        refreshCopy()
    }

    private func refreshCopy() {
        let folder = Self.folderLabel(for: savedPreset)
        let accent = NSColor(srgbRed: 38 / 255, green: 90 / 255, blue: 158 / 255, alpha: 1)
        canvas.mode = .tourboxImport(folderName: folder)
        if savedPreset != nil {
            whyLabel.stringValue = "Saved OBS Fadester for TourBox.tb in “\(folder)”! Now do these 3 quick clicks in TourBox Console (this window floats beside Console while you click):"
            saveBtn.title = "Save Another Copy…"
            saveBtn.bezelColor = nil
            openBtn.bezelColor = accent
            revealBtn.isHidden = false
        } else {
            whyLabel.stringValue = "Step 1: Click “1. Save Preset (.tb)…” below to save OBS Fadester for TourBox.tb to Downloads (or any folder). Step 2: Import it in TourBox Console in 3 quick clicks:"
            saveBtn.title = "1. Save Preset (.tb)…"
            saveBtn.bezelColor = accent
            openBtn.bezelColor = nil
            revealBtn.isHidden = true
        }
        openBtn.title = consoleInstalled ? "2. Open TourBox Console" : "2. Download TourBox Console…"
        stepsSummary.stringValue = "1. In TourBox Console, click the middle Import [↙] icon beside Preset List.\n2. Choose “\(folder)” in the sidebar and open OBS Fadester for TourBox.tb.\n3. With OBS open, click “Not Linked” → pick OBS (not FadesterTourBoxPanel) → click Save, with Auto Switch on."
    }

    @objc private func selectStep(_ sender: NSButton) {
        for b in stepButtons { b.state = (b === sender) ? .on : .off }
        switch sender.tag {
        case 0: canvas.stopAnimation(); canvas.fixedTime = 2.05
        case 1: canvas.stopAnimation(); canvas.fixedTime = 5.4
        case 2: canvas.stopAnimation(); canvas.fixedTime = 8.45
        default: canvas.fixedTime = nil; canvas.startAnimation()
        }
    }

    @objc private func saveTapped() {
        if let url = onSavePreset() {
            savedPreset = url
            refreshCopy()
        }
    }

    @objc private func primaryTapped() {
        // Dock the guide card on the right side of the screen so it stays visible beside TourBox Console!
        if let screen = NSScreen.main?.visibleFrame {
            panel.setFrameOrigin(NSPoint(x: max(screen.minX + 20, screen.maxX - panel.frame.width - 24), y: max(screen.minY + 40, screen.midY - panel.frame.height / 2)))
        }
        if consoleInstalled { onOpenConsole() } else { onDownloadConsole() }
    }

    @objc private func revealFile() {
        guard let url = savedPreset else { return }
        NSWorkspace.shared.activateFileViewerSelecting([url])
    }

    @objc private func closeTapped() { close() }

    func show(relativeTo parent: NSWindow?) {
        if !panel.isVisible {
            if let parentFrame = parent?.frame {
                panel.setFrameOrigin(NSPoint(x: parentFrame.midX - panel.frame.width / 2, y: parentFrame.midY - panel.frame.height / 2))
            } else {
                panel.center()
            }
        }
        for (i, b) in stepButtons.enumerated() { b.state = i == 3 ? .on : .off }
        canvas.fixedTime = nil
        canvas.startAnimation()
        panel.makeKeyAndOrderFront(nil)
    }

    func close() {
        canvas.stopAnimation()
        panel.close()
    }

    func renderPreview(to url: URL, time: CGFloat = 2.05) throws {
        canvas.fixedTime = time
        panel.contentView!.layoutSubtreeIfNeeded()
        guard let image = panel.contentView!.bitmapImageRepForCachingDisplay(in: panel.contentView!.bounds) else {
            throw PanelFailure.message("Import preview image could not be created.")
        }
        panel.contentView!.cacheDisplay(in: panel.contentView!.bounds, to: image)
        guard let png = image.representation(using: .png, properties: [:]) else {
            throw PanelFailure.message("Import preview PNG unavailable.")
        }
        try png.write(to: url)
    }
}

@MainActor final class ObsShowMeWindow {
    private let panel: NSPanel
    private let canvas: ShowMeCanvas
    private var onCheckAgain: (() -> Void)?

    init(mode: ShowMeCanvas.Mode, title: String, detail: String, actionTitle: String?, onAction: (() -> Void)?) {
        self.onCheckAgain = onAction
        canvas = ShowMeCanvas(mode: mode)
        panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 580, height: 400),
            styleMask: [.titled, .closable, .utilityWindow],
            backing: .buffered,
            defer: false
        )
        panel.appearance = NSAppearance(named: .aqua)
        panel.title = title
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false

        let root = SheetBackground(frame: NSRect(x: 0, y: 0, width: 580, height: 400))
        panel.contentView = root
        let stack = NSStackView()
        stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 12
        stack.edgeInsets = NSEdgeInsets(top: 16, left: 20, bottom: 16, right: 20)
        stack.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            stack.topAnchor.constraint(equalTo: root.topAnchor),
            stack.bottomAnchor.constraint(equalTo: root.bottomAnchor)
        ])

        stack.addArrangedSubview(canvas)
        NSLayoutConstraint.activate([
            canvas.widthAnchor.constraint(equalToConstant: 540),
            canvas.heightAnchor.constraint(equalToConstant: 264)
        ])

        let info = NSTextField(wrappingLabelWithString: detail)
        info.font = .systemFont(ofSize: 12.5)
        stack.addArrangedSubview(info)
        info.widthAnchor.constraint(equalToConstant: 540).isActive = true

        var buttons: [NSView] = []
        if let actionLabel = actionTitle {
            let act = NSButton(title: actionLabel, target: self, action: #selector(actionTapped))
            act.bezelStyle = .rounded
            act.bezelColor = NSColor(srgbRed: 38 / 255, green: 90 / 255, blue: 158 / 255, alpha: 1)
            act.contentTintColor = .white
            buttons.append(act)
        }
        buttons.append(NSView())
        buttons.append(NSButton(title: "Close", target: self, action: #selector(closeTapped)))
        let bar = NSStackView(views: buttons)
        bar.orientation = .horizontal; bar.spacing = 10
        stack.addArrangedSubview(bar)
        bar.widthAnchor.constraint(equalToConstant: 540).isActive = true
    }

    @objc private func actionTapped() {
        let cb = onCheckAgain
        close()
        cb?()
    }

    @objc private func closeTapped() { close() }

    func show(relativeTo parent: NSWindow?) {
        if let parentFrame = parent?.frame {
            panel.setFrameOrigin(NSPoint(x: parentFrame.midX - panel.frame.width / 2, y: parentFrame.midY - panel.frame.height / 2))
        } else {
            panel.center()
        }
        canvas.startAnimation()
        panel.makeKeyAndOrderFront(nil)
    }

    func close() {
        canvas.stopAnimation()
        panel.close()
    }
}

/// Live interactive architecture & signal-flow diagram at the top of the Setup tab.
@MainActor final class SetupDiagramView: NSView {
    struct State: Equatable {
        var obsLamp: Lamp = .grey
        var obsRunning = false
        var obsConnected = false
        var studioOff = false
        var frontIsObs = false
        var obsAction = "openObs"
        var tourBoxLamp: Lamp = .amber
        var consoleRunning = false
        var consoleInstalled = true
        var presetSync: PresetSyncState = .neverSaved
        var vjsterLamp: Lamp = .green
        var vjsterEnabled = true
        var vjsterPort = 48150
        var vjsterConnected = false
        var vjsterPortBusy = false
        var controlsLamp: Lamp = .grey
        var controlsRunning = false
        var controlsArmed = false
        var axTrusted = true
        var canStart = true
    }

    private struct ButtonSpec {
        let id: String
        let title: String
        let rect: NSRect
        let fill: NSColor
        let enabled: Bool
    }

    private struct Geometry {
        let box1: NSRect
        let box2: NSRect
        let box3a: NSRect
        let box3b: NSRect
        let buttons: [ButtonSpec]
    }

    var state = State() {
        didSet {
            guard oldValue != state else { return }
            window?.invalidateCursorRects(for: self)
            needsDisplay = true
        }
    }
    var onAction: ((String) -> Void)?
    private var pressedId: String?

    override var isFlipped: Bool { true }
    override var intrinsicContentSize: NSSize { NSSize(width: NSView.noIntrinsicMetric, height: 164) }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        translatesAutoresizingMaskIntoConstraints = false
    }
    @available(*, unavailable) required init?(coder: NSCoder) { nil }

    private static let navy = NSColor(srgbRed: 26 / 255, green: 34 / 255, blue: 51 / 255, alpha: 1)
    private static let darkCard = NSColor(srgbRed: 33 / 255, green: 40 / 255, blue: 56 / 255, alpha: 1)
    private static let accent = NSColor(srgbRed: 38 / 255, green: 90 / 255, blue: 158 / 255, alpha: 1)
    private static let stopRed = NSColor(srgbRed: 184 / 255, green: 58 / 255, blue: 52 / 255, alpha: 1)
    private static let green = NSColor(srgbRed: 62 / 255, green: 176 / 255, blue: 98 / 255, alpha: 1)
    private static let amber = NSColor(srgbRed: 232 / 255, green: 158 / 255, blue: 32 / 255, alpha: 1)
    private static let red = NSColor(srgbRed: 224 / 255, green: 78 / 255, blue: 68 / 255, alpha: 1)
    private static let grey = NSColor(srgbRed: 148 / 255, green: 156 / 255, blue: 172 / 255, alpha: 1)
    private static let slatePill = NSColor(srgbRed: 58 / 255, green: 68 / 255, blue: 92 / 255, alpha: 1)

    private func lampColor(_ lamp: Lamp) -> NSColor {
        switch lamp {
        case .green: return Self.green
        case .amber: return Self.amber
        case .red: return Self.red
        case .grey: return Self.grey
        }
    }

    private func pillWidth(_ title: String) -> CGFloat {
        let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.boldSystemFont(ofSize: 10.5)]
        return max(52, ceil((title as NSString).size(withAttributes: attrs).width) + 16)
    }

    private func geometry(for totalWidth: CGFloat) -> Geometry {
        let w = max(totalWidth, 700)
        let pad: CGFloat = 12
        let gap1: CGFloat = 70
        let gap2: CGFloat = 88
        let avail = w - pad * 2 - gap1 - gap2
        let w1 = round(avail * 0.34)
        let w2 = round(avail * 0.30)
        let w3 = avail - w1 - w2

        let x1 = pad
        let x2 = x1 + w1 + gap1
        let x3 = x2 + w2 + gap2

        let box1 = NSRect(x: x1, y: 28, width: w1, height: 124)
        let box2 = NSRect(x: x2, y: 28, width: w2, height: 124)
        let box3a = NSRect(x: x3, y: 28, width: w3, height: 58)
        let box3b = NSRect(x: x3, y: 94, width: w3, height: 58)

        var buttons: [ButtonSpec] = []

        // Box 1 buttons: Save .tb + Guide/Console
        let b1Title: String
        let b1Fill: NSColor
        switch state.presetSync {
        case .neverSaved: b1Title = "1. Save .tb"; b1Fill = Self.accent
        case .current: b1Title = "Save .tb"; b1Fill = Self.slatePill
        case .updateAvailable: b1Title = "Update .tb!"; b1Fill = Self.amber
        }
        let b1W = pillWidth(b1Title)
        let b2Title = state.consoleRunning ? "Guide" : (state.consoleInstalled ? "2. Console" : "Download")
        let b2Action = state.consoleRunning ? "guide" : (state.consoleInstalled ? "openConsole" : "downloadConsole")
        let b2W = pillWidth(b2Title)
        buttons.append(ButtonSpec(
            id: "savePreset",
            title: b1Title,
            rect: NSRect(x: box1.minX + 10, y: box1.maxY - 31, width: b1W, height: 22),
            fill: b1Fill,
            enabled: true
        ))
        buttons.append(ButtonSpec(
            id: b2Action,
            title: b2Title,
            rect: NSRect(x: box1.minX + 16 + b1W, y: box1.maxY - 31, width: b2W, height: 22),
            fill: state.presetSync == .current && !state.consoleRunning ? Self.accent : Self.slatePill,
            enabled: true
        ))

        // Box 2 button: Start / Stop / Grant Accessibility
        let ctlTitle: String
        let ctlAction: String
        let ctlFill: NSColor
        if state.controlsRunning {
            ctlTitle = "Stop Controls"; ctlAction = "stop"; ctlFill = Self.stopRed
        } else if !state.axTrusted {
            ctlTitle = "Grant Access…"; ctlAction = "grantAx"; ctlFill = Self.amber
        } else {
            ctlTitle = "Start Controls"; ctlAction = "start"; ctlFill = Self.accent
        }
        let ctlW = pillWidth(ctlTitle)
        buttons.append(ButtonSpec(
            id: ctlAction,
            title: ctlTitle,
            rect: NSRect(x: box2.minX + 10, y: box2.maxY - 31, width: ctlW, height: 22),
            fill: ctlFill,
            enabled: state.controlsRunning || !state.axTrusted || state.canStart
        ))

        // Box 3A button: OBS Studio action
        let obsBtnTitle: String
        let obsBtnAction: String
        if !state.obsRunning {
            obsBtnTitle = "Open OBS"; obsBtnAction = "openObs"
        } else if !state.obsConnected || (state.studioOff && !state.controlsRunning) {
            obsBtnTitle = "Show me"; obsBtnAction = state.obsAction
        } else if state.controlsRunning && !state.frontIsObs {
            obsBtnTitle = "Focus OBS"; obsBtnAction = "openObs"
        } else {
            obsBtnTitle = "Read OBS"; obsBtnAction = "scan"
        }
        let obsW = pillWidth(obsBtnTitle)
        buttons.append(ButtonSpec(
            id: obsBtnAction,
            title: obsBtnTitle,
            rect: NSRect(x: box3a.maxX - obsW - 10, y: box3a.maxY - 28, width: obsW, height: 21),
            fill: Self.accent,
            enabled: obsBtnAction != "scan" || (!state.controlsRunning && state.canStart)
        ))

        // Box 3B button: VJster Video action
        if state.vjsterEnabled {
            let vjTitle: String
            let vjAction: String
            if state.vjsterPortBusy {
                vjTitle = "Show me"; vjAction = "vjsterPort"
            } else if state.controlsRunning && !state.vjsterConnected {
                vjTitle = "Show me"; vjAction = "vjsterWait"
            } else {
                vjTitle = "Copy URL"; vjAction = "copyObsUrl"
            }
            let vjW = pillWidth(vjTitle)
            buttons.append(ButtonSpec(
                id: vjAction,
                title: vjTitle,
                rect: NSRect(x: box3b.maxX - vjW - 10, y: box3b.maxY - 28, width: vjW, height: 21),
                fill: Self.accent,
                enabled: true
            ))
        }

        return Geometry(box1: box1, box2: box2, box3a: box3a, box3b: box3b, buttons: buttons)
    }

    override func resetCursorRects() {
        for btn in geometry(for: bounds.width).buttons where btn.enabled {
            addCursorRect(btn.rect, cursor: .pointingHand)
        }
    }

    override func mouseDown(with event: NSEvent) {
        let pt = convert(event.locationInWindow, from: nil)
        guard let hit = geometry(for: bounds.width).buttons.first(where: { $0.enabled && $0.rect.contains(pt) }) else { return }
        pressedId = hit.id
        needsDisplay = true
        defer { pressedId = nil; needsDisplay = true }
        onAction?(hit.id)
    }

    private func fill(_ rect: NSRect, _ color: NSColor, radius: CGFloat = 7) {
        color.setFill()
        NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius).fill()
    }

    private func stroke(_ rect: NSRect, _ color: NSColor, radius: CGFloat = 7, width: CGFloat = 1.3) {
        color.setStroke()
        let p = NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius)
        p.lineWidth = width
        p.stroke()
    }

    private func drawText(_ text: String, at point: NSPoint, size: CGFloat, bold: Bool = false, color: NSColor) {
        let attrs: [NSAttributedString.Key: Any] = [
            .font: bold ? NSFont.boldSystemFont(ofSize: size) : NSFont.systemFont(ofSize: size),
            .foregroundColor: color
        ]
        (text as NSString).draw(at: point, withAttributes: attrs)
    }

    private func drawDot(_ lamp: Lamp, x: CGFloat, y: CGFloat) {
        lampColor(lamp).setFill()
        NSBezierPath(ovalIn: NSRect(x: x, y: y, width: 9.5, height: 9.5)).fill()
    }

    private func drawArrowHead(tip: NSPoint, color: NSColor) {
        color.setFill()
        let head = NSBezierPath()
        head.move(to: tip)
        head.line(to: NSPoint(x: tip.x - 7, y: tip.y - 4.2))
        head.line(to: NSPoint(x: tip.x - 7, y: tip.y + 4.2))
        head.close()
        head.fill()
    }

    private func drawMiniTourBox(in rect: NSRect) {
        let shell = NSColor(srgbRed: 52 / 255, green: 60 / 255, blue: 82 / 255, alpha: 1)
        let rim = NSColor(srgbRed: 120 / 255, green: 132 / 255, blue: 162 / 255, alpha: 0.55)
        let well = NSColor(srgbRed: 22 / 255, green: 26 / 255, blue: 38 / 255, alpha: 1)
        fill(rect, shell, radius: 9)
        stroke(rect, rim, radius: 9, width: 1)
        // Flat Dial (bottom-left), Raised Knob (top-right), Scroll (top-left), D-pad (bottom-right)
        fill(NSRect(x: rect.minX + 6, y: rect.minY + 23, width: 18, height: 18), well, radius: 9)
        fill(NSRect(x: rect.minX + 25, y: rect.minY + 6, width: 14, height: 14), well, radius: 7)
        fill(NSRect(x: rect.minX + 8, y: rect.minY + 8, width: 12, height: 7), well, radius: 3)
        let dpad = NSColor(srgbRed: 78 / 255, green: 146 / 255, blue: 240 / 255, alpha: 0.9)
        fill(NSRect(x: rect.minX + 30, y: rect.minY + 26, width: 4, height: 12), dpad, radius: 1.5)
        fill(NSRect(x: rect.minX + 26, y: rect.minY + 30, width: 12, height: 4), dpad, radius: 1.5)
    }

    override func draw(_ dirtyRect: NSRect) {
        let g = geometry(for: bounds.width)
        let outerBg = NSColor(srgbRed: 245 / 255, green: 248 / 255, blue: 253 / 255, alpha: 1)
        let outerBorder = NSColor(srgbRed: 214 / 255, green: 222 / 255, blue: 236 / 255, alpha: 1)
        fill(bounds, outerBg, radius: 8)
        stroke(bounds.insetBy(dx: 0.5, dy: 0.5), outerBorder, radius: 8, width: 1)

        drawText(
            "HOW EVERYTHING CONNECTS   ·   Click any button inside the diagram to save the preset, open apps, or start controls",
            at: NSPoint(x: 12, y: 7),
            size: 10.5,
            bold: true,
            color: NSColor(srgbRed: 76 / 255, green: 88 / 255, blue: 112 / 255, alpha: 1)
        )

        let lightInk = NSColor(srgbRed: 232 / 255, green: 237 / 255, blue: 247 / 255, alpha: 1)
        let mutedLight = NSColor(srgbRed: 172 / 255, green: 182 / 255, blue: 204 / 255, alpha: 1)
        let mutedDark = NSColor(srgbRed: 96 / 255, green: 106 / 255, blue: 126 / 255, alpha: 1)

        // --- Arrow 1: TourBox + Console -> Fadester Companion ---
        let a1Active = state.consoleRunning
        let a1Color = a1Active ? Self.green : Self.grey
        let a1Start = NSPoint(x: g.box1.maxX + 2, y: g.box1.midY)
        let a1End = NSPoint(x: g.box2.minX - 3, y: g.box2.midY)
        let p1 = NSBezierPath()
        p1.lineWidth = 2.0
        if !a1Active { p1.setLineDash([4, 3], count: 2, phase: 0) }
        p1.move(to: a1Start)
        p1.line(to: NSPoint(x: a1End.x - 5, y: a1End.y))
        a1Color.setStroke()
        p1.stroke()
        drawArrowHead(tip: a1End, color: a1Color)
        drawText("Shortcuts", at: NSPoint(x: a1Start.x + 8, y: a1Start.y - 17), size: 9.5, bold: true, color: Self.navy)
        drawText("OBS active", at: NSPoint(x: a1Start.x + 7, y: a1Start.y + 5), size: 9.0, bold: false, color: mutedDark)

        // --- Arrow 2: Fadester Companion -> OBS Studio (top) & VJster Video (bottom) ---
        let splitX = g.box2.maxX + 18
        let trunkY = g.box2.midY
        let topY = g.box3a.midY
        let botY = g.box3b.midY

        let obsLinkColor = state.obsConnected ? Self.green : (state.obsRunning ? Self.amber : Self.grey)
        let pTop = NSBezierPath()
        pTop.lineWidth = 2.0
        if !state.obsConnected { pTop.setLineDash([4, 3], count: 2, phase: 0) }
        pTop.move(to: NSPoint(x: g.box2.maxX + 2, y: trunkY))
        pTop.line(to: NSPoint(x: splitX, y: trunkY))
        pTop.line(to: NSPoint(x: splitX, y: topY))
        pTop.line(to: NSPoint(x: g.box3a.minX - 8, y: topY))
        obsLinkColor.setStroke()
        pTop.stroke()
        drawArrowHead(tip: NSPoint(x: g.box3a.minX - 3, y: topY), color: obsLinkColor)
        drawText("WS + T-bar", at: NSPoint(x: splitX + 5, y: topY - 15), size: 9.2, bold: true, color: Self.navy)

        let vjActive = state.vjsterEnabled && !state.vjsterPortBusy && (!state.controlsRunning || state.vjsterConnected)
        let vjLinkColor = !state.vjsterEnabled ? Self.grey : (state.vjsterPortBusy ? Self.red : (vjActive ? Self.green : Self.amber))
        let pBot = NSBezierPath()
        pBot.lineWidth = 2.0
        if !vjActive { pBot.setLineDash([4, 3], count: 2, phase: 0) }
        pBot.move(to: NSPoint(x: splitX, y: trunkY))
        pBot.line(to: NSPoint(x: splitX, y: botY))
        pBot.line(to: NSPoint(x: g.box3b.minX - 8, y: botY))
        vjLinkColor.setStroke()
        pBot.stroke()
        drawArrowHead(tip: NSPoint(x: g.box3b.minX - 3, y: botY), color: vjLinkColor)
        drawText("Port \(state.vjsterPort)", at: NSPoint(x: splitX + 5, y: botY + 4), size: 9.2, bold: true, color: mutedDark)

        // --- Box 1: TourBox + Console ---
        fill(g.box1, Self.darkCard, radius: 7)
        stroke(g.box1, lampColor(state.tourBoxLamp).withAlphaComponent(0.85), radius: 7, width: 1.4)
        drawDot(state.tourBoxLamp, x: g.box1.minX + 10, y: g.box1.minY + 10)
        drawText("1. TourBox + Console", at: NSPoint(x: g.box1.minX + 24, y: g.box1.minY + 7), size: 11.5, bold: true, color: .white)
        drawMiniTourBox(in: NSRect(x: g.box1.minX + 10, y: g.box1.minY + 32, width: 45, height: 47))
        let tbLine1 = state.consoleRunning ? "Console: open" : (state.consoleInstalled ? "Console: closed" : "Console: get app")
        drawText(tbLine1, at: NSPoint(x: g.box1.minX + 62, y: g.box1.minY + 33), size: 10.5, bold: true, color: lightInk)
        drawText("Import Mac .tb once", at: NSPoint(x: g.box1.minX + 62, y: g.box1.minY + 49), size: 9.8, bold: false, color: mutedLight)
        drawText("Auto Switch → OBS", at: NSPoint(x: g.box1.minX + 62, y: g.box1.minY + 63), size: 9.8, bold: false, color: mutedLight)

        // --- Box 2: Fadester Companion (Here) ---
        fill(g.box2, Self.navy, radius: 7)
        stroke(g.box2, state.controlsArmed ? Self.green : (!state.axTrusted ? Self.amber : Self.accent), radius: 7, width: 1.5)
        drawDot(state.controlsLamp, x: g.box2.minX + 10, y: g.box2.minY + 10)
        drawText("2. Companion (Here)", at: NSPoint(x: g.box2.minX + 24, y: g.box2.minY + 7), size: 11.5, bold: true, color: .white)
        let ctlText = !state.controlsRunning ? (state.axTrusted ? "Controls: off" : "Needs Mac Access") : (state.controlsArmed ? "Controls: armed" : "Controls: starting…")
        drawText(ctlText, at: NSPoint(x: g.box2.minX + 10, y: g.box2.minY + 33), size: 10.5, bold: true, color: lightInk)
        drawText("Drives OBS & VJster", at: NSPoint(x: g.box2.minX + 10, y: g.box2.minY + 49), size: 9.8, bold: false, color: mutedLight)
        drawText("Keep this app open", at: NSPoint(x: g.box2.minX + 10, y: g.box2.minY + 63), size: 9.8, bold: false, color: mutedLight)

        // --- Box 3A: OBS Studio ---
        fill(g.box3a, .white, radius: 7)
        stroke(g.box3a, lampColor(state.obsLamp), radius: 7, width: 1.4)
        drawDot(state.obsLamp, x: g.box3a.minX + 10, y: g.box3a.minY + 9)
        drawText("3. OBS Studio", at: NSPoint(x: g.box3a.minX + 24, y: g.box3a.minY + 6), size: 11.5, bold: true, color: Self.navy)
        let obsNote: String
        if !state.obsRunning { obsNote = "Not running" }
        else if !state.obsConnected { obsNote = "Setup WebSocket" }
        else if state.studioOff && !state.controlsRunning { obsNote = "Turn Studio Mode on" }
        else if state.controlsRunning && !state.frontIsObs { obsNote = "Bring OBS to front" }
        else { obsNote = "Keep in front live" }
        drawText(obsNote, at: NSPoint(x: g.box3a.minX + 10, y: g.box3a.minY + 32), size: 10.0, bold: false, color: mutedDark)

        // --- Box 3B: VJster Video ---
        fill(g.box3b, .white, radius: 7)
        stroke(g.box3b, lampColor(state.vjsterLamp), radius: 7, width: 1.4)
        drawDot(state.vjsterLamp, x: g.box3b.minX + 10, y: g.box3b.minY + 9)
        drawText("4. VJster Video", at: NSPoint(x: g.box3b.minX + 24, y: g.box3b.minY + 6), size: 11.5, bold: true, color: Self.navy)
        let vjNote: String
        if !state.vjsterEnabled { vjNote = "Optional (off)" }
        else if state.vjsterPortBusy { vjNote = "Port \(state.vjsterPort) busy" }
        else if state.controlsRunning && !state.vjsterConnected { vjNote = "Open YouTube / /obs" }
        else if state.controlsRunning { vjNote = "Player connected" }
        else { vjNote = "Chrome or /obs ready" }
        drawText(vjNote, at: NSPoint(x: g.box3b.minX + 10, y: g.box3b.minY + 32), size: 10.0, bold: false, color: mutedDark)

        // --- Interactive pill buttons inside all boxes ---
        for btn in g.buttons {
            let isDown = pressedId == btn.id
            let bg: NSColor
            if !btn.enabled {
                bg = NSColor(srgbRed: 182 / 255, green: 188 / 255, blue: 200 / 255, alpha: 1)
            } else if isDown {
                bg = btn.fill.withAlphaComponent(0.78)
            } else {
                bg = btn.fill
            }
            fill(btn.rect, bg, radius: 5)
            let attrs: [NSAttributedString.Key: Any] = [
                .font: NSFont.boldSystemFont(ofSize: 10.5),
                .foregroundColor: NSColor.white
            ]
            let sz = (btn.title as NSString).size(withAttributes: attrs)
            let textPt = NSPoint(x: btn.rect.minX + (btn.rect.width - sz.width) / 2, y: btn.rect.minY + (btn.rect.height - sz.height) / 2)
            (btn.title as NSString).draw(at: textPt, withAttributes: attrs)
        }
    }
}

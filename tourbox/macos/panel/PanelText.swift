// SPDX-License-Identifier: GPL-2.0-or-later
import Foundation

/// The Mac panel's language: the same 10 languages and words as the Windows panel (tourbox/panel/PanelText.cs),
/// from the catalog that make-strings.cjs generates into PanelStrings.swift.
enum PanelText {
    private static let table: [String: [String]] = {
        guard let data = PanelStrings.json.data(using: .utf8),
              let rows = try? JSONSerialization.jsonObject(with: data) as? [String: [String]] else { return [:] }
        return rows
    }()
    private static var index = 0
    static var locale: String { PanelStrings.locales[index] }

    static func use(_ requested: String) {
        index = PanelStrings.locales.firstIndex(of: normalize(requested)) ?? 0
    }

    /// The same rules as the Windows panel: Traditional Chinese for Taiwan, Hong Kong and Macao, Simplified for the rest, else the language.
    static func normalize(_ requested: String) -> String {
        let code = requested.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "_", with: "-").lowercased()
        if ["zh-tw", "zh-hk", "zh-mo", "zh-cht", "zh-hant"].contains(code) || code.hasPrefix("zh-hant-") { return "zh-TW" }
        if ["zh", "zh-cn", "zh-sg", "zh-chs", "zh-hans"].contains(code) || code.hasPrefix("zh-hans-") { return "zh-CN" }
        let primary = String(code.split(separator: "-").first ?? "")
        return PanelStrings.locales.contains(primary) ? primary : "en"
    }

    /// Takes --language CODE (or --language=CODE) out of the arguments; without it, the Mac's first preferred language.
    static func choose(from args: [String], preferred: [String] = Locale.preferredLanguages) -> [String] {
        var rest: [String] = [], chosen: String?
        var i = 0
        while i < args.count {
            if args[i] == "--language" && i + 1 < args.count { chosen = args[i + 1]; i += 2; continue }
            if args[i].hasPrefix("--language=") { chosen = String(args[i].dropFirst("--language=".count)); i += 1; continue }
            rest.append(args[i]); i += 1
        }
        use(chosen ?? preferred.first ?? "en")
        return rest
    }

    static func text(_ key: String, _ values: [Any]) -> String {
        guard let row = table[key], !row.isEmpty else { return key }
        // "&&" is how the Windows panel writes "&" on a button.
        var result = (index < row.count ? row[index] : row[0]).replacingOccurrences(of: "&&", with: "&")
        for (i, value) in values.enumerated() { result = result.replacingOccurrences(of: "{\(i)}", with: String(describing: value)) }
        return result
    }

    static func has(_ key: String) -> Bool { table[key] != nil }

    static func selfTest() throws {
        func check(_ okay: Bool, _ label: String) throws { if !okay { throw PanelFailure.message("Self-test: " + label) } }
        let previous = locale
        defer { use(previous) }
        try check(table.count > 100 && PanelStrings.locales.count == 10, "panel catalog loads")
        try check(normalize("zh-Hant-HK") == "zh-TW" && normalize("zh-Hans-CN") == "zh-CN" && normalize("de-DE") == "de" && normalize("pt-BR") == "en", "panel language selection")
        use("de"); try check(L("setup") == "Einrichtung" && L("obsConnected", 14).contains("14"), "German panel text")
        use("en"); try check(L("saveStart") == "Save & start controls" && L("no.such.key") == "no.such.key", "English panel text")
        try check(choose(from: ["--language", "ja", "--self-test"]) == ["--self-test"] && locale == "ja", "--language argument")
    }
}

/// The panel text for key in the panel's language; {0}, {1}… take values.
func L(_ key: String, _ values: Any...) -> String { PanelText.text(key, values) }

// SPDX-License-Identifier: GPL-2.0-or-later
using System.Text.Json.Nodes;

namespace Fadester.TourBox;

internal record Chord(uint Mods, uint Key)
{
    public static Chord Parse(string text)
    {
        string[] parts = text.ToUpperInvariant().Split('+', StringSplitOptions.TrimEntries);
        uint mods = 0;
        foreach (string part in parts[..^1])
        {
            uint bit = part switch { "CTRL" => 2u, "ALT" => 1u, "SHIFT" => 4u, "WIN" => 8u, _ => throw new InvalidDataException("Unknown shortcut modifier: " + part) };
            if ((mods & bit) != 0) throw new InvalidDataException("Duplicate modifier: " + text);
            mods |= bit;
        }
        string key = parts[^1];
        uint code;
        if (key.Length == 1 && char.IsAsciiLetterOrDigit(key[0])) code = key[0];
        else if (key.StartsWith('F') && int.TryParse(key[1..], out var n) && n is >= 1 and <= 24) code = (uint)(0x70 + n - 1);
        else throw new InvalidDataException("Unsupported shortcut key: " + text);
        if (mods == 0) throw new InvalidDataException("Global shortcuts need a modifier: " + text);
        return new(mods, code);
    }
}

/// <summary>
/// The names a user sees: an action's label from presets/map.json (the panel shows the same labels) and a game
/// controller control as the panel's Game controller tab names it. Without a map an action keeps its id.
/// </summary>
internal static class ActionNames
{
    private static Dictionary<string, string> labels = new();

    /** Once, before any line is printed. A map that cannot be read leaves the ids (the bindings report the map itself). */
    public static void Load(string mapPath)
    {
        var found = new Dictionary<string, string>();
        try
        {
            if (JsonNode.Parse(File.ReadAllText(mapPath))?["presets"] is not JsonObject presets) return;
            foreach (var bank in presets)
                foreach (var list in new[] { "bindings", "nativeBindings", "menuBindings" })
                    if (bank.Value?[list] is JsonArray rows)
                        foreach (var row in rows)
                            if (row?["action"] is JsonValue action && action.TryGetValue<string>(out var id) &&
                                row["label"] is JsonValue label && label.TryGetValue<string>(out var text) && text.Length > 0)
                                found.TryAdd(id, text);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or System.Text.Json.JsonException or InvalidOperationException) { return; }
        labels = found;
    }

    public static string Of(string id) => labels.TryGetValue(id, out var label) ? label : id switch
    {
        "vjster.speed.fast" => "Video speed: fast preset",
        "vjster.speed.slow" => "Video speed: slow preset",
        // The controller's own queue ids for its take: name them as the take they run.
        "pad.take" or "take.now" => Of("take"),
        _ => id,
    };

    /** A controller control as the Controller map shows it: "D-pad Down", "LS ↑", "LT · let go". */
    public static string Control(string control) => control switch
    {
        "DpadUp" => "D-pad Up", "DpadDown" => "D-pad Down", "DpadLeft" => "D-pad Left", "DpadRight" => "D-pad Right",
        "LS" or "RS" => control + " · Press",
        "LTRelease" => "LT · let go",
        _ when control.StartsWith("Left", StringComparison.Ordinal) && control.Length > 4 => "LS " + Arrow(control[4..]),
        _ when control.StartsWith("Right", StringComparison.Ordinal) && control.Length > 5 => "RS " + Arrow(control[5..]),
        _ => control,
    };

    private static string Arrow(string direction) => direction switch { "Up" => "↑", "Down" => "↓", "Left" => "←", "Right" => "→", _ => direction };
}

internal sealed record Binding(Chord Chord, string Label, string Action)
{
    public static List<Binding> Load(string path)
    {
        var root = JsonNode.Parse(File.ReadAllText(path));
        if (root?["version"]?.GetValue<int>() != 1 || root["presets"] is not JsonObject presets) throw new InvalidDataException("Unsupported preset map.");
        var seen = new Dictionary<Chord, Binding>();
        foreach (var bank in presets)
        {
            foreach (var row in bank.Value!["bindings"]!.AsArray().Concat(bank.Value["menuBindings"] as JsonArray ?? new JsonArray()))
            {
                if (row?["hotkey"] is null)
                {
                    if (row?["action"]?.GetValue<string>() is "preset.switch" or "bank.switch" || row?["native"] is not null) continue;
                    throw new InvalidDataException("Map binding lacks a keyboard shortcut.");
                }
                string action = row["action"]!.GetValue<string>(), label = row["hotkey"]!.GetValue<string>(); var chord = Chord.Parse(label);
                if (!DeskActions.Supported.Contains(action)) throw new InvalidDataException("Unknown mapped action: " + action);
                if (seen.TryGetValue(chord, out var other) && other.Action != action) throw new InvalidDataException($"Shortcut conflict: {label} for {action} and {other.Action}");
                seen[chord] = new(chord, label, action);
            }
        }
        if (seen.Count == 0) throw new InvalidDataException("No mapped keyboard shortcuts.");
        return seen.Values.ToList();
    }
}

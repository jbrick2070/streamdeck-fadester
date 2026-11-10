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

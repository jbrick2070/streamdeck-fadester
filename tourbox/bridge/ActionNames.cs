// SPDX-License-Identifier: GPL-2.0-or-later
using System.Text.Json.Nodes;

namespace Fadester.TourBox;

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

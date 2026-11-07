// SPDX-License-Identifier: GPL-2.0-or-later
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace Fadester.TourBox;

internal sealed class BridgeConfig
{
    public string Host { get; set; } = "127.0.0.1";
    public int Port { get; set; } = 4455;
    public string MusicInput { get; set; } = "";
    public string ContentInput { get; set; } = "";
    public string MicInput { get; set; } = "";
    public string MediaInput { get; set; } = "";
    public string OverlayScene { get; set; } = "";
    public string OverlaySource { get; set; } = "";
    public string[] Anchors { get; set; } = ["", "", "", ""];
    public double VolumeStepDb { get; set; } = 1.0;
    public double DuckDb { get; set; } = -12.0;
    public double FaderStep { get; set; } = 0.05;
    public int TransitionStepMs { get; set; } = 50;
    public bool MixEnabled { get; set; }
    public double MixStepDb { get; set; } = 3;
    public int MixFadeMs { get; set; } = 600;
    /** VJster: the link the Chrome extension connects to (docs/vjster R-LNK-1..2); off leaves the port alone. */
    public bool VjsterEnabled { get; set; } = true;
    public int VjsterPort { get; set; } = VjsterLink.DefaultPort;
    /** Empty lets any VJster extension connect; otherwise only this 32-letter id (the extension's options page shows it). */
    public string VjsterExtensionId { get; set; } = "";
    /** The two VJ layers: a scene item each, by scene and source name. Layer 2 is the one opacity rides. */
    public string Layer1Scene { get; set; } = "";
    public string Layer1Source { get; set; } = "";
    public string Layer2Scene { get; set; } = "";
    public string Layer2Source { get; set; } = "";
    public double OpacityStep { get; set; } = 0.05;
    [JsonIgnore] public string MixStateDirectory { get; set; } = Path.Combine(Path.GetDirectoryName(DefaultPath)!, "mix-state");
    public static readonly JsonSerializerOptions Options = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true };
    public static string DefaultPath => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FadesterTourBox", "config.json");

    public static BridgeConfig Load(string path)
    {
        var config = File.Exists(path) ? JsonSerializer.Deserialize<BridgeConfig>(File.ReadAllText(path), Options)
            ?? throw new InvalidDataException("Empty bridge configuration.") : new();
        if (config.Host is not ("localhost" or "127.0.0.1" or "::1") || config.Port is <= 0 or > 65535)
            throw new InvalidDataException("Choose a loopback OBS host and port 1–65535.");
        if (config.Anchors?.Length != 4 || config.VolumeStepDb is <= 0 or > 12 || config.DuckDb is < -100 or > 0 ||
            config.FaderStep is <= 0 or > 1 || config.TransitionStepMs is < 1 or > 5000)
            throw new InvalidDataException("Invalid anchors, volume step (0–12 dB), duck level (−100–0 dB), fader step (0–1), or transition step (1–5000 ms).");
        if (!double.IsFinite(config.MixStepDb) || config.MixStepDb is <= 0 or > 12 || config.MixFadeMs is < 0 or > 10000)
            throw new InvalidDataException("Mix steps must be above 0 and at most 12 dB, and mix fade duration must be 0–10000 ms.");
        if (config.VjsterPort is < 1024 or > 65535 || !double.IsFinite(config.OpacityStep) || config.OpacityStep is < 0.01 or > 0.5)
            throw new InvalidDataException("The VJster port must be 1024–65535 and the opacity step 0.01–0.5.");
        config.VjsterExtensionId = (config.VjsterExtensionId ?? "").Trim().ToLowerInvariant();
        if (config.VjsterExtensionId.Length > 0 && !System.Text.RegularExpressions.Regex.IsMatch(config.VjsterExtensionId, "^[a-p]{32}$"))
            throw new InvalidDataException("The VJster extension id is 32 letters a to p, as the extension's options page shows it.");
        foreach (var layer in new[] { config.Layer1Scene, config.Layer1Source, config.Layer2Scene, config.Layer2Source }) if (layer == null) throw new InvalidDataException("Layer assignments must be text.");
        config.MixStateDirectory = Path.Combine(Path.GetDirectoryName(Path.GetFullPath(path))!, "mix-state");
        return config;
    }

    public string Password()
    {
        var supplied = Environment.GetEnvironmentVariable("FADESTER_OBS_PASSWORD");
        if (!string.IsNullOrEmpty(supplied)) return supplied;
        var path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "obs-studio", "plugin_config", "obs-websocket", "config.json");
        if (File.Exists(path))
        {
            var local = JsonNode.Parse(File.ReadAllText(path));
            if (local?["server_port"]?.GetValue<int>() == Port && local["server_password"]?.GetValue<string>() is { Length: > 0 } saved) return saved;
        }
        throw new InvalidOperationException("Enter the OBS password in the control panel, or set FADESTER_OBS_PASSWORD for this process.");
    }
}

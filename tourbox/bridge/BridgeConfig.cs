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
    /** VJster: the link the Chrome extension and the /obs Browser Source page connect to (docs/vjster R-LNK-1..2); off leaves the port alone. */
    public bool VjsterEnabled { get; set; } = true;
    public int VjsterPort { get; set; } = VjsterLink.DefaultPort;
    /** Empty lets any VJster extension connect; otherwise only this 32-letter id (the extension's options page shows it). */
    public string VjsterExtensionId { get; set; } = "";
    /** The OBS Browser Source page token (32 lowercase hex digits); empty refuses every token connection. */
    public string VjsterObsToken { get; set; } = "";
    /** Which VJster target receives video controls: browser, obs, or both. */
    public string VjsterTarget { get; set; } = "both";
    /** The two VJ layers: a scene item each, by scene and source name. Layer 2 is the one opacity rides. */
    public string Layer1Scene { get; set; } = "";
    public string Layer1Source { get; set; } = "";
    public string Layer2Scene { get; set; } = "";
    public string Layer2Source { get; set; } = "";
    public double OpacityStep { get; set; } = 0.05;
    /** A game controller read through XInput (docs/gamepad/DESIGN.md): off by default. */
    public bool GamepadEnabled { get; set; }
    /** Changes to the controller's default map: control name to action id; "" leaves a control free. */
    public Dictionary<string, string> GamepadMap { get; set; } = new();
    /** Easy mode: take, cut and other actions that change the live picture need a short hold on the controller. On by default. */
    public bool GamepadEasy { get; set; } = true;
    /** The controller's speed presets (vjster.speed.fast / vjster.speed.slow), one of YouTube's own rates. */
    public double GamepadFastSpeed { get; set; } = 2.0;
    public double GamepadSlowSpeed { get; set; } = 0.5;
    public static readonly double[] PresetSpeeds = [0.25, 0.5, 0.75, 1.25, 1.5, 1.75, 2.0];
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
        if (config.VjsterExtensionId.Length > 0 && !System.Text.RegularExpressions.Regex.IsMatch(config.VjsterExtensionId, @"^[a-p]{32}\z"))
            throw new InvalidDataException("The VJster extension id is 32 letters a to p, as the extension's options page shows it.");
        config.VjsterObsToken = (config.VjsterObsToken ?? "").Trim().ToLowerInvariant();
        if (config.VjsterObsToken.Length > 0 && !System.Text.RegularExpressions.Regex.IsMatch(config.VjsterObsToken, @"^[0-9a-f]{32}\z"))
            throw new InvalidDataException("The VJster OBS page token must be 32 lowercase hex digits (0–9, a–f).");
        config.VjsterTarget = string.IsNullOrWhiteSpace(config.VjsterTarget) ? "both" : config.VjsterTarget.Trim().ToLowerInvariant();
        if (config.VjsterTarget is not ("browser" or "obs" or "both"))
            throw new InvalidDataException("The VJster target must be browser, obs, or both.");
        foreach (var layer in new[] { config.Layer1Scene, config.Layer1Source, config.Layer2Scene, config.Layer2Source }) if (layer == null) throw new InvalidDataException("Layer assignments must be text.");
        config.GamepadMap ??= new();
        if (!PresetSpeeds.Contains(config.GamepadFastSpeed) || !PresetSpeeds.Contains(config.GamepadSlowSpeed))
            throw new InvalidDataException("The controller's speed presets must each be one of " + string.Join(", ", PresetSpeeds.Select(r => r.ToString(System.Globalization.CultureInfo.InvariantCulture))) + ".");
        if (config.GamepadEnabled) PadControls.Build(config.GamepadMap); // refuses an unknown control or action now, not at the first press
        config.MixStateDirectory = Path.Combine(Path.GetDirectoryName(Path.GetFullPath(path))!, "mix-state");
        return config;
    }

    /** Stable per-install UUID in MixStateDirectory so restarting Companion keeps one provider.id across restarts. */
    public static string ResolveProviderId(string? stateDirectory)
    {
        if (!string.IsNullOrWhiteSpace(stateDirectory))
        {
            try
            {
                Directory.CreateDirectory(stateDirectory);
                string file = Path.Combine(stateDirectory, "provider-id");
                if (File.Exists(file) && Guid.TryParse(File.ReadAllText(file).Trim(), out var existing) && existing != Guid.Empty)
                    return existing.ToString("D");
                string created = Guid.NewGuid().ToString("D");
                string tmp = file + ".tmp-" + Environment.ProcessId;
                File.WriteAllText(tmp, created);
                File.Move(tmp, file, overwrite: true);
                return created;
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
        return MixProtocolServer.DefaultProviderId;
    }

    /** Only `--listen` hosts the VJster link; a catalog read or mix-only run has no use for its port. */
    public void CheckPorts()
    {
        if (VjsterEnabled && VjsterPort == Port)
            throw new InvalidDataException($"The OBS port and the VJster port cannot both be {Port}. The OBS port is usually 4455.");
    }

    public string Password()
    {
        var supplied = Environment.GetEnvironmentVariable("FADESTER_OBS_PASSWORD");
        if (!string.IsNullOrEmpty(supplied)) return supplied;
        var path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "obs-studio", "plugin_config", "obs-websocket", "config.json");
        return SavedPassword(File.Exists(path) ? File.ReadAllText(path) : null, Port);
    }

    /** OBS's saved password from its obs-websocket settings, when they are for this port; otherwise what to fix. */
    internal static string SavedPassword(string? obsSettings, int port)
    {
        JsonObject? local = null;
        try { if (obsSettings != null) local = JsonNode.Parse(obsSettings) as JsonObject; }
        catch (JsonException) { } // half-written or hand-edited: ask for the password rather than show a parser error
        if (local?["server_port"] is JsonValue portValue && portValue.TryGetValue<int>(out var obsPort) && obsPort > 0)
        {
            if (obsPort != port) throw new InvalidOperationException($"OBS on this PC uses port {obsPort}, but the OBS port in Setup is {port}. Set it to {obsPort}, or for another OBS enter that OBS's password in Setup.");
            if (local["server_password"] is JsonValue passwordValue && passwordValue.TryGetValue<string>(out var saved) && saved.Length > 0) return saved;
        }
        throw ObsSetupException.NoPassword();
    }
}

// SPDX-License-Identifier: GPL-2.0-or-later
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Fadester.TourBox;

internal sealed class MixMember
{
    public double Original { get; set; }
    public double Applied { get; set; }
    public double? Pending { get; set; }
    public bool LeftToOperator { get; set; }
}

internal sealed class MixJournal
{
    public int Version { get; set; } = 1;
    public string Collection { get; set; } = "";
    public int Port { get; set; }
    public double Gain { get; set; } = 1;
    public Dictionary<Guid, MixMember> Members { get; set; } = [];

    internal static string Location(string directory, int port, string collection)
    {
        string key = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(collection)));
        return Path.Combine(directory, $"{port}-{key}.json");
    }

    internal static MixJournal? Read(string path, int port, string collection)
    {
        if (!File.Exists(path)) return null;
        var state = JsonSerializer.Deserialize<MixJournal>(File.ReadAllBytes(path), BridgeConfig.Options);
        static bool Level(double x) => double.IsFinite(x) && x is >= 0 and <= 20;
        if (state is null || state.Version != 1 || state.Port != port || state.Collection != collection ||
            !double.IsFinite(state.Gain) || state.Gain is < 0 or > 1 || state.Members is null ||
            state.Members.Any(k => k.Key == Guid.Empty || k.Value is not { } m || !Level(m.Original) ||
                !Level(m.Applied) || (m.Pending is double p && !Level(p))))
            throw new InvalidDataException("Invalid saved mixer state; no OBS levels were changed. Preserve " + path + " for recovery.");
        return state;
    }

    internal void Save(string path)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        string temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            using (var file = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                JsonSerializer.Serialize(file, this, BridgeConfig.Options);
                file.Flush(flushToDisk: true);
            }
            File.Move(temp, path, overwrite: true);
        }
        finally { File.Delete(temp); }
    }
}

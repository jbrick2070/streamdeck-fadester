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
    /// <summary>Counts this journal's saves, so the newer of the journal file and the step file can be told (Read).</summary>
    public long Revision { get; set; }
    internal const string StepSuffix = ".step";
    /// <summary>How often a journal was written, and written through to the disk, in this process (the self-tests read them).</summary>
    internal static int Saves, Flushes;

    internal static string Location(string directory, int port, string collection)
    {
        string key = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(collection)));
        return Path.Combine(directory, $"{port}-{key}.json");
    }

    /// <summary>
    /// The journal as it is on disk, or null when there is none. Two files can hold it: the journal itself, which is
    /// only ever replaced by a file whose bytes are on the disk, and a step file beside it, which a running fade writes
    /// every 35 ms without forcing it to the disk. The step file counts when it is whole and newer; a step file a power
    /// cut left empty or cut short is passed over, and the journal under it is still the last one that was flushed.
    /// </summary>
    internal static MixJournal? Read(string path, int port, string collection)
    {
        var journal = Load(path, port, collection);
        MixJournal? step = null;
        try { step = Load(path + StepSuffix, port, collection); }
        catch (Exception e) when (e is JsonException or InvalidDataException or IOException or UnauthorizedAccessException) { }
        return step is not null && (journal is null || step.Revision > journal.Revision) ? step : journal;
    }

    internal static bool Exists(string path) => File.Exists(path) || File.Exists(path + StepSuffix);

    internal static void Delete(string path)
    {
        File.Delete(path + StepSuffix);
        File.Delete(path);
    }

    private static MixJournal? Load(string path, int port, string collection)
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

    /// <summary>
    /// Saves the journal. With <paramref name="flush"/> it replaces the journal file: written to a temporary file,
    /// forced to the disk, then renamed over it, so the journal on disk is whole at every moment, also across a power
    /// cut; the step file is then older and is removed. Without it (a step of a running fade, MixDesk.SaveJournal) the
    /// journal file is left alone and the step file beside it is replaced, with no wait for the disk.
    /// </summary>
    internal void Save(string path, bool flush = true)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        Revision++;
        string target = flush ? path : path + StepSuffix;
        string temp = target + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            using (var file = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                JsonSerializer.Serialize(file, this, BridgeConfig.Options);
                file.Flush(flushToDisk: flush);
                Flushes += flush ? 1 : 0; Saves++;
            }
            File.Move(temp, target, overwrite: true);
            if (flush) File.Delete(path + StepSuffix);
        }
        finally { File.Delete(temp); }
    }
}

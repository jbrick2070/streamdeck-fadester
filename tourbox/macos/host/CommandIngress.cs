// SPDX-License-Identifier: GPL-2.0-or-later
using System.Diagnostics;
using System.Globalization;
using System.Threading.Channels;

namespace Fadester.TourBox;

internal sealed record HostCommand(string Action, int Generation, long ReceivedAt, long InitialAge);

/// The only action ingress. Capture age before any action queue or OBS request.
internal sealed class CommandIngress
{
    readonly Func<long> monotonicMs, unixMs;
    readonly object sync = new();
    int generation, sequence;
    internal Channel<HostCommand> Commands { get; } = Channel.CreateBounded<HostCommand>(
        new BoundedChannelOptions(64) { SingleReader = true, FullMode = BoundedChannelFullMode.Wait });
    static readonly HashSet<string> Rotary = new((
        "music.down music.up music.fineDown music.fineUp content.down content.up " +
        "fader.back fader.forward fader.fineBack fader.fineForward preview.previous preview.next " +
        "media.previous media.next transition.previous transition.next transition.shorter transition.longer mix.up mix.down").Split(' '));
    internal CommandIngress(Func<long>? monotonicMs = null, Func<long>? unixMs = null)
    {
        this.monotonicMs = monotonicMs ?? (() => (long)(Stopwatch.GetTimestamp() * 1000d / Stopwatch.Frequency));
        this.unixMs = unixMs ?? (() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
    }
    internal static int Lifetime(string action) => Rotary.Contains(action) ? 180 : 1500;
    internal int Generation { get { lock (sync) return generation; } }
    internal int Activate() { lock (sync) return generation = checked(++sequence); }
    internal void Disarm() { lock (sync) generation = 0; }
    internal void Disarm(int expected) { lock (sync) if (generation == expected) generation = 0; }
    internal bool Current(HostCommand command) { lock (sync) return generation != 0 && command.Generation == generation; }
    internal bool Fresh(HostCommand command) => command.InitialAge + Math.Max(0, monotonicMs() - command.ReceivedAt) <= Lifetime(command.Action);
    internal void Require(HostCommand command, bool freshness)
    {
        if (!Current(command)) throw new InvalidOperationException("Input belongs to an inactive OBS connection.");
        if (freshness && !Fresh(command)) throw new InvalidOperationException("Input expired before its first write; it was not replayed.");
    }
    internal bool SubmitEvent(string action, int epoch, long sentAt, out string reason)
    {
        reason = "";
        lock (sync)
        {
            if (action != "host.native.status" && !DeskActions.Supported.Contains(action)) { reason = "unknown action"; return false; }
            if (generation == 0 || epoch != generation) { reason = "inactive connection generation"; return false; }
            long now = unixMs();
            if (sentAt < now - Lifetime(action) || sentAt > now + 100) { reason = "expired or future input"; return false; }
            var command = new HostCommand(action, epoch, monotonicMs(), Math.Max(0, now - sentAt));
            if (!Commands.Writer.TryWrite(command)) { reason = "input queue full"; return false; }
            return true;
        }
    }
    internal bool SubmitLine(string line, out string reason)
    {
        reason = "invalid syntax; use action ID or event GENERATION UNIX_MS ID";
        if (line.Length > 256 || line.Any(c => c < 32 || c > 126)) return false;
        var words = line.Split(' ', StringSplitOptions.None);
        if (words is ["action", var action]) return SubmitEvent(action, Generation, unixMs(), out reason);
        if (words is ["event", var epochText, var timeText, var id] &&
            int.TryParse(epochText, NumberStyles.None, CultureInfo.InvariantCulture, out int epoch) &&
            long.TryParse(timeText, NumberStyles.None, CultureInfo.InvariantCulture, out long timestamp))
            return SubmitEvent(id, epoch, timestamp, out reason);
        return false;
    }
}

/// Permit belongs to one accepted command. Long, intentional fades may complete;
/// a queued command cannot begin its first mutation after its ingress deadline.
internal sealed class DispatchPermit(CommandIngress ingress, HostCommand command)
{
    bool began;
    readonly object sync = new();
    internal void Check(bool write)
    {
        lock (sync)
        {
            ingress.Require(command, freshness: write && !began);
            if (write) began = true;
        }
    }
}

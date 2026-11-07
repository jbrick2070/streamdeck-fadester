// SPDX-License-Identifier: GPL-2.0-or-later
using System.Text.Json.Nodes;

namespace Fadester.TourBox;

/// One connection, one native helper, no fallback and no write during cleanup.
internal sealed class HostSession
{
    readonly CommandIngress ingress;
    readonly int generation;
    readonly Func<string, JsonObject?, Task<JsonObject>> rpc;
    readonly Func<double, double, Task> native;
    readonly Func<bool> connected;
    readonly CancellationToken stop;
    readonly bool readOnly;
    readonly Func<Task<int>>? nativeRead;
    static readonly HashSet<string> StatusActions = ["preview.status", "fader.status", "recording.status", "host.native.status"];
    readonly AsyncLocal<DispatchPermit?> active = new();
    internal DeskActions Desk { get; }
    internal HostSession(BridgeConfig config, CommandIngress ingress, int generation,
        Func<string, JsonObject?, Task<JsonObject>> rpc, Func<double, double, Task> native,
        Func<bool> connected, CancellationToken stop, bool readOnly = false, Func<Task<int>>? nativeRead = null)
    {
        this.ingress = ingress; this.generation = generation; this.rpc = rpc;
        this.native = native ?? throw new ArgumentNullException(nameof(native));
        this.connected = connected; this.stop = stop; this.readOnly = readOnly; this.nativeRead = nativeRead;
        Desk = new DeskActions(config, Call, nativeMove: Move);
    }
    void Current()
    {
        stop.ThrowIfCancellationRequested();
        if (!connected() || ingress.Generation != generation)
            throw new IOException("OBS session is inactive; command was not replayed.");
    }
    async Task<JsonObject> Call(string request, JsonObject? args)
    {
        Current();
        if (readOnly && !request.StartsWith("Get", StringComparison.Ordinal))
            throw new InvalidOperationException("Read-only session refuses every OBS mutation, including event broadcasts.");
        active.Value?.Check(write: !request.StartsWith("Get", StringComparison.Ordinal));
        return await rpc(request, args);
    }
    async Task Move(double from, double to)
    {
        Current();
        if (readOnly) throw new InvalidOperationException("Read-only session refuses native slider moves.");
        // A post-release equal-value read verifies parking, never writes a reset.
        active.Value?.Check(write: from != to);
        await native(from, to);
        Current();
    }
    internal async Task<string> Dispatch(HostCommand command)
    {
        Current(); ingress.Require(command, freshness: true);
        if (readOnly && !StatusActions.Contains(command.Action))
            throw new InvalidOperationException("Read-only session accepts status actions only.");
        if (command.Action == "host.native.status")
        {
            if (nativeRead is null) throw new InvalidOperationException("Native readback is unavailable.");
            int value = await nativeRead(); Current();
            return "Native slider: " + value + " / 1023";
        }
        if (command.Action == "bridge.reconnect") throw new InvalidOperationException("Reconnect must be handled by the host.");
        active.Value = new DispatchPermit(ingress, command);
        try { return await Desk.Dispatch(command.Action); }
        finally { active.Value = null; }
    }
}

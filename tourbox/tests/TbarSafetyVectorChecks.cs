// SPDX-License-Identifier: GPL-2.0-or-later
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Fadester.TourBox;

internal static class TbarSafetyVectorChecks
{
    private sealed class VectorObs
    {
        public string Program = "a", Preview = "b", Transition = "Fade", Version = "33.0.1";
        public int Duration = 300;
        public bool Studio = true;
        public double Cursor, Slider;
        public string? Origin;
        public Queue<double> CursorSamples = new();
        public bool RefuseAllWrites;
        public int FailUncertainOnMoveAttempt = -1;
        public bool Dead;
        public int MoveAttempts;
        public List<(double From, double To)> AcceptedMoves = [];
        public List<(double Position, bool Release)> ObsTbarCalls = [];

        public Task NativeMove(double expected, double target)
        {
            MoveAttempts++;
            if (RefuseAllWrites) throw new NativeRefusal("native T-bar hidden or unavailable");
            if (Dead || (FailUncertainOnMoveAttempt > 0 && MoveAttempts >= FailUncertainOnMoveAttempt))
            {
                Dead = true;
                throw new IOException("Lost the OBS slider connection.");
            }
            if (StudioFader.ToSliderTick(Slider) != StudioFader.ToSliderTick(expected))
                throw new NativeRefusal("native slider moved before write");
            AcceptedMoves.Add((expected, target));
            if (StudioFader.ToSliderTick(expected) != StudioFader.ToSliderTick(target))
            {
                Slider = target;
                Origin ??= Program;
                Program = Preview;
                Cursor = Math.Clamp(target, 0.01, 0.99);
            }
            return Task.CompletedTask;
        }

        public Task<JsonObject> Call(string action, JsonObject? data)
        {
            JsonObject result = new();
            switch (action)
            {
                case "GetStudioModeEnabled":
                    result["studioModeEnabled"] = Studio;
                    break;
                case "GetSceneList":
                    result["currentProgramSceneUuid"] = Program;
                    result["currentPreviewSceneUuid"] = Preview;
                    break;
                case "GetCurrentProgramScene":
                    result["sceneUuid"] = Program;
                    break;
                case "GetCurrentSceneTransitionCursor":
                    result["transitionCursor"] = CursorSamples.Count > 0 ? CursorSamples.Dequeue() : Cursor;
                    break;
                case "GetVersion":
                    result["obsVersion"] = Version;
                    break;
                case "GetSceneSceneTransitionOverride":
                    result["transitionName"] = null;
                    result["transitionDuration"] = null;
                    break;
                case "GetCurrentSceneTransition":
                    result["transitionName"] = Transition;
                    result["transitionUuid"] = Transition + "-id";
                    result["transitionKind"] = "fade_transition";
                    result["transitionDuration"] = Duration;
                    break;
                case "SetCurrentPreviewScene":
                    Preview = (string)data!["sceneUuid"]!;
                    break;
                case "SetTBarPosition":
                    double pos = (double)data!["position"]!;
                    bool release = (bool)data["release"]!;
                    ObsTbarCalls.Add((pos, release));
                    Origin ??= Program;
                    Program = Preview;
                    Cursor = Math.Clamp(pos, 0.01, 0.99);
                    if (release)
                    {
                        int tick = StudioFader.ToSliderTick(Slider);
                        if (tick >= StudioFader.ObsFinishMinTick)
                        {
                            Preview = Origin!;
                            Origin = null;
                            Cursor = 0;
                            Slider = 0;
                        }
                        else if (tick <= StudioFader.ObsCancelMaxTick)
                        {
                            Program = Origin!;
                            Origin = null;
                            Cursor = 0;
                            Slider = 0;
                        }
                        // 103..920 intentionally leaves OBS's manual transition open, matching OBS 33's TBarReleased.
                    }
                    break;
                case "SetStudioModeEnabled":
                    Studio = (bool)data!["studioModeEnabled"]!;
                    if (!Studio && Origin != null)
                    {
                        Preview = Origin;
                        Origin = null;
                        Cursor = 0;
                        Slider = 0;
                    }
                    break;
                default:
                    throw new InvalidOperationException("Unexpected OBS request in vector test: " + action);
            }
            return Task.FromResult(result);
        }
    }

    private static string ClassifyZone(int tick) =>
        tick <= StudioFader.ObsCancelMaxTick ? "cancel" :
        tick >= StudioFader.ObsFinishMinTick ? "finish" : "open";

    private static void Require(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException("T-bar safety vector check failed: " + message);
    }

    public static async Task<int> RunAsync(string? vectorsPath = null, bool strictContract = false)
    {
        string path = vectorsPath ?? Path.Combine(AppContext.BaseDirectory, "vectors", "tbar-safety.json");
        var root = JsonNode.Parse(await File.ReadAllTextAsync(path))?.AsObject()
            ?? throw new InvalidDataException("Empty tbar-safety.json.");

        Require((int?)root["contract_version"] == 1, "expected contract_version 1");
        var constants = root["constants"]!.AsObject();
        Require(StudioFader.SliderMax == (int)constants["slider_max"]!, "slider_max matches StudioFader.SliderMax");
        Require(StudioFader.ObsFinishMinTick == (int)constants["obs_finish_min_tick"]!, "obs_finish_min_tick matches 921");
        Require(StudioFader.ObsCancelMaxTick == (int)constants["obs_cancel_max_tick"]!, "obs_cancel_max_tick matches 102");

        int passed = 0;
        var divergences = new List<string>();

        void RecordOutcome(string id, bool matchesContract, JsonObject? companionDivergence, bool matchesDivergence, string detail)
        {
            if (matchesContract)
            {
                Require(companionDivergence == null, $"{id} matched contract, so known_divergences.companion is stale");
                Console.WriteLine($"  [VECTOR PASS] {id}: {detail}");
                passed++;
                return;
            }
            Require(companionDivergence != null && matchesDivergence,
                $"{id} failed target contract without matching known_divergences.companion ({detail})");
            string decisionId = (string)companionDivergence!["decision_id"]!;
            Console.WriteLine($"  [VECTOR FAIL (recorded divergence {decisionId})] {id}: {detail}");
            divergences.Add($"{decisionId}:{id}");
        }

        foreach (var node in root["tick_vectors"]!.AsArray())
        {
            var vec = node!.AsObject();
            string id = (string)vec["id"]!;
            double normalized = (double)vec["normalized"]!;
            int expectedTick = (int)vec["tick"]!;
            string expectedZone = (string)vec["obs_release_zone"]!;
            int actualTick = StudioFader.ToSliderTick(normalized);
            string actualZone = ClassifyZone(actualTick);
            RecordOutcome(id, actualTick == expectedTick && actualZone == expectedZone, null, false,
                $"normalized={normalized} -> tick={actualTick} ({actualZone})");
        }

        foreach (var node in root["release_once_vectors"]!.AsArray())
        {
            var vec = node!.AsObject();
            string id = (string)vec["id"]!;
            var expected = vec["contract_expected"]!.AsObject();
            var obs = new VectorObs();
            var fader = new StudioFader(obs.Call, nativeMove: obs.NativeMove);
            int releaseObservedAtMove = -1;
            int releaseObservedAtObsCall = -1;

            var steps = vec["steps"]!.AsArray();
            for (int i = 1; i < steps.Count; i++)
            {
                double target = (double)steps[i]!["position"]!;
                await fader.MoveToAsync(target);
                int releasesNow = obs.ObsTbarCalls.Count(c => c.Release);
                if (releaseObservedAtObsCall < 0 && releasesNow > 0)
                {
                    releaseObservedAtObsCall = obs.ObsTbarCalls.Count;
                    releaseObservedAtMove = obs.AcceptedMoves.Count;
                }
            }

            int totalReleases = obs.ObsTbarCalls.Count(c => c.Release);
            int postReleaseWrites =
                (releaseObservedAtObsCall >= 0 ? obs.ObsTbarCalls.Count - releaseObservedAtObsCall : 0) +
                (releaseObservedAtMove >= 0 ? obs.AcceptedMoves.Count - releaseObservedAtMove : 0);
            string finalScene = obs.Program == "b" ? "preview" : "program";
            bool leftOpen = obs.Cursor is > 0 and < 1;

            bool ok = totalReleases == (int)expected["releases"]! &&
                      postReleaseWrites == (int)expected["post_release_writes"]! &&
                      finalScene == (string)expected["final_scene"]! &&
                      leftOpen == (bool)expected["transition_left_open"]!;
            RecordOutcome(id, ok, null, false,
                $"releases={totalReleases}, post_release_writes={postReleaseWrites}, final_scene={finalScene}, transition_left_open={leftOpen}");
        }

        foreach (var node in root["failure_vectors"]!.AsArray())
        {
            var vec = node!.AsObject();
            string id = (string)vec["id"]!;
            string kind = (string)vec["kind"]!;
            double throwPos = (double)vec["throw_position"]!;
            double attemptPos = (double)vec["attempt_position"]!;
            var expected = vec["contract_expected"]!.AsObject();
            var div = vec["known_divergences"]?["companion"]?.AsObject();

            var obs = new VectorObs();
            var fader = new StudioFader(obs.Call, nativeMove: obs.NativeMove);

            int writesReplayed;
            bool needsReset;
            bool leftOpen;
            string outcome;

            if (kind == "pre_write_refusal")
            {
                obs.RefuseAllWrites = true;
                try { await fader.MoveToAsync(attemptPos); }
                catch (NativeRefusal) { }

                writesReplayed = obs.AcceptedMoves.Count + obs.ObsTbarCalls.Count;
                leftOpen = obs.Cursor is > 0 and < 1;

                obs.RefuseAllWrites = false;
                needsReset = false;
                try { await fader.MoveToAsync(0.2); await fader.CancelAsync(); }
                catch (InvalidOperationException e) when (e.Message.Contains("cancel/reset", StringComparison.OrdinalIgnoreCase))
                {
                    needsReset = true;
                }
                outcome = !needsReset && !leftOpen ? "refused_cleanly" : "latched_needs_reset";
            }
            else
            {
                await fader.MoveToAsync(throwPos);
                Require(obs.Cursor is > 0 and < 1, $"{id} setup must open manual transition");
                int movesBeforeFailure = obs.AcceptedMoves.Count;
                int obsCallsBeforeFailure = obs.ObsTbarCalls.Count;
                obs.FailUncertainOnMoveAttempt = obs.MoveAttempts + 1;

                try { await fader.MoveToAsync(attemptPos); }
                catch (Exception e) when (e is IOException or InvalidOperationException) { }

                writesReplayed = (obs.AcceptedMoves.Count - movesBeforeFailure) +
                                 (obs.ObsTbarCalls.Count - obsCallsBeforeFailure);
                leftOpen = obs.Cursor is > 0 and < 1;
                needsReset = false;
                try { await fader.MoveToAsync(0.2); }
                catch (InvalidOperationException e) when (e.Message.Contains("cancel/reset", StringComparison.OrdinalIgnoreCase))
                {
                    needsReset = true;
                }
                outcome = !needsReset && !leftOpen ? "auto_closed" : "latched_needs_reset";
            }

            bool matchesContract =
                writesReplayed == (int)expected["writes_replayed"]! &&
                needsReset == (bool)expected["needs_operator_reset"]! &&
                leftOpen == (bool)expected["transition_left_open"]! &&
                outcome == (string)expected["outcome"]!;

            bool matchesDiv = div != null &&
                writesReplayed == (int)div["writes_replayed"]! &&
                needsReset == (bool)div["needs_operator_reset"]! &&
                leftOpen == (bool)div["transition_left_open"]! &&
                outcome == (string)div["outcome"]!;

            RecordOutcome(id, matchesContract, div, matchesDiv,
                $"expected(transition_left_open={(bool)expected["transition_left_open"]!}, needs_operator_reset={(bool)expected["needs_operator_reset"]!}, outcome={(string)expected["outcome"]!}) vs observed(writes_replayed={writesReplayed}, transition_left_open={leftOpen}, needs_operator_reset={needsReset}, outcome={outcome})");
        }

        foreach (var node in root["reconnect_vectors"]!.AsArray())
        {
            var vec = node!.AsObject();
            string id = (string)vec["id"]!;
            var samples = vec["samples"]!.AsArray();
            double firstSample = (double)samples[0]!["cursor"]!;
            double secondSample = (double)samples[1]!["cursor"]!;
            var expected = vec["contract_expected"]!.AsObject();
            var div = vec["known_divergences"]?["companion"]?.AsObject();

            var obs = new VectorObs();
            var fader1 = new StudioFader(obs.Call, nativeMove: obs.NativeMove);
            await fader1.MoveToAsync(firstSample);
            var memory = fader1.Leave();

            int obsCallsBeforeResume = obs.ObsTbarCalls.Count;
            obs.CursorSamples.Enqueue(firstSample);
            obs.CursorSamples.Enqueue(secondSample);
            if (firstSample != secondSample) obs.Cursor = secondSample;

            var fader2 = new StudioFader(obs.Call, nativeMove: obs.NativeMove, resume: memory);
            await fader2.ResumeAsync();

            string observedAction;
            if (obs.ObsTbarCalls.Count == obsCallsBeforeResume)
            {
                observedAction = fader2.Position > 0 ? "adopt_open_throw" : "leave_alone";
            }
            else
            {
                observedAction = obs.Cursor == 0 && obs.Program == "a" ? "cancel_to_program" : "unexpected_write";
            }

            string expectedAction = (string)expected["action"]!;
            bool matchesContract = observedAction == expectedAction;
            bool matchesDiv = div != null && observedAction == (string)div["action"]!;
            RecordOutcome(id, matchesContract, div, matchesDiv,
                $"expected({expectedAction}) vs observed({observedAction})");
        }

        foreach (var node in root["version_gate_vectors"]!.AsArray())
        {
            var vec = node!.AsObject();
            string id = (string)vec["id"]!;
            string host = (string)vec["host"]!;
            string obsVersion = (string)vec["obs_version"]!;
            var expected = vec["contract_expected"]!.AsObject();
            var div = vec["known_divergences"]?["companion"]?.AsObject();

            bool eligible;
            string tempFile = Path.Combine(Path.GetTempPath(), $"fadester-vec-{Guid.NewGuid():N}.json");
            try
            {
                await File.WriteAllTextAsync(tempFile, JsonSerializer.Serialize(new { host, port = 4455 }));
                bool hostAccepted = true;
                try { _ = BridgeConfig.Load(tempFile); }
                catch (InvalidDataException) { hostAccepted = false; }

                if (!hostAccepted)
                {
                    eligible = false;
                }
                else
                {
                    var obs = new VectorObs { Version = obsVersion };
                    var fader = new StudioFader(obs.Call, nativeMove: obs.NativeMove);
                    eligible = await fader.SlidePlanAsync() != null;
                }
            }
            finally
            {
                if (File.Exists(tempFile)) File.Delete(tempFile);
            }

            bool expectedEligible = (bool)expected["eligible"]!;
            bool matchesContract = eligible == expectedEligible;
            bool matchesDiv = div != null && eligible == (bool)div["eligible"]!;
            RecordOutcome(id, matchesContract, div, matchesDiv,
                $"host={host}, obs_version={obsVersion} -> expected(eligible={expectedEligible}) vs observed(eligible={eligible})");
        }

        Console.WriteLine(
            $"PASS: T-bar safety vectors (Companion): {passed} matched contract, {divergences.Count} failed target contract ({string.Join(", ", divergences)}).");

        if (strictContract && divergences.Count > 0)
            throw new InvalidOperationException(
                $"Strict contract check failed with {divergences.Count} unresolved Companion divergences: {string.Join(", ", divergences)}");

        return divergences.Count;
    }
}

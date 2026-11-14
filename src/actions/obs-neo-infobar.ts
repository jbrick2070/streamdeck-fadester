// SPDX-License-Identifier: GPL-2.0-or-later
import { action, DidReceiveSettingsEvent, SingletonAction, WillAppearEvent, WillDisappearEvent } from "@elgato/streamdeck";
import { CellRateLimiter } from "../gfx/cell-rate-limiter.js";
import { DirectObsClient, DirectObsCatalog } from "../obs/direct-obs-client.js";
import { SampledVisualSignals, VisualSignals } from "../control/visual-signals.js";
import { DEFAULT_OBS_NEO_INFOBAR_SETTINGS, ObsNeoInfobarSettings } from "../types/settings.js";
import { onLanguageChanged, t } from "../i18n/strings.js";

export interface NeoInfobarFeedback {
  status: string;
  live: string;
  preview: string;
}

export function formatNeoVisualSidechainStatus(sampled: SampledVisualSignals): string {
  switch (sampled.state) {
    case "not_loaded":
      return t("vmNotLoaded");
    case "panic":
      return t("vmPanic");
    case "no_audio":
      return t("vmNoAudio");
    case "active":
      return t(sampled.bpmLocked ? "infobarVsLocked" : "infobarVsActive", {
        bpm: Math.round(sampled.bpm),
        beat: sampled.beatIndex + 1
      });
    default:
      return t("infobarDisconnected");
  }
}

export function buildNeoInfobarFeedback(
  connected: boolean,
  catalog: DirectObsCatalog,
  sampledSignals?: SampledVisualSignals
): NeoInfobarFeedback {
  if (!connected) {
    return {
      status: t("infobarDisconnected"),
      live: t("infobarLive", { scene: t("infobarNoScene") }),
      preview: t("infobarPreview", { scene: t("infobarNoScene") })
    };
  }
  const status = sampledSignals ? formatNeoVisualSidechainStatus(sampledSignals) : t("infobarConnected");
  return {
    status,
    live: t("infobarLive", { scene: catalog.currentProgramScene || t("infobarUnavailable") }),
    preview: t("infobarPreview", {
      scene: catalog.studioMode ? catalog.currentPreviewScene || t("infobarUnavailable") : t("infobarStudioOff")
    })
  };
}

interface InfobarSink {
  setFeedback(feedback: NeoInfobarFeedback): Promise<void>;
}

export class ObsNeoInfobarInstanceController {
  private visible = false;
  private showVisualSidechain: boolean;
  /** Unsubscribes this control from language changes (PLAN.md 11.1). */
  private offLanguage: () => void = () => {};
  private readonly limiter: CellRateLimiter<NeoInfobarFeedback>;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private lastStatus = "";
  private lastLive = "";
  private lastPreview = "";
  private readonly onStateChanged = (): void => {
    this.syncTickTimer();
    this.render();
  };

  public constructor(
    private readonly client: DirectObsClient,
    sink: InfobarSink,
    rateLimitMs = 100,
    private readonly signals?: VisualSignals,
    initialSettings?: ObsNeoInfobarSettings
  ) {
    this.showVisualSidechain = Boolean(initialSettings?.showVisualSidechain ?? DEFAULT_OBS_NEO_INFOBAR_SETTINGS.showVisualSidechain);
    this.limiter = new CellRateLimiter((feedback) => sink.setFeedback(feedback), rateLimitMs);
  }

  public appear(settings?: ObsNeoInfobarSettings): void {
    if (settings) this.showVisualSidechain = Boolean(settings.showVisualSidechain);
    if (this.visible) return;
    this.visible = true;
    this.offLanguage();
    this.offLanguage = onLanguageChanged(() => {
      this.lastStatus = "";
      this.render();
    });
    this.client.on("statusChanged", this.onStateChanged);
    this.client.on("directStateChanged", this.onStateChanged);
    this.signals?.on("stateChanged", this.onStateChanged);
    this.signals?.on("tempoChanged", this.onStateChanged);
    this.syncTickTimer();
    this.render();
  }

  public updateSettings(settings: ObsNeoInfobarSettings): void {
    this.showVisualSidechain = Boolean(settings.showVisualSidechain);
    this.lastStatus = "";
    this.syncTickTimer();
    this.render();
  }

  public disappear(): void {
    this.visible = false;
    this.offLanguage();
    this.offLanguage = () => {};
    this.stopTickTimer();
    this.lastStatus = "";
    this.lastLive = "";
    this.lastPreview = "";
    this.client.off("statusChanged", this.onStateChanged);
    this.client.off("directStateChanged", this.onStateChanged);
    this.signals?.off("stateChanged", this.onStateChanged);
    this.signals?.off("tempoChanged", this.onStateChanged);
    this.limiter.dispose();
  }

  private syncTickTimer(): void {
    if (!this.visible || !this.showVisualSidechain || !this.signals) {
      this.stopTickTimer();
      return;
    }
    if (this.signals.sample().state !== "active") {
      this.stopTickTimer();
      return;
    }
    if (this.tickTimer !== null) return;
    this.tickTimer = setInterval(() => {
      if (!this.visible || !this.showVisualSidechain || !this.signals || this.signals.sample().state !== "active") {
        this.stopTickTimer();
      }
      this.render();
    }, 200);
  }

  private stopTickTimer(): void {
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private render(): void {
    if (!this.visible) return;
    const sampled = this.showVisualSidechain && this.signals ? this.signals.sample() : undefined;
    const feedback = buildNeoInfobarFeedback(this.client.isConnected(), this.client.getCatalog(), sampled);
    if (
      feedback.status === this.lastStatus &&
      feedback.live === this.lastLive &&
      feedback.preview === this.lastPreview
    ) {
      return;
    }
    this.lastStatus = feedback.status;
    this.lastLive = feedback.live;
    this.lastPreview = feedback.preview;
    this.limiter.push(feedback);
  }
}

@action({ UUID: "io.github.jbrick2070.fadester-for-obs.obs-neo-infobar" })
export class ObsNeoInfobarAction extends SingletonAction<ObsNeoInfobarSettings> {
  private readonly instances = new Map<string, ObsNeoInfobarInstanceController>();

  public constructor(private readonly client: DirectObsClient, private readonly signals?: VisualSignals) { super(); }

  public override async onWillAppear(ev: WillAppearEvent<ObsNeoInfobarSettings>): Promise<void> {
    if (!ev.action.isNeoInfobar()) return;
    const infobar = ev.action;
    this.instances.get(infobar.id)?.disappear();
    const controller = new ObsNeoInfobarInstanceController(
      this.client,
      { setFeedback: (feedback) => infobar.setFeedback({ ...feedback }) },
      100,
      this.signals,
      ev.payload.settings
    );
    this.instances.set(infobar.id, controller);
    await infobar.setFeedbackLayout("layouts/obs-neo-infobar.json");
    // An action may disappear while the layout command is in flight.
    if (this.instances.get(infobar.id) === controller) controller.appear(ev.payload.settings);
  }

  public override onDidReceiveSettings(ev: DidReceiveSettingsEvent<ObsNeoInfobarSettings>): void {
    this.instances.get(ev.action.id)?.updateSettings(ev.payload.settings);
  }

  public override onWillDisappear(ev: WillDisappearEvent<ObsNeoInfobarSettings>): void {
    this.instances.get(ev.action.id)?.disappear();
    this.instances.delete(ev.action.id);
  }
}

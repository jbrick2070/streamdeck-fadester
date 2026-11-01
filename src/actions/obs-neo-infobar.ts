// SPDX-License-Identifier: GPL-2.0-or-later
import { action, SingletonAction, WillAppearEvent, WillDisappearEvent } from "@elgato/streamdeck";
import { CellRateLimiter } from "../gfx/cell-rate-limiter.js";
import { DirectObsClient, DirectObsCatalog } from "../obs/direct-obs-client.js";
import { t } from "../i18n/strings.js";

export interface NeoInfobarFeedback {
  status: string;
  live: string;
  preview: string;
}

export function buildNeoInfobarFeedback(connected: boolean, catalog: DirectObsCatalog): NeoInfobarFeedback {
  if (!connected) {
    return {
      status: t("infobarDisconnected"),
      live: t("infobarLive", { scene: t("infobarNoScene") }),
      preview: t("infobarPreview", { scene: t("infobarNoScene") })
    };
  }
  return {
    status: t("infobarConnected"),
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
  private readonly limiter: CellRateLimiter<NeoInfobarFeedback>;
  private readonly onStateChanged = (): void => this.render();

  public constructor(private readonly client: DirectObsClient, sink: InfobarSink, rateLimitMs = 100) {
    this.limiter = new CellRateLimiter((feedback) => sink.setFeedback(feedback), rateLimitMs);
  }

  public appear(): void {
    if (this.visible) return;
    this.visible = true;
    this.client.on("statusChanged", this.onStateChanged);
    this.client.on("directStateChanged", this.onStateChanged);
    this.render();
  }

  public disappear(): void {
    this.visible = false;
    this.client.off("statusChanged", this.onStateChanged);
    this.client.off("directStateChanged", this.onStateChanged);
    this.limiter.dispose();
  }

  private render(): void {
    if (!this.visible) return;
    this.limiter.push(buildNeoInfobarFeedback(this.client.isConnected(), this.client.getCatalog()));
  }
}

@action({ UUID: "com.jbrick2070.fadester-for-obs.obs-neo-infobar" })
export class ObsNeoInfobarAction extends SingletonAction {
  private readonly instances = new Map<string, ObsNeoInfobarInstanceController>();

  public constructor(private readonly client: DirectObsClient) { super(); }

  public override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    if (!ev.action.isNeoInfobar()) return;
    const infobar = ev.action;
    this.instances.get(infobar.id)?.disappear();
    const controller = new ObsNeoInfobarInstanceController(this.client, {
      setFeedback: (feedback) => infobar.setFeedback({ ...feedback })
    });
    this.instances.set(infobar.id, controller);
    await infobar.setFeedbackLayout("layouts/obs-neo-infobar.json");
    // An action may disappear while the layout command is in flight.
    if (this.instances.get(infobar.id) === controller) controller.appear();
  }

  public override onWillDisappear(ev: WillDisappearEvent): void {
    this.instances.get(ev.action.id)?.disappear();
    this.instances.delete(ev.action.id);
  }
}

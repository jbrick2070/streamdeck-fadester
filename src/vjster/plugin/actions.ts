// SPDX-License-Identifier: GPL-2.0-or-later
// VJster deck actions: the Stream Deck SDK glue around the controllers
// (docs/vjster/PLAN.md 3.8, Phase 1 step 5). Each action instance on the deck
// gets its own controller; the hub is shared. The UUIDs are the standalone
// plugin's (docs/vjster D-12); a Fadester-hosted copy would subclass these
// with Fadester's UUIDs (R-HOME-2).

import { action, SingletonAction, type DialAction, type KeyAction } from "@elgato/streamdeck";
import type {
  DialDownEvent,
  DialRotateEvent,
  DialUpEvent,
  DidReceiveSettingsEvent,
  KeyDownEvent,
  TouchTapEvent,
  WillAppearEvent,
  WillDisappearEvent
} from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";
import { createCoalescer } from "../shared/coalesce.js";
import { svgDataUri } from "./display.js";
import {
  PinController,
  QualityDialController,
  QualityPresetController,
  SpeedDialController,
  SpeedPresetController,
  SpeedStepController,
  TransportController,
  type Sink
} from "./controllers.js";
import type { Hub } from "./hub.js";
import {
  qualityDialSettings,
  qualityPresetSettings,
  speedDialSettings,
  speedPresetSettings,
  speedStepSettings,
  transportSettings
} from "./settings.js";

export const UUID_PREFIX = "com.jbrick2070.vjster";

/** At most one draw per action per this many ms, the last always (a fast spin would otherwise draw on every tick and reply). */
export const DRAW_MS = 100;

/** The shared parts every action needs. */
interface Rendered {
  render(): void;
  error(inReplyTo: string | null): void;
  dispose?(): void;
}

/** Instances by Stream Deck context id, with the hub subscription that redraws them. */
abstract class VjsterAction<C extends Rendered> extends SingletonAction<JsonObject> {
  protected readonly instances = new Map<string, { controller: C; off: () => void; offError: () => void; stopDrawing: () => void }>();

  constructor(protected readonly hub: Hub) {
    super();
  }

  protected abstract make(sink: Sink, settings: JsonObject): C;
  protected abstract settingsChanged(controller: C, settings: JsonObject): void;

  protected sinkFor(act: DialAction<JsonObject> | KeyAction<JsonObject>): { sink: Sink; stop: () => void } {
    let last = "";
    const send = (svg: string): void => {
      let uri: string;
      try {
        uri = svgDataUri(svg);
      } catch {
        return; // escapeText keeps this from happening; never let one title stop the drawing
      }
      const done = act.isDial() ? (act as DialAction<JsonObject>).setFeedback({ canvas: uri }) : (act as KeyAction<JsonObject>).setImage(uri);
      void Promise.resolve(done).catch(() => undefined);
    };
    const out = createCoalescer<string>(send, DRAW_MS);
    return {
      sink: {
        draw: (svg) => {
          if (svg === last) return; // only changes are drawn
          last = svg;
          out.push(svg);
        },
        alert: () => void Promise.resolve(act.showAlert()).catch(() => undefined)
      },
      stop: () => out.cancel()
    };
  }

  override onWillAppear(ev: WillAppearEvent<JsonObject>): void {
    const act = ev.action as DialAction<JsonObject> | KeyAction<JsonObject>;
    // A second willAppear for the same context replaces the first; let that one go first.
    if (this.instances.has(act.id)) this.forget(act.id);
    const { sink, stop } = this.sinkFor(act);
    const controller = this.make(sink, ev.payload.settings);
    const off = this.hub.subscribe(() => controller.render());
    const offError = this.hub.onError((_target, error) => controller.error(error.inReplyTo));
    this.instances.set(act.id, { controller, off, offError, stopDrawing: stop });
    void this.hub.acquire();
    controller.render();
  }

  override onWillDisappear(ev: WillDisappearEvent<JsonObject>): void {
    this.forget(ev.action.id);
  }

  private forget(id: string): void {
    const entry = this.instances.get(id);
    if (!entry) return;
    entry.off();
    entry.offError();
    entry.stopDrawing();
    entry.controller.dispose?.();
    this.instances.delete(id);
    this.hub.release();
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<JsonObject>): void {
    const entry = this.instances.get(ev.action.id);
    if (entry) this.settingsChanged(entry.controller, ev.payload.settings);
  }

  protected controllerOf(id: string): C | undefined {
    return this.instances.get(id)?.controller;
  }
}

@action({ UUID: `${UUID_PREFIX}.speed` })
export class SpeedDialAction extends VjsterAction<SpeedDialController> {
  protected make(sink: Sink, settings: JsonObject): SpeedDialController {
    return new SpeedDialController(this.hub, sink, speedDialSettings(settings));
  }
  protected settingsChanged(c: SpeedDialController, s: JsonObject): void {
    c.update(speedDialSettings(s));
  }
  override onDialRotate(ev: DialRotateEvent<JsonObject>): void {
    this.controllerOf(ev.action.id)?.rotate(ev.payload.ticks, ev.payload.pressed);
  }
  override onDialDown(ev: DialDownEvent<JsonObject>): void {
    this.controllerOf(ev.action.id)?.pressDown();
  }
  override onDialUp(ev: DialUpEvent<JsonObject>): void {
    this.controllerOf(ev.action.id)?.pressUp();
  }
  override onTouchTap(ev: TouchTapEvent<JsonObject>): void {
    this.controllerOf(ev.action.id)?.tap();
  }
}

@action({ UUID: `${UUID_PREFIX}.quality` })
export class QualityDialAction extends VjsterAction<QualityDialController> {
  protected make(sink: Sink, settings: JsonObject): QualityDialController {
    return new QualityDialController(this.hub, sink, qualityDialSettings(settings));
  }
  protected settingsChanged(c: QualityDialController, s: JsonObject): void {
    c.update(qualityDialSettings(s));
  }
  override onDialRotate(ev: DialRotateEvent<JsonObject>): void {
    this.controllerOf(ev.action.id)?.rotate(ev.payload.ticks, ev.payload.pressed);
  }
  override onDialDown(ev: DialDownEvent<JsonObject>): void {
    this.controllerOf(ev.action.id)?.pressDown();
  }
  override onDialUp(ev: DialUpEvent<JsonObject>): void {
    this.controllerOf(ev.action.id)?.pressUp();
  }
  override onTouchTap(ev: TouchTapEvent<JsonObject>): void {
    this.controllerOf(ev.action.id)?.press();
  }
}

@action({ UUID: `${UUID_PREFIX}.speed-preset` })
export class SpeedPresetAction extends VjsterAction<SpeedPresetController> {
  protected make(sink: Sink, settings: JsonObject): SpeedPresetController {
    return new SpeedPresetController(this.hub, sink, speedPresetSettings(settings));
  }
  protected settingsChanged(c: SpeedPresetController, s: JsonObject): void {
    c.update(speedPresetSettings(s));
  }
  override onKeyDown(ev: KeyDownEvent<JsonObject>): void {
    this.controllerOf(ev.action.id)?.press();
  }
}

@action({ UUID: `${UUID_PREFIX}.speed-step` })
export class SpeedStepAction extends VjsterAction<SpeedStepController> {
  protected make(sink: Sink, settings: JsonObject): SpeedStepController {
    return new SpeedStepController(this.hub, sink, speedStepSettings(settings));
  }
  protected settingsChanged(c: SpeedStepController, s: JsonObject): void {
    c.update(speedStepSettings(s));
  }
  override onKeyDown(ev: KeyDownEvent<JsonObject>): void {
    this.controllerOf(ev.action.id)?.press();
  }
}

@action({ UUID: `${UUID_PREFIX}.quality-preset` })
export class QualityPresetAction extends VjsterAction<QualityPresetController> {
  protected make(sink: Sink, settings: JsonObject): QualityPresetController {
    return new QualityPresetController(this.hub, sink, qualityPresetSettings(settings));
  }
  protected settingsChanged(c: QualityPresetController, s: JsonObject): void {
    c.update(qualityPresetSettings(s));
  }
  override onKeyDown(ev: KeyDownEvent<JsonObject>): void {
    this.controllerOf(ev.action.id)?.press();
  }
}

@action({ UUID: `${UUID_PREFIX}.pin` })
export class PinAction extends VjsterAction<PinController> {
  protected make(sink: Sink): PinController {
    return new PinController(this.hub, sink);
  }
  protected settingsChanged(): void {
    /* no settings */
  }
  override onKeyDown(ev: KeyDownEvent<JsonObject>): void {
    this.controllerOf(ev.action.id)?.press();
  }
}

@action({ UUID: `${UUID_PREFIX}.transport` })
export class TransportAction extends VjsterAction<TransportController> {
  protected make(sink: Sink, settings: JsonObject): TransportController {
    return new TransportController(this.hub, sink, transportSettings(settings));
  }
  protected settingsChanged(c: TransportController, s: JsonObject): void {
    c.update(transportSettings(s));
  }
  override onKeyDown(ev: KeyDownEvent<JsonObject>): void {
    this.controllerOf(ev.action.id)?.press();
  }
}

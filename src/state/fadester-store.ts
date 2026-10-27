// SPDX-License-Identifier: GPL-2.0-or-later
import {
  FadesterDeviceState,
  FadesterSlot
} from "../types/contract.js";
import { FadesterClient } from "../obs/fadester-client.js";
import { SurfaceStore } from "../../packages/streamdeck-fadester-shared/src/surface-store.js";

export class FadesterStore extends SurfaceStore<
  FadesterSlot,
  FadesterDeviceState,
  FadesterClient
> {
  public constructor(client: FadesterClient) {
    super(client, {
      name: "",
      connected: false,
      error: ""
    });
  }
}

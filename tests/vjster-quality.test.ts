// SPDX-License-Identifier: GPL-2.0-or-later
// VJster quality logic (docs/vjster/REQUIREMENTS.md R-QLT-1, R-QLT-7; PLAN.md 3.5).
import { describe, expect, it } from "vitest";
import {
  AUTO,
  isLevelId,
  levelHeight,
  normalizeLevels,
  qualityLabel,
  resolveHeldLevel,
  stepQuality
} from "../src/vjster/shared/quality.js";

/** The list the player reported in every probe run (PROBE-LOG.md). */
const REPORTED = ["hd2160", "hd1440", "hd1080", "hd720", "large", "medium", "small", "tiny", "auto"];
const LEVELS = normalizeLevels(REPORTED);

describe("normalizeLevels", () => {
  it("keeps the reported order and drops auto", () => {
    expect(LEVELS).toEqual(["hd2160", "hd1440", "hd1080", "hd720", "large", "medium", "small", "tiny"]);
  });

  it("drops duplicates and anything that is not a level id", () => {
    expect(normalizeLevels(["hd720", "hd720", "HD1080", "", "hd 1080", 5, null, "x".repeat(17), "large", AUTO])).toEqual([
      "hd720",
      "large"
    ]);
    expect(normalizeLevels(null)).toEqual([]);
  });
});

describe("isLevelId", () => {
  it("accepts the player's ids, including unknown, and nothing else", () => {
    for (const id of [...REPORTED, "unknown", "highres"]) expect(isLevelId(id)).toBe(true);
    for (const bad of ["", "HD720", "hd-720", "hd_720", "hd720 ", "x".repeat(17), 720, null, undefined, {}]) expect(isLevelId(bad)).toBe(false);
    expect(isLevelId("x".repeat(16))).toBe(true);
  });
});

describe("qualityLabel and levelHeight", () => {
  it("labels the eight ids the probe saw by picture height", () => {
    expect(LEVELS.map(qualityLabel)).toEqual(["2160p", "1440p", "1080p", "720p", "480p", "360p", "240p", "144p"]);
    expect(LEVELS.map(levelHeight)).toEqual([2160, 1440, 1080, 720, 480, 360, 240, 144]);
  });

  it("shows Auto for auto and any other id as it is", () => {
    expect(qualityLabel(AUTO)).toBe("Auto");
    expect(qualityLabel("highres")).toBe("highres");
    expect(levelHeight("highres")).toBeNull();
    expect(levelHeight("constructor")).toBeNull();
  });
});

describe("stepQuality (R-QLT-1)", () => {
  it("turns up toward higher quality and down toward lower", () => {
    expect(stepQuality(LEVELS, "hd720", 1)).toBe("hd1080");
    expect(stepQuality(LEVELS, "hd720", -1)).toBe("large");
    expect(stepQuality(LEVELS, "hd720", 3)).toBe("hd2160");
    expect(stepQuality(LEVELS, "large", -2)).toBe("small");
  });

  it("stops at both ends", () => {
    expect(stepQuality(LEVELS, "hd2160", 1)).toBe("hd2160");
    expect(stepQuality(LEVELS, "tiny", -1)).toBe("tiny");
    expect(stepQuality(LEVELS, "hd720", 50)).toBe("hd2160");
  });

  it("from a level not in the list, goes to the highest on a turn up and the lowest on a turn down", () => {
    expect(stepQuality(LEVELS, "unknown", 1)).toBe("hd2160");
    expect(stepQuality(LEVELS, null, -1)).toBe("tiny");
    expect(stepQuality(LEVELS, null, 0)).toBeNull();
    expect(stepQuality(LEVELS, "hd720", 0)).toBe("hd720");
  });

  it("returns null for an empty list and rejects fractional ticks", () => {
    expect(stepQuality([], "hd720", 1)).toBeNull();
    expect(() => stepQuality(LEVELS, "hd720", 0.5)).toThrow(RangeError);
  });

  it("skips auto even when a caller passes the raw reported list", () => {
    expect(stepQuality(REPORTED, "tiny", -1)).toBe("tiny");
    expect(stepQuality(REPORTED, null, -1)).toBe("tiny");
    expect(stepQuality(["auto"], null, 1)).toBeNull();
  });

  it("never returns auto", () => {
    for (const current of [...LEVELS, null, "unknown"]) {
      for (const ticks of [-9, -1, 1, 9]) expect(stepQuality(LEVELS, current, ticks)).not.toBe(AUTO);
    }
  });
});

describe("resolveHeldLevel (R-QLT-7)", () => {
  it("re-applies the held level when the new video offers it", () => {
    expect(resolveHeldLevel("hd720", LEVELS)).toBe("hd720");
  });

  it("falls back to the nearest lower offered level", () => {
    expect(resolveHeldLevel("hd1440", ["hd1080", "hd720", "large"])).toBe("hd1080");
    expect(resolveHeldLevel("hd2160", ["hd720", "large", "medium"])).toBe("hd720");
  });

  it("uses the lowest offered level when nothing is lower", () => {
    expect(resolveHeldLevel("tiny", ["hd720", "large"])).toBe("large");
  });

  it("gives up on an unknown held level that is not offered, and on an empty list", () => {
    expect(resolveHeldLevel("highres", ["hd720"])).toBeNull();
    expect(resolveHeldLevel("highres", ["highres", "hd720"])).toBe("highres");
    expect(resolveHeldLevel("hd720", [])).toBeNull();
  });
});

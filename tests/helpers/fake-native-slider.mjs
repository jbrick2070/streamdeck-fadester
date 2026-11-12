// SPDX-License-Identifier: GPL-2.0-or-later
// Stand-in for FadesterNativeSlider.exe (tourbox/native/NativeSlider.cpp): the same line protocol over stdin/stdout.
//   node fake-native-slider.mjs --port <n>        FAKE_SLIDER_MODE=unconfirmed|refuse|silent changes its answers;
//   FAKE_SLIDER_ON_CLOSE=<line> prints that line once its stdin closes (a late answer from a helper already let go).
import { createInterface } from "node:readline";

const mode = process.env.FAKE_SLIDER_MODE ?? "";
let value = Number(process.env.FAKE_SLIDER_START ?? 0);
let uncertain = false;
const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  if (mode === "silent") return; // never answers: the caller's timeout
  if (uncertain) return void console.log("ERR prior write unconfirmed; restart helper");
  if (mode === "refuse") return void console.log("ERR Cannot find the main OBS window.");
  if (line === "READ") return void console.log(`OK ${value}`);
  const [expected, desired] = line.split(" ").map(Number);
  if (expected !== value) return void console.log(`ERR T-bar moved; actual ${value}`);
  if (mode === "unconfirmed") {
    uncertain = true;
    return void console.log("ERR write unconfirmed: native slider readback mismatch");
  }
  value = desired;
  console.log(`OK ${value}`);
});
lines.on("close", () => {
  if (process.env.FAKE_SLIDER_ON_CLOSE) console.log(process.env.FAKE_SLIDER_ON_CLOSE);
});

// SPDX-License-Identifier: GPL-2.0-or-later
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Test files that import @elgato/streamdeck share the SDK's file logger
    // (logs/streamdeck-fadester.N.log). Parallel workers race on its log
    // rotation and fail with ENOENT, so files run one at a time.
    fileParallelism: false
  }
});

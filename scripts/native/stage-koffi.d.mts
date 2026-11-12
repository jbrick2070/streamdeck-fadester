// SPDX-License-Identifier: GPL-2.0-or-later
export interface StagedKoffiPaths {
  koffiDir: string;
  win32X64Node: string;
  win32Arm64Node: string;
}

export function extractTarGzEntry(tgzBytes: Buffer, entryPath: string): Buffer;
export function stageKoffi(root?: string, outBinDir?: string): StagedKoffiPaths;

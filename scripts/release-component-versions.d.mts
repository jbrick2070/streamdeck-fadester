// SPDX-License-Identifier: GPL-2.0-or-later
export interface Component {
  name: string;
  versionFile: string;
  read: (json: unknown) => unknown;
  bump: string;
  paths: string[];
}

export interface Git {
  tags: () => string[];
  show: (ref: string, file: string) => string | null;
  changed: (from: string, paths: string[]) => string[];
}

export const COMPONENTS: Component[];
export function checkComponents(git: Git, current: (file: string) => string | null, components?: Component[]): Array<{ name: string; ok: boolean; message: string }>;
export function tagsMissingOnRunner(git: Git, env?: Record<string, string | undefined>): boolean;
export function gitAt(commit: string, cwd?: string): Git;

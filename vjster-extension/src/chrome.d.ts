// SPDX-License-Identifier: GPL-2.0-or-later
// The few Chrome extension APIs VJster uses, declared by hand. The full
// `@types/chrome` would be a new dev dependency in package.json, which carries
// someone else's uncommitted work today (docs/vjster/REQUIREMENTS.md R-STD-3,
// R-HOME-5); these declarations cover only what the code calls.

declare namespace chrome {
  namespace runtime {
    interface MessageSender {
      tab?: { id?: number; windowId: number };
      frameId?: number;
      id?: string;
    }
    const id: string;
    const lastError: { message?: string } | undefined;
    function sendMessage(message: unknown): Promise<unknown>;
    function getURL(path: string): string;
    function openOptionsPage(): Promise<void>;
    const onMessage: {
      addListener(cb: (message: unknown, sender: MessageSender, sendResponse: (response?: unknown) => void) => boolean | void): void;
    };
    const onInstalled: { addListener(cb: () => void): void };
    const onStartup: { addListener(cb: () => void): void };
  }

  namespace tabs {
    interface Tab {
      id?: number;
      windowId: number;
      active: boolean;
    }
    function query(info: { active?: boolean; windowId?: number }): Promise<Tab[]>;
    function sendMessage(tabId: number, message: unknown, options?: { frameId?: number }): Promise<unknown>;
    const onRemoved: { addListener(cb: (tabId: number, info: { windowId: number; isWindowClosing: boolean }) => void): void };
    const onActivated: { addListener(cb: (info: { tabId: number; windowId: number }) => void): void };
    const onAttached: { addListener(cb: (tabId: number, info: { newWindowId: number; newPosition: number }) => void): void };
  }

  namespace windows {
    const WINDOW_ID_NONE: number;
    function getLastFocused(): Promise<{ id?: number; focused: boolean }>;
    const onFocusChanged: { addListener(cb: (windowId: number) => void): void };
  }

  namespace storage {
    interface StorageArea {
      get(keys: string | string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    }
    const local: StorageArea;
    const session: StorageArea;
    const onChanged: {
      addListener(cb: (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, areaName: string) => void): void;
    };
  }

  namespace alarms {
    function create(name: string, info: { periodInMinutes: number }): Promise<void>;
    const onAlarm: { addListener(cb: (alarm: { name: string }) => void): void };
  }

  namespace permissions {
    function request(p: { origins?: string[] }): Promise<boolean>;
    function contains(p: { origins?: string[] }): Promise<boolean>;
    function remove(p: { origins?: string[] }): Promise<boolean>;
  }

  namespace scripting {
    interface RegisteredContentScript {
      id: string;
      matches?: string[];
      excludeMatches?: string[];
      js?: string[];
      runAt?: "document_start" | "document_end" | "document_idle";
      world?: "ISOLATED" | "MAIN";
      allFrames?: boolean;
      persistAcrossSessions?: boolean;
    }
    function registerContentScripts(scripts: RegisteredContentScript[]): Promise<void>;
    function unregisterContentScripts(filter?: { ids?: string[] }): Promise<void>;
    function getRegisteredContentScripts(filter?: { ids?: string[] }): Promise<RegisteredContentScript[]>;
  }
}

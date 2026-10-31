import type { EventType, StoredEvent } from '../domain/types';
import { parseCommand } from '../domain/eventSchema';
import type { EventCommand } from '../domain/eventSchema';
import { normalizeReplayEvents } from '../domain/commands';
import { resolveLanguage, setLanguage, supportedLanguages, t } from '../i18n';

export interface DatabaseEntry {
  name: string;
  path: string;
  isDemo: boolean;
  exists: boolean;
}

export interface TaskMenuItem {
  id: string;
  label: string;
  shortcut?: string;
  disabled: boolean;
  separator?: boolean;
}

export interface TaskMenuAnchor { x: number; y: number }

export interface SetupState {
  currentExe: string;
  currentDir?: string;
  installPath: string;
  programInstalled: boolean;
  desktopShortcut: boolean;
  startMenuShortcut: boolean;
}

export interface AppSettings {
  knownDatabases: DatabaseEntry[];
  activeDatabasePath: string;
  autostart: boolean;
  dockCorner?: string;
  bootMinimized?: boolean;
  databaseReady?: boolean;
  version?: string;
  buildTime?: string;
  uiLanguage?: string;
  setup?: SetupState;
  previewCacheDir?: string;
  previewCacheError?: string;
}

declare global {
  interface Window {
    runtime?: {
      EventsOn?: (eventName: string, callback: (...data: any[]) => void) => () => void;
      BrowserOpenURL?: (url: string) => void;
      OnFileDrop?: (callback: (x: number, y: number, paths: string[]) => void, useDropTarget?: boolean) => void;
      OnFileDropOff?: () => void;
    };
    go?: {
      main?: {
        App?: {
          GetEvents: () => Promise<unknown>;
          AppendBatch: (commands: Array<EventCommand & { id: string; groupId?: string }>) => Promise<unknown>;
          AppendEvent: (
            id: string,
            eventType: string,
            payloadJSON: string
          ) => Promise<unknown>;
          Undo: () => Promise<unknown>;
          Redo: () => Promise<unknown>;
          GetSettings: () => Promise<AppSettings>;
          SetAutostart: (enabled: boolean) => Promise<AppSettings>;
          SetUILanguage?: (language: string) => Promise<AppSettings>;
          SelectFolderDialog: () => Promise<string>;
          CreateDatabase: (
            folderPath: string,
            dbName: string,
            seedDemo: boolean
          ) => Promise<AppSettings>;
          OpenExistingDatabaseDialog: () => Promise<AppSettings>;
          SwitchDatabase: (dbPath: string) => Promise<AppSettings>;
          DeleteDatabase: (dbPath: string, deleteFile: boolean) => Promise<AppSettings>;
          RunSetupAction?: (action: string) => Promise<AppSettings>;
          OpenFolderInExplorer?: (path: string, isFile: boolean) => Promise<void>;
          OpenFolderInVSCode?: (path: string, isFile: boolean) => Promise<void>;
          OpenPathInExplorer?: (path: string) => Promise<void>;
          OpenPathInVSCode?: (path: string) => Promise<void>;
          OpenExternalURL?: (url: string) => Promise<void>;
          GetPathKind?: (path: string) => Promise<'file' | 'directory'>;
          ClearPreviewCache?: () => Promise<void>;
          OpenPreviewCacheInExplorer?: () => Promise<void>;
          EnterMiniMode: (
            corner: string,
            itemCount: number
          ) => Promise<string>;
          UpdateMiniModeHeight: (itemCount: number) => Promise<void>;
          SnapMiniWindowToNearestCorner: (
            itemCount: number
          ) => Promise<string>;
          ExitMiniMode: () => Promise<void>;
          ShowTaskContextMenu: (items: TaskMenuItem[]) => Promise<string>;
          ShowTaskContextMenuAt?: (items: TaskMenuItem[], anchor: TaskMenuAnchor) => Promise<string>;
        };
      };
    };
  }
}

// The Windows backend is the only persistence and OS-integration authority.
// A missing host/method must reject instead of silently using browser state or reporting success.
type NativeApp = NonNullable<NonNullable<NonNullable<Window['go']>['main']>['App']>;
function nativeMethod<K extends keyof NativeApp>(name: K): NonNullable<NativeApp[K]> {
  const app = typeof window === 'undefined' ? undefined : window.go?.main?.App;
  const method = app?.[name];
  if (typeof method !== 'function') throw new Error(t('Anwendung konnte nicht geladen werden'));
  return method.bind(app) as NonNullable<NativeApp[K]>;
}

const fileDropSubscribers = new Set<(x: number, y: number, paths: string[]) => void>();

export function normalizeEvents(rawList: unknown): StoredEvent[] {
  if (!Array.isArray(rawList)) throw new Error(t('Event history must be an array'));
  return normalizeReplayEvents(rawList);
}

export const eventBridge = {
  async getEvents(): Promise<StoredEvent[]> {
    return normalizeEvents(await nativeMethod('GetEvents')());
  },

  async appendEvent<T extends EventType>(
    type: T,
    payload: Extract<EventCommand, { type: T }>['payload'],
    groupId = ''
  ): Promise<StoredEvent[]> {
    return this.appendBatch([parseCommand({ type, payload })], groupId);
  },

  async appendBatch(commands: EventCommand[], groupId = ''): Promise<StoredEvent[]> {
    if ([...groupId].length > 256) throw new Error(t('Invalid edit group'));
    const identified = commands.map(parseCommand).map(command => ({
      ...command, groupId, id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    }));
    return normalizeEvents(await nativeMethod('AppendBatch')(identified));
  },

  async undo(): Promise<StoredEvent[]> {
    return normalizeEvents(await nativeMethod('Undo')());
  },

  async redo(): Promise<StoredEvent[]> {
    return normalizeEvents(await nativeMethod('Redo')());
  },

  async getSettings(): Promise<AppSettings> {
    const settings = await nativeMethod('GetSettings')();
    if (settings.uiLanguage) setLanguage(resolveLanguage(settings.uiLanguage));
    return settings;
  },

  async setUILanguage(language: string): Promise<AppSettings> {
    if (!supportedLanguages.includes(language as typeof supportedLanguages[number])) throw new Error(t('Nicht unterstützte Sprache: {language}', { language }));
    const settings = await nativeMethod('SetUILanguage')(language);
    setLanguage(settings.uiLanguage || language);
    return settings;
  },

  async setAutostart(enabled: boolean): Promise<AppSettings> {
    return nativeMethod('SetAutostart')(enabled);
  },

  async runSetupAction(action: 'install' | 'desktop-shortcut' | 'startmenu-shortcut'): Promise<AppSettings> {
    return nativeMethod('RunSetupAction')(action);
  },

  async openFolderInExplorer(path: string, isFile: boolean): Promise<void> {
    await nativeMethod('OpenFolderInExplorer')(path, isFile);
  },

  async openFolderInVSCode(path: string, isFile: boolean): Promise<void> {
    await nativeMethod('OpenFolderInVSCode')(path, isFile);
  },

  async selectFolderDialog(): Promise<string> {
    return nativeMethod('SelectFolderDialog')();
  },

  async openPathInExplorer(path: string): Promise<void> {
    await nativeMethod('OpenPathInExplorer')(path);
  },

  async openPathInVSCode(path: string): Promise<void> {
    await nativeMethod('OpenPathInVSCode')(path);
  },

  async openExternalURL(url: string): Promise<void> {
    const parsed = new URL(url);
    if (!['http:', 'https:', 'mailto:', 'sip:', 'tel:'].includes(parsed.protocol)) throw new Error(t('Ungültige URL'));
    await nativeMethod('OpenExternalURL')(url);
  },

  async getPathKind(path: string): Promise<'file' | 'directory'> {
    return nativeMethod('GetPathKind')(path);
  },

  async clearPreviewCache(): Promise<void> {
    await nativeMethod('ClearPreviewCache')();
  },

  async openPreviewCacheInExplorer(): Promise<void> {
    await nativeMethod('OpenPreviewCacheInExplorer')();
  },

  onFileDrop(callback: (x: number, y: number, paths: string[]) => void): () => void {
    // Wails 2.9.2 resolves Windows paths in a window-level bubbling drop handler.
    // Child file-drop handlers may preventDefault, but must not stopPropagation.
    // Coordinates are client CSS pixels; the CSS target property is inherited.
    if (!fileDropSubscribers.size) window.runtime?.OnFileDrop?.((x, y, paths) => {
      for (const subscriber of fileDropSubscribers) subscriber(x, y, paths);
    }, true);
    fileDropSubscribers.add(callback);
    return () => {
      fileDropSubscribers.delete(callback);
      if (!fileDropSubscribers.size) window.runtime?.OnFileDropOff?.();
    };
  },

  async createDatabase(folderPath: string, dbName: string, seedDemo: boolean): Promise<AppSettings> {
    return nativeMethod('CreateDatabase')(folderPath, dbName, seedDemo);
  },

  async openExistingDatabaseDialog(): Promise<AppSettings> {
    return nativeMethod('OpenExistingDatabaseDialog')();
  },

  async switchDatabase(dbPath: string): Promise<AppSettings> {
    return nativeMethod('SwitchDatabase')(dbPath);
  },

  async deleteDatabase(dbPath: string, deleteFile: boolean): Promise<AppSettings> {
    return nativeMethod('DeleteDatabase')(dbPath, deleteFile);
  },

  async showTaskContextMenu(items: TaskMenuItem[], anchor?: TaskMenuAnchor): Promise<string> {
    return anchor ? nativeMethod('ShowTaskContextMenuAt')(items, anchor) : nativeMethod('ShowTaskContextMenu')(items);
  },

  async enterMiniMode(corner: string, itemCount: number): Promise<string> {
    return nativeMethod('EnterMiniMode')(corner, itemCount);
  },

  async updateMiniModeHeight(itemCount: number): Promise<void> {
    await nativeMethod('UpdateMiniModeHeight')(itemCount);
  },

  async snapMiniWindowToNearestCorner(itemCount: number): Promise<string> {
    return nativeMethod('SnapMiniWindowToNearestCorner')(itemCount);
  },

  async exitMiniMode(): Promise<void> {
    await nativeMethod('ExitMiniMode')();
  },

  onWindowMinimized(callback: () => void): () => void {
    if (window?.runtime?.EventsOn) {
      return window.runtime.EventsOn('window:minimized', callback);
    }
    return () => {};
  },

  onPreviewCacheWarning(callback: (message: string) => void): () => void {
    return window.runtime?.EventsOn?.('preview:cache-warning', callback) ?? (() => {});
  },

  onWindowRestored(callback: () => void): () => void {
    if (window?.runtime?.EventsOn) {
      return window.runtime.EventsOn('window:restored', callback);
    }
    return () => {};
  },

  onWindowCornerChanged(callback: (corner: string) => void): () => void {
    if (window?.runtime?.EventsOn) {
      return window.runtime.EventsOn('window:cornerChanged', (c: string) => {
        if (typeof c === 'string' && c) callback(c);
      });
    }
    return () => {};
  },
};

import type { EventType, StoredEvent } from '../domain/types';
import { parseCommand, parseStoredEvent } from '../domain/eventSchema';
import type { EventCommand } from '../domain/eventSchema';
import { applyCommand, copyReplayTasks, replayCommands } from '../domain/commands';
import { resolveLanguage, setLanguage, supportedLanguages, t } from '../i18n';

export interface DatabaseEntry {
  name: string;
  path: string;
  isDemo: boolean;
  exists: boolean;
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
}

declare global {
  interface Window {
    runtime?: {
      EventsOn?: (eventName: string, callback: (...data: any[]) => void) => () => void;
      BrowserOpenURL?: (url: string) => void;
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
          EnterMiniMode: (
            corner: string,
            itemCount: number
          ) => Promise<string>;
          UpdateMiniModeHeight: (itemCount: number) => Promise<void>;
          SnapMiniWindowToNearestCorner: (
            itemCount: number
          ) => Promise<string>;
          ExitMiniMode: () => Promise<void>;
        };
      };
    };
  }
}

const LOCAL_STORAGE_KEY = 'dodrag_sqlite_fallback_events_v1';
const LOCAL_SETTINGS_KEY = 'dodrag_settings_fallback_v1';

function isWailsAvailable(): boolean {
  return Boolean(window?.go?.main?.App);
}

const normalizedCache = new WeakMap<object, StoredEvent[]>();

export function normalizeEvents(rawList: unknown): StoredEvent[] {
  if (!Array.isArray(rawList)) throw new Error(t('Event history must be an array'));
  const cached = normalizedCache.get(rawList);
  if (cached) return cached;
  const events = rawList.map((item: unknown) => parseStoredEvent(item));
  replayCommands(events);
  normalizedCache.set(rawList, events);
  return events;
}

function createInitialBrowserDemoEvents(): StoredEvent[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0, 0);
  const inTwoDays = new Date(today.getTime());
  inTwoDays.setDate(inTwoDays.getDate() + 2);
  const inFiveDays = new Date(today.getTime());
  inFiveDays.setDate(inFiveDays.getDate() + 5);

  const yy = String(now.getFullYear() % 100).padStart(2, '0');
  const t1 = `${yy}-101`;
  const t2 = `${yy}-102`;
  const t3 = `${yy}-103`;
  const t4 = `${yy}-104`;
  const t5 = `${yy}-105`;
  const t6 = `${yy}-106`;

  const raw: EventCommand[] = [
    {
      type: 'TASK_CREATED',
      payload: {
        taskId: t1,
        title: t('API-Zugangsdaten vom Kunden anfordern'),
        configuredStart: today.toISOString(),
        createdAt: new Date(now.getTime() - 300_000).toISOString(),
      },
    },
    {
      type: 'TASK_ACTIVE_SET',
      payload: {
        taskId: t1,
        isActive: true,
      },
    },
    {
      type: 'TASK_CREATED',
      payload: {
        taskId: t2,
        title: t('OAuth-Webhook im Staging-System konfigurieren'),
        configuredStart: today.toISOString(),
        createdAt: new Date(now.getTime() - 240_000).toISOString(),
      },
    },
    {
      type: 'DEPENDENCY_ADDED',
      payload: {
        taskId: t2,
        predecessorId: t1,
      },
    },
    {
      type: 'TASK_CREATED',
      payload: {
        taskId: t3,
        title: t('End-to-End Integrationstest durchführen'),
        configuredStart: today.toISOString(),
        createdAt: new Date(now.getTime() - 180_000).toISOString(),
      },
    },
    {
      type: 'TASK_CREATED',
      payload: {
        taskId: t4,
        title: t('SSL-Zertifikat für Subdomain bestellen'),
        configuredStart: today.toISOString(),
        createdAt: new Date(now.getTime() - 120_000).toISOString(),
      },
    },
    {
      type: 'TASK_CREATED',
      payload: {
        taskId: t5,
        title: t('Freigabe durch Datenschutzbeauftragten abwarten'),
        configuredStart: inTwoDays.toISOString(),
        createdAt: new Date(now.getTime() - 60_000).toISOString(),
      },
    },
    {
      type: 'TASK_CREATED',
      payload: {
        taskId: t6,
        title: t('Produktiv-Deployment & Release-Notes versenden'),
        configuredStart: inFiveDays.toISOString(),
        createdAt: now.toISOString(),
      },
    },
    {
      type: 'DEPENDENCY_ADDED',
      payload: {
        taskId: t6,
        predecessorId: t2,
      },
    },
  ];

  return raw.map((r, i) => ({
    seq: i + 1,
    id: `seed-${i + 1}`,
    timestamp: new Date(now.getTime() + i * 1000).toISOString(),
    ...r,
    undone: false,
  }));
}

function loadBrowserEvents(): StoredEvent[] {
  const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
  if (raw === null) {
    return [];
  }
  return normalizeEvents(JSON.parse(raw));
}

function saveBrowserEvents(events: StoredEvent[]): StoredEvent[] {
  replayCommands(events);
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(events));
  return events;
}

let browserGroup = '';

export const eventBridge = {
  isNativeWails(): boolean {
    return isWailsAvailable();
  },

  async getEvents(): Promise<StoredEvent[]> {
    if (isWailsAvailable()) {
      const res = await window.go!.main!.App!.GetEvents();
      return normalizeEvents(res);
    }
    return loadBrowserEvents();
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
    const checked = commands.map(parseCommand);
    const identified = checked.map(command => ({
      ...command,
      groupId,
      id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    }));
    if (isWailsAvailable()) {
      const res = await window.go!.main!.App!.AppendBatch(identified);
      return normalizeEvents(res);
    }
    const history = loadBrowserEvents();
    const tasks = copyReplayTasks(replayCommands(history));
    const effective = identified.filter(command => applyCommand(tasks, command));
    if (!effective.length) return history;
    const current = history.filter(event => !event.undone);
    let storedGroup = `edit-${effective[0].id}`;
    if (groupId && browserGroup === groupId) {
      storedGroup = current[current.length - 1]?.groupId || storedGroup;
    }
    if (effective.length > 1) storedGroup = `batch-${effective[0].id}`;
    let seq = history.reduce((max, event) => Math.max(max, event.seq), 0);
    for (const command of effective) {
      const last = current[current.length - 1];
      const timestamp = new Date().toISOString();
      const coalesce = effective.length === 1 && groupId && browserGroup === groupId &&
        last && last.type === command.type && last.payload.taskId === command.payload.taskId &&
        ['TASK_RENAMED', 'TASK_START_DATE_SET', 'TASK_ACTIVE_SET'].includes(command.type);
      if (coalesce) {
        current[current.length - 1] = {
          ...command, seq: last.seq, id: last.id, groupId: last.groupId, timestamp, undone: false,
        };
      } else {
        current.push({ ...command, groupId: storedGroup, seq: ++seq, timestamp, undone: false });
      }
    }
    const saved = saveBrowserEvents(current);
    browserGroup = groupId;
    return saved;
  },

  async undo(): Promise<StoredEvent[]> {
    browserGroup = '';
    if (isWailsAvailable()) {
      const res = await window.go!.main!.App!.Undo();
      return normalizeEvents(res);
    }
    const events = loadBrowserEvents();
    const latest = [...events].reverse().find(event => !event.undone);
    if (!latest) return events;
    return saveBrowserEvents(events.map(event =>
      event.seq === latest.seq || latest.groupId && event.groupId === latest.groupId
        ? { ...event, undone: true }
        : event
    ));
  },

  async redo(): Promise<StoredEvent[]> {
    browserGroup = '';
    if (isWailsAvailable()) {
      const res = await window.go!.main!.App!.Redo();
      return normalizeEvents(res);
    }
    const events = loadBrowserEvents();
    const earliest = events.find(event => event.undone);
    if (!earliest) return events;
    return saveBrowserEvents(events.map(event =>
      event.seq === earliest.seq || earliest.groupId && event.groupId === earliest.groupId
        ? { ...event, undone: false }
        : event
    ));
  },

  async getSettings(): Promise<AppSettings> {
    if (isWailsAvailable()) {
      const settings = await window.go!.main!.App!.GetSettings();
      if (settings.uiLanguage) setLanguage(resolveLanguage(settings.uiLanguage));
      return settings;
    }
    {
      const raw = localStorage.getItem(LOCAL_SETTINGS_KEY);
      if (raw !== null) {
        // TODO: Browserbetrieb ist kein Produktziel; vor Produktnutzung die fehlende Settings-Formprüfung ergänzen, da syntaktisch gültiges JSON mit ungültiger Settings-Form den Dialog abstürzen lassen kann.
        const parsed: AppSettings = JSON.parse(raw);
        const uiLanguage = parsed.uiLanguage ? resolveLanguage(parsed.uiLanguage) : resolveLanguage(navigator.languages?.length ? navigator.languages : navigator.language);
        setLanguage(uiLanguage);
        if (parsed.uiLanguage !== uiLanguage) localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify({ ...parsed, uiLanguage }));
        return {
          ...parsed,
          uiLanguage,
          databaseReady: Boolean(parsed.activeDatabasePath),
        };
      }
    }
    const uiLanguage = resolveLanguage(navigator.languages?.length ? navigator.languages : navigator.language);
    setLanguage(uiLanguage);
    const settings: AppSettings = {
      knownDatabases: [
        {
          name: t('Demo-Datenbank'),
          path: '%APPDATA%\\DoDrag\\dodrag.db',
          isDemo: true,
          exists: localStorage.getItem(LOCAL_STORAGE_KEY) !== null,
        },
      ],
      activeDatabasePath: '',
      autostart: false,
      databaseReady: false,
      version: '0.1.2',
      uiLanguage,
    };
    localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(settings));
    return settings;
  },

  async setUILanguage(language: string): Promise<AppSettings> {
    if (!supportedLanguages.includes(language as typeof supportedLanguages[number])) throw new Error(t('Nicht unterstützte Sprache: {language}', { language }));
    if (isWailsAvailable()) {
      const settings = await window.go!.main!.App!.SetUILanguage!(language);
      setLanguage(settings.uiLanguage || language);
      return settings;
    }
    const current = await this.getSettings();
    const updated = { ...current, uiLanguage: language };
    localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(updated));
    setLanguage(language);
    return updated;
  },

  async setAutostart(enabled: boolean): Promise<AppSettings> {
    if (isWailsAvailable()) {
      return await window.go!.main!.App!.SetAutostart(enabled);
    }
    const current = await this.getSettings();
    const updated: AppSettings = { ...current, autostart: enabled };
    localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(updated));
    return updated;
  },

  async selectFolderDialog(): Promise<string> {
    if (isWailsAvailable()) {
      return await window.go!.main!.App!.SelectFolderDialog();
    }
    return '';
  },

  async createDatabase(
    folderPath: string,
    dbName: string,
    seedDemo: boolean
  ): Promise<AppSettings> {
    if (isWailsAvailable()) {
      return await window.go!.main!.App!.CreateDatabase(folderPath, dbName, seedDemo);
    }
    const current = await this.getSettings();
    const cleanName = dbName.trim();
    const fileName = cleanName.endsWith('.db') ? cleanName : `${cleanName}.db`;
    const fullPath = `${folderPath || '%APPDATA%\\DoDrag'}\\${fileName}`;
    if (!cleanName || /[<>:"/\\|?*]/.test(cleanName) || cleanName.endsWith('.')) throw new Error(t('Datenbankname muss ein reiner Dateiname sein'));
    if (current.knownDatabases.some(entry => entry.path.toLowerCase() === fullPath.toLowerCase() && entry.exists)) throw new Error(t('Datenbank existiert bereits'));
    loadBrowserEvents(); // Never overwrite a corrupt browser history during creation.
    const next: AppSettings = {
      ...current,
      knownDatabases: [
        ...current.knownDatabases.filter((d) => d.path !== fullPath),
        { name: cleanName, path: fullPath, isDemo: false, exists: true },
      ],
      activeDatabasePath: fullPath,
      databaseReady: true,
    };
    const oldSettings = localStorage.getItem(LOCAL_SETTINGS_KEY);
    const oldEvents = localStorage.getItem(LOCAL_STORAGE_KEY);
    try {
      saveBrowserEvents(seedDemo ? createInitialBrowserDemoEvents() : []);
      localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(next));
    } catch (error) {
      try {
        if (oldEvents === null) localStorage.removeItem(LOCAL_STORAGE_KEY); else localStorage.setItem(LOCAL_STORAGE_KEY, oldEvents);
        if (oldSettings === null) localStorage.removeItem(LOCAL_SETTINGS_KEY); else localStorage.setItem(LOCAL_SETTINGS_KEY, oldSettings);
      } catch (rollback) { throw new Error(t('{error}; Ruecksetzen fehlgeschlagen: {rollback}', { error: String(error), rollback: String(rollback) })); }
      throw error;
    }
    return next;
  },

  async openExistingDatabaseDialog(): Promise<AppSettings> {
    if (isWailsAvailable()) {
      return await window.go!.main!.App!.OpenExistingDatabaseDialog();
    }
    return await this.getSettings();
  },

  async switchDatabase(dbPath: string): Promise<AppSettings> {
    if (isWailsAvailable()) {
      return await window.go!.main!.App!.SwitchDatabase(dbPath);
    }
    const current = await this.getSettings();
    const next: AppSettings = {
      ...current,
      activeDatabasePath: dbPath,
      databaseReady: true,
    };
    localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(next));
    return next;
  },

  async deleteDatabase(dbPath: string, deleteFile: boolean): Promise<AppSettings> {
    if (isWailsAvailable()) {
      return await window.go!.main!.App!.DeleteDatabase(dbPath, deleteFile);
    }
    const current = await this.getSettings();
    const remaining = current.knownDatabases.filter((d) => d.path !== dbPath);
    const wasActive = current.activeDatabasePath === dbPath;
    const next: AppSettings = {
      ...current,
      knownDatabases: remaining,
      activeDatabasePath: wasActive ? '' : current.activeDatabasePath,
      databaseReady: wasActive ? false : current.databaseReady,
    };
    localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(next));
    return next;
  },

  async enterMiniMode(corner: string, itemCount: number): Promise<string> {
    if (isWailsAvailable()) {
      return await window.go!.main!.App!.EnterMiniMode(corner, itemCount);
    }
    return corner || 'bottom-left';
  },

  async updateMiniModeHeight(itemCount: number): Promise<void> {
    if (isWailsAvailable()) {
      await window.go!.main!.App!.UpdateMiniModeHeight(itemCount);
    }
  },

  async snapMiniWindowToNearestCorner(itemCount: number): Promise<string> {
    if (isWailsAvailable()) {
      return await window.go!.main!.App!.SnapMiniWindowToNearestCorner(
        itemCount
      );
    }
    return 'bottom-left';
  },

  async exitMiniMode(): Promise<void> {
    if (isWailsAvailable()) {
      await window.go!.main!.App!.ExitMiniMode();
    }
  },

  onWindowMinimized(callback: () => void): () => void {
    if (window?.runtime?.EventsOn) {
      return window.runtime.EventsOn('window:minimized', callback);
    }
    return () => {};
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

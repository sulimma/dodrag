import { EventType, StoredEvent } from '../domain/types';
import { EventCommand, parseCommand, parseStoredEvent } from '../domain/eventSchema';
import { applyCommand, replayCommands } from '../domain/commands';

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
}

declare global {
  interface Window {
    runtime?: {
      EventsOn?: (eventName: string, callback: (...data: any[]) => void) => () => void;
    };
    go?: {
      main?: {
        App?: {
          GetEvents: () => Promise<any[]>;
          AppendBatch: (commands: Array<EventCommand & { id: string; groupId?: string }>) => Promise<any[]>;
          AppendEvent: (
            id: string,
            eventType: string,
            payloadJSON: string
          ) => Promise<any[]>;
          Undo: () => Promise<any[]>;
          Redo: () => Promise<any[]>;
          ResetDemoData: () => Promise<any[]>;
          GetSettings: () => Promise<AppSettings>;
          SetAutostart: (enabled: boolean) => Promise<AppSettings>;
          SelectFolderDialog: () => Promise<string>;
          CreateDatabase: (
            folderPath: string,
            dbName: string
          ) => Promise<AppSettings>;
          OpenExistingDatabaseDialog: () => Promise<AppSettings>;
          SwitchDatabase: (dbPath: string) => Promise<AppSettings>;
          DeleteDatabase: (dbPath: string) => Promise<AppSettings>;
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

function normalizeEvents(rawList: any[]): StoredEvent[] {
  if (!Array.isArray(rawList)) throw new Error('Event history must be an array');
  const events = rawList.map(item => parseStoredEvent({ ...item, payload: typeof item.payload === 'string' ? JSON.parse(item.payload) : item.payload }));
  replayCommands(events);
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

  const raw: Array<{ type: EventType; payload: Record<string, any> }> = [
    {
      type: 'TASK_CREATED',
      payload: {
        taskId: t1,
        title: 'API-Zugangsdaten vom Kunden anfordern',
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
        title: 'OAuth-Webhook im Staging-System konfigurieren',
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
        title: 'End-to-End Integrationstest durchführen',
        configuredStart: today.toISOString(),
        createdAt: new Date(now.getTime() - 180_000).toISOString(),
      },
    },
    {
      type: 'TASK_CREATED',
      payload: {
        taskId: t4,
        title: 'SSL-Zertifikat für Subdomain bestellen',
        configuredStart: today.toISOString(),
        createdAt: new Date(now.getTime() - 120_000).toISOString(),
      },
    },
    {
      type: 'TASK_CREATED',
      payload: {
        taskId: t5,
        title: 'Freigabe durch Datenschutzbeauftragten abwarten',
        configuredStart: inTwoDays.toISOString(),
        createdAt: new Date(now.getTime() - 60_000).toISOString(),
      },
    },
    {
      type: 'TASK_CREATED',
      payload: {
        taskId: t6,
        title: 'Produktiv-Deployment & Release-Notes versenden',
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
    type: r.type,
    payload: r.payload,
    undone: false,
  }));
}

function loadBrowserEvents(): StoredEvent[] {
  const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
  if (raw === null) {
    return saveBrowserEvents(createInitialBrowserDemoEvents());
  }
  return normalizeEvents(JSON.parse(raw));
}

function saveBrowserEvents(events: StoredEvent[]): StoredEvent[] {
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

  async appendEvent(
    type: EventType,
    payload: Record<string, any>,
    groupId = ''
  ): Promise<StoredEvent[]> {
    return this.appendBatch([parseCommand({ type, payload })], groupId);
  },

  async appendBatch(commands: EventCommand[], groupId = ''): Promise<StoredEvent[]> {
    const checked = commands.map(parseCommand);
    const identified = checked.map(command => ({ ...command, groupId, id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` }));
    if (isWailsAvailable()) {
      const res = await window.go!.main!.App!.AppendBatch(identified);
      return normalizeEvents(res);
    }
    const history = loadBrowserEvents();
    const tasks = replayCommands(history);
    const effective = identified.filter(command => applyCommand(tasks, command));
    if (!effective.length) return history;
    const current = history.filter(event => !event.undone);
    const storedGroup = effective.length > 1 ? `batch-${effective[0].id}` : groupId && browserGroup === groupId ? current[current.length - 1]?.groupId : `edit-${effective[0].id}`;
    let seq = history.reduce((max, event) => Math.max(max, event.seq), 0);
    for (const command of effective) {
      const last = current[current.length - 1];
      const timestamp = new Date().toISOString();
      if (effective.length === 1 && groupId && browserGroup === groupId && last && last.type === command.type && last.payload.taskId === command.payload.taskId && ['TASK_RENAMED', 'TASK_START_DATE_SET', 'TASK_ACTIVE_SET'].includes(command.type)) {
        current[current.length - 1] = { ...last, payload: command.payload, timestamp };
      } else current.push({ ...command, groupId: storedGroup, seq: ++seq, timestamp, undone: false });
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
    return saveBrowserEvents(events.map(event => event.seq === latest.seq || latest.groupId && event.groupId === latest.groupId ? { ...event, undone: true } : event));
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
    return saveBrowserEvents(events.map(event => event.seq === earliest.seq || earliest.groupId && event.groupId === earliest.groupId ? { ...event, undone: false } : event));
  },

  async resetDemoData(): Promise<StoredEvent[]> {
    if (isWailsAvailable()) {
      const res = await window.go!.main!.App!.ResetDemoData();
      return normalizeEvents(res);
    }
    const seeded = createInitialBrowserDemoEvents();
    return saveBrowserEvents(seeded);
  },

  async getSettings(): Promise<AppSettings> {
    if (isWailsAvailable()) {
      return await window.go!.main!.App!.GetSettings();
    }
    try {
      const raw = localStorage.getItem(LOCAL_SETTINGS_KEY);
      if (raw) {
        const parsed: AppSettings = JSON.parse(raw);
        return {
          ...parsed,
          databaseReady: Boolean(parsed.activeDatabasePath),
        };
      }
    } catch {
      // ignore
    }
    return {
      knownDatabases: [
        {
          name: 'Demo-Datenbank',
          path: '%APPDATA%\\DoDrag\\dodrag.db',
          isDemo: true,
          exists: true,
        },
      ],
      activeDatabasePath: '',
      autostart: false,
      databaseReady: false,
    };
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
    dbName: string
  ): Promise<AppSettings> {
    if (isWailsAvailable()) {
      return await window.go!.main!.App!.CreateDatabase(folderPath, dbName);
    }
    const current = await this.getSettings();
    const cleanName = dbName.trim() || 'neue-datenbank';
    const fileName = cleanName.endsWith('.db') ? cleanName : `${cleanName}.db`;
    const fullPath = `${folderPath || '%APPDATA%\\DoDrag'}\\${fileName}`;
    const next: AppSettings = {
      ...current,
      knownDatabases: [
        ...current.knownDatabases.filter((d) => d.path !== fullPath),
        { name: cleanName, path: fullPath, isDemo: false, exists: true },
      ],
      activeDatabasePath: fullPath,
      databaseReady: true,
    };
    localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(next));
    saveBrowserEvents([]);
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

  async deleteDatabase(dbPath: string): Promise<AppSettings> {
    if (isWailsAvailable()) {
      return await window.go!.main!.App!.DeleteDatabase(dbPath);
    }
    const current = await this.getSettings();
    const remaining = current.knownDatabases.filter((d) => d.path !== dbPath);
    const fallback =
      remaining.length > 0
        ? remaining
        : [
            {
              name: 'Demo-Datenbank',
              path: '%APPDATA%\\DoDrag\\dodrag.db',
              isDemo: true,
              exists: true,
            },
          ];
    const wasActive = current.activeDatabasePath === dbPath;
    const next: AppSettings = {
      ...current,
      knownDatabases: fallback,
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

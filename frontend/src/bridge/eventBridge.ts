import { EventType, StoredEvent } from '../domain/types';

export interface DatabaseEntry {
  name: string;
  path: string;
  isDemo: boolean;
  exists: boolean;
}

export interface AppSettings {
  knownDatabases: DatabaseEntry[];
  activeDatabasePath: string;
  firstRunCompleted: boolean;
}

declare global {
  interface Window {
    go?: {
      main?: {
        App?: {
          GetEvents: () => Promise<any[]>;
          AppendEvent: (
            id: string,
            eventType: string,
            payloadJSON: string
          ) => Promise<any[]>;
          Undo: () => Promise<any[]>;
          Redo: () => Promise<any[]>;
          ResetDemoData: () => Promise<any[]>;
          GetSettings: () => Promise<AppSettings>;
          CompleteFirstRun: () => Promise<AppSettings>;
          SelectFolderDialog: () => Promise<string>;
          CreateDatabase: (
            folderPath: string,
            dbName: string
          ) => Promise<AppSettings>;
          OpenExistingDatabaseDialog: () => Promise<AppSettings>;
          SwitchDatabase: (dbPath: string) => Promise<AppSettings>;
          DeleteDatabase: (dbPath: string) => Promise<AppSettings>;
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
  return (rawList || []).map((item, idx) => ({
    seq: typeof item.seq === 'number' ? item.seq : idx + 1,
    id: String(item.id),
    timestamp: String(item.timestamp),
    type: item.type as EventType,
    payload:
      typeof item.payload === 'string'
        ? JSON.parse(item.payload)
        : item.payload || {},
    undone: Boolean(item.undone),
  }));
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
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) {
      const seeded = createInitialBrowserDemoEvents();
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(seeded));
      return seeded;
    }
    return normalizeEvents(JSON.parse(raw));
  } catch {
    return createInitialBrowserDemoEvents();
  }
}

function saveBrowserEvents(events: StoredEvent[]): StoredEvent[] {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(events));
  } catch {
    // ignore storage errors
  }
  return events;
}

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
    payload: Record<string, any>
  ): Promise<StoredEvent[]> {
    const id = `ev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (isWailsAvailable()) {
      const res = await window.go!.main!.App!.AppendEvent(
        id,
        type,
        JSON.stringify(payload)
      );
      return normalizeEvents(res);
    }

    const current = loadBrowserEvents().filter((e) => !e.undone);
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    const coalescableTypes: EventType[] = [
      'TASK_RENAMED',
      'TASK_START_DATE_SET',
      'TASK_ACTIVE_SET',
    ];

    if (
      coalescableTypes.includes(type) &&
      current.length > 0 &&
      payload?.taskId
    ) {
      const last = current[current.length - 1];
      const lastMs = new Date(last.timestamp).getTime();
      if (
        last.type === type &&
        last.payload?.taskId === payload.taskId &&
        nowMs - lastMs <= 60_000
      ) {
        const updatedLast: StoredEvent = {
          ...last,
          timestamp: nowIso,
          payload,
        };
        return saveBrowserEvents([...current.slice(0, -1), updatedLast]);
      }
    }

    const nextSeq = current.length > 0 ? current[current.length - 1].seq + 1 : 1;
    const nextEvent: StoredEvent = {
      seq: nextSeq,
      id,
      timestamp: nowIso,
      type,
      payload,
      undone: false,
    };
    return saveBrowserEvents([...current, nextEvent]);
  },

  async undo(): Promise<StoredEvent[]> {
    if (isWailsAvailable()) {
      const res = await window.go!.main!.App!.Undo();
      return normalizeEvents(res);
    }
    const events = loadBrowserEvents();
    for (let i = events.length - 1; i >= 0; i--) {
      if (!events[i].undone) {
        events[i] = { ...events[i], undone: true };
        break;
      }
    }
    return saveBrowserEvents([...events]);
  },

  async redo(): Promise<StoredEvent[]> {
    if (isWailsAvailable()) {
      const res = await window.go!.main!.App!.Redo();
      return normalizeEvents(res);
    }
    const events = loadBrowserEvents();
    for (let i = 0; i < events.length; i++) {
      if (events[i].undone) {
        events[i] = { ...events[i], undone: false };
        break;
      }
    }
    return saveBrowserEvents([...events]);
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
    if (isWailsAvailable() && window.go!.main!.App!.GetSettings) {
      return await window.go!.main!.App!.GetSettings();
    }
    try {
      const raw = localStorage.getItem(LOCAL_SETTINGS_KEY);
      if (raw) return JSON.parse(raw);
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
      activeDatabasePath: '%APPDATA%\\DoDrag\\dodrag.db',
      firstRunCompleted: false,
    };
  },

  async completeFirstRun(): Promise<AppSettings> {
    if (isWailsAvailable() && window.go!.main!.App!.CompleteFirstRun) {
      return await window.go!.main!.App!.CompleteFirstRun();
    }
    const current = await this.getSettings();
    const updated: AppSettings = { ...current, firstRunCompleted: true };
    localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(updated));
    return updated;
  },

  async selectFolderDialog(): Promise<string> {
    if (isWailsAvailable() && window.go!.main!.App!.SelectFolderDialog) {
      return await window.go!.main!.App!.SelectFolderDialog();
    }
    return '';
  },

  async createDatabase(
    folderPath: string,
    dbName: string
  ): Promise<AppSettings> {
    if (isWailsAvailable() && window.go!.main!.App!.CreateDatabase) {
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
      firstRunCompleted: true,
    };
    localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(next));
    saveBrowserEvents([]);
    return next;
  },

  async openExistingDatabaseDialog(): Promise<AppSettings> {
    if (
      isWailsAvailable() &&
      window.go!.main!.App!.OpenExistingDatabaseDialog
    ) {
      return await window.go!.main!.App!.OpenExistingDatabaseDialog();
    }
    return await this.getSettings();
  },

  async switchDatabase(dbPath: string): Promise<AppSettings> {
    if (isWailsAvailable() && window.go!.main!.App!.SwitchDatabase) {
      return await window.go!.main!.App!.SwitchDatabase(dbPath);
    }
    const current = await this.getSettings();
    const next: AppSettings = {
      ...current,
      activeDatabasePath: dbPath,
      firstRunCompleted: true,
    };
    localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(next));
    return next;
  },

  async deleteDatabase(dbPath: string): Promise<AppSettings> {
    if (isWailsAvailable() && window.go!.main!.App!.DeleteDatabase) {
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
    const next: AppSettings = {
      ...current,
      knownDatabases: fallback,
      activeDatabasePath:
        current.activeDatabasePath === dbPath
          ? fallback[0].path
          : current.activeDatabasePath,
    };
    localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(next));
    return next;
  },
};


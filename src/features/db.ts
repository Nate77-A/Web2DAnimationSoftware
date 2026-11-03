// IndexedDB repository on Dexie. Callers use the `db.*` functions only, never Dexie tables directly.
import Dexie, { type EntityTable } from 'dexie';

export interface ProjectRecord {
  id: string;
  name: string;
  updatedAt: string;
  data: string; // JSON of ProjectV1
  previous: string | null; // last known-good version
}

export interface AssetRecord {
  id: string; // sha-256 hex of the original bytes
  blob: Blob;
  mime: string;
  width: number;
  height: number;
  byteLength: number;
  name: string;
}

interface MetaRecord { key: string; value: unknown }

class StudioDb extends Dexie {
  projects!: EntityTable<ProjectRecord, 'id'>;
  assets!: EntityTable<AssetRecord, 'id'>;
  meta!: EntityTable<MetaRecord, 'key'>;

  constructor() {
    super('animation-studio');
    // Same store names and key paths as the pre-Dexie v1 database, so existing data opens as-is.
    this.version(1).stores({ projects: 'id', assets: 'id', meta: 'key' });
  }
}

let instance: StudioDb | null = null;

export function isIndexedDbAvailable(): boolean {
  try { return typeof indexedDB !== 'undefined' && indexedDB !== null; } catch { return false; }
}

function open(): StudioDb {
  if (!isIndexedDbAvailable()) throw new Error('IndexedDB is not available in this browser context.');
  return (instance ??= new StudioDb());
}

export const db = {
  async getProject(id: string): Promise<ProjectRecord | undefined> {
    return open().projects.get(id);
  },
  async putProject(rec: ProjectRecord): Promise<void> {
    await open().projects.put(rec);
  },
  async deleteProject(id: string): Promise<void> {
    await open().projects.delete(id);
  },
  async listProjects(): Promise<{ id: string; name: string; updatedAt: string; size: number }[]> {
    const all = await open().projects.toArray();
    return all.map((r) => ({ id: r.id, name: r.name, updatedAt: r.updatedAt, size: r.data.length }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  async getAsset(id: string): Promise<AssetRecord | undefined> {
    return open().assets.get(id);
  },
  async hasAsset(id: string): Promise<boolean> {
    return (await open().assets.where('id').equals(id).count()) > 0;
  },
  async putAsset(rec: AssetRecord): Promise<void> {
    await open().assets.put(rec);
  },
  async getMeta<T>(key: string): Promise<T | undefined> {
    return (await open().meta.get(key))?.value as T | undefined;
  },
  async setMeta(key: string, value: unknown): Promise<void> {
    await open().meta.put({ key, value });
  },
};

/** True for storage-quota failures, including Dexie's wrapped QuotaExceededError. */
export function isQuotaError(e: unknown): boolean {
  const names = ['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED'];
  if (e instanceof Dexie.QuotaExceededError) return true;
  if (e instanceof Dexie.DexieError && e.inner instanceof DOMException) return names.includes(e.inner.name);
  return e instanceof DOMException && names.includes(e.name);
}

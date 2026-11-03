// Autosave (debounced) to IndexedDB with last-known-good retention and crash recovery.
import { createProject } from '../domain/defaults';
import { parseProject, ProjectLoadError } from '../domain/migrations';
import type { Project } from '../domain/schema';
import { getState, loadProjectIntoEditor, store, toast } from '../editor/state';
import { ensureAssetsLoaded } from './assets';
import { db, isIndexedDbAvailable, isQuotaError } from './db';

const DEBOUNCE_MS = 700;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastSaved: Project | null = null;
let storageAvailable = true;

export async function saveNow(project: Project = getState().project): Promise<void> {
  if (!storageAvailable) return;
  store.set({ saveStatus: 'saving' });
  try {
    const existing = await db.getProject(project.id);
    const data = JSON.stringify(project);
    // Keep the previous successfully-parsed version as last known-good.
    let previous = existing?.previous ?? null;
    if (existing) {
      try { parseProject(JSON.parse(existing.data)); previous = existing.data; } catch { /* keep older good copy */ }
    }
    await db.putProject({ id: project.id, name: project.name, updatedAt: project.updatedAt, data, previous });
    await db.setMeta('lastProjectId', project.id);
    lastSaved = project;
    if (getState().project === project) store.set({ saveStatus: 'saved', saveError: null });
  } catch (e) {
    const msg = isQuotaError(e)
      ? 'Browser storage is full. Use File › Save to download your project, then free space in Projects.'
      : `Autosave failed: ${(e as Error).message}`;
    store.set({ saveStatus: 'error', saveError: msg });
    toast(msg, 'error', true);
  }
}

export function startAutosave() {
  store.subscribe((s, prev) => {
    if (s.project === prev.project || s.gestureBase) return;
    if (s.project === lastSaved) return;
    store.set({ saveStatus: 'pending' });
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void saveNow(getState().project); }, DEBOUNCE_MS);
  });
  window.addEventListener('beforeunload', (e) => {
    if (timer || getState().saveStatus === 'pending') {
      void saveNow(getState().project);
      e.preventDefault();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && (timer || getState().saveStatus === 'pending')) {
      if (timer) clearTimeout(timer);
      timer = null;
      void saveNow(getState().project);
    }
  });
}

/** Boot: restore the last project, falling back to the last known-good copy, never overwriting a corrupt one. */
export async function restoreOnBoot(): Promise<void> {
  if (!isIndexedDbAvailable()) {
    storageAvailable = false;
    toast('Local storage (IndexedDB) is unavailable here, so autosave is off. Use File › Save to keep your work.', 'warning', true);
    finishBoot(createProject());
    return;
  }
  let lastId: string | undefined;
  try { lastId = await db.getMeta<string>('lastProjectId'); } catch (e) {
    storageAvailable = false;
    toast(`Local storage could not be opened (${(e as Error).message}). Autosave is off.`, 'warning', true);
    finishBoot(createProject());
    return;
  }
  if (!lastId) { const p = createProject(); finishBoot(p); await saveNow(p); return; }
  const rec = await db.getProject(lastId).catch(() => undefined);
  if (!rec) { const p = createProject(); finishBoot(p); await saveNow(p); return; }
  try {
    finishBoot(parseProject(JSON.parse(rec.data)));
  } catch (e) {
    const err = e instanceof ProjectLoadError ? e : new ProjectLoadError((e as Error).message);
    if (rec.previous) {
      try {
        const prev = parseProject(JSON.parse(rec.previous));
        finishBoot(prev);
        toast('The latest autosave was damaged, so the previous good version was restored.', 'warning', true);
        return;
      } catch { /* fall through */ }
    }
    // Do not overwrite the damaged record: start a fresh project with a new id and offer the raw data.
    const fresh = createProject();
    finishBoot(fresh);
    store.set({ dialog: { kind: 'recovery', message: err.message, details: err.details, raw: rec.data, projectId: rec.id } });
  }
}

function finishBoot(p: Project) {
  lastSaved = p;
  loadProjectIntoEditor(p);
  store.set({ ready: true, saveStatus: 'saved' });
  void ensureAssetsLoaded(p.assets).then((missing) => {
    if (missing.length) toast(`${missing.length} image asset(s) could not be found in local storage.`, 'warning', true);
  });
}

export async function switchToProject(id: string) {
  const rec = await db.getProject(id);
  if (!rec) throw new Error('Project not found');
  const p = parseProject(JSON.parse(rec.data));
  await saveNow();
  lastSaved = p;
  loadProjectIntoEditor(p);
  await db.setMeta('lastProjectId', p.id);
  await ensureAssetsLoaded(p.assets);
}

export async function replaceWithProject(p: Project, opts: { fileDirty?: boolean } = {}) {
  await saveNow();
  loadProjectIntoEditor(p, opts);
  await saveNow(p);
  await ensureAssetsLoaded(p.assets);
}

export function isStorageAvailable() { return storageAvailable; }

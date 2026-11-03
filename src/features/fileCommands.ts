// File menu workflows: New, Open, Save (download .anims), Save As, project catalog.
import { createProject } from '../domain/defaults';
import { newId, nowIso } from '../domain/ids';
import { ProjectLoadError } from '../domain/migrations';
import { commit, getState, store, toast } from '../editor/state';
import { downloadBlob, safeFileName } from './export/common';
import { buildProjectFile, FILE_EXTENSION, pickProjectFile, readProjectFile } from './fileFormat';
import { replaceWithProject, saveNow } from './persistence';
import { db } from './db';

function confirmDiscard(action: string, run: () => void) {
  const s = getState();
  if (!s.fileDirty) { run(); return; }
  store.set({
    dialog: {
      kind: 'confirm',
      title: `${action}?`,
      body: `"${s.project.name}" has changes that have not been saved to a project file. They remain in this browser's local storage (Projects), but are not in any downloaded file.`,
      confirmLabel: action,
      altLabel: 'Save file first',
      onAlt: () => { void saveProjectFile().then(run); },
      onConfirm: run,
    },
  });
}

export function newProject() {
  confirmDiscard('Create new project', () => {
    void replaceWithProject(createProject()).then(() => {
      window.dispatchEvent(new Event('studio:fit'));
      toast('New project created', 'success');
    });
  });
}

export function openProject() {
  confirmDiscard('Open another project', async () => {
    const file = await pickProjectFile();
    if (!file) return;
    try {
      const p = await readProjectFile(file);
      // Opening a file creates/updates its local copy; never overwrite the current one until validation passed.
      await replaceWithProject({ ...p, updatedAt: nowIso() });
      window.dispatchEvent(new Event('studio:fit'));
      toast(`Opened "${p.name}"`, 'success');
    } catch (e) {
      const err = e instanceof ProjectLoadError ? e : new ProjectLoadError((e as Error).message);
      store.set({ dialog: { kind: 'confirm', title: 'Could not open project', body: `${err.message}${err.details.length ? `\n\n• ${err.details.join('\n• ')}` : ''}\n\nYour current project was not changed.`, confirmLabel: 'OK', onConfirm: () => {} } });
    }
  });
}

export async function saveProjectFile(): Promise<void> {
  const p = getState().project;
  try {
    await saveNow(p);
    const blob = await buildProjectFile(p);
    if (!(await downloadBlob(blob, `${safeFileName(p.name)}${FILE_EXTENSION}`))) return;
    store.set({ fileDirty: false });
    toast(`Saved "${p.name}${FILE_EXTENSION}"`, 'success');
  } catch (e) {
    toast(`Save failed: ${(e as Error).message}`, 'error', true);
  }
}

export function saveProjectAs() {
  const p = getState().project;
  store.set({
    dialog: {
      kind: 'prompt', title: 'Save As', label: 'New project name', value: `${p.name} copy`, confirmLabel: 'Save As',
      onConfirm: async (name) => {
        const trimmed = name.trim().slice(0, 200);
        if (!trimmed) return;
        const copy = { ...structuredClone(getState().project), id: newId('proj'), name: trimmed, createdAt: nowIso(), updatedAt: nowIso() };
        try {
          // Write the new identity first; only switch once the write succeeded.
          await db.putProject({ id: copy.id, name: copy.name, updatedAt: copy.updatedAt, data: JSON.stringify(copy), previous: null });
          await replaceWithProject(copy, { fileDirty: true });
          await saveProjectFile();
        } catch (e) {
          toast(`Save As failed; the original project is unchanged. ${(e as Error).message}`, 'error', true);
        }
      },
    },
  });
}

export function renameProject(name: string) {
  const trimmed = name.trim().slice(0, 200);
  if (!trimmed) return;
  commit('Rename project', (p) => (p.name === trimmed ? p : { ...p, name: trimmed }));
}

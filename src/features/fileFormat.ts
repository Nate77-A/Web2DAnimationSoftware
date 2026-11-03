// Native project file (.anims): ZIP containing manifest.json (project + asset manifest) and assets/<hash>.
// See docs/decisions/0002-native-file-format.md.
import JSZip from 'jszip';
import { z } from 'zod';
import { parseProject, ProjectLoadError } from '../domain/migrations';
import type { Project } from '../domain/schema';
import { db } from './db';
import { getAssetBlob, registerAssetBytes, sha256Hex, sniffMime } from './assets';

export const FILE_EXTENSION = '.anims';
export const FORMAT_ID = 'animation-studio-project';
const MAX_FILE_BYTES = 500 * 1024 * 1024;

const manifestSchema = z.object({
  format: z.literal(FORMAT_ID),
  formatVersion: z.literal(1),
  app: z.string().max(100),
  savedAt: z.string(),
  project: z.unknown(),
  assets: z.array(z.object({
    id: z.string().regex(/^[0-9a-f]{64}$/),
    path: z.string().regex(/^assets\/[0-9a-f]{64}\.(png|jpg|webp)$/),
    mime: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    byteLength: z.number().int().min(1),
  })),
});

const ext = (mime: string) => (mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : 'webp');

export async function buildProjectFile(project: Project): Promise<Blob> {
  const zip = new JSZip();
  const assets = [];
  for (const a of project.assets) {
    let blob = getAssetBlob(a.id);
    if (!blob) blob = (await db.getAsset(a.id))?.blob;
    if (!blob) throw new Error(`Image "${a.name}" is missing from local storage and cannot be saved.`);
    const path = `assets/${a.id}.${ext(a.mime)}`;
    zip.file(path, blob);
    assets.push({ id: a.id, path, mime: a.mime, byteLength: a.byteLength });
  }
  const manifest = { format: FORMAT_ID, formatVersion: 1, app: `2D Animation Studio ${__APP_VERSION__}`, savedAt: new Date().toISOString(), project, assets };
  zip.file('manifest.json', JSON.stringify(manifest));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 }, mimeType: 'application/zip' });
}

/** Validates schema version, the embedded asset manifest and every asset's bytes before returning. */
export async function readProjectFile(file: File): Promise<Project> {
  if (file.size > MAX_FILE_BYTES) throw new ProjectLoadError(`File is too large (${(file.size / 1048576).toFixed(0)} MB).`);
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(await file.arrayBuffer()); } catch { throw new ProjectLoadError('This is not a valid .anims project file (not a ZIP archive).'); }
  const entry = zip.file('manifest.json');
  if (!entry) throw new ProjectLoadError('The project file has no manifest.json.');
  let raw: unknown;
  try { raw = JSON.parse(await entry.async('string')); } catch { throw new ProjectLoadError('manifest.json is not valid JSON.'); }
  const m = manifestSchema.safeParse(raw);
  if (!m.success) throw new ProjectLoadError('The project manifest is invalid.', m.error.issues.slice(0, 6).map((i) => `${i.path.join('.')}: ${i.message}`));
  const project = parseProject(m.data.project);
  const listed = new Map(m.data.assets.map((a) => [a.id, a]));
  for (const a of project.assets) {
    const item = listed.get(a.id);
    if (!item) throw new ProjectLoadError(`Asset "${a.name}" is referenced but not listed in the manifest.`);
    const f = zip.file(item.path);
    if (!f) throw new ProjectLoadError(`Asset file ${item.path} is missing from the archive.`);
    const bytes = await f.async('arraybuffer');
    if (bytes.byteLength !== item.byteLength) throw new ProjectLoadError(`Asset "${a.name}" has the wrong size.`);
    if ((await sha256Hex(bytes)) !== a.id) throw new ProjectLoadError(`Asset "${a.name}" failed its integrity check.`);
    if (sniffMime(new Uint8Array(bytes.slice(0, 16))) !== a.mime) throw new ProjectLoadError(`Asset "${a.name}" is not the image type it claims to be.`);
  }
  // Only after full validation are bytes written to local storage.
  for (const a of project.assets) {
    const item = listed.get(a.id)!;
    await registerAssetBytes(a, await zip.file(item.path)!.async('arraybuffer'));
  }
  return project;
}

export function pickProjectFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `${FILE_EXTENSION},.zip,application/zip`;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

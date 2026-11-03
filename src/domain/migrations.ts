// Migration registry. Each entry upgrades a payload from version N to N+1. Never edit a shipped
// migration; add a new one and bump SCHEMA_VERSION.
import { projectSchema, SCHEMA_VERSION, validateIntegrity, type Project } from './schema';

type Raw = Record<string, unknown>;

export const migrations: Record<number, (raw: Raw) => Raw> = {
  /** v0 was the pre-release draft format: `frameRate` instead of `fps`, no preferences, no layer colors. */
  0: (raw) => {
    const { frameRate, ...rest } = raw as Raw & { frameRate?: number };
    const layers = (rest.layers as Raw[] | undefined) ?? [];
    return {
      ...rest,
      schemaVersion: 1,
      fps: (rest.fps as number | undefined) ?? frameRate ?? 24,
      preferences: rest.preferences ?? { onionSkin: false, onionBefore: 2, onionAfter: 1, loopPlayback: true },
      layers: layers.map((l, i) => ({ color: '#3CC8D6FF', blendMode: 'normal', solo: false, order: i, ...l })),
    };
  },
};

export class ProjectLoadError extends Error {
  constructor(message: string, readonly details: string[] = []) {
    super(message);
    this.name = 'ProjectLoadError';
  }
}

/** Parses unknown JSON into a valid ProjectV1, running migrations. Throws ProjectLoadError. */
export function parseProject(input: unknown): Project {
  if (!input || typeof input !== 'object') throw new ProjectLoadError('Project data is not an object.');
  let raw = input as Raw;
  let version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
  if (version > SCHEMA_VERSION) {
    throw new ProjectLoadError(`This project was saved by a newer version (schema ${version}). This app supports schema ${SCHEMA_VERSION}.`);
  }
  while (version < SCHEMA_VERSION) {
    const m = migrations[version];
    if (!m) throw new ProjectLoadError(`No migration from schema ${version}.`);
    raw = m(raw);
    version += 1;
  }
  const result = projectSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues.slice(0, 8).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new ProjectLoadError('Project data failed validation.', details);
  }
  const problems = validateIntegrity(result.data);
  if (problems.length) throw new ProjectLoadError('Project data is internally inconsistent.', problems.slice(0, 8));
  return result.data;
}

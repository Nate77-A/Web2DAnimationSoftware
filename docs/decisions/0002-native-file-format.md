# 0002 — Native project file (`.anims`)

**Status:** accepted · **Stage:** 0 / 5

- Extension `.anims`; a ZIP archive with `manifest.json` and `assets/<sha256>.<png|jpg|webp>`.
- `manifest.json` = `{ format: "animation-studio-project", formatVersion: 1, app, savedAt, project: ProjectV1, assets: [{ id, path, mime, byteLength }] }`.
- **Open** validates in this order before anything is replaced or stored: ZIP readable → manifest schema (Zod) →
  project schema + migrations + referential integrity → every referenced asset listed, present, correct size,
  SHA-256 equals its id, magic bytes match the declared MIME. Only then are bytes written to IndexedDB.
- **Save** autosaves to IndexedDB continuously; File › Save downloads the `.anims` file.
- **Save As** writes the new project identity to IndexedDB first and only switches the editor after that write succeeds.
- The live renderer is never serialized; only the versioned schema.

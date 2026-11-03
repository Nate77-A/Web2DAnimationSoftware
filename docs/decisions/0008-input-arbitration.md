# 0008 — Input arbitration (Pointer Events)

**Status:** accepted · **Stage:** 1

- All stage input goes through one coordinator in `editor/Stage.tsx` that maps client → stage → document
  coordinates with the viewport (`panX, panY, zoom`; zoom 12.5 %–3200 %). Panning never changes document coordinates.
- `touch-action: none` is applied only to the stage; panels scroll normally.
- Pen/Pencil and mouse drive the active tool. A **finger** pans when a drawing tool is active or while another
  pointer is drawing (so a Pencil stroke and a panning finger can coexist); two fingers pinch-zoom about their centroid.
- Middle-button drag and Space-drag pan from any tool. Ctrl/⌘ + wheel or trackpad pinch zooms at the pointer; plain wheel pans.
- `getCoalescedEvents()` is used for brush sampling fidelity where available.
- Selection handles are drawn in a screen-space SVG overlay at constant size and are never part of exports.
- *Debug: Coordinate Markers* (View menu) drops labeled markers at clicked document points for zoom/pan verification.

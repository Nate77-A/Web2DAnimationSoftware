# Manual device test matrix

Desktop automation cannot prove Apple Pencil behavior. Run on physical devices at the end of each input-related change.

| Check | iPad + Pencil | iPad finger only | macOS Safari | Chrome/Edge desktop |
|---|---|---|---|---|
| Pencil stroke records pressure (Brush data shows "pressure recorded"); light vs firm strokes differ in width | ☐ | n/a | n/a | pen tablet ☐ |
| Tilt (enable "Tilt affects width") changes width | ☐ | n/a | n/a | ☐ |
| One finger pans while Brush is active; no stroke is created | ☐ | ☐ | n/a | n/a |
| Pencil draws while a second finger pans | ☐ | n/a | n/a | n/a |
| Two-finger pinch zooms about the fingers; page does not zoom or scroll | ☐ | ☐ | trackpad ☐ | trackpad ☐ |
| Panels and menus scroll and tap normally (44 px targets) | ☐ | ☐ | ☐ | ☐ |
| Import PNG/JPEG/WebP, reload, image still renders offline | ☐ | ☐ | ☐ | ☐ |
| Autosave → close tab → reopen restores project | ☐ | ☐ | ☐ | ☐ |
| Transform handles: scale, rotate, Shift constrain (desktop) | ☐ | ☐ | ☐ | ☐ |
| Timeline: add/hide/lock/solo layers, F6/F7, tween preview | ☐ | ☐ | ☐ | ☐ |
| One export of each format opens correctly | ☐ | ☐ | ☐ | ☐ |

import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { installKeyboard } from './app/commands';
import './app/theme.css';
import { store, toast } from './editor/state';
import { setAssetLoadedListener } from './features/assets';
import { restoreOnBoot, startAutosave } from './features/persistence';

// Named fallbacks for missing platform APIs (spec: detect missing APIs and degrade gracefully).
const missing: string[] = [];
if (typeof PointerEvent === 'undefined') missing.push('Pointer Events');
if (typeof Path2D === 'undefined') missing.push('Path2D');
if (typeof structuredClone === 'undefined') missing.push('structuredClone');
if (!(globalThis.crypto && crypto.subtle)) missing.push('Web Crypto (image import needs a secure context)');

setAssetLoadedListener(() => store.set((s) => ({ assetsVersion: s.assetsVersion + 1 })));
installKeyboard();
// Test/debug hook used by the Playwright suite (read-only inspection plus state setup).
(window as unknown as { __studio: typeof store }).__studio = store;
createRoot(document.getElementById('root')!).render(<App />);

void restoreOnBoot().then(() => {
  startAutosave();
  if (missing.length) toast(`This browser is missing: ${missing.join(', ')}. Some features are unavailable.`, 'warning', true);
});

if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !location.hostname.match(/^(localhost|127\.)/) && document.querySelector('link[rel="manifest"]')) {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* offline cache unavailable; app still works online */ });
}

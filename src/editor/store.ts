// App store on Zustand (vanilla store + React hook). The `get/set/subscribe` facade keeps the editor's
// call sites independent of the library.
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { shallow } from 'zustand/shallow';
import { createStore as createZustandStore, type StoreApi } from 'zustand/vanilla';

export interface Store<T> {
  get(): T;
  set(patch: Partial<T> | ((s: T) => Partial<T>)): void;
  subscribe(fn: (s: T, prev: T) => void): () => void;
  /** Underlying Zustand store, for Zustand middleware and devtools. */
  api: StoreApi<T>;
}

export function createStore<T extends object>(initial: T): Store<T> {
  const api = createZustandStore<T>()(() => initial);
  return {
    api,
    get: api.getState,
    set(patch) {
      const state = api.getState();
      const p = typeof patch === 'function' ? patch(state) : patch;
      // Skip no-op patches so subscribers only run on real changes.
      let changed = false;
      for (const k in p) if ((p as T)[k] !== state[k]) { changed = true; break; }
      if (changed) api.setState(p);
    },
    subscribe: api.subscribe,
  };
}

export const shallowEqual = (a: unknown, b: unknown): boolean => shallow(a, b);

/** Subscribe a component to a derived slice. Selected values are compared shallowly. */
export function useSelector<T extends object, R>(store: Store<T>, selector: (s: T) => R): R {
  return useStore(store.api, useShallow(selector));
}

import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import { addObjects, mapObjects } from '../domain/ops';
import { beginGesture, commit, commitMerge, endGesture, initialState, loadProjectIntoEditor, redo, store, undo, updateGesture } from '../editor/state';
import { rect, twoLayerProject } from './fixtures';

const count = () => store.get().project.layers.reduce((n, l) => n + l.objectTracks.reduce((m, c) => m + c.objects.length, 0), 0);

describe('command history', () => {
  beforeEach(() => {
    store.set(initialState());
    loadProjectIntoEditor(twoLayerProject());
  });

  it('commit / undo / redo restore exact project snapshots', () => {
    const p0 = store.get().project;
    commit('Add', (p) => addObjects(p, 'fg', 0, [rect('new')]), ['new']);
    assert.equal(count(), 4);
    undo();
    assert.equal(store.get().project, p0);
    redo();
    assert.equal(count(), 4);
    assert.deepEqual(store.get().selection, ['new'], 'redo selects the affected object');
  });

  it('no-op commits are not recorded', () => {
    assert.equal(commit('Nothing', (p) => p), false);
    assert.equal(store.get().past.length, 0);
  });

  it('a gesture records exactly one command', () => {
    beginGesture();
    for (let i = 1; i <= 10; i++) updateGesture((b) => mapObjects(b, ['ball-a'], (o) => ({ ...o, transform: { ...o.transform, x: i } })));
    endGesture('Move', ['ball-a']);
    assert.equal(store.get().past.length, 1);
    undo();
    assert.equal(store.get().project.layers[1].objectTracks[0].objects[0].transform.x, 100);
  });

  it('commitMerge folds rapid edits of the same target', () => {
    for (let i = 0; i < 5; i++) commitMerge('Opacity', (p) => mapObjects(p, ['sky'], (o) => ({ ...o, opacity: 1 - i * 0.1 })), ['sky']);
    assert.equal(store.get().past.length, 1);
    undo();
    assert.equal(store.get().project.layers[0].objectTracks[0].objects[0].opacity, 1);
  });

  it('commands hold deterministic data only (serializable)', () => {
    commit('Add', (p) => addObjects(p, 'fg', 0, [rect('x')]), ['x']);
    const cmd = store.get().past[0];
    assert.doesNotThrow(() => JSON.stringify(cmd));
    assert.equal(typeof cmd.label, 'string');
  });
});

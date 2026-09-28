import { describe, expect, it } from 'vitest';

import { branchMenuReducer } from '../src/renderer/branch-menu.js';

describe('branchMenuReducer', () => {
  it('toggles open state from the branch label', () => {
    expect(branchMenuReducer(false, { type: 'toggle' })).toBe(true);
    expect(branchMenuReducer(true, { type: 'toggle' })).toBe(false);
  });

  it('closes on branch selection, outside click, escape, and lane focus change', () => {
    for (const type of ['select', 'outside_click', 'escape', 'focus_lane_change'] as const) {
      expect(branchMenuReducer(true, { type })).toBe(false);
    }
  });
});

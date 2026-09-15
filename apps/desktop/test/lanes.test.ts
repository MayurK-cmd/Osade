import { describe, expect, it } from 'vitest';

import { showPinnedNeedsYou } from '../src/renderer/lanes.js';

describe('showPinnedNeedsYou', () => {
  it('hides the group when it would contain every visible chat', () => {
    expect(showPinnedNeedsYou(1, 1)).toBe(false);
    expect(showPinnedNeedsYou(3, 3)).toBe(false);
  });

  it('shows the group when some chats do not need you', () => {
    expect(showPinnedNeedsYou(1, 2)).toBe(true);
  });
});

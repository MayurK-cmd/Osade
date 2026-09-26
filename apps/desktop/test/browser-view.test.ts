import { describe, expect, it } from 'vitest';

import {
  boxOf,
  boxToPixels,
  browserShotContext,
  BROWSER_DEFAULT,
  BROWSER_MAX,
  BROWSER_MIN,
  clampBrowserWidth,
  clickFraction,
  DEFAULT_BROWSER_URL,
  elementLabel,
  elementSummary,
  fittedSize,
  normaliseUrl,
  SHOT_MAX_EDGE,
} from '../src/renderer/browser-view.js';

describe('normaliseUrl', () => {
  it('leaves a full URL alone, so an http dev server stays http', () => {
    expect(normaliseUrl('http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('assumes https for a bare host', () => {
    expect(normaliseUrl('example.com')).toBe('https://example.com');
    expect(normaliseUrl('example.com/pr/13?x=1')).toBe('https://example.com/pr/13?x=1');
  });

  it('reads a bare localhost as a host and a port, not as a scheme', () => {
    expect(normaliseUrl('localhost:5173')).toBe('http://localhost:5173');
    expect(normaliseUrl('localhost')).toBe('http://localhost');
  });

  it('falls back to the default when the bar is empty', () => {
    expect(normaliseUrl('   ')).toBe(DEFAULT_BROWSER_URL);
  });
});

describe('clampBrowserWidth', () => {
  it('gives the default when nothing has been remembered', () => {
    expect(clampBrowserWidth(BROWSER_DEFAULT, 1440)).toBe(BROWSER_DEFAULT);
  });

  it('keeps the chat a column it can be read in', () => {
    // 700px of window leaves 340 for the pane, so 520 has to give way.
    expect(clampBrowserWidth(BROWSER_DEFAULT, 700)).toBe(340);
  });

  it('never goes below the minimum, however narrow the window is', () => {
    // A 400px window leaves 40px for the pane. It still gets the minimum — the pane is opt-in,
    // and the user's way out of an unusable layout is to close it, not to be refused one.
    expect(clampBrowserWidth(BROWSER_DEFAULT, 400)).toBe(BROWSER_MIN);
    expect(clampBrowserWidth(10, 1440)).toBe(BROWSER_MIN);
  });

  it('does not let an unlaid-out window pin the pane to its minimum', () => {
    // A window reporting 0 is a window that has not been measured yet. The clamped value is
    // what gets remembered, so shrinking here would shrink it for good.
    expect(clampBrowserWidth(BROWSER_DEFAULT, 0)).toBe(BROWSER_DEFAULT);
    expect(clampBrowserWidth(BROWSER_DEFAULT, Number.NaN)).toBe(BROWSER_DEFAULT);
  });

  it('ignores a remembered width that is not a number', () => {
    expect(clampBrowserWidth(Number.NaN, 1440)).toBe(BROWSER_DEFAULT);
  });

  it('caps at the widest the pane is ever meant to be', () => {
    expect(clampBrowserWidth(4_000, 4_000)).toBe(BROWSER_MAX);
  });
});

describe('elementLabel', () => {
  it('prefers the probed selector', () => {
    expect(elementLabel({ selector: 'button#save.primary', tag: 'button' })).toBe('button#save.primary');
  });

  it('builds one from the parts when there is no selector', () => {
    expect(elementLabel({ tag: 'button', id: 'save', classes: ['primary', 'big'] })).toBe('button#save.primary');
  });

  it('does not invent a class for a bare element', () => {
    expect(elementLabel({ tag: 'h1' })).toBe('h1');
  });
});

describe('elementSummary', () => {
  it('names the element and its container', () => {
    const line = elementSummary({
      selector: 'button#save',
      name: 'Save changes',
      path: ['html', 'body', 'form', 'button#save'],
    });
    expect(line).toBe('button#save in form — “Save changes”');
  });

  it('survives an element with no text at all', () => {
    expect(elementSummary({ selector: 'hr' })).toBe('hr');
  });
});

describe('browserShotContext', () => {
  const element = {
    selector: 'button#save',
    tag: 'button',
    name: 'Save changes',
    path: ['body', 'form', 'button#save'],
  };

  it('tells the agent which page the image is from', () => {
    const text = browserShotContext('http://localhost:3000/settings', element);
    expect(text).toContain('http://localhost:3000/settings');
  });

  it('names the element and spells out that the image is attached', () => {
    const text = browserShotContext('http://localhost:3000', element);
    expect(text).toContain('button#save');
    expect(text).toContain('Save changes');
    expect(text).toContain('Path: body > form > button#save');
    expect(text).toContain('Open it and look');
  });

  it('says so when nothing was selected', () => {
    const text = browserShotContext('http://localhost:3000', null);
    expect(text).toContain('No element was selected');
    expect(text).not.toContain('Path:');
  });
});

describe('clickFraction', () => {
  const image = { x: 100, y: 50, width: 400, height: 200 };

  it('converts a click inside the image to a fraction of it', () => {
    expect(clickFraction({ x: 300, y: 150 }, image)).toEqual({ x: 0.5, y: 0.5 });
  });

  it('is 0,0 at the top-left corner and 1,1 at the bottom-right', () => {
    expect(clickFraction({ x: 100, y: 50 }, image)).toEqual({ x: 0, y: 0 });
    expect(clickFraction({ x: 500, y: 250 }, image)).toEqual({ x: 1, y: 1 });
  });

  it('clamps a click that landed outside the image', () => {
    expect(clickFraction({ x: 0, y: 0 }, image)).toEqual({ x: 0, y: 0 });
    expect(clickFraction({ x: 9_999, y: 9_999 }, image)).toEqual({ x: 1, y: 1 });
  });

  it('degrades rather than dividing by zero on an unlaid-out image', () => {
    expect(clickFraction({ x: 10, y: 10 }, { x: 0, y: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 });
  });
});

describe('boxOf', () => {
  it('passes a normal rect through', () => {
    expect(boxOf({ rect: { x: 0.25, y: 0.5, width: 0.2, height: 0.1 } })).toEqual({
      x: 0.25,
      y: 0.5,
      width: 0.2,
      height: 0.1,
    });
  });

  it('clamps an element hanging off the right or bottom edge', () => {
    // `toBeCloseTo`, not `toBe`: the clamp is `1 - 0.9`, and asserting on its exact binary
    // expansion would be a test about IEEE 754 rather than about clamping.
    const box = boxOf({ rect: { x: 0.9, y: 0.95, width: 0.4, height: 0.4 } })!;
    expect(box.x).toBeCloseTo(0.9, 10);
    expect(box.y).toBeCloseTo(0.95, 10);
    expect(box.width).toBeCloseTo(0.1, 10);
    expect(box.height).toBeCloseTo(0.05, 10);
  });

  it('refuses a rect that is not a rect', () => {
    expect(boxOf({ rect: { x: 0.1, y: 0.1, width: 0, height: 0.2 } })).toBe(null);
    expect(boxOf({})).toBe(null);
  });
});

describe('boxToPixels', () => {
  it('scales a normalised box into drawn pixels', () => {
    expect(boxToPixels({ x: 0.5, y: 0.25, width: 0.5, height: 0.5 }, { width: 800, height: 400 })).toEqual({
      x: 400,
      y: 100,
      width: 400,
      height: 200,
    });
  });
});

describe('fittedSize', () => {
  it('leaves a small capture alone', () => {
    expect(fittedSize({ width: 800, height: 600 })).toEqual({ width: 800, height: 600 });
  });

  it('caps the long edge so the photo stays under the daemon limit', () => {
    const fitted = fittedSize({ width: 3840, height: 2160 });
    expect(fitted).toEqual({ width: SHOT_MAX_EDGE, height: 900 });
  });

  it('never rounds a dimension away to zero', () => {
    const fitted = fittedSize({ width: 20_000, height: 3 });
    expect(fitted.width).toBeGreaterThan(0);
    expect(fitted.height).toBeGreaterThan(0);
  });
});

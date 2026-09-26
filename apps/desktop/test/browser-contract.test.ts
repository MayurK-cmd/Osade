import { describe, expect, it } from 'vitest';

import { elementProbeScript, readBounds, readElement } from '../src/main/browser-contract.js';

/**
 * The pane runs a developer's own app, so the answer to a probe is a page's answer, not ours.
 * These are the checks that stop that page choosing the shape of what reaches the chat.
 */
describe('readElement', () => {
  const probed = {
    tag: 'button',
    id: 'save',
    classes: ['primary', 'big'],
    role: null,
    name: 'Save changes',
    selector: 'button#save.primary',
    path: ['body', 'form', 'button#save.primary'],
    rect: { x: 0.25, y: 0.5, width: 0.2, height: 0.1 },
  };

  it('passes a well-formed probe through', () => {
    expect(readElement(probed)).toEqual(probed);
  });

  it('refuses anything that is not an element', () => {
    expect(readElement(null)).toBeNull();
    expect(readElement('button')).toBeNull();
    expect(readElement({})).toBeNull();
    expect(readElement({ tag: '' })).toBeNull();
  });

  it('rebuilds a page that answered with the wrong types', () => {
    // A page that shadows `elementFromPoint` can return anything. It should cost the pane the
    // fields, not the pane's ability to draw a box.
    const read = readElement({
      tag: 'div',
      id: 42,
      classes: 'not-an-array',
      role: 7,
      name: { evil: true },
      selector: 9,
      path: ['body', 3, 'div'],
      rect: 'nope',
    });
    expect(read).not.toBeNull();
    expect(read!.tag).toBe('div');
    expect(read!.id).toBe('');
    expect(read!.classes).toEqual([]);
    expect(read!.role).toBeNull();
    expect(read!.name).toBe('');
    expect(read!.selector).toBe('div');
    expect(read!.path).toEqual(['body', 'div']);
    expect(read!.rect).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('caps the text it will put in a message', () => {
    expect(readElement({ tag: 'p', name: 'x'.repeat(5_000) })!.name).toHaveLength(200);
  });

  it('turns a NaN coordinate into zero rather than into a box off the page', () => {
    const read = readElement({ tag: 'div', rect: { x: Number.NaN, y: 0.5, width: 0.2, height: 0.2 } });
    expect(read!.rect).toEqual({ x: 0, y: 0.5, width: 0.2, height: 0.2 });
  });
});

describe('readBounds', () => {
  it('accepts a measured rectangle', () => {
    expect(readBounds({ x: 12, y: 40, width: 500, height: 700 })).toEqual({
      x: 12,
      y: 40,
      width: 500,
      height: 700,
    });
  });

  it('treats "no pane" as no rectangle', () => {
    expect(readBounds(null)).toBeNull();
    expect(readBounds(undefined)).toBeNull();
  });

  it('refuses a rectangle that would cover the window or swallow every click', () => {
    expect(readBounds({ x: 0, y: 0, width: 0, height: 700 })).toBeNull();
    expect(readBounds({ x: 0, y: 0, width: 500, height: -1 })).toBeNull();
    expect(readBounds({ x: Number.NaN, y: 0, width: 500, height: 700 })).toBeNull();
    expect(readBounds({ x: 0, y: 0, width: '500', height: 700 })).toBeNull();
    expect(readBounds('somewhere')).toBeNull();
  });
});

describe('elementProbeScript', () => {
  it('sends the point as a fraction and asks for a fraction back', () => {
    const script = elementProbeScript(0.25, 0.75);
    expect(script).toContain('0.25 * vw');
    expect(script).toContain('0.75 * vh');
    expect(script).toContain('rect.left / vw');
    expect(script).toContain('rect.width / vw');
    expect(script).toContain('rect.height / vh');
  });

  it('clamps the point into the page', () => {
    const script = elementProbeScript(4, -3);
    expect(script).toContain('Math.max(4 * vw, 0)');
    expect(script).toContain('Math.max(-3 * vh, 0)');
  });
});

/**
 * The browser pane's contract — issue #13.
 *
 * Two things live here, and they are the same thing seen from two sides: **the shape of what
 * crosses the bridge**, and **the checks that stop a web page choosing that shape**. A
 * `WebContentsView` runs a developer's own app, which is untrusted input in exactly the way a
 * pull request is — it can `executeJavaScript`-adjacent its way into returning anything at all in
 * response to a probe. So the answer is validated here, in one place, rather than trusted
 * wherever it is first read.
 *
 * Pure and dependency-free on purpose, like `zoom.ts`: the parts worth testing cannot be tested
 * if importing them also imports Electron.
 */

export interface CssRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A rectangle in fractions of a viewport or an image, never in pixels. See `BrowserElement`. */
export interface NormRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserElement {
  tag: string;
  id: string;
  classes: string[];
  role: string | null;
  /** Whatever a human would call the element: aria-label, placeholder, title, value, text. */
  name: string;
  /** A short CSS guess. Useful to the agent; not guaranteed to be unique. */
  selector: string;
  /** Up to four levels of ancestors, outermost first. */
  path: string[];
  /** Normalised to the viewport, so it survives zoom and display scaling. */
  rect: NormRect;
}

export interface BrowserState {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** A load that failed outright. A dead pane is otherwise an indistinguishable blank rectangle. */
  error: string | null;
}

export interface BrowserShot {
  /** Raw base64 PNG, no data-URL prefix. */
  data: string;
  width: number;
  height: number;
  url: string;
}

/**
 * The in-page probe. Runs in the pane's own origin, so it reads the DOM with no CORS question.
 *
 * It returns a *rectangle in fractions of the viewport*, not in pixels, and that is the whole
 * reason the click lands where the user aimed: the click happened on a screenshot, whose pixel
 * grid is the display's, and the display is not the page.
 *
 * `elementFromPoint`'s answer is used as-is. An earlier version walked *up* past `body` and
 * `html` looking for something more specific, which sounds like an improvement and is the
 * opposite: a click on empty space is `body`, and climbing turns that honest answer into `html`
 * with the entire page as its bounding box. The deepest element is also the one the user meant.
 */
export function elementProbeScript(fx: number, fy: number): string {
  return `(() => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!vw || !vh) return null;
  const x = Math.min(Math.max(${fx} * vw, 0), vw - 1);
  const y = Math.min(Math.max(${fy} * vh, 0), vh - 1);

  const el = document.elementFromPoint(x, y);
  if (!el) return null;

  const rect = el.getBoundingClientRect();
  const classes = Array.from(el.classList ?? []).filter(Boolean).slice(0, 6);
  const label = (v) => (typeof v === 'string' ? v.replace(/\\s+/g, ' ').trim() : '');

  const name =
    label(el.getAttribute('aria-label')) ||
    label(el.getAttribute('placeholder')) ||
    label(el.getAttribute('alt')) ||
    label(el.getAttribute('title')) ||
    label(el.getAttribute('name')) ||
    label(el.value) ||
    label(el.innerText) ||
    label(el.textContent) ||
    '';

  const short = (node) => {
    let out = node.tagName.toLowerCase();
    if (node.id) out += '#' + node.id;
    const first = Array.from(node.classList ?? []).filter(Boolean)[0];
    if (first) out += '.' + first;
    return out;
  };

  const path = [];
  let walker = el;
  for (let i = 0; walker && i < 4; i += 1) {
    path.unshift(short(walker));
    walker = walker.parentElement;
  }

  return {
    tag: el.tagName.toLowerCase(),
    id: label(el.id),
    classes,
    role: el.getAttribute ? (el.getAttribute('role') || null) : null,
    name: name.slice(0, 200),
    selector: short(el),
    path,
    rect: {
      x: rect.left / vw,
      y: rect.top / vh,
      width: rect.width / vw,
      height: rect.height / vh,
    },
  };
})()`;
}

/**
 * Accept an element description from the pane, or nothing.
 *
 * A page is not obliged to answer with the shape the probe returned — it can shadow
 * `document.elementFromPoint`, or simply be a different page by the time the promise resolves.
 * So every field is re-derived here from what is actually there, and anything without a tag is
 * discarded rather than half-rendered.
 */
export function readElement(raw: unknown): BrowserElement | null {
  if (raw == null || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.tag !== 'string' || row.tag === '') return null;
  const box = row.rect != null && typeof row.rect === 'object' ? (row.rect as Record<string, unknown>) : null;
  return {
    tag: row.tag,
    id: str(row.id),
    classes: strings(row.classes),
    // `null` rather than `''` for anything that is not a role string: the annotator draws a chip
    // per role, and an empty string is a chip with nothing in it.
    role: typeof row.role === 'string' && row.role !== '' ? row.role : null,
    name: str(row.name).slice(0, 200),
    selector: str(row.selector) || row.tag,
    path: strings(row.path),
    rect: {
      x: num(box?.x),
      y: num(box?.y),
      width: num(box?.width),
      height: num(box?.height),
    },
  };
}

/**
 * A rectangle the renderer measured, or nothing.
 *
 * A pane that reports `NaN`, a negative size, or a million-pixel box is a pane covering the
 * whole window and eating every click in it — so the numbers are checked here, where a bad
 * value can still be refused, rather than downstream where it has already been applied.
 *
 * Note the difference from `num` above, and why it matters: a NaN coordinate is *rejected*,
 * not read as zero. Coercing it would snap a misbehaving pane to the top-left corner — a smaller
 * failure than "pane covering everything", but still a wrong answer to give instead of none.
 */
export function readBounds(value: unknown): CssRect | null {
  if (value == null || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const x = row.x;
  const y = row.y;
  const width = row.width;
  const height = row.height;
  if (!isNum(x) || !isNum(y) || !isNum(width) || !isNum(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

function isNum(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function num(value: unknown): number {
  return isNum(value) ? value : 0;
}

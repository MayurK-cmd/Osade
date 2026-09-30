/**
 * The browser pane's own logic — issue #13.
 *
 * Everything here is a pure function of its arguments, and everything here is about *the
 * screenshot*, not the live page. That split is the whole design: the live page is a native
 * `WebContentsView` in the main process, so the renderer never sees it. What the renderer does
 * see is a PNG, and a click on that PNG has to be turned back into "this element, at these
 * normalised coordinates" so the annotator can draw a box an agent can act on.
 */

/** Where the pane opens when the user has not said otherwise. */
export const DEFAULT_BROWSER_URL = 'http://localhost:3000';

export const SHOT_MAX_EDGE = 1600;

export const BROWSER_MIN = 320;
export const BROWSER_MAX = 960;
export const BROWSER_DEFAULT = 520;

/** What the chat keeps, whatever the pane takes. */
const CHAT_FLOOR = 360;

/**
 * The pane may not eat the chat.
 *
 * `BROWSER_DEFAULT` is what you get when nothing has been remembered; the room left over is the
 * ceiling.
 *
 * The unmeasured case is the one worth reading twice. A window that has not been laid out yet
 * reports a width of 0, and because the clamped value is what gets *remembered*, constraining
 * against that would shrink the pane for the rest of the session. An unmeasured window is not a
 * narrow window, so `available` below the chat floor means "do not constrain" rather than
 * "squeeze" — which is also why a genuinely tiny window gets the minimum rather than nothing.
 */
export function clampBrowserWidth(n: number, available: number): number {
  const wanted = Number.isFinite(n) ? n : BROWSER_DEFAULT;
  if (!Number.isFinite(available) || available < CHAT_FLOOR) {
    return Math.min(BROWSER_MAX, Math.max(BROWSER_MIN, wanted));
  }
  // The room is floored at the minimum too: honouring the chat floor is best-effort, and a
  // window too narrow for both is a window the user closes the pane in.
  const room = Math.max(BROWSER_MIN, Math.min(BROWSER_MAX, available - CHAT_FLOOR));
  return Math.min(room, Math.max(BROWSER_MIN, wanted));
}

/**
 * Turn what someone typed in the URL bar into something loadable.
 *
 * `example.com` is what a person types; `https://example.com` is what Chromium wants. Anything
 * that already names a scheme is left alone so `http://localhost:3000` — the common case, and
 * the one where guessing https would break it — is not rewritten into something that refuses to
 * connect.
 */
export function normaliseUrl(input: string): string {
  const raw = input.trim();
  if (raw === '') return DEFAULT_BROWSER_URL;
  // Checked before the scheme test, and not as an afterthought: `localhost:5173` matches
  // `/^[a-z][a-z0-9+.-]*:/` as a scheme called `localhost`, and handing that to Chromium fails
  // with a bare "not a valid URL" — the one URL this pane exists to open.
  if (/^localhost(?::\d+)?(?:[/?#]|$)/iu.test(raw)) return `http://${raw}`;
  if (/^[a-z][a-z0-9+.-]*:/iu.test(raw)) return raw;
  if (/^[\w-]+(?:\.[\w-]+)+(?::\d+)?(?:[/?#]|$)/u.test(raw)) return `https://${raw}`;
  return `http://${raw}`;
}

/** A short, human-facing name for an element: `button#save.primary`. */
export function elementLabel(element: {
  selector?: string;
  tag?: string;
  id?: string;
  classes?: readonly string[];
}): string {
  const tag = element.tag ?? 'element';
  if (element.selector && element.selector !== '') return element.selector;
  const id = element.id && element.id !== '' ? `#${element.id}` : '';
  const cls = element.classes?.[0] ? `.${element.classes[0]}` : '';
  return `${tag}${id}${cls}`;
}

/** One line about what was clicked, for the annotator's footer. */
export function elementSummary(element: {
  selector?: string;
  tag?: string;
  id?: string;
  classes?: readonly string[];
  name?: string;
  path?: readonly string[];
}): string {
  const label = elementLabel(element);
  const where = element.path && element.path.length > 1 ? ` in ${element.path.at(-2)}` : '';
  const name = (element.name ?? '').replace(/\s+/gu, ' ').trim();
  return name === '' ? `${label}${where}` : `${label}${where} — “${name}”`;
}

/**
 * The note that goes into the composer alongside the image.
 *
 * Osade ships no model — it drives agent CLIs in a terminal, so there is no vision payload to
 * put an image into. The image travels the way every other image already does: written to
 * `~/.osade/inbox/<task>/` and referenced by path (`taskDropImages` → `photosPrompt`), which
 * every supported agent can open. This text is what makes that path *mean* something: without the
 * URL and the element, a screenshot in an inbox is a picture of an unknown page.
 */
export function browserShotContext(url: string, element: BrowserElementLike | null): string {
  const where = url.trim() === '' ? 'the browser pane' : url.trim();
  if (element == null) {
    return `[Browser view] Screenshot of ${where}. No element was selected.`;
  }
  const label = elementLabel(element);
  const name = (element.name ?? '').replace(/\s+/gu, ' ').trim();
  const described = name === '' ? label : `${label} — “${name}”`;
  const chain = element.path && element.path.length > 1 ? `\nPath: ${element.path.join(' > ')}` : '';
  return [
    `[Browser view] Screenshot of ${where}.`,
    `The highlighted box is ${described}.${chain}`,
    'The image is attached to this message. Open it and look before changing anything.',
  ].join('\n');
}

/** The subset of a probed element this module needs. Structural, so tests need no DOM. */
export interface BrowserElementLike {
  tag?: string;
  id?: string;
  classes?: readonly string[];
  name?: string;
  selector?: string;
  path?: readonly string[];
  rect?: { x: number; y: number; width: number; height: number };
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A click on the screenshot, in fractions of the image.
 *
 * Normalised rather than pixels because the image is in device pixels and the page is not: at
 * 150% display scaling a click at image x=900 is page x=600, and getting that wrong is the
 * difference between tagging the button the user aimed at and tagging its neighbour.
 */
export function clickFraction(
  click: { x: number; y: number },
  image: Box,
): { x: number; y: number } {
  if (image.width <= 0 || image.height <= 0) return { x: 0, y: 0 };
  return {
    x: clamp01((click.x - image.x) / image.width),
    y: clamp01((click.y - image.y) / image.height),
  };
}

/** A probed element's normalised rect, as a box in fractions of the image. */
export function boxOf(element: BrowserElementLike): Box | null {
  const rect = element.rect;
  if (rect == null) return null;
  const width = clamp01(rect.width);
  const height = clamp01(rect.height);
  if (width <= 0 || height <= 0) return null;
  return {
    x: clamp01(rect.x),
    y: clamp01(rect.y),
    width: Math.min(width, 1 - clamp01(rect.x)),
    height: Math.min(height, 1 - clamp01(rect.y)),
  };
}

/** A normalised box, in the pixels of a box drawn at `width` × `height`. */
export function boxToPixels(box: Box, size: { width: number; height: number }): Box {
  return {
    x: box.x * size.width,
    y: box.y * size.height,
    width: box.width * size.width,
    height: box.height * size.height,
  };
}

/**
 * The size the annotated image is stored at.
 *
 * A 4K pane captures to several megabytes, and the daemon refuses anything over 8 MB per photo
 * (`chat-photos.ts`) — so a capture that is fine to look at can still be too big to send. Capping
 * the long edge keeps a full-pane capture comfortably inside the limit on any display, at a
 * resolution where a highlighted button is still readable.
 */
export function fittedSize(size: { width: number; height: number }): { width: number; height: number } {
  const longest = Math.max(size.width, size.height);
  if (longest <= SHOT_MAX_EDGE || longest <= 0) return { width: size.width, height: size.height };
  const scale = SHOT_MAX_EDGE / longest;
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}

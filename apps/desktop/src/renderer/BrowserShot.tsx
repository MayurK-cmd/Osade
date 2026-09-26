import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { createPortal } from 'react-dom';

import type { BrowserElement, BrowserShot } from '../main/browser-contract.js';

import {
  boxOf,
  boxToPixels,
  browserShotContext,
  clickFraction,
  elementSummary,
  fittedSize,
  type Box,
} from './browser-view.js';
import { composeAppend, composeAppendPhoto } from './compose-event.js';

export interface ShotDraft {
  image: BrowserShot;
  url: string;
}

const HIGHLIGHT = '#58a6ff';
const LABEL_BG = 'rgba(15, 18, 20, 0.88)';

/**
 * Screenshot, then click what you mean.
 *
 * Two things make this more than a file dialog. First, the click: the PNG is in *device* pixels
 * and the page is not, so the click is converted to a fraction of the image, sent to the pane, and
 * answered with the element's own rect — also a fraction — which is what the box is drawn from.
 * Scaling it in CSS pixels instead would be right on a 1× display and off by a third of a button
 * on a 150% one.
 *
 * Second, the annotated image is *composed here*, in a canvas, rather than re-captured in main.
 * One capture, one decode, and the box the user sees is provably the box in the file.
 *
 * Portalled to `document.body` because the pane is a column: a screenshot reviewed inside a
 * 480px column is not a screenshot anyone can read. The pane detaches its native view while this
 * is open, or the page would paint over the top of it.
 */
export function BrowserShotOverlay({
  shot,
  url,
  onClose,
  onRetake,
}: {
  shot: BrowserShot;
  url: string;
  onClose: () => void;
  onRetake: () => void;
}): JSX.Element | null {
  const imageRef = useRef<HTMLImageElement>(null);
  const [image, setImage] = useState<{ width: number; height: number; src: string } | null>(null);
  const [picked, setPicked] = useState<BrowserElement | null>(null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState<Box | null>(null);
  const bridge = window.osade?.browser;

  const source = `data:image/png;base64,${shot.data}`;

  useEffect(() => {
    let live = true;
    const probe = new Image();
    probe.onload = () => {
      if (!live) return;
      setImage({ width: probe.naturalWidth, height: probe.naturalHeight, src: source });
    };
    probe.onerror = () => {
      if (live) setError('the screenshot could not be decoded');
    };
    probe.src = source;
    return () => {
      live = false;
    };
  }, [source]);

  const imageBox = useCallback((): Box | null => {
    const el = imageRef.current;
    if (el == null) return null;
    const box = el.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return null;
    return { x: box.left, y: box.top, width: box.width, height: box.height };
  }, []);

  async function pick(event: ReactMouseEvent<HTMLImageElement>): Promise<void> {
    const box = imageBox();
    if (box == null || bridge == null) return;
    const at = clickFraction({ x: event.clientX, y: event.clientY }, box);
    setPicking(true);
    setError(null);
    try {
      const element = await bridge.element(at.x, at.y);
      if (element == null) {
        setPicked(null);
        setError('nothing selectable at that point');
        return;
      }
      setPicked(element);
      setLabel(chipAt(box, element));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPicking(false);
    }
  }

  /**
   * Where the `<tag>` chip goes: just above the box, or on it when there is no room above.
   *
   * Viewport coordinates, because the chip is `position: fixed`. `boxToPixels` only *scales* —
   * it knows nothing about where the image sits on screen — so the image's origin has to be added
   * here. Getting that wrong puts the chip at the window's left edge while the box it names is
   * drawn correctly in the middle, which is the kind of bug that looks like a layout accident
   * rather than a missing offset.
   */
  function chipAt(box: Box, element: BrowserElement): Box | null {
    const found = boxOf(element);
    if (found == null) return null;
    const target = boxToPixels(found, box);
    const left = box.x + target.x;
    const top = box.y + target.y;
    const above = top - 22;
    return {
      x: left,
      y: above >= box.y ? above : top,
      width: target.width,
      height: target.height,
    };
  }

  /**
   * The box, in the image's own coordinates.
   *
   * Drawn inside the relatively-positioned wrapper around the `<img>`, so this one is
   * deliberately *not* offset by where the image is — only scaled.
   */
  function outlineBoxIn(): Box | null {
    const frame = imageBox();
    if (frame == null || picked == null) return null;
    const found = boxOf(picked);
    return found == null ? null : boxToPixels(found, frame);
  }

  async function attach(): Promise<void> {
    const el = imageRef.current;
    const box = imageBox();
    if (el == null || image == null || box == null) return;
    setError(null);
    try {
      const data = await drawShot(source, image, picked);
      // One id per capture, so re-adding the same screenshot is a second chip rather than a
      // silent no-op — the composer's dedupe is on id, and a fixed name would collapse them.
      const id = `browser-view-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      composeAppendPhoto({
        id,
        name: 'browser-view.png',
        mime: 'image/png',
        data,
        preview: `data:image/png;base64,${data}`,
      });
      composeAppend(browserShotContext(url, picked));
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const target = createPortal(
    <div
      role="dialog"
      aria-label="Screenshot"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        background: 'rgba(8, 10, 12, 0.86)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20,
        }}
      >
        {image == null ? (
          <p className="mono" style={{ color: 'var(--ink-2)', fontSize: 'var(--t-s)' }}>
            {error ?? 'Decoding the screenshot…'}
          </p>
        ) : (
          <div style={{ position: 'relative', maxWidth: '100%', maxHeight: '100%', lineHeight: 0 }}>
            <img
              ref={imageRef}
              src={source}
              alt="Screenshot of the browser pane"
              onClick={(event) => {
                event.stopPropagation();
                void pick(event);
              }}
              style={{
                maxWidth: '100%',
                maxHeight: 'calc(100vh - 140px)',
                objectFit: 'contain',
                border: '0.5px solid var(--line)',
                cursor: picking ? 'progress' : 'crosshair',
                display: 'block',
              }}
            />
            {outlineBox(outlineBoxIn())}
            {label != null && picked != null && (
              <span
                className="mono"
                style={{
                  position: 'fixed',
                  left: label.x,
                  top: label.y,
                  maxWidth: 320,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontSize: 'var(--t-xs)',
                  lineHeight: '18px',
                  padding: '0 6px',
                  color: HIGHLIGHT,
                  background: LABEL_BG,
                  border: `1px solid ${HIGHLIGHT}`,
                  borderRadius: 'var(--radius)',
                  pointerEvents: 'none',
                }}
              >
                {elementLabelFor(picked)}
              </span>
            )}
          </div>
        )}
      </div>

      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px',
          borderTop: '0.5px solid var(--line)',
          background: 'var(--bg-1)',
          minHeight: 52,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="mono" style={{ fontSize: 'var(--t-xs)', color: 'var(--ink-3)' }}>
            {url === '' ? 'the browser pane' : url}
          </div>
          <div style={{ fontSize: 'var(--t-s)', color: picked == null ? 'var(--ink-2)' : 'var(--ink)' }}>
            {picked == null
              ? 'Click the thing you mean. It is boxed and named, and the agent is told which.'
              : elementSummary(picked)}
          </div>
        </div>
        {error != null && (
          <span className="mono" style={{ fontSize: 'var(--t-xs)', color: 'var(--st-fail)', maxWidth: 260 }}>
            {error}
          </span>
        )}
        <button onClick={onRetake}>Retake</button>
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={image == null} onClick={() => void attach()}>
          Add to chat
        </button>
      </div>
    </div>,
    document.body,
  );

  return target;
}

function outlineBox(box: Box | null): JSX.Element | null {
  if (box == null) return null;
  return (
    <span
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.height,
        border: `2px solid ${HIGHLIGHT}`,
        boxShadow: '0 0 0 9999px rgba(8, 10, 12, 0.32)',
        pointerEvents: 'none',
      }}
    />
  );
}

function elementLabelFor(element: BrowserElement): string {
  const base = element.selector !== '' ? element.selector : element.tag;
  const chain = element.path.slice(-2, -1)[0];
  return chain == null ? base : `${base}  ·  ${chain}`;
}

/**
 * Compose the image that actually gets sent: the capture, plus the box, plus a name for it.
 *
 * Drawn at the capture's own resolution, then scaled to fit. The long edge is capped because the
 * daemon refuses a photo over 8 MB, and a 4K pane capture is over it — an annotator that cannot
 * be sent is worse than one that is slightly soft.
 */
async function drawShot(
  source: string,
  size: { width: number; height: number },
  element: BrowserElement | null,
): Promise<string> {
  const fitted = fittedSize(size);
  const bitmap = await loadImage(source);
  const canvas = document.createElement('canvas');
  canvas.width = fitted.width;
  canvas.height = fitted.height;
  const ctx = canvas.getContext('2d');
  if (ctx == null) throw new Error('this machine cannot annotate the screenshot');
  ctx.drawImage(bitmap, 0, 0, fitted.width, fitted.height);

  if (element != null) {
    const found = boxOf(element);
    if (found != null) {
      const target = boxToPixels(found, fitted);
      const line = Math.max(2, Math.round(fitted.width / 600));
      ctx.lineWidth = line;
      ctx.strokeStyle = HIGHLIGHT;
      ctx.strokeRect(
        target.x + line / 2,
        target.y + line / 2,
        Math.max(0, target.width - line),
        Math.max(0, target.height - line),
      );
      const text = elementLabelFor(element);
      ctx.font = `${Math.max(11, Math.round(fitted.width / 70))}px ui-monospace, monospace`;
      const padX = 6;
      const height = Math.max(18, Math.round(fitted.width / 70) + 8);
      const width = Math.min(ctx.measureText(text).width + padX * 2, fitted.width);
      const above = target.y - height - 2;
      const y = above >= 0 ? above : Math.min(target.y + target.height + 2, fitted.height - height);
      ctx.fillStyle = 'rgba(15, 18, 20, 0.88)';
      ctx.fillRect(target.x, y, width, height);
      ctx.strokeStyle = HIGHLIGHT;
      ctx.lineWidth = 1;
      ctx.strokeRect(target.x + 0.5, y + 0.5, width - 1, height - 1);
      ctx.fillStyle = HIGHLIGHT;
      ctx.textBaseline = 'middle';
      ctx.fillText(text, target.x + padX, y + height / 2, Math.max(0, width - padX * 2));
    }
  }

  const out = canvas.toDataURL('image/png');
  const comma = out.indexOf(',');
  return comma >= 0 ? out.slice(comma + 1) : out;
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('the screenshot could not be decoded'));
    img.src = source;
  });
}

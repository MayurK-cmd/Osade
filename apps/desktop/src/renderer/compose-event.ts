import type { ComposerPhoto } from './compose-photos.js';

export const COMPOSE_EVENT = 'osade:compose';

/** The browser pane's "Add to chat" — issue #13. */
export const COMPOSE_PHOTO_EVENT = 'osade:compose-photo';

export function composeAppend(text: string): void {
  window.dispatchEvent(new CustomEvent(COMPOSE_EVENT, { detail: text }));
}

/**
 * Drop a photo into whichever composer is on screen.
 *
 * A window event rather than a prop, for the same reason `composeAppend` is one: the thing taking
 * the screenshot is not an ancestor of the thing that sends the message, and threading a
 * `pendingPhoto` through `App` → `Detail` → `Composer` to say "here is an image" would couple the
 * browser pane to the whole chat surface for no benefit.
 */
export function composeAppendPhoto(photo: ComposerPhoto): void {
  window.dispatchEvent(new CustomEvent<ComposerPhoto>(COMPOSE_PHOTO_EVENT, { detail: photo }));
}

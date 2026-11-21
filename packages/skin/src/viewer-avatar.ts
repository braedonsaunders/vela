// The viewer's avatar over their initial (#33). Any text that is exactly `{env.viewerInitial}` is a
// skin's viewer badge, and where the server gives the viewer a picture the renderer draws it over the
// badge, clipped to the badge's own shape. Only a badge that sizes itself (a width and a height of
// its own) takes the picture: an initial that is a bare letter inside some other box stays a letter.
import type { Css } from './translate';

/** The picture to draw over a viewer badge, or '' to leave the initial alone. */
export function viewerAvatarFor(avatar: boolean | undefined, own: Css, url: string | undefined): string {
  if (!avatar || !url) return '';
  return own.width !== undefined && own.height !== undefined ? url : '';
}

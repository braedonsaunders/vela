// YouTube trailers played by the client in YouTube's privacy-enhanced embed (features.trailerEmbed,
// Extra.clientPlayback). Everything here is pure: which extras embed on which platforms, the one URL
// shape accepted, the player URL a view loads, YouTube's embed messages, and the host page a native
// web view draws the embed in. The server-played extra (`availability`) stays the fallback.
import type * as V from './wire';

/** The only origin a trailer embed loads from outside a mock build. */
export const YOUTUBE_EMBED_ORIGIN = 'https://www.youtube-nocookie.com';
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
/** How long an embed may stay silent (no player message) before the server-played extra takes over. */
export const EMBED_START_TIMEOUT_MS = 15_000;
/** The identity a native host page loads under: YouTube asks web-view clients to name their app this way. */
export const NATIVE_EMBED_HOST = 'app.ether.vela';

/** A trailer the client plays itself: YouTube's privacy-enhanced player for one video. */
export interface TrailerEmbed { provider: 'youtube'; videoId: string }

export function isYoutubeVideoId(value: unknown): value is string {
  return typeof value === 'string' && VIDEO_ID.test(value);
}

/** `https://www.youtube-nocookie.com/embed/<id>`: the exact URL the server must send. */
export function youtubeEmbedUrl(videoId: string): string {
  return `${YOUTUBE_EMBED_ORIGIN}/embed/${videoId}`;
}

/** The wire `clientPlayback` when it names exactly YouTube's nocookie embed of a valid id; null refuses it. */
export function acceptClientPlayback(value: unknown): TrailerEmbed | null {
  if (!value || typeof value !== 'object') return null;
  const { provider, videoId, embedUrl } = value as Record<string, unknown>;
  if (provider !== 'youtube' || !isYoutubeVideoId(videoId) || embedUrl !== youtubeEmbedUrl(videoId)) return null;
  return { provider: 'youtube', videoId };
}

/** Phones, tablets, browsers and the desktop apps (which run the web build) embed. TVs never do: Apple TV
 * has no web view, and a remote does not drive YouTube's player. */
export function platformEmbedsTrailers(platform: { os: string; isTV: boolean }): boolean {
  if (platform.isTV) return false;
  return platform.os === 'web' || platform.os === 'ios' || platform.os === 'android';
}

/** The owner lets clients embed: available, in `clientWhenPossible` mode. Absent (an older server) is no. */
export function serverAllowsTrailerEmbed(feature: V.TrailerEmbedFeature | undefined): boolean {
  return feature?.available === true && feature.mode === 'clientWhenPossible';
}

/** The server plays this extra (features.extraPlayback; trailers only, unless it says it is unavailable). */
export function serverPlaysExtra(extra: Pick<V.Extra, 'kind' | 'availability'>, extraPlayback: boolean): boolean {
  return extraPlayback && extra.kind === 'trailer' && extra.availability !== 'unavailable';
}

/** How one extra plays here: in the embed (with the server's extra as the fallback, when it has one), on
 * the server, or not at all. `embeds` is the platform and the server together (trailerEmbedAllowed). */
export type ExtraPlayback =
  | { kind: 'embed'; embed: TrailerEmbed; fallback: boolean }
  | { kind: 'server' }
  | { kind: 'none' };

export function extraPlayback(extra: Pick<V.Extra, 'kind' | 'availability' | 'clientPlayback'>, options: { embeds: boolean; extraPlayback: boolean }): ExtraPlayback {
  const server = serverPlaysExtra(extra, options.extraPlayback);
  const embed = options.embeds ? acceptClientPlayback(extra.clientPlayback) : null;
  if (embed) return { kind: 'embed', embed, fallback: server };
  return server ? { kind: 'server' } : { kind: 'none' };
}

/** This platform may embed and the server allows it. */
export function trailerEmbedAllowed(platformEmbeds: boolean, feature: V.TrailerEmbedFeature | undefined): boolean {
  return platformEmbeds && serverAllowsTrailerEmbed(feature);
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '10.0.2.2']);

/** A mock build's stand-in for YouTube's origin: plain loopback (or the Android emulator's host alias)
 * only, so even a misconfigured release could never point the embed at another site. */
export function acceptEmbedOriginOverride(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !LOOPBACK.has(url.hostname)) return null;
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
  return url.origin;
}

/** The URL the embed loads: the nocookie embed (or a mock's stand-in) with autoplay, no other channels'
 * suggestions, inline on phones, and YouTube's message API reporting to `parentOrigin` only. */
export function embedPlayerUrl(embed: TrailerEmbed, parentOrigin: string, embedOrigin: string = YOUTUBE_EMBED_ORIGIN): string {
  if (!isYoutubeVideoId(embed.videoId)) throw new Error('Invalid YouTube video id');
  const params = new URLSearchParams({ autoplay: '1', rel: '0', playsinline: '1', enablejsapi: '1', origin: parentOrigin });
  return `${embedOrigin}/embed/${embed.videoId}?${params}`;
}

/** The frame a native web view may load: the player's origin and path, nothing else. */
export function embedFrameUrl(playerUrl: string): string {
  const url = new URL(playerUrl);
  return `${url.origin}${url.pathname}`;
}

/** Where a native host page loads from: an https identity for YouTube (its Referer and message origin),
 * plain http only beside a mock's plain-http stand-in, which an https page could not frame. */
export function nativeEmbedHostOrigin(embedOrigin: string = YOUTUBE_EMBED_ORIGIN): string {
  return `${embedOrigin.startsWith('http:') ? 'http' : 'https'}://${NATIVE_EMBED_HOST}`;
}

/** What the player said, from YouTube's embed message API (enablejsapi=1). */
export type EmbedSignal =
  | { kind: 'ready' }
  | { kind: 'state'; state: number }
  | { kind: 'error'; code: number };

/** YouTube's player states: ended 0, playing 1. */
export const EMBED_ENDED = 0;
export const EMBED_PLAYING = 1;

/** The message a parent sends until the player answers, so it reports its events to the parent. */
export const EMBED_LISTENING = JSON.stringify({ event: 'listening', id: 1, channel: 'widget' });

/** One message from the embed, read strictly; anything else is ignored (null). */
export function parseEmbedMessage(data: unknown): EmbedSignal | null {
  if (typeof data !== 'string' || data.length > 65_536) return null;
  let message: unknown;
  try { message = JSON.parse(data); } catch { return null; }
  if (!message || typeof message !== 'object') return null;
  const { event, info } = message as { event?: unknown; info?: unknown };
  if (event === 'onError') return { kind: 'error', code: typeof info === 'number' && Number.isFinite(info) ? info : -1 };
  if (event === 'onStateChange' && typeof info === 'number') return { kind: 'state', state: info };
  if (event === 'infoDelivery' && info && typeof info === 'object' && typeof (info as { playerState?: unknown }).playerState === 'number') {
    return { kind: 'state', state: (info as { playerState: number }).playerState };
  }
  if (event === 'onReady' || event === 'initialDelivery' || event === 'infoDelivery' || event === 'apiInfoDelivery') return { kind: 'ready' };
  return null;
}

/** Where an embed has got to: still starting, up (the player answered), or done (ended or failed). */
export type EmbedPhase = 'starting' | 'ready' | 'ended' | 'failed';

/** The next phase after a signal: an error at any point fails (the server's extra takes over), the end
 * closes, and any other answer means the player is up. A finished embed stays finished. */
export function nextEmbedPhase(phase: EmbedPhase, signal: EmbedSignal): EmbedPhase {
  if (phase === 'ended' || phase === 'failed') return phase;
  if (signal.kind === 'error') return 'failed';
  if (signal.kind === 'state' && signal.state === EMBED_ENDED && phase === 'ready') return 'ended';
  return 'ready';
}

/** What the watch surface does in a phase: keep the embed, hand over to the server's extra, say the trailer
 * cannot play (the embed failed and the server cannot play it: no spinner, no server start), or close. */
export type EmbedOutcome = 'embed' | 'server' | 'unavailable' | 'close';

export function embedOutcome(phase: EmbedPhase, fallback: boolean): EmbedOutcome {
  if (phase === 'ended') return 'close';
  if (phase === 'failed') return fallback ? 'server' : 'unavailable';
  return 'embed';
}

/** An extra offered for the client embed that plays nowhere on this device (a TV, when the server cannot
 * play it either): not offered at all, rather than listed as unavailable. */
export function hiddenExtra(extra: Pick<V.Extra, 'clientPlayback'>, playback: ExtraPlayback): boolean {
  return playback.kind === 'none' && extra.clientPlayback !== undefined;
}

function htmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The page a native web view loads at nativeEmbedHostOrigin(): the player in a full-size frame, and a
 * script that asks it for events and passes its messages (from the player's own frame and origin only)
 * to the app's bridge (WKScriptMessageHandler `velaEmbed` on iOS, the `VelaEmbed` interface on Android). */
export function nativeEmbedPage(playerUrl: string): string {
  const origin = new URL(playerUrl).origin;
  const script = `(function(){var f=document.getElementById('player'),o=${JSON.stringify(origin).replace(/</g, '\\u003c')},heard=false;
function send(d){try{if(window.webkit&&window.webkit.messageHandlers&&window.webkit.messageHandlers.velaEmbed)window.webkit.messageHandlers.velaEmbed.postMessage(d);else if(window.VelaEmbed)window.VelaEmbed.postMessage(d);}catch(e){}}
window.addEventListener('message',function(e){if(e.origin!==o||e.source!==f.contentWindow||typeof e.data!=='string')return;heard=true;send(e.data);});
var t=setInterval(function(){if(heard){clearInterval(t);return;}try{f.contentWindow.postMessage(${JSON.stringify(EMBED_LISTENING)},o);}catch(e){}},250);})();`;
  return '<!doctype html><html><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">'
    + '<meta name="referrer" content="strict-origin-when-cross-origin">'
    + '<style>html,body{margin:0;width:100%;height:100%;background:#000;overflow:hidden}iframe{position:absolute;top:0;left:0;width:100%;height:100%;border:0}</style>'
    + `</head><body><iframe id="player" src="${htmlAttribute(playerUrl)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`
    + `<script>${script}</script></body></html>`;
}

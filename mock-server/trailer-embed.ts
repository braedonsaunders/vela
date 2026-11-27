// YouTube trailers in the client embed (features.trailerEmbed, Extra.clientPlayback), and a stand-in for
// YouTube's privacy-enhanced player so tests never load youtube.com.
//
// VELA_MOCK_TRAILER_EMBED: `clientWhenPossible` (the default), `server`, or `off` (not advertised, as an
// older server). POST /__admin/trailer-embed {mode, player, errorCode} changes it at run time; GET reads it.
// `player` is what the stand-in does: `play` (ready, playing), `error` (ready, then onError errorCode, as a
// video whose owner refused embedding), or `silent` (never answers: the client's start timeout).
// VELA_MOCK_YOUTUBE_VIDEO_ID: another video id for the fixture's YouTube trailer (a real one, for a manual
// check against YouTube itself).
//
// GET /embed/:id is the stand-in, at the mock's own origin. A client points its embed origin here only in
// a mock build (apps/vela/src/trailer-embed-origin.ts); the server's clientPlayback always names YouTube.
import type * as V from '../packages/protocol/types';

export type TrailerEmbedMode = V.TrailerEmbedMode | 'off';
export type EmbedPlayer = 'play' | 'error' | 'silent';
export interface TrailerEmbedAdmin { mode: TrailerEmbedMode; player: EmbedPlayer; errorCode: number }

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const MODES: TrailerEmbedMode[] = ['clientWhenPossible', 'server', 'off'];
const PLAYERS: EmbedPlayer[] = ['play', 'error', 'silent'];

function initialMode(): TrailerEmbedMode {
  const value = process.env.VELA_MOCK_TRAILER_EMBED as TrailerEmbedMode | undefined;
  return value && MODES.includes(value) ? value : 'clientWhenPossible';
}

const defaults = (): TrailerEmbedAdmin => ({ mode: initialMode(), player: 'play', errorCode: 150 });
export const trailerEmbed: TrailerEmbedAdmin = defaults();

/** The capability as advertised: absent when `off`. */
export function trailerEmbedFeature(): V.TrailerEmbedFeature | undefined {
  if (trailerEmbed.mode === 'off') return undefined;
  return { available: true, mode: trailerEmbed.mode };
}

/** POST /__admin/trailer-embed: change what is set (unknown values are ignored); `{reset: true}` restores the start state. */
export function trailerEmbedAdmin(body: Record<string, unknown>): TrailerEmbedAdmin {
  if (body.reset === true) Object.assign(trailerEmbed, defaults());
  if (MODES.includes(body.mode as TrailerEmbedMode)) trailerEmbed.mode = body.mode as TrailerEmbedMode;
  if (PLAYERS.includes(body.player as EmbedPlayer)) trailerEmbed.player = body.player as EmbedPlayer;
  if (Number.isInteger(body.errorCode) && (body.errorCode as number) >= 0 && (body.errorCode as number) < 1000) trailerEmbed.errorCode = body.errorCode as number;
  return { ...trailerEmbed };
}

/** An extra as Ether sends it: `clientPlayback` only while the owner allows client embeds. */
export function servedExtra(extra: V.Extra): V.Extra {
  const { clientPlayback, ...rest } = extra;
  if (!clientPlayback || trailerEmbed.mode !== 'clientWhenPossible') return rest;
  const override = process.env.VELA_MOCK_YOUTUBE_VIDEO_ID;
  const videoId = override && VIDEO_ID.test(override) ? override : clientPlayback.videoId;
  return { ...rest, clientPlayback: { provider: 'youtube', videoId, embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}` } };
}

export function servedExtras<T extends { extras: V.Extra[] }>(detail: T): T {
  return { ...detail, extras: detail.extras.map(servedExtra) };
}

function escape(value: string): string {
  return value.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
}

/** GET /embed/:id: a silent stand-in for YouTube's embed. It answers the embed message API the way YouTube
 * does (to the `origin` query parameter, after the parent's `listening`), and shows what it was asked. */
export function embedStub(url: URL): Response {
  const id = /^\/embed\/([^/]+)$/.exec(url.pathname)?.[1] ?? '';
  if (!VIDEO_ID.test(id)) return new Response('Not found', { status: 404 });
  const origin = url.searchParams.get('origin') ?? '';
  const params = [...url.searchParams].map(([key, value]) => `${key}=${value}`).join(' · ');
  const config = JSON.stringify({ origin, player: trailerEmbed.player, errorCode: trailerEmbed.errorCode }).replace(/</g, '\\u003c');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>YouTube embed stand-in</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;height:100%;background:#0f0f0f;color:#f1f1f1;font:15px system-ui,sans-serif;overflow:hidden}
main{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center;padding:0 24px;box-sizing:border-box}
.mark{width:68px;height:48px;border-radius:12px;background:#f00;display:flex;align-items:center;justify-content:center}
.mark:after{content:'';border-style:solid;border-width:10px 0 10px 18px;border-color:transparent transparent transparent #fff}
small{color:#aaa;max-width:100%;overflow-wrap:anywhere}</style></head>
<body><main data-video="${escape(id)}" data-player="${escape(trailerEmbed.player)}"><div class="mark"></div>
<strong>YouTube embed stand-in</strong><span id="state">${escape(id)} · waiting</span><small>${escape(params)}</small></main>
<script>(function(){var c=${config},sent=false,state=document.getElementById('state');
function post(m){if(!c.origin)return;try{parent.postMessage(JSON.stringify(Object.assign({id:1,channel:'widget'},m)),c.origin)}catch(e){}}
addEventListener('message',function(e){var d;try{d=JSON.parse(e.data)}catch(x){return}
if(!d||d.event!=='listening'||sent||c.player==='silent')return;sent=true;
post({event:'initialDelivery',info:{playerState:-1}});post({event:'onReady'});
if(c.player==='error'){state.textContent=${JSON.stringify(id)}+' · error '+c.errorCode;post({event:'onError',info:c.errorCode});return}
state.textContent=${JSON.stringify(id)}+' · playing';post({event:'onStateChange',info:1});post({event:'infoDelivery',info:{playerState:1}});});})();</script>
</body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

import { afterAll, expect, test } from 'bun:test';
import { createHostContext } from '../web/engine/host/context';
import { activateSource } from '../web/engine/host/media';
import { detachMedia } from '../web/engine/host/native-events';
import { publishHostState } from '../web/engine/host/events';
import type { EngineEvent, PlaybackSession, Source } from '../web/engine/model';

const page = globalThis as Record<string, unknown>;
const added = Object.entries({ document: { fullscreenEnabled: false, pictureInPictureEnabled: false }, isSecureContext: false })
  .filter(([name]) => !(name in page)).map(([name, value]) => { page[name] = value; return name; });
afterAll(() => { for (const name of added) delete page[name]; });

/** A <video> that loads a file's metadata as soon as it is given one and fires `seeked` only after a seek. */
function video() {
  const element = Object.assign(new EventTarget(), {
    currentTime: 0, duration: 6555, videoWidth: 0, videoHeight: 0, readyState: 0, paused: true, seeking: false, error: null,
    playbackRate: 1, volume: 1, muted: true, buffered: { length: 0 }, attributes: new Set<string>(),
    hasAttribute(name: string) { return element.attributes.has(name); },
    removeAttribute(name: string) { element.attributes.delete(name); element.readyState = 0; },
    pause() { element.paused = true; },
    load() {},
    canPlayType: () => 'probably',
  });
  Object.defineProperty(element, 'src', {
    set() {
      element.attributes.add('src');
      setTimeout(() => { element.readyState = 4; element.dispatchEvent(new Event('loadedmetadata')); });
    },
  });
  return element;
}

const file: Source = { id: 'direct', strategy: 'direct', delivery: 'file', url: 'https://media.example/film.mp4', mime: 'video/mp4',
  edition: '', timeline: '1', original: false, renditions: [] } as unknown as Source;
const session = { id: 'vela-1', serverState: 'paused', serverControlled: true, selectedSourceId: 'direct', mediaId: '1', edition: '',
  position: 0, duration: 6555, live: false, sourceGeneration: 1, seekGeneration: 2, audioTracks: [], subtitleTracks: [], chapters: [],
  sources: [file] } as unknown as PlaybackSession;

// Start Over on a paused title: the server's plan for the seek to 0 opens the source again at 0. The fresh
// media is already there, so nothing assigns currentTime and the video never fires `seeked`. The report is
// delivered at once, also when the last one went out shortly before (the session may end before the next).
test.each([['no recent report', Infinity], ['a report 150 ms ago', 150]])('a paused Start Over that needs no media seek reports paused at zero, not buffering (%s)', async (_, since) => {
  const events: EngineEvent[] = [];
  const v = video();
  const host = createHostContext(v as never, event => events.push(event), v as never, false, undefined, {} as never);
  clearInterval(host.lifecycle.timer);
  host.lifecycle.timer = undefined;
  try {
    host.session.controller.start(session.id, 1, 2);
    host.session.current = session;
    host.playback.wantsPlay = false;
    host.session.pendingSeek = { position: 0, startedAt: performance.now(), authorized: true };
    host.telemetry.lastObservation = performance.now() - since;
    await activateSource(host, file, 0);
    const last = events.filter(e => e.type === 'snapshot').at(-1);
    expect(last).toMatchObject({ type: 'snapshot', snapshot: { state: 'paused', position: 0 } });
    expect(host.session.pendingSeek).toBeUndefined();
  } finally {
    if (host.watchdog.startTimer) clearTimeout(host.watchdog.startTimer);
    detachMedia(host);
  }
});

// A paused open at a later position assigns currentTime; the authorised seek ends with `seeked`, as before.
test('a paused open that seeks the media still waits for the seek to land', async () => {
  const events: EngineEvent[] = [];
  const v = video();
  const host = createHostContext(v as never, event => events.push(event), v as never, false, undefined, {} as never);
  clearInterval(host.lifecycle.timer);
  host.lifecycle.timer = undefined;
  try {
    host.session.controller.start(session.id, 1, 2);
    host.session.current = { ...session, position: 90 } as PlaybackSession;
    host.playback.wantsPlay = false;
    host.session.pendingSeek = { position: 90, startedAt: performance.now(), authorized: true };
    let time = 0;
    Object.defineProperty(v, 'currentTime', { get: () => time, set: (value: number) => { time = value; v.seeking = true; } });
    await activateSource(host, file, 90);
    publishHostState(host, true);
    expect(host.session.pendingSeek).toBeDefined();
    expect(events.filter(e => e.type === 'snapshot').at(-1)).toMatchObject({ snapshot: { state: 'buffering' } });
    v.seeking = false;
    v.dispatchEvent(new Event('seeked'));
    expect(host.session.pendingSeek).toBeUndefined();
  } finally {
    if (host.watchdog.startTimer) clearTimeout(host.watchdog.startTimer);
    detachMedia(host);
  }
});

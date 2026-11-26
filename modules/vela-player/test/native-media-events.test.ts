import { expect, test } from 'bun:test';
import type { EngineEvent } from '../web/engine/model';
import { createHostContext } from '../web/engine/host/context';
import { bindMedia, detachMedia } from '../web/engine/host/native-events';

test('native playback leaves buffering when the clock advances after a seek without another playing event', () => {
  const video = Object.assign(new EventTarget(), {
    buffered: { length: 0 },
    currentTime: 0,
    duration: 180,
    error: null,
    muted: true,
    paused: false,
    readyState: 2,
    seeking: false,
    videoWidth: 0,
    volume: 0,
  });
  const events: EngineEvent[] = [];
  const page = globalThis as Record<string, unknown>;
  const hasDocument = 'document' in page;
  if (!hasDocument) page.document = {};
  const host = createHostContext(video as unknown as HTMLVideoElement, event => events.push(event), undefined, false, undefined, {} as never);
  clearInterval(host.lifecycle.timer);
  try {
    host.media.backend = 'file';
    host.playback.status = 'playing';
    host.playback.wantsPlay = true;
    bindMedia(host, host.session.controller.start('resume-film'));
    const emit = (name: string) => video.dispatchEvent(new Event(name));

    video.seeking = true;
    emit('seeking');
    emit('waiting');
    video.currentTime = 99;
    video.seeking = false;
    emit('timeupdate');
    expect(host.playback.status).toBe('buffering');

    emit('seeked');
    emit('timeupdate');
    expect(host.playback.status).toBe('buffering');

    video.currentTime = 99.25;
    video.paused = true;
    emit('timeupdate');
    expect(host.playback.status).toBe('buffering');

    video.paused = false;
    emit('timeupdate');
    expect(host.playback.status).toBe('playing');
    expect(events.at(-1)).toMatchObject({ type: 'snapshot', snapshot: { state: 'playing', waiting: false, position: 99.25 } });
  } finally {
    detachMedia(host);
    if (!hasDocument) delete page.document;
  }
});

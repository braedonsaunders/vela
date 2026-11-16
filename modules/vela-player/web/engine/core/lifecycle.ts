import { abortable } from './async';
import type { CoreContext } from './runtime-state';
import { publishCoreState } from './telemetry';

export function failCore(context: CoreContext, error: unknown) {
  if (context.lifecycle.state === 'failed' || context.lifecycle.closed) return;
  const failure = error instanceof Error ? error : new Error(String(error));
  const position = context.clock.time();
  if (context.session.source?.kind === 'file') {
    const io = context.session.source.reader.acquisitionState;
    // Keep the compact transport state in the existing durable recovery
    // message. No URL, header, source identifier or media byte is included.
    failure.message += ` io=${JSON.stringify({
      counts: [io.requests, io.bytes, io.active, io.cacheBytes],
      cursor: [io.anchor, io.demand, io.ahead],
      runs: io.runs
        .slice(0, 2)
        .map((run) => [run.next, run.end, run.demand, run.pages, Number(run.request), Number(run.paused)]),
    })}`;
  }
  context.lifecycle.state = 'failed';
  context.lifecycle.failure = failure.message;
  context.clock.setPlaying(false);
  context.session.source?.audio.pause();
  context.decode.epoch?.abort.abort();
  context.decode.epoch?.decoder.dispose();
  context.scheduler.stop();
  context.scheduler.buffer.clear();
  if (context.lifecycle.timer) clearInterval(context.lifecycle.timer);
  context.lifecycle.timer = undefined;
  publishCoreState(context);
  context.dependencies.onFailure(failure, position);
}

export async function closeSourceSession(context: CoreContext) {
  if (context.lifecycle.timer) clearInterval(context.lifecycle.timer);
  context.lifecycle.timer = undefined;
  const source = context.session.source;
  context.session.source = undefined;
  context.decode.epoch?.abort.abort();
  context.decode.epoch?.decoder.dispose();
  context.decode.epoch?.demux.dispose();
  context.decode.epoch = undefined;
  context.scheduler.stop();
  context.scheduler.buffer.clear();
  context.clock.setPlaying(false);
  source?.abort.abort();
  if (source?.kind === 'file') source.reader.dispose();
  else source?.segments.dispose();
  if (source) await abortable(source.audio.dispose(), AbortSignal.timeout(3500)).catch(() => {});
}

export function disposeCore(context: CoreContext): Promise<void> {
  if (context.lifecycle.disposing) return context.lifecycle.disposing;
  context.lifecycle.closed = true;
  context.lifecycle.disposing = (async () => {
    await closeSourceSession(context);
    context.dependencies.presenter.dispose();
    context.scheduler.dispose();
  })();
  return context.lifecycle.disposing;
}

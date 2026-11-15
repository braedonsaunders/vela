import {mountPlaybackTiming,playbackMark} from './timing';
import { mediaCapabilities } from './media-capabilities';
import {mountCoreWarmup} from './universal/loader';
import { createInstall, type InstallHandle } from './install';
import { createPreview, setPreview, destroyPreview, type PreviewHandle } from './preview';
import { createTheme, setTheme, destroyTheme, type ThemeHandle } from './theme';
import { createEngine, setEngine, destroyEngine, type EngineHandle } from './engine-handoff';
import { PlaybackEngine } from './engine';
import type { Command, PlaybackSession } from './model';
import type { PlaybackPlan } from '../../protocol/v0/types';
import { observation, sessionFromPlan } from './protocol';
export const abi = 1;
export const roster = { 'vela-player': { snapshot: false }, 'vela-context': { snapshot: false }, 'vela-preview': { snapshot: false }, 'vela-install': { snapshot: false }, 'vela-theme': { snapshot: false }, 'vela-engine': { snapshot: false } };
interface ContextHandle { releaseTiming?:()=>void;releaseWarmup?:()=>void; context: true; disposed: boolean; lastNavigation: string; probe: string; revision: number; abort: AbortController; event: (kind: number, payload: string) => void }
interface Handle {
  engine: PlaybackEngine; video: HTMLVideoElement; sessionJson: string; lastCommand: number;
  endedReport: string; reportedFailure: string; serverError: string; planRevision: number; planSession: string; sequence: number; lastReport: number;
  reportedTracks:string;
}
export function create(tag: string, element: HTMLElement, json: string, event: (kind: number, payload: string) => void): Handle | ContextHandle | PreviewHandle | InstallHandle | ThemeHandle | EngineHandle {
  if (tag === 'vela-engine') return createEngine(json);
  if (tag === 'vela-theme') return createTheme(json);
  if (tag === 'vela-install') return createInstall(element, json, event);
  if (tag === 'vela-preview') return createPreview(element, json, event);
  if (tag === 'vela-context') {
    const handle: ContextHandle = { context:true, disposed:false, lastNavigation:'', probe:'', revision:0, abort:new AbortController(), event };
    const props = JSON.parse(json) as Record<string, string>;
    handle.probe = props.probe ?? '';
    if(handle.probe==='media'){handle.releaseTiming=mountPlaybackTiming();handle.releaseWarmup=mountCoreWarmup(handle.abort.signal);}
    navigateSecurely(handle,props);
    queueMicrotask(() => { void publishContext(handle); });
    return handle;
  }
  if (tag !== 'vela-player') throw new Error(`Unknown player view: ${tag}`);
  const ambient = (JSON.parse(json) as Record<string, string>).ambient === 'true';
  const root = element.shadowRoot ?? element.attachShadow({ mode: 'open' });
  const video = document.createElement('video'); video.style.cssText = 'display:block;width:100%;height:100%;object-fit:contain;background:#000;pointer-events:none';
  const surface = document.createElement('div'); surface.style.cssText = 'position:relative;width:100%;height:100%;isolation:isolate;z-index:0;pointer-events:none';
  // A shadow root does not isolate z-order. Contain the canvas's local z-index
  // below sibling Contract chrome; media owns no pointer targets or controls.
  const style = document.createElement('style');
  style.textContent = '.webgpuPlayerCanvas{position:absolute;display:block;z-index:1;opacity:0;pointer-events:none}.webgpuPlayerCanvas-visible{opacity:1}';
  surface.append(video); root.replaceChildren(style,surface);
  const handle: Handle = { engine: undefined!, video, sessionJson: '', lastCommand: -1, planRevision: -1, planSession: '', sequence: 0, lastReport: 0, serverError: '', endedReport: '', reportedFailure: '',reportedTracks:'' };
  handle.engine = new PlaybackEngine(video, value => {
    event(8, JSON.stringify(value));
    const now = performance.now();
    const failureKey = value.type === 'snapshot' && value.snapshot.failure
      ? `${value.snapshot.sessionId}:${value.snapshot.sourceGeneration}:${value.snapshot.seekGeneration}:${value.snapshot.sourceId}:${value.snapshot.failure.kind}:${value.snapshot.failure.message}` : '';
    const trackKey=value.type==='snapshot'?JSON.stringify([value.snapshot.sessionId,value.snapshot.sourceGeneration,value.snapshot.seekGeneration,
      value.snapshot.audioTrackId,value.snapshot.subtitleTrackId]):'';
    if (value.type === 'snapshot' && handle.engine.observationAllowed && (now - handle.lastReport >= 1000 || failureKey !== '' && failureKey !== handle.reportedFailure||trackKey!==handle.reportedTracks)) {
      if (failureKey) handle.reportedFailure = failureKey;
      const endedKey = `${value.snapshot.sessionId}:${value.snapshot.sourceGeneration}:${value.snapshot.seekGeneration}`;
      if (value.snapshot.state === 'ended' && handle.endedReport === endedKey) return;
      if (value.snapshot.state === 'ended') handle.endedReport = endedKey;
      const report = observation(value.snapshot, ++handle.sequence);
      if (report) { handle.lastReport = now;handle.reportedTracks=trackKey; event(8, JSON.stringify({ type: 'observation', sessionId: value.snapshot.sessionId, observation: report })); }
    }
  }, element.parentElement ?? element, ambient);
  try { setProps(handle, json); } catch (error) { handle.engine.dispose(); video.remove(); throw error; }
  return handle;
}
export function setProps(handle: Handle | ContextHandle | PreviewHandle | InstallHandle | ThemeHandle | EngineHandle, json: string) {
  if ('leaving' in handle) { setEngine(handle, json); return; }
  if ('theme' in handle) { setTheme(handle, json); return; }
  if ('install' in handle) { handle.update(json); return; }
  if ('preview' in handle) { setPreview(handle, json); return; }
  if ('context' in handle) { navigateSecurely(handle,JSON.parse(json) as Record<string,string>); return; }
  const props = JSON.parse(json) as Record<string, string>;
  if (props.serverError !== handle.serverError) { handle.serverError = props.serverError ?? ''; if (handle.serverError) handle.engine.rejectCommand(handle.serverError); }
  const input = props.plan || props.session || '';
  if (input && input !== handle.sessionJson) {
    let session: PlaybackSession;
    if (props.plan) {
      const plan = JSON.parse(input) as PlaybackPlan;
      const stale = plan.sessionId === handle.planSession && (plan.revision <= handle.planRevision || plan.sourceGeneration < handle.engine.controller.source || plan.seekGeneration < handle.engine.controller.seek);
      if (stale) { applyCommand(handle, props); return; }
      session = sessionFromPlan(plan); handle.planRevision = plan.revision; handle.planSession = plan.sessionId;
    } else session = JSON.parse(input) as PlaybackSession;
    if (!session.id || !Array.isArray(session.sources)) throw new Error('Invalid playback session');
    if(handle.engine.snapshot().sessionId!==session.id)playbackMark('plan:received');
    handle.sessionJson = input;
    const current = handle.engine.snapshot();
    if (props.plan && current.sessionId === session.id && current.sourceId === session.selectedSourceId && current.sourceGeneration === session.sourceGeneration && current.seekGeneration === session.seekGeneration) handle.engine.updateSession(session);
    else void handle.engine.load(session);
  }
  applyCommand(handle, props);
}
function applyCommand(handle: Handle, props: Record<string, string>) {
  if (props.playerCommand) {
    let command = JSON.parse(props.playerCommand) as Command;
    const value = (command as unknown as { value?: string }).value;
    if (typeof value === 'string') {
      const decoded = decodeURIComponent(value), base = { id: command.id, type: command.type };
      switch (command.type) {
        case 'lowDelay': command = { ...base, type: 'lowDelay', enabled: decoded === 'true' }; break;
        case 'seekBy': command = { ...base, type: 'seekBy', seconds: Number(decoded) }; break;
        case 'seek': command = { ...base, type: 'seek', seconds: Number(decoded) }; break;
        case 'volume': command = { ...base, type: 'volume', value: Number(decoded) }; break;
        case 'speed': command = { ...base, type: 'speed', value: Number(decoded) }; break;
        case 'subtitleStyle': command = { ...base, type: 'subtitleStyle', value: decoded }; break;
        case 'mute': command = { ...base, type: 'mute', muted: decoded === '' ? undefined : decoded === 'true' }; break;
        case 'quality': command = { ...base, type: 'quality', renditionId: decoded || null }; break;
        case 'audio': command = { ...base, type: 'audio', trackId: decoded }; break;
        case 'subtitle': command = { ...base, type: 'subtitle', trackId: decoded || null }; break;
        case 'switchPath': command = { ...base, type: 'switchPath', pathId: decoded }; break;
      }
    }
    if (!Number.isSafeInteger(command.id)) throw new Error('Command requires integer id');
    if (command.id > handle.lastCommand) { handle.lastCommand = command.id; void handle.engine.command(command); }
  }
}
export function destroy(handle: Handle | ContextHandle | PreviewHandle | InstallHandle | ThemeHandle | EngineHandle) { if ('leaving' in handle) { destroyEngine(handle); return; } if ('theme' in handle) { destroyTheme(handle); return; } if ('install' in handle) { handle.dispose(); return; } if ('preview' in handle) { destroyPreview(handle); return; } if ('context' in handle) { handle.disposed = true; handle.abort.abort(); handle.releaseTiming?.();handle.releaseWarmup?.(); return; } handle.engine.dispose(); handle.video.remove(); }

/** The data realm issues the one-time code and validates the server identity;
 * the host enforces the advertised HTTPS destination and never logs the code. */
function navigateSecurely(handle: ContextHandle, props: Record<string, string>) {
  const target = props.secureNavigate;
  if (!target || handle.disposed || target === handle.lastNavigation) return;
  try {
    if (target.length > 8192) throw new Error('Invalid secure handoff');
    const url = new URL(target);
    const allowed = JSON.parse(props.secureOrigins || '[]') as unknown;
    if (url.protocol !== 'https:' || url.username || url.password || !['/vela', '/vela/'].includes(url.pathname)
      || !Array.isArray(allowed) || !allowed.some(origin => typeof origin === 'string' && origin === url.origin)) throw new Error('Invalid secure handoff');
    handle.lastNavigation = target;
    queueMicrotask(() => { if (!handle.disposed) location.replace(url.href); });
  } catch {
    handle.event(8, JSON.stringify({ secureNavigation: 'rejected' }));
  }
}

async function publishContext(handle: ContextHandle) {
  const revision = ++handle.revision;
  try {
    const payload = handle.probe === 'media' ? JSON.stringify(await mediaCapabilities(handle.abort.signal))

      : handle.probe === 'network' ? JSON.stringify({saveData:(navigator as Navigator & {connection?:{saveData?:boolean}}).connection?.saveData === true})
      : location.origin;
    if (!handle.disposed && revision === handle.revision) handle.event(8,payload);
  } catch { /* Destroyed/superseded probes do not publish stale capabilities. */ }
}

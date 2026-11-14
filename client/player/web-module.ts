import { PlaybackEngine } from './engine';
import type { Command, PlaybackSession } from './model';
import type { PlaybackPlan } from '../../protocol/v0/types';
import { observation, sessionFromPlan } from './protocol';
export const abi = 1;
export const roster = { 'vela-player': { snapshot: false } };
interface Handle {
  engine: PlaybackEngine; video: HTMLVideoElement; sessionJson: string; lastCommand: number;
  planRevision: number; planSession: string; sequence: number; lastReport: number;
}
export function create(tag: string, element: HTMLElement, json: string, event: (kind: number, payload: string) => void): Handle {
  if (tag !== 'vela-player') throw new Error(`Unknown player view: ${tag}`);
  const root = element.shadowRoot ?? element.attachShadow({ mode: 'open' });
  const video = document.createElement('video'); video.style.cssText = 'display:block;width:100%;height:100%;object-fit:contain;background:#000';
  root.replaceChildren(video);
  const handle: Handle = { engine: undefined!, video, sessionJson: '', lastCommand: -1, planRevision: -1, planSession: '', sequence: 0, lastReport: 0 };
  handle.engine = new PlaybackEngine(video, value => {
    event(8, JSON.stringify(value));
    const now = performance.now();
    if (value.type === 'snapshot' && now - handle.lastReport >= 1000) {
      const report = observation(value.snapshot, ++handle.sequence);
      if (report) { handle.lastReport = now; event(8, JSON.stringify({ type: 'observation', sessionId: value.snapshot.sessionId, observation: report })); }
    }
  }, element.parentElement ?? element);
  try { setProps(handle, json); } catch (error) { handle.engine.dispose(); video.remove(); throw error; }
  return handle;
}
export function setProps(handle: Handle, json: string) {
  const props = JSON.parse(json) as Record<string, string>;
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
    handle.sessionJson = input; void handle.engine.load(session);
  }
  applyCommand(handle, props);
}
function applyCommand(handle: Handle, props: Record<string, string>) {
  if (props.playerCommand) {
    const command = JSON.parse(props.playerCommand) as Command;
    if (!Number.isSafeInteger(command.id)) throw new Error('Command requires integer id');
    if (command.id > handle.lastCommand) { handle.lastCommand = command.id; void handle.engine.command(command); }
  }
}
export function destroy(handle: Handle) { handle.engine.dispose(); handle.video.remove(); }

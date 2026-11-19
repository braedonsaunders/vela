/** Presentation navigation shared by every host. Authentication and tokens stay in Auth/Servers. */
export type AuthStep = { page: 'choose' | 'add' | 'plex' } | { page: 'signin' | 'code'; serverId: string };
export interface AuthFlow { step: AuthStep; history: AuthStep[] }
export type AuthFlowEvent = { type: 'add' | 'plex' | 'back' } | { type: 'server'; serverId: string } | { type: 'code' } | { type: 'servers'; count: number };
export function initialAuthFlow(saved: number): AuthFlow {
  return { step: { page: saved ? 'choose' : 'add' }, history: [] };
}
export function authFlow(state: AuthFlow, event: AuthFlowEvent): AuthFlow {
  if (event.type === 'back') return state.history.length ? { step: state.history[state.history.length - 1]!, history: state.history.slice(0, -1) } : state;
  if (event.type === 'servers') {
    if (state.history.length === 0 && (state.step.page === 'choose' || state.step.page === 'add')) return initialAuthFlow(event.count);
    return state;
  }
  const next: AuthStep = event.type === 'server' ? { page: 'signin', serverId: event.serverId }
    : event.type === 'code' ? state.step.page === 'signin' ? { page: 'code', serverId: state.step.serverId } : state.step
    : { page: event.type };
  if (next === state.step || (next.page === state.step.page && next.page !== 'signin')) return state;
  return { step: next, history: [...state.history, state.step] };
}

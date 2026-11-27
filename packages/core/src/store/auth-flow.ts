/** Presentation navigation shared by every host. Authentication and tokens stay in Auth/Servers.
 * `add` is the welcome (Plex, or a server's address); `address` is typing that address. */
export type AuthStep = { page: 'choose' | 'add' | 'address' | 'plex' } | { page: 'signin' | 'code' | 'server-plex'; serverId: string };
export interface AuthFlow { step: AuthStep; history: AuthStep[] }
export type AuthFlowEvent = { type: 'add' | 'address' | 'plex' | 'back' } | { type: 'server'; serverId: string } | { type: 'code' | 'server-plex' } | { type: 'servers'; count: number };
export function initialAuthFlow(saved: number): AuthFlow {
  return { step: { page: saved ? 'choose' : 'add' }, history: [] };
}
/** Open a selected server directly. A standalone sign-in has no screen behind its Back button. */
export function selectedAuthFlow(serverId: string, saved: number, canChooseServer = true): AuthFlow {
  return { step: { page: 'signin', serverId }, history: canChooseServer ? [initialAuthFlow(saved).step] : [] };
}
export function authFlow(state: AuthFlow, event: AuthFlowEvent): AuthFlow {
  if (event.type === 'back') return state.history.length ? { step: state.history[state.history.length - 1]!, history: state.history.slice(0, -1) } : state;
  if (event.type === 'servers') {
    if (state.history.length === 0 && (state.step.page === 'choose' || state.step.page === 'add')) return initialAuthFlow(event.count);
    return state;
  }
  const next: AuthStep = event.type === 'server' ? { page: 'signin', serverId: event.serverId }
    : (event.type === 'code' || event.type === 'server-plex') ? state.step.page === 'signin' ? { page: event.type, serverId: state.step.serverId } : state.step
    : { page: event.type };
  if (next === state.step || next.page === state.step.page && (next.page !== 'signin' || next.serverId === (state.step.page === 'signin' ? state.step.serverId : ''))) return state;
  return { step: next, history: [...state.history, state.step] };
}

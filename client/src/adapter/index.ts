import type * as V from '../../wire/v0/types';

/** Server-independent operations used by Vela's data layer. */
export interface ServerAdapter {
  capabilities(): Promise<V.ServerCapabilities>;
  signIn(request: V.SignInRequest): Promise<V.Tokens>;
  deviceGrant(request: V.DeviceGrantRequest): Promise<V.DeviceGrant>;
  pollDevice(request: V.DevicePollRequest): Promise<V.GrantPoll>;
  quickConnect(request: V.DeviceGrantRequest): Promise<V.QuickConnect>;
  pollQuickConnect(request: V.QuickPollRequest): Promise<V.GrantPoll>;
  revoke(request: V.RevokeRequest): Promise<V.Ack>;
  bootstrap(): Promise<V.Bootstrap>;
  rows(query: V.RowsQuery): Promise<V.Page<V.Row>>;
  row(id: string, cursor?: string, limit?: number): Promise<V.Row>;
  detail(id: string): Promise<V.TitleDetail>;
  search(request: V.SearchRequest): Promise<V.SearchResponse>;
  startAI(request: V.AISearchRequest): Promise<V.AISearchJob>;
  aiJob(id: string): Promise<V.AISearchJob>;
  cancelAI(id: string, request: V.CancelRequest): Promise<V.AISearchJob>;
  interactions(request: V.InteractionsRequest): Promise<V.Ack>;
  playback(request: V.PlaybackRequest): Promise<V.PlaybackPlan>;
  observe(id: string, request: V.PlayerObservation): Promise<V.Ack>;
  command(id: string, request: V.SessionCommand): Promise<V.PlaybackPlan>;
  snapshot(id: string): Promise<V.SessionSnapshot>;
}

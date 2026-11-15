import type * as V from '../../wire/v0/types';

/** Server-independent operations used by Vela's data layer. */
export interface ServerAdapter {
  /** The stored session's current form, or null once the server rejected it. A transient failure throws. */
  validateSession(): Promise<V.Tokens | null>;
  capabilities(): Promise<V.ServerCapabilities>;
  negotiate(request: V.NegotiateRequest): Promise<V.NegotiateResponse>;
  issueWebCode(request: V.WebCodeIssueRequest): Promise<V.WebCodeIssueResponse>;
  redeemWebCode(request: V.WebCodeRedeemRequest): Promise<V.Tokens>;
  signIn(request: V.SignInRequest): Promise<V.Tokens>;
  deviceGrant(request: V.DeviceGrantRequest): Promise<V.DeviceGrant>;
  pollDevice(request: V.DevicePollRequest): Promise<V.GrantPoll>;
  quickConnect(request: V.DeviceGrantRequest): Promise<V.QuickConnect>;
  pollQuickConnect(request: V.QuickPollRequest): Promise<V.GrantPoll>;
  revoke(request: V.RevokeRequest): Promise<V.Ack>;
  bootstrap(): Promise<V.Bootstrap>;
  bootstrapFresh(): Promise<V.Bootstrap>;
  rows(query: V.RowsQuery): Promise<V.Page<V.Row>>;
  row(id: string, cursor?: string, limit?: number): Promise<V.Row>;
  libraries(query: V.LibrariesQuery): Promise<V.Page<V.Library>>;
  library(id: string, query: V.LibraryBrowseQuery): Promise<V.LibraryContents>;
  collection(id: string, cursor?: string, limit?: number): Promise<V.CollectionContents>;
  detail(id: string): Promise<V.TitleDetail>;
  trailerPreview(id: string, request: V.TrailerPreviewRequest): Promise<V.TrailerPreviewResponse>;
  /** The state of a preview already requested by trailerPreview; never starts preparation. */
  trailerPreviewStatus(id: string): Promise<V.TrailerPreviewResponse>;
  search(request: V.SearchRequest): Promise<V.SearchResponse>;
  startAI(request: V.AISearchRequest): Promise<V.AISearchJob>;
  aiJob(id: string): Promise<V.AISearchJob>;
  cancelAI(id: string, request: V.CancelRequest): Promise<V.AISearchJob>;
  interactions(request: V.InteractionsRequest): Promise<V.Ack>;
  playback(request: V.PlaybackRequest): Promise<V.PlaybackPlan | V.PlaybackPreparing>;
  createAudioFallback(id: string, request: V.AudioFallbackRequest, signal?: AbortSignal): Promise<V.AudioFallbackResponse>;
  cancelAudioFallback(id: string, audioId: string, request: V.Mutation, signal?: AbortSignal): Promise<V.Ack>;
  observe(id: string, request: V.PlayerObservation): Promise<V.Ack>;
  command(id: string, request: V.SessionCommand): Promise<V.PlaybackPlan>;
  channels(cursor?: string, limit?: number): Promise<V.Page<V.Channel>>;
  guide(query: V.GuideQuery): Promise<V.GuideResponse>;
  snapshot(id: string): Promise<V.SessionSnapshot>;
}

/** A native server's media credentials, attached only by the trusted player host to requests
 * inside origin + pathPrefix. Ether has none: its broker grants carry their own authority. */
export interface MediaAccess {
  origin: string;
  pathPrefix: string;
  headers(): Promise<Record<string, string>>;
  /** A credentialed URL for one native-element attachment, minted on request and never stored. */
  nativeURL(url: string): Promise<string>;
}

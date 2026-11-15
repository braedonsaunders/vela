import type * as V from '../../../wire/v0/types';
import type { ServerAdapter } from '../index';
import { VelaError, type Credentials } from '../ether';
import type { Item, Result, User, Auth, Info, MediaSource } from './types';
const seconds = (ticks?: number) => ticks === undefined ? undefined : ticks / 10000000;
const ticks = (value: number) => Math.round(value * 10000000);
const e = encodeURIComponent;
const absent = {
    available: false, reason: 'Not provided by this server adapter'
};
const supported = {
    available: true
};
const fields = 'Overview,Genres,MediaSources,Chapters,People,PrimaryImageAspectRatio,UserData';
const kinds: Record<string, V.TitleKind> = {
    Movie: 'movie', Series: 'show', Season: 'season', Episode: 'episode'
};
const sortKeys: Partial<Record<V.LibrarySort, string>> = {
    title: 'SortName', added: 'DateCreated', released: 'PremiereDate', year: 'ProductionYear', rating: 'CommunityRating', duration: 'Runtime'
};
interface Session {
    plan: V.PlaybackPlan;
    itemId: string;
    source: MediaSource;
    sequence: number;
    started: boolean;
    stopped: boolean;
}
/** All API requests are pinned to this server/base path and refuse redirects.
 * Media URLs contain no account credential. The host supplies scoped media headers.
 * Jellyfin has no refresh tokens: the token is validated, never fictitiously rotated.
 */
export class JellyfinAdapter implements ServerAdapter {
    private base: URL;
    private sessions = new Map<string, Session>();
    private starts = new Map<string, Promise<V.PlaybackPlan>>();
    constructor(origin: string, private credentials: Credentials, _capabilityContext = '', private onSessionRejected?: () => void) {
        this.base = new URL(origin);
        if (!['https:', 'http:'].includes(this.base.protocol) || this.base.username || this.base.password || this.base.search || this.base.hash)
            throw new Error('Invalid server address');
        this.base.pathname = this.base.pathname.replace(/\/*$/, '/');
    }
    setCapabilityContext(_context: string): void {
    }
    private url(path: string): URL {
        const url = new URL(path.replace(/^\//, ''), this.base);
        if (url.origin !== this.base.origin || !url.pathname.startsWith(this.base.pathname) || url.username || url.password)
            throw new Error('Request outside bound server');
        return url;
    }
    /** Validate server-issued media paths; strip persistent URL credentials. */
    mediaURL(path: string): string {
        const url = new URL(path, this.base);
        if (url.origin !== this.base.origin || !url.pathname.startsWith(this.base.pathname) || url.username || url.password)
            throw new Error('Media outside bound server');
        for (const key of [...url.searchParams.keys()])
            if (/^(api_key|apikey|access_token|x-emby-token)$/i.test(key))
                url.searchParams.delete(key);
        return url.href;
    }
    private async request<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
        const tokens = auth ? await this.credentials.get() : null;
        if (auth && !tokens)
            throw this.error('auth', 'sign_in_required', 'Sign in required', 401);
        const quote = (s: string) => s.replace(/["\\\r\n]/g, '');
        const device = this.credentials.device;
        const authorization = `MediaBrowser Client="Vela", Device="${quote(device.name)}", DeviceId="${quote(device.id)}", Version="${quote(device.appVersion)}"${tokens ? `, Token="${quote(tokens.accessToken)}"` : ''}`;
        const response = await fetch(this.url(path).href, {
            method, redirect: 'error', headers: {
                Authorization: authorization, ...(tokens ? {
                    'X-Emby-Token': tokens.accessToken
                } : {}), ...(body === undefined ? {} : {
                    'Content-Type': 'application/json'
                })
            }, ...(body === undefined ? {} : {
                body: JSON.stringify(body)
            })
        });
        if (!response.ok) {
            if (response.status === 401 && tokens) {
                await this.credentials.set(null);
                this.sessions.clear();
                this.starts.clear();
                this.onSessionRejected?.();
            }
            throw this.error(response.status === 401 ? 'auth' : response.status === 404 ? 'not-found' : response.status === 403 ? 'policy' : 'request', 'jellyfin_http_error', `Server returned ${response.status}`, response.status);
        }
        if (response.status === 204 || response.headers.get('content-length') === '0')
            return undefined as T;
        const text = await response.text();
        return (text ? JSON.parse(text) : undefined) as T;
    }
    private error(kind: V.ProtocolError['class'], code: string, message: string, status = 400) {
        return new VelaError({
            class: kind, code, message, retry: {
                allowed: false
            }
        }, status);
    }
    private unsupported(feature: string): never {
        throw this.error('request', 'unsupported', `${feature} is unavailable`);
    }
    private async userPath() {
        const t = await this.credentials.get();
        if (!t)
            throw this.error('auth', 'sign_in_required', 'Sign in required', 401);
        return `Users/${e(t.viewer.id)}`;
    }
    private viewer(user: User): V.Viewer {
        return {
            id: user.Id, name: user.Name, policyRevision: 'jellyfin', ...(user.PrimaryImageTag ? {
                avatar: this.image(user.Id, 'Primary', user.PrimaryImageTag, 'person')
            } : {})
        };
    }
    private tokens(auth: Auth): V.Tokens {
        return {
            accessToken: auth.AccessToken, refreshToken: auth.AccessToken, expiresAt: '9999-12-31T23:59:59Z', viewer: this.viewer(auth.User)
        };
    }
    async validateSession(): Promise<V.Tokens | null> {
        const token = await this.credentials.get();
        if (!token)
            return null;
        const user = await this.request<User>('GET', 'Users/Me');
        const next = {
            ...token, viewer: this.viewer(user)
        };
        await this.credentials.set(next);
        return next;
    }
    async signIn(r: V.SignInRequest) {
        return this.tokens(await this.request<Auth>('POST', 'Users/AuthenticateByName', {
            Username: r.username, Pw: r.password
        }, false));
    }
    async revoke(_r: V.RevokeRequest): Promise<V.Ack> {
        await this.request('POST', 'Sessions/Logout');
        this.sessions.clear();
        this.starts.clear();
        return {
            accepted: true
        };
    }
    issueWebCode(_r: V.WebCodeIssueRequest): Promise<V.WebCodeIssueResponse> {
        return Promise.reject(this.error('request', 'unsupported', 'Web codes are unavailable'));
    }
    redeemWebCode(_r: V.WebCodeRedeemRequest): Promise<V.Tokens> {
        return Promise.reject(this.error('request', 'unsupported', 'Web codes are unavailable'));
    }
    async deviceGrant(_r: V.DeviceGrantRequest): Promise<V.DeviceGrant> {
        return this.unsupported('Device grants');
    }
    async pollDevice(_r: V.DevicePollRequest): Promise<V.GrantPoll> {
        return this.unsupported('Device grants');
    }
    async quickConnect(_r: V.DeviceGrantRequest): Promise<V.QuickConnect> {
        const q = await this.request<{
            Secret: string;
            Code: string;
            DateAdded: string;
        }>('POST', 'QuickConnect/Initiate', undefined, false);
        return {
            secret: q.Secret, code: q.Code, expiresAt: new Date(Date.parse(q.DateAdded) + 600000).toISOString(), pollIntervalSeconds: 5
        };
    }
    async pollQuickConnect(r: V.QuickPollRequest): Promise<V.GrantPoll> {
        const q = await this.request<{
            Authenticated: boolean;
        }>('GET', `QuickConnect/Connect${query({
            Secret: r.secret
        })}`, undefined, false);
        if (!q.Authenticated)
            return {
                status: 'pending'
            };
        return {
            status: 'approved', tokens: this.tokens(await this.request<Auth>('POST', 'Users/AuthenticateWithQuickConnect', {
                Secret: r.secret
            }, false))
        };
    }
    async capabilities(): Promise<V.ServerCapabilities> {
        const info = await this.request<Info>('GET', 'System/Info/Public', undefined, false);
        const quick = await this.request<boolean>('GET', 'QuickConnect/Enabled', undefined, false).catch(() => false);
        const token = await this.credentials.get();
        const live = token ? await this.request<{
            IsEnabled?: boolean;
            Services?: {
                IsVisible?: boolean;
                Tuners?: unknown[];
            }[];
        }>('GET', 'LiveTv/Info').catch(() => null) : null;
        const configuredLive = live?.Services?.some(s => s.IsVisible !== false && (s.Tuners?.length ?? 0) > 0) === true;
        const liveChannels = token && live?.IsEnabled === true && !configuredLive ? await this.request<Result>('GET', 'LiveTv/Channels?Limit=1').catch(() => null) : null;
        const hasLive = configuredLive || (liveChannels?.Items.length ?? 0) > 0;
        return {
            protocolVersion: 0, server: {
                id: info.Id, name: info.ServerName, version: info.Version
            }, features: {
                passwordSignIn: supported, deviceGrant: absent, quickConnect: quick ? supported : absent, descriptiveSearch: absent, aiSearch: absent, proactiveFallback: absent, liveTV: hasLive ? supported : absent, extras: supported, extraPlayback: supported, trailerPreview: absent, themeMusic: absent, audioFallback: absent, initialTrackSelection: supported, sessionTrackChanges: absent
            }, skins: [{
                    id: 'cinematic', name: 'Cinematic'
                }], defaultSkinId: 'cinematic'
        };
    }
    async negotiate(r: V.NegotiateRequest): Promise<V.NegotiateResponse> {
        await this.request('POST', 'Sessions/Capabilities/Full', {
            PlayableMediaTypes: ['Video', 'Audio'], SupportsMediaControl: false, SupportsPersistentIdentifier: true, DeviceProfile: this.profile(r.client)
        });
        return {
            capabilities: await this.capabilities(), client: r.client
        };
    }
    async appearance(): Promise<V.Appearance> {
        return {
            revision: 0, defaultSkinId: 'cinematic', defaultEngineId: 'cinematic', force: false, packs: []
        };
    }
    async skinDocument(_path: string): Promise<never> {
        return this.unsupported('Server skin documents');
    }
    private image(id: string, type: string, tag: string, kind: V.ArtworkRef['kind']): V.ArtworkRef {
        return {
            id: `${id}:${type}`, kind, tag, sizes: [{
                    width: 0, height: 0, url: this.url(`Items/${e(id)}/Images/${type}${query({
                        tag
                    })}`).href
                }]
        };
    }
    private artwork(i: Item): V.ArtworkRef[] {
        const art: V.ArtworkRef[] = [];
        for (const [type, kind] of [['Primary', 'poster'], ['Thumb', 'still'], ['Logo', 'logo']] as const)
            if (i.ImageTags?.[type])
                art.push(this.image(i.Id, type, i.ImageTags[type], kind));
        if (i.BackdropImageTags?.[0])
            art.push(this.image(i.Id, 'Backdrop/0', i.BackdropImageTags[0], 'backdrop'));
        return art;
    }
    private title(i: Item): V.Title {
        if (!kinds[i.Type ?? ''])
            throw this.error('request', 'unsupported_item', 'Unsupported catalogue item');
        return {
            id: i.Id, kind: kinds[i.Type!], name: i.Name, summary: i.Overview ?? '', year: i.ProductionYear, genres: i.Genres ?? [], durationSeconds: seconds(i.RunTimeTicks), rating: i.OfficialRating, ratings: [...(i.CommunityRating === undefined ? [] : [{
                        source: 'Community', kind: 'audience' as const, value: i.CommunityRating, scale: 10
                    }]), ...(i.CriticRating === undefined ? [] : [{
                        source: 'Critic', kind: 'critic' as const, value: i.CriticRating, scale: 100
                    }])], artwork: this.artwork(i), showId: i.SeriesId, seasonId: i.SeasonId, seasonNumber: i.ParentIndexNumber, episodeNumber: i.IndexNumber, watch: {
                positionSeconds: seconds(i.UserData?.PlaybackPositionTicks) ?? 0, played: i.UserData?.Played ?? false, favorite: i.UserData?.IsFavorite ?? false, watchlisted: false
            }
        };
    }
    private entry(i: Item): V.RowEntry {
        if (kinds[i.Type ?? ''])
            return {
                id: i.Id, kind: 'title', receiptToken: '', title: this.title(i)
            };
        return {
            id: i.Id, kind: i.Type === 'Playlist' ? 'playlist' : i.Type === 'BoxSet' ? 'collection' : 'directory', name: i.Name, artwork: this.artwork(i), targetId: i.Id, receiptToken: ''
        };
    }
    private page<T>(items: T[], result: Result, start: number): V.Page<T> {
        const more = result.TotalRecordCount !== undefined && start + result.Items.length < result.TotalRecordCount;
        return {
            items, continuation: more ? 'more' : result.TotalRecordCount === undefined ? 'unknown' : 'exhausted', ...(more ? {
                nextCursor: String(start + result.Items.length)
            } : {})
        };
    }
    private paging(cursor?: string, limit = 40) {
        const start = cursor === undefined ? 0 : Number(cursor);
        if (!Number.isSafeInteger(start) || start < 0 || !Number.isInteger(limit) || limit < 1 || limit > 200)
            throw this.error('request', 'invalid_page', 'Invalid page');
        return {
            StartIndex: start, Limit: limit
        };
    }
    async bootstrap(): Promise<V.Bootstrap> {
        const token = await this.credentials.get();
        if (!token)
            throw this.error('auth', 'sign_in_required', 'Sign in required', 401);
        return {
            viewer: token.viewer, capabilities: await this.capabilities(), defaultSkinId: 'cinematic', heroes: [], rows: (await this.rows({})).items
        };
    }
    bootstrapFresh() {
        return this.bootstrap();
    }
    async rows(q: V.RowsQuery): Promise<V.Page<V.Row>> {
        if (q.placement === 'detail' && q.titleId) {
            const result = await this.request<Result>('GET', `Items/${e(q.titleId)}/Similar${query({
                UserId: (await this.credentials.get())?.viewer.id, Limit: q.limit ?? 20, Fields: fields
            })}`);
            return {
                items: [{
                        id: `similar:${q.titleId}`, name: 'Similar', purpose: 'recommendation', receiptToken: '', ...this.page(result.Items.filter(i => kinds[i.Type ?? '']).map(i => this.entry(i)), result, 0)
                    }], continuation: 'exhausted'
            };
        }
        return {
            items: await Promise.all(['resume', 'nextup', 'latest'].map(id => this.row(id, q.cursor, q.limit ?? 20))), continuation: 'exhausted'
        };
    }
    async row(id: string, cursor?: string, limit = 20): Promise<V.Row> {
        const user = await this.userPath();
        const p = this.paging(cursor, limit);
        let result: Result;
        if (id === 'latest') {
            const items = await this.request<Item[]>('GET', `${user}/Items/Latest${query({
                ...p, Fields: fields, IncludeItemTypes: 'Movie,Series,Episode'
            })}`);
            result = {
                Items: items
            };
        }
        else if (id === 'resume' || id === 'nextup')
            result = await this.request<Result>('GET', `${id === 'resume' ? `${user}/Items/Resume` : 'Shows/NextUp'}${query({
                ...p, UserId: (await this.credentials.get())?.viewer.id, Fields: fields, MediaTypes: 'Video'
            })}`);
        else
            throw this.error('not-found', 'row_not_found', 'Unknown row', 404);
        return {
            id, name: id === 'resume' ? 'Continue Watching' : id === 'nextup' ? 'Next Up' : 'Recently Added', purpose: id === 'resume' ? 'continue' : id === 'nextup' ? 'nextUp' : 'recentlyAdded', receiptToken: '', ...this.page(result.Items.filter(i => kinds[i.Type ?? '']).map(i => this.entry(i)), result, p.StartIndex)
        };
    }
    private libraryModel(i: Item): V.Library {
        return {
            id: i.Id, name: i.Name, kind: i.CollectionType === 'movies' ? 'movies' : i.CollectionType === 'tvshows' ? 'shows' : i.CollectionType === 'livetv' ? 'live' : 'mixed', artwork: this.artwork(i), browse: {
                sorts: Object.keys(sortKeys).map(id => ({
                    id: id as V.LibrarySort, directions: ['asc', 'desc']
                })), defaultSort: 'title', defaultDirection: 'asc', filters: {
                    kind: ['movie', 'show', 'season', 'episode'], genre: true, year: true, played: true, favorite: true
                }
            }
        };
    }
    async libraries(q: V.LibrariesQuery): Promise<V.Page<V.Library>> {
        const result = await this.request<Result>('GET', `${await this.userPath()}/Views`);
        const p = this.paging(q.cursor, q.limit);
        const items = result.Items.slice(p.StartIndex, p.StartIndex + p.Limit);
        return this.page(items.map(i => this.libraryModel(i)), {
            Items: items, TotalRecordCount: result.Items.length
        }, p.StartIndex);
    }
    async library(id: string, q: V.LibraryBrowseQuery): Promise<V.LibraryContents> {
        const sort = q.sort ?? 'title';
        if (!sortKeys[sort])
            throw this.error('request', 'unsupported_sort', 'Unsupported sort');
        const p = this.paging(q.cursor, q.limit);
        const user = await this.userPath();
        const item = await this.request<Item>('GET', `${user}/Items/${e(id)}`);
        const result = await this.request<Result>('GET', `${user}/Items${query({
            ...p, ParentId: id, Recursive: true, Fields: fields, SortBy: sortKeys[sort], SortOrder: q.direction === 'desc' ? 'Descending' : 'Ascending', IncludeItemTypes: q.kind ? Object.keys(kinds).find(k => kinds[k] === q.kind) : 'Movie,Series,BoxSet', Genres: q.genre, Years: q.year, IsPlayed: q.played, IsFavorite: q.favorite
        })}`);
        return {
            library: this.libraryModel(item), sort, direction: q.direction ?? 'asc', ...this.page(result.Items.map(i => this.entry(i)), result, p.StartIndex)
        };
    }
    async collection(id: string, cursor?: string, limit = 100): Promise<V.CollectionContents> {
        const user = await this.userPath();
        const p = this.paging(cursor, limit);
        const item = await this.request<Item>('GET', `${user}/Items/${e(id)}`);
        const result = await this.request<Result>('GET', `${user}/Items${query({
            ParentId: id, Fields: fields, ...p
        })}`);
        return {
            collection: {
                id, name: item.Name, kind: item.Type === 'Playlist' ? 'playlist' : item.Type === 'BoxSet' ? 'collection' : 'directory', summary: item.Overview, artwork: this.artwork(item)
            }, ...this.page(result.Items.map(i => this.entry(i)), result, p.StartIndex)
        };
    }
    private chapters(i: Item): V.Chapter[] {
        return (i.Chapters ?? []).map((c, n) => ({
            id: String(n), name: c.Name ?? `Chapter ${n + 1}`, startSeconds: seconds(c.StartPositionTicks)!, ...(i.Chapters?.[n + 1] ? {
                endSeconds: seconds(i.Chapters[n + 1].StartPositionTicks)
            } : {})
        }));
    }
    async detail(id: string): Promise<V.TitleDetail> {
        const item = await this.request<Item>('GET', `${await this.userPath()}/Items/${e(id)}`);
        const [trailers, extras] = await Promise.all(['LocalTrailers', 'SpecialFeatures'].map(path => this.request<Item[]>('GET', `Items/${e(id)}/${path}`).catch(error => {
            if (error instanceof VelaError && error.status === 404)
                return [];
            throw error;
        })));
        const people = (item.People ?? []).map(p => ({
            name: p.Name, role: p.Role ?? p.Type, ...(p.PrimaryImageTag ? {
                artwork: this.image(p.Id, 'Primary', p.PrimaryImageTag, 'person')
            } : {})
        }));
        const streams = item.MediaSources?.[0]?.MediaStreams ?? [];
        const child = item.Type === 'Series' ? await this.request<Result>('GET', `Shows/${e(id)}/Seasons${query({
            UserId: (await this.credentials.get())?.viewer.id, Fields: fields
        })}`) : item.Type === 'Season' && item.SeriesId ? await this.request<Result>('GET', `Shows/${e(item.SeriesId)}/Episodes${query({
            SeasonId: id, UserId: (await this.credentials.get())?.viewer.id, Fields: fields
        })}`) : null;
        return {
            title: this.title(item), canPlay: item.Type === 'Movie' || item.Type === 'Episode', ...(child ? item.Type === 'Series' ? {
                seasons: child.Items.map(i => this.title(i))
            } : {
                episodes: child.Items.map(i => this.title(i))
            } : {}), cast: people.filter((_p, n) => item.People![n].Type === 'Actor'), crew: people.filter((_p, n) => item.People![n].Type !== 'Actor'), extras: [...trailers.map(i => this.extra(i, id, 'trailer')), ...extras.map(i => this.extra(i, id, 'other'))], chapters: this.chapters(item), mediaSummary: {
                video: streams.filter(s => s.Type === 'Video').map(s => ({
                    codec: s.Codec, width: s.Width, height: s.Height, bitDepth: s.BitDepth, colorTransfer: s.ColorTransfer
                })), audio: streams.filter(s => s.Type === 'Audio').map(s => ({
                    codec: s.Codec, channels: s.Channels, language: s.Language
                }))
            }
        };
    }
    private extra(i: Item, parentId: string, kind: V.Extra['kind']): V.Extra {
        return {
            id: i.Id, parentId, kind, name: i.Name, durationSeconds: seconds(i.RunTimeTicks), artwork: this.artwork(i)[0], availability: 'ready'
        };
    }
    async trailerPreview(_id: string, _r: V.TrailerPreviewRequest): Promise<V.TrailerPreviewResponse> {
        return {
            state: 'unavailable', reason: 'No scoped trailer-preview grants'
        };
    }
    async search(r: V.SearchRequest): Promise<V.SearchResponse> {
        if (r.mode !== 'fast')
            return this.unsupported('Descriptive search');
        const p = this.paging(r.cursor, r.limit);
        const result = await this.request<Result>('GET', `${await this.userPath()}/Items${query({
            ...p, SearchTerm: r.query, Recursive: true, IncludeItemTypes: 'Movie,Series,Season,Episode', Fields: fields
        })}`);
        return {
            query: r.query, generation: r.generation, ...this.page(result.Items.filter(i => kinds[i.Type ?? '']).map(i => this.title(i)), result, p.StartIndex)
        };
    }
    async startAI(_r: V.AISearchRequest): Promise<V.AISearchJob> {
        return this.unsupported('AI search');
    }
    async aiJob(_id: string): Promise<V.AISearchJob> {
        return this.unsupported('AI search');
    }
    async cancelAI(_id: string, _r: V.CancelRequest): Promise<V.AISearchJob> {
        return this.unsupported('AI search');
    }
    async interactions(_r: V.InteractionsRequest): Promise<V.Ack> {
        return this.unsupported('Ranking receipts');
    }
    async mediaHeaders(): Promise<Record<string, string>> {
        const token = await this.credentials.get();
        if (!token)
            throw this.error('auth', 'sign_in_required', 'Sign in required', 401);
        return {
            Authorization: `MediaBrowser Token="${token.accessToken.replace(/["\\\r\n]/g, '')}"`
        };
    }
    async nativePlaybackURL(value: string): Promise<string> {
        const url = new URL(this.mediaURL(value));
        const token = await this.credentials.get();
        if (!token)
            throw this.error('auth', 'sign_in_required', 'Sign in required', 401);
        url.searchParams.set('api_key', token.accessToken);
        return url.href;
    }
    private profile(c: V.ClientCapabilities) {
        const original = c.originalPlayback;
        return {
            Name: 'Vela', MaxStreamingBitrate: c.maxBitrate ?? 120000000,
            DirectPlayProfiles: [{
                    Type: 'Video', Container: (original?.demuxContainers ?? c.containers).join(','), VideoCodec: (original?.videoDecoders ?? c.videoCodecs).join(','), AudioCodec: (original?.audioDecoders ?? c.audioCodecs).join(',')
                }],
            TranscodingProfiles: c.hls || c.mse ? [{
                    Type: 'Video', Container: 'ts', Protocol: 'hls', VideoCodec: 'h264', AudioCodec: 'aac', Context: 'Streaming', EnableSubtitlesInManifest: false
                }] : [],
            SubtitleProfiles: [{
                    Format: 'vtt', Method: 'External'
                }]
        };
    }
    playback(r: V.PlaybackRequest): Promise<V.PlaybackPlan> {
        let work = this.starts.get(r.idempotencyKey);
        if (!work) {
            work = this.open(r);
            this.starts.set(r.idempotencyKey, work);
            if (this.starts.size > 64)
                this.starts.delete(this.starts.keys().next().value!);
        }
        return work;
    }
    private async open(r: V.PlaybackRequest): Promise<V.PlaybackPlan> {
        const id = r.titleId ?? r.extraId ?? r.channelId!;
        const item = await this.request<Item>('GET', `${await this.userPath()}/Items/${e(id)}`);
        const position = r.positionSeconds ?? seconds(item.UserData?.PlaybackPositionTicks) ?? 0;
        const info = await this.request<{
            PlaySessionId?: string;
            MediaSources: MediaSource[];
            ErrorCode?: string;
        }>('POST', `Items/${e(id)}/PlaybackInfo`, {
            UserId: (await this.credentials.get())?.viewer.id, DeviceProfile: this.profile(r.client), StartTimeTicks: ticks(position),
            IsPlayback: true, AutoOpenLiveStream: !!r.channelId, EnableDirectPlay: !r.channelId, EnableDirectStream: true,
            EnableTranscoding: r.allowTranscode !== false, MaxStreamingBitrate: r.client.maxBitrate ?? 120000000,
            ...(r.audioTrackId !== undefined ? {
                AudioStreamIndex: this.trackIndex(r.audioTrackId)
            } : {}),
            ...(r.subtitleTrackId !== undefined ? {
                SubtitleStreamIndex: r.subtitleTrackId === null ? -1 : this.trackIndex(r.subtitleTrackId)
            } : {}),
        });
        let source = info.MediaSources?.find(s => s.SupportsDirectPlay) ?? info.MediaSources?.[0];
        if (!source || info.ErrorCode)
            throw this.error('playback', 'no_playable_source', 'Server could not provide a playable source');
        const sessionId = info.PlaySessionId || `jf-${r.idempotencyKey}`;
        if (source.RequiresOpening && !source.LiveStreamId) {
            const opened = await this.request<{
                MediaSource: MediaSource;
            }>('POST', 'LiveStreams/Open', {
                OpenToken: source.OpenToken, UserId: (await this.credentials.get())?.viewer.id, PlaySessionId: sessionId
            });
            source = opened.MediaSource;
        }
        const paths: V.PlaybackPath[] = [];
        if (source.SupportsDirectPlay && !r.channelId) {
            const url = this.url(`Videos/${e(id)}/stream${query({
                Static: true, MediaSourceId: source.Id, PlaySessionId: sessionId, DeviceId: r.client.device.id
            })}`).href;
            const video = source.MediaStreams?.find(s => s.Type === 'Video');
            paths.push({
                id: 'direct', kind: 'direct', transport: 'file', mimeType: source.Container === 'mp4' || source.Container === 'm4v' ? 'video/mp4' : source.Container === 'webm' ? 'video/webm' : 'video/x-matroska', sourceId: source.Id, original: true, range: true, byteLength: source.Size, originalVideo: video ? {
                    codec: video.Codec, width: video.Width, height: video.Height, bitDepth: video.BitDepth, colorTransfer: video.ColorTransfer
                } : undefined, readiness: 'ready', url, qualities: [], boundaries: []
            });
        }
        if (source.TranscodingUrl && r.allowTranscode !== false && (r.client.hls || r.client.mse))
            paths.push({
                id: 'hls', kind: source.SupportsDirectStream ? 'remux' : 'transcode', transport: 'hls', mimeType: 'application/vnd.apple.mpegurl', sourceId: source.Id, readiness: 'ready', url: this.mediaURL(source.TranscodingUrl), timelineOriginSeconds: position, qualities: [], boundaries: []
            });
        if (!paths.length && source.DirectStreamUrl)
            paths.push({
                id: 'stream', kind: 'remux', transport: 'file', mimeType: 'video/mp4', sourceId: source.Id, readiness: 'ready', url: this.mediaURL(source.DirectStreamUrl), qualities: [], boundaries: []
            });
        if (!paths.length)
            throw this.error('playback', 'no_playable_source', 'No compatible direct or HLS stream');
        const tracks = (type: string): V.Track[] => (source.MediaStreams ?? []).filter(s => s.Type === type).map(s => {
            const text = s.IsTextSubtitleStream || ['srt', 'subrip', 'ass', 'ssa', 'vtt', 'webvtt', 'mov_text'].includes(s.Codec ?? '');
            const url = type === 'Subtitle' && text ? this.mediaURL(s.DeliveryUrl ?? this.url(`Videos/${e(id)}/${e(source.Id)}/Subtitles/${s.Index}/Stream.vtt`).href) : undefined;
            return {
                id: String(s.Index), streamIndex: s.Index, kind: type === 'Audio' ? 'audio' : 'subtitle', language: s.Language ?? 'und', name: s.DisplayTitle ?? s.Title ?? s.Language ?? `${type} ${s.Index}`, codec: s.Codec ?? '', channels: s.Channels, forced: s.IsForced, hearingImpaired: s.IsHearingImpaired, default: s.IsDefault, ...(type === 'Subtitle' ? {
                    ...(url ? {
                        url
                    } : {}), delivery: url ? {
                        kind: 'external', format: 'webvtt', url
                    } : {
                        kind: 'embedded'
                    }
                } : {})
            };
        });
        const plan: V.PlaybackPlan = {
            sessionId, revision: 1, sourceGeneration: 0, seekGeneration: 0, ...(r.channelId ? {
                channelId: id
            } : r.extraId ? {
                extraId: id
            } : {
                titleId: id
            }), state: 'ready', positionSeconds: position, durationSeconds: seconds(source.RunTimeTicks ?? item.RunTimeTicks), paths, selectedPathId: paths[0].id, audioTracks: tracks('Audio'), subtitleTracks: tracks('Subtitle'), selectedAudioTrackId: r.audioTrackId ?? (source.DefaultAudioStreamIndex === undefined ? undefined : String(source.DefaultAudioStreamIndex)), selectedSubtitleTrackId: r.subtitleTrackId === undefined ? source.DefaultSubtitleStreamIndex === undefined || source.DefaultSubtitleStreamIndex < 0 ? null : String(source.DefaultSubtitleStreamIndex) : r.subtitleTrackId, chapters: this.chapters(item), fallback: {
                state: 'unsupported', reason: 'No proactive fallback or verified switch boundaries'
            }
        };
        this.sessions.set(sessionId, {
            plan, itemId: id, source, sequence: -1, started: false, stopped: false
        });
        return plan;
    }
    private trackIndex(id: string): number {
        if (!/^\d+$/.test(id))
            throw this.error('request', 'invalid_track', 'Invalid track');
        return Number(id);
    }
    private session(id: string): Session {
        const session = this.sessions.get(id);
        if (!session)
            throw this.error('not-found', 'session_not_found', 'Playback session is no longer available', 404);
        return session;
    }
    private generation(s: Session, r: V.Generations) {
        if (s.plan.sourceGeneration !== r.sourceGeneration || s.plan.seekGeneration !== r.seekGeneration)
            throw new VelaError({
                class: 'conflict', code: 'stale_generation', message: 'Playback generation changed', retry: {
                    allowed: false
                }, currentGenerations: {
                    sourceGeneration: s.plan.sourceGeneration, seekGeneration: s.plan.seekGeneration
                }
            }, 409);
    }
    private async report(s: Session, stopped = false) {
        const body = {
            ItemId: s.itemId, MediaSourceId: s.source.Id, PlaySessionId: s.plan.sessionId, PositionTicks: ticks(s.plan.positionSeconds), IsPaused: s.plan.state === 'paused', CanSeek: !s.plan.channelId, PlayMethod: s.plan.selectedPathId === 'direct' ? 'DirectPlay' : 'Transcode', AudioStreamIndex: s.plan.selectedAudioTrackId === undefined ? undefined : Number(s.plan.selectedAudioTrackId), SubtitleStreamIndex: s.plan.selectedSubtitleTrackId === null ? -1 : Number(s.plan.selectedSubtitleTrackId), LiveStreamId: s.source.LiveStreamId
        };
        if (!s.started && !stopped) {
            await this.request('POST', 'Sessions/Playing', body);
            s.started = true;
        }
        await this.request('POST', stopped ? 'Sessions/Playing/Stopped' : 'Sessions/Playing/Progress', body);
        if (stopped) {
            s.stopped = true;
            if (s.source.LiveStreamId)
                await this.request('POST', `LiveStreams/Close${query({
                    LiveStreamId: s.source.LiveStreamId
                })}`);
            await this.request('DELETE', `Videos/ActiveEncodings${query({
                DeviceId: this.credentials.device.id, PlaySessionId: s.plan.sessionId
            })}`);
        }
    }
    async observe(id: string, r: V.PlayerObservation): Promise<V.Ack> {
        const s = this.session(id);
        this.generation(s, r);
        if (s.stopped || r.sequence <= s.sequence)
            return {
                accepted: true
            };
        if (!Number.isFinite(r.positionSeconds) || r.positionSeconds < 0)
            throw this.error('request', 'invalid_position', 'Invalid playback position');
        s.plan = {
            ...s.plan, positionSeconds: r.positionSeconds, state: r.state === 'ended' ? 'ended' : r.state === 'paused' ? 'paused' : 'playing', revision: s.plan.revision + 1
        };
        await this.report(s, r.state === 'ended');
        s.sequence = r.sequence;
        return {
            accepted: true
        };
    }
    async command(id: string, r: V.SessionCommand): Promise<V.PlaybackPlan> {
        const s = this.session(id);
        this.generation(s, r);
        if (r.kind === 'tracks' || r.kind === 'prepare-fallback' || r.kind === 'switch')
            return this.unsupported('Session source/track changes');
        if (r.kind === 'seek') {
            if (!Number.isFinite(r.positionSeconds) || r.positionSeconds < 0)
                throw this.error('request', 'invalid_position', 'Invalid playback position');
            if (s.plan.channelId)
                return this.unsupported('Seeking live TV');
            s.plan = {
                ...s.plan, paths: s.plan.paths.map(path => {
                    if (path.transport !== 'hls' || path.readiness === 'on-demand')
                        return path;
                    const url = new URL(this.mediaURL(path.url));
                    url.searchParams.set('StartTimeTicks', String(ticks(r.positionSeconds)));
                    return {
                        ...path, url: url.href, timelineOriginSeconds: r.positionSeconds
                    };
                })
            };
            s.plan = {
                ...s.plan, positionSeconds: r.positionSeconds, seekGeneration: s.plan.seekGeneration + 1
            };
        }
        else
            s.plan = {
                ...s.plan, state: r.kind === 'stop' ? 'ended' : r.kind === 'pause' ? 'paused' : 'playing'
            };
        s.plan = {
            ...s.plan, revision: s.plan.revision + 1
        };
        if (!s.stopped)
            await this.report(s, r.kind === 'stop');
        return s.plan;
    }
    async snapshot(id: string): Promise<V.SessionSnapshot> {
        const s = this.session(id);
        return {
            cursor: String(s.plan.revision), revision: s.plan.revision, plan: s.plan, publishedRanges: [], ...(s.sequence >= 0 ? {
                lastObservationSequence: s.sequence
            } : {})
        };
    }
    async createAudioFallback(_id: string, _r: V.AudioFallbackRequest): Promise<V.AudioFallbackResponse> {
        return this.unsupported('Audio fallback');
    }
    async cancelAudioFallback(_id: string, _audio: string, _r: V.Mutation): Promise<V.Ack> {
        return this.unsupported('Audio fallback');
    }
    private channel(i: Item): V.Channel {
        return {
            id: i.Id, number: i.Number ?? i.ChannelNumber ?? '', name: i.Name, kind: 'tv', artwork: this.artwork(i).map(a => ({
                ...a, kind: 'channel'
            })), favorite: i.UserData?.IsFavorite ?? false, rating: i.OfficialRating
        };
    }
    async channels(cursor?: string, limit?: number): Promise<V.Page<V.Channel>> {
        const p = this.paging(cursor, limit);
        const result = await this.request<Result>('GET', `LiveTv/Channels${query({
            ...p, UserId: (await this.credentials.get())?.viewer.id
        })}`);
        return this.page(result.Items.map(i => this.channel(i)), result, p.StartIndex);
    }
    async guide(q: V.GuideQuery): Promise<V.GuideResponse> {
        const p = this.paging(q.cursor, q.limit);
        const result = await this.request<Result>('GET', `LiveTv/Programs${query({
            ...p, UserId: (await this.credentials.get())?.viewer.id, ChannelIds: q.channelIds?.join(','), MinEndDate: q.from, MaxStartDate: q.until, Fields: fields
        })}`);
        const programmes = result.Items.filter(i => i.StartDate && i.EndDate && i.ChannelId).map(i => ({
            id: i.Id, channelId: i.ChannelId!, name: i.Name, summary: i.Overview ?? '', start: i.StartDate!, end: i.EndDate!, episodeTitle: i.EpisodeTitle, seasonNumber: i.ParentIndexNumber, episodeNumber: i.IndexNumber, artwork: this.artwork(i), rating: i.OfficialRating, genres: i.Genres
        }));
        return {
            from: q.from, until: q.until, ...this.page(programmes, result, p.StartIndex)
        };
    }
}
function query(values: object): string {
    const params = Object.entries(values).filter(([, v]) => v !== undefined).map(([k, v]) => `${e(k)}=${e(String(v))}`);
    return params.length ? `?${params.join('&')}` : '';
}

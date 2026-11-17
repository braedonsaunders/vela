import type * as V from '../../wire';
import type { CatalogueSearch, Credentials, Home, ServerAdapter, ServerDescription, TransportCommand } from '../index';
import type { ClientDeclaration, LiveTv, PasswordSignIn, QuickConnectSignIn, TrackChanges, TrackCommand } from '../capabilities';
import { VelaError } from '../errors';
import { seriesOrder } from '../series';
import type { Item, Result, User, Auth, Info, MediaSource } from './types';
const seconds = (ticks?: number) => ticks === undefined ? undefined : ticks / 10000000;
const ticks = (value: number) => Math.round(value * 10000000);
const e = encodeURIComponent;
const offered: V.Feature = { available: true };
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
    client: V.ClientCapabilities;
    playSessionId: string;
    source: MediaSource;
    sequence: number;
    started: boolean;
    stopped: boolean;
    pending: Promise<unknown>;
    mutations: Map<string, V.PlaybackPlan>;
}
/** All API requests are pinned to this server/base path and refuse redirects.
 * Media URLs contain no account credential. The host supplies scoped media headers.
 * Jellyfin has no refresh tokens: the token is validated, never fictitiously rotated.
 */
export class JellyfinAdapter
    implements ServerAdapter, PasswordSignIn, QuickConnectSignIn, ClientDeclaration, LiveTv, TrackChanges {
    private base: URL;
    private sessions = new Map<string, Session>();
    private starts = new Map<string, Promise<V.PlaybackPlan>>();
    constructor(origin: string, private credentials: Credentials, private onSessionRejected?: () => void) {
        this.base = new URL(origin);
        if (!['https:', 'http:'].includes(this.base.protocol) || this.base.username || this.base.password || this.base.search || this.base.hash)
            throw new Error('Invalid server address');
        this.base.pathname = this.base.pathname.replace(/\/*$/, '/');
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
    async signInWithPassword(r: V.SignInRequest) {
        return this.tokens(await this.request<Auth>('POST', 'Users/AuthenticateByName', {
            Username: r.username, Pw: r.password
        }, false));
    }
    async revokeSession(_r: V.RevokeRequest): Promise<V.Ack> {
        await this.request('POST', 'Sessions/Logout');
        this.sessions.clear();
        this.starts.clear();
        return {
            accepted: true
        };
    }
    async startQuickConnect(_r: V.DeviceGrantRequest): Promise<V.QuickConnect> {
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
    async describe(): Promise<ServerDescription> {
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
                passwordSignIn: offered,
                quickConnect: quick ? offered : { available: false, reason: 'Quick Connect is turned off' },
                liveTV: hasLive ? offered : { available: false, reason: 'No live TV tuner is configured' },
                extras: offered,
                extraPlayback: offered,
                initialTrackSelection: offered,
                sessionTrackChanges: offered,
            }, skins: [{
                    id: 'cinematic', name: 'Cinematic'
                }], defaultSkinId: 'cinematic'
        };
    }
    /** The server shapes transcodes to the client's device profile. */
    async declareClient(r: V.NegotiateRequest): Promise<void> {
        await this.request('POST', 'Sessions/Capabilities/Full', {
            PlayableMediaTypes: ['Video', 'Audio'], SupportsMediaControl: false, SupportsPersistentIdentifier: true, DeviceProfile: this.profile(r.client)
        });
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
        const episode = i.Type === 'Episode';
        const seriesPoster = (episode || i.Type === 'Season') && i.SeriesId && i.SeriesPrimaryImageTag;
        if (seriesPoster) art.push(this.image(i.SeriesId!, 'Primary', i.SeriesPrimaryImageTag!, 'poster'));
        for (const [type, kind] of [['Primary', 'poster'], ['Thumb', 'still'], ['Logo', 'logo']] as const)
            if (i.ImageTags?.[type])
                if (!(seriesPoster && type === 'Primary' && !episode))
                    art.push(this.image(i.Id, type, i.ImageTags[type], episode && type === 'Primary' ? 'still' : kind));
        if (!i.ImageTags?.Logo && i.ParentLogoItemId && i.ParentLogoImageTag)
            art.push(this.image(i.ParentLogoItemId, 'Logo', i.ParentLogoImageTag, 'logo'));
        if (!i.BackdropImageTags?.[0] && i.ParentBackdropItemId && i.ParentBackdropImageTags?.[0])
            art.push(this.image(i.ParentBackdropItemId, 'Backdrop/0', i.ParentBackdropImageTags[0], 'backdrop'));
        if (i.BackdropImageTags?.[0])
            art.push(this.image(i.Id, 'Backdrop/0', i.BackdropImageTags[0], 'backdrop'));
        return art;
    }
    private title(i: Item): V.Title {
        if (!kinds[i.Type ?? ''])
            throw this.error('request', 'unsupported_item', 'Unsupported catalogue item');
        return {
            id: i.Id, kind: kinds[i.Type!], name: i.Name, summary: i.Overview ?? '', year: i.ProductionYear, airDate: i.PremiereDate?.slice(0, 10), genres: i.Genres ?? [], durationSeconds: seconds(i.RunTimeTicks), rating: i.OfficialRating, ratings: [...(i.CommunityRating === undefined ? [] : [{
                        source: 'Community', kind: 'audience' as const, value: i.CommunityRating, scale: 10
                    }]), ...(i.CriticRating === undefined ? [] : [{
                        source: 'Critic', kind: 'critic' as const, value: i.CriticRating, scale: 100
                    }])], artwork: this.artwork(i), showId: i.SeriesId, showName: i.SeriesName, seasonId: i.SeasonId, seasonNumber: i.Type === 'Season' ? i.IndexNumber : i.ParentIndexNumber, episodeNumber: i.Type === 'Episode' ? i.IndexNumber : undefined, watch: {
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
    async home(): Promise<Home> {
        const token = await this.credentials.get();
        if (!token)
            throw this.error('auth', 'sign_in_required', 'Sign in required', 401);
        return {
            viewer: token.viewer, capabilities: await this.describe(), defaultSkinId: 'cinematic', heroes: [], rows: (await this.rows({})).items
        };
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
    async libraryRows(id: string, kind: V.Library['kind']): Promise<V.Row[]> {
        const user = await this.userPath();
        const userId = (await this.credentials.get())?.viewer.id;
        const latest = await this.request<Item[]>('GET', `${user}/Items/Latest${query({ ParentId: id, Limit: 20, Fields: fields, IncludeItemTypes: kind === 'movies' ? 'Movie' : kind === 'shows' ? 'Series,Episode' : 'Movie,Series,Episode' })}`);
        const rows: V.Row[] = [{ id: `library:${id}:latest`, name: 'Recently Added', purpose: 'recentlyAdded', receiptToken: '', items: latest.filter(i => kinds[i.Type ?? '']).map(i => this.entry(i)), continuation: 'exhausted' }];
        if (kind === 'movies') {
            const suggestions = await this.request<{ BaselineItemName?: string; CategoryId?: string; RecommendationType?: string; Items: Item[] }[]>('GET', `Movies/Recommendations${query({ ParentId: id, UserId: userId, Fields: fields, CategoryLimit: 5, ItemLimit: 20 })}`);
            rows.push(...suggestions.map((group, index): V.Row => ({ id: `library:${id}:suggestion:${group.CategoryId ?? index}`, name: group.BaselineItemName || 'Suggested for you', purpose: 'recommendation', receiptToken: '', items: (group.Items ?? []).filter(i => kinds[i.Type ?? '']).map(i => this.entry(i)), continuation: 'exhausted' })));
        } else if (kind === 'shows') {
            const next = await this.request<Result>('GET', `Shows/NextUp${query({ ParentId: id, UserId: userId, Limit: 20, Fields: fields })}`);
            rows.unshift({ id: `library:${id}:nextup`, name: 'Next Up', purpose: 'nextUp', receiptToken: '', items: next.Items.filter(i => kinds[i.Type ?? '']).map(i => this.entry(i)), continuation: 'exhausted' });
        }
        return rows.filter(row => row.items.length > 0);
    }
    async libraryCollections(id: string, cursor?: string): Promise<V.Page<V.RowEntry>> {
        const p = this.paging(cursor, 100);
        const result = await this.request<Result>('GET', `${await this.userPath()}/Items${query({ ...p, ParentId: id, Recursive: true, IncludeItemTypes: 'BoxSet', Fields: fields, SortBy: 'SortName', SortOrder: 'Ascending' })}`);
        return this.page(result.Items.map(i => this.entry(i)), result, p.StartIndex);
    }
    async libraryGenres(id: string): Promise<{ id: string; label: string }[]> {
        const result = await this.request<Result>('GET', `Genres${query({ ParentId: id, UserId: (await this.credentials.get())?.viewer.id, Recursive: true })}`);
        return result.Items.filter(i => i.Name).map(i => ({ id: i.Name, label: i.Name }));
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
            ...p, ParentId: id, Recursive: true, Fields: fields, SortBy: sortKeys[sort], SortOrder: q.direction === 'desc' ? 'Descending' : 'Ascending', IncludeItemTypes: q.kind ? Object.keys(kinds).find(k => kinds[k] === q.kind) : 'Movie,Series', Genres: q.genre, Years: q.year, IsPlayed: q.played, IsFavorite: q.favorite
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
        const source = item.MediaSources?.[0];
        const streams = source?.MediaStreams ?? [];
        const userId = (await this.credentials.get())?.viewer.id;
        const seriesId = item.Type === 'Series' ? id : item.Type === 'Season' ? item.SeriesId : undefined;
        const seasons = item.Type === 'Series' ? await this.children(`Shows/${e(id)}/Seasons`, { UserId: userId }) : undefined;
        const episodes = seriesId ? await this.children(`Shows/${e(seriesId)}/Episodes`, {
            UserId: userId, SeasonId: item.Type === 'Season' ? id : undefined, SortBy: 'ParentIndexNumber,IndexNumber', SortOrder: 'Ascending'
        }) : undefined;
        const next = seriesId ? await this.request<Result>('GET', `Shows/NextUp${query({
            UserId: userId, SeriesId: seriesId, Limit: 1, Fields: fields, EnableResumable: true
        })}`) : undefined;
        const nextItem = next?.Items[0];
        return {
            title: this.title(item), canPlay: item.Type === 'Movie' || item.Type === 'Episode', seasons: seasons ? seriesOrder(seasons) : undefined,
            episodes: episodes ? seriesOrder(episodes) : undefined,
            nextUp: next ? nextItem && (item.Type !== 'Season' || nextItem.SeasonId === id) ? this.title(nextItem) : null : undefined,
            cast: people.filter((_p, n) => item.People![n].Type === 'Actor'), crew: people.filter((_p, n) => item.People![n].Type !== 'Actor'), extras: [...trailers.map(i => this.extra(i, id, 'trailer')), ...extras.map(i => this.extra(i, id, 'other'))], chapters: this.chapters(item), mediaSummary: {
                video: streams.filter(s => s.Type === 'Video').map(s => ({
                    codec: s.Codec, width: s.Width, height: s.Height, bitDepth: s.BitDepth, colorTransfer: s.ColorTransfer,
                    ...(s.DvProfile !== undefined ? { dolbyVisionProfile: s.DvProfile } : {})
                })), audio: streams.filter(s => s.Type === 'Audio').map(s => ({
                    codec: s.Codec, channels: s.Channels, language: s.Language,
                    ...((source?.DefaultAudioStreamIndex !== undefined ? s.Index === source.DefaultAudioStreamIndex : s.IsDefault) ? { default: true } : {})
                })),
                ...(source?.MediaStreams ? { subtitleCount: streams.filter(s => s.Type === 'Subtitle').length } : {})
            }
        };
    }
    private async children(path: string, params: object): Promise<V.Title[]> {
        const items: V.Title[] = [];
        for (;;) {
            const result = await this.request<Result>('GET', `${path}${query({ ...params, Fields: fields, StartIndex: items.length, Limit: 200 })}`);
            items.push(...result.Items.map(i => this.title(i)));
            if (!result.Items.length || (result.TotalRecordCount !== undefined ? items.length >= result.TotalRecordCount : result.Items.length < 200)) return items;
        }
    }
    private extra(i: Item, parentId: string, kind: V.Extra['kind']): V.Extra {
        return {
            id: i.Id, parentId, kind, name: i.Name, durationSeconds: seconds(i.RunTimeTicks), artwork: this.artwork(i)[0], availability: 'ready'
        };
    }
    async search(r: CatalogueSearch): Promise<V.SearchResponse> {
        const p = this.paging(r.cursor, r.limit);
        const result = await this.request<Result>('GET', `${await this.userPath()}/Items${query({
            ...p, SearchTerm: r.query, Recursive: true, IncludeItemTypes: 'Movie,Series,Season,Episode', Fields: fields
        })}`);
        return {
            query: r.query, generation: r.generation, ...this.page(result.Items.filter(i => kinds[i.Type ?? '']).map(i => this.title(i)), result, p.StartIndex)
        };
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
    startPlayback(r: V.PlaybackRequest): Promise<V.PlaybackPlan> {
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
            plan, itemId: id, client: r.client, playSessionId: sessionId, source, sequence: -1, started: false, stopped: false, pending: Promise.resolve(), mutations: new Map()
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
        const path = s.plan.paths.find(p => p.id === s.plan.selectedPathId);
        const body = {
            ItemId: s.itemId, MediaSourceId: s.source.Id, PlaySessionId: s.playSessionId, PositionTicks: ticks(s.plan.positionSeconds), IsPaused: s.plan.state === 'paused', CanSeek: !s.plan.channelId, PlayMethod: path?.kind === 'direct' ? 'DirectPlay' : path?.kind === 'remux' ? 'DirectStream' : 'Transcode', AudioStreamIndex: s.plan.selectedAudioTrackId === undefined ? undefined : Number(s.plan.selectedAudioTrackId), SubtitleStreamIndex: s.plan.selectedSubtitleTrackId === undefined ? undefined : s.plan.selectedSubtitleTrackId === null ? -1 : Number(s.plan.selectedSubtitleTrackId), LiveStreamId: s.source.LiveStreamId
        };
        if (!s.started) {
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
            if (path?.kind !== 'direct') await this.request('DELETE', `Videos/ActiveEncodings${query({
                DeviceId: this.credentials.device.id, PlaySessionId: s.playSessionId
            })}`);
        }
    }
    async reportObservation(id: string, r: V.PlayerObservation): Promise<V.Ack> {
        const s = this.session(id);
        return this.serialize(s, async () => {
            this.generation(s, r);
            if (s.stopped || r.sequence <= s.sequence)
                return {
                    accepted: true
                };
            if (!Number.isFinite(r.positionSeconds) || r.positionSeconds < 0)
                throw this.error('request', 'invalid_position', 'Invalid playback position');
            s.plan = {
                ...s.plan, positionSeconds: r.positionSeconds, state: r.state === 'ended' ? 'ended' : r.state === 'paused' ? 'paused' : 'playing',
                selectedAudioTrackId: r.audioTrackId ?? s.plan.selectedAudioTrackId,
                selectedSubtitleTrackId: r.subtitleTrackId === undefined ? s.plan.selectedSubtitleTrackId : r.subtitleTrackId, revision: s.plan.revision + 1
            };
            await this.report(s, r.state === 'ended');
            s.sequence = r.sequence;
            return {
                accepted: true
            };
        });
    }
    async command(id: string, r: TransportCommand): Promise<V.PlaybackPlan> {
        const s = this.session(id);
        return this.serialize(s, async () => {
            const saved = s.mutations.get(r.idempotencyKey);
            if (saved) return saved;
            this.generation(s, r);
            if (s.stopped) return structuredClone(s.plan);
            if (r.kind === 'seek') {
                if (!Number.isFinite(r.positionSeconds) || r.positionSeconds < 0)
                    throw this.error('request', 'invalid_position', 'Invalid playback position');
                if (s.plan.channelId)
                    throw this.error('request', 'unsupported', 'Seeking live TV is unavailable');
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
            const result = structuredClone(s.plan);
            s.mutations.set(r.idempotencyKey, result);
            return result;
        });
    }
    async changeTracks(id: string, r: TrackCommand): Promise<V.PlaybackPlan> {
        const s = this.session(id);
        return this.serialize(s, async () => {
            const saved = s.mutations.get(r.idempotencyKey);
            if (saved) return saved;
            this.generation(s, r);
            if (s.stopped) throw this.error('conflict', 'session_ended', 'Playback has ended');
            const audio = r.audioTrackId ?? s.plan.selectedAudioTrackId;
            const subtitle = r.subtitleTrackId === undefined ? s.plan.selectedSubtitleTrackId : r.subtitleTrackId;
            if (audio !== undefined && !s.plan.audioTracks.some(t => t.id === audio)) throw this.error('request', 'invalid_track', 'Unknown audio track');
            if (subtitle != null && !s.plan.subtitleTracks.some(t => t.id === subtitle)) throw this.error('request', 'invalid_track', 'Unknown subtitle track');
            const path = s.plan.paths.find(p => p.id === s.plan.selectedPathId);
            if (path?.kind !== 'direct') {
                const info = await this.request<{ PlaySessionId?: string; MediaSources: MediaSource[] }>('POST', `Items/${e(s.itemId)}/PlaybackInfo`, {
                    UserId: (await this.credentials.get())?.viewer.id, MediaSourceId: s.source.Id,
                    DeviceProfile: this.profile(s.client), StartTimeTicks: ticks(s.plan.positionSeconds),
                    AudioStreamIndex: audio === undefined ? undefined : this.trackIndex(audio),
                    SubtitleStreamIndex: subtitle == null ? -1 : this.trackIndex(subtitle),
                    IsPlayback: true, EnableDirectPlay: false, EnableDirectStream: true, EnableTranscoding: true,
                });
                const source = info.MediaSources?.find(m => m.Id === s.source.Id) ?? info.MediaSources?.[0];
                const raw = source?.TranscodingUrl ?? source?.DirectStreamUrl;
                if (!source || !raw) throw this.error('playback', 'no_playable_source', 'Server did not provide the selected tracks');
                const url = this.mediaURL(raw);
                await this.request('DELETE', `Videos/ActiveEncodings${query({ DeviceId: this.credentials.device.id, PlaySessionId: s.playSessionId })}`);
                s.source = source;
                s.playSessionId = info.PlaySessionId ?? s.playSessionId;
                s.plan = { ...s.plan, paths: [{ ...path!, readiness: 'ready', url, mimeType: source.TranscodingUrl ? 'application/vnd.apple.mpegurl' : 'video/mp4', sourceId: source.Id, transport: source.TranscodingUrl ? 'hls' : 'file', kind: source.SupportsDirectStream ? 'remux' : 'transcode', timelineOriginSeconds: s.plan.positionSeconds }], sourceGeneration: s.plan.sourceGeneration + 1 };
            }
            s.plan = { ...s.plan, selectedAudioTrackId: audio, selectedSubtitleTrackId: subtitle, revision: s.plan.revision + 1 };
            await this.report(s);
            const result = structuredClone(s.plan);
            s.mutations.set(r.idempotencyKey, result);
            return result;
        });
    }
    // Never let delayed progress arrive after a stop and revive the server's session.
    private serialize<T>(s: Session, run: () => Promise<T>): Promise<T> {
        const work = s.pending.then(run);
        s.pending = work.catch(() => undefined);
        return work;
    }
    async sessionSnapshot(id: string): Promise<V.SessionSnapshot> {
        const s = this.session(id);
        return {
            cursor: String(s.plan.revision), revision: s.plan.revision, plan: structuredClone(s.plan), publishedRanges: [], ...(s.sequence >= 0 ? {
                lastObservationSequence: s.sequence
            } : {})
        };
    }
    private channel(i: Item): V.Channel {
        return {
            id: i.Id, number: i.Number ?? i.ChannelNumber ?? '', name: i.Name, kind: 'tv', artwork: this.artwork(i).sort((a, b) => Number(b.kind === 'logo') - Number(a.kind === 'logo')).map(a => ({
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

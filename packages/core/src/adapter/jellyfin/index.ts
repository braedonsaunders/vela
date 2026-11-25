import type { RemoteSubtitle, SubtitleLanguages, SubtitleSearchResult, TitleActions } from '../media-actions';
import { deviceLanguages, iso6392, KNOWN_SUBTITLE_LANGUAGES, pickSubtitleLanguage, type SubtitleLanguage } from '../../subtitle-languages';
import { homeHeroes } from '../home-heroes';
import type * as V from '../../wire';
import type { CatalogueSearch, Credentials, Home, ServerAdapter, ServerDescription, TransportCommand } from '../index';
import type { ClientDeclaration, LibraryRecommendations, LiveTv, PasswordSignIn, QuickConnectSignIn, Reading, TitleChildren, TrackChanges, TrackCommand, TrickplaySheet, TrickplaySheets } from '../capabilities';
import { VelaError } from '../errors';
import { seriesOrder } from '../series';
import type { Item, Result, User, Auth, Info, MediaSource } from './types';
import { audioMime, DIRECT_AUDIO, foldAudiobooks, isAudioItem, jellyfinMarkers, readingFormat, readingMime, shelfOf, titleProjection, type MediaHint, type MediaSegment, type Shelf } from './media';
import { jellyfinTrickplay } from '../../protocol/trickplay';
/** The wire offer, without the media source it was read for. */
const offerOf = ({ sourceId: _source, ...offer }: V.TrickplayMetadata & { sourceId: string }): V.TrickplayMetadata => offer;
const seconds = (ticks?: number) => ticks === undefined ? undefined : ticks / 10000000;
const ticks = (value: number) => Math.round(value * 10000000);
const e = encodeURIComponent;
const offered: V.Feature = { available: true };
const fields = 'Overview,Genres,MediaSources,Chapters,People,PrimaryImageAspectRatio,UserData,Path,ChildCount,DateCreated,ParentId,ProductionYear,PremiereDate';
const kinds: Record<string, V.TitleKind> = {
    Movie: 'movie', Series: 'show', Season: 'season', Episode: 'episode'
};
/** Item types a search or a mixed row may show, beyond movies and shows. */
const MEDIA_TYPES = 'MusicArtist,MusicAlbum,Audio,AudioBook,Book,MusicVideo';
const READING: V.ReadingFormat[] = ['epub', 'pdf', 'cbz'];
const tab = (id: string, label: string, kind: V.LibraryTab['kind'], extra: Partial<V.LibraryTab> = {}): V.LibraryTab => ({ id, label, kind, ...extra });
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
    /** The media source whose scrub thumbnails the plan offers. */
    trickplaySource?: string;
}
/** All API requests are pinned to this server/base path and refuse redirects.
 * Media URLs contain no account credential. The host supplies scoped media headers.
 * Jellyfin has no refresh tokens: the token is validated, never fictitiously rotated.
 */
export class JellyfinAdapter
    implements ServerAdapter, PasswordSignIn, QuickConnectSignIn, ClientDeclaration, LiveTv, TrackChanges, TitleChildren, Reading, LibraryRecommendations, TrickplaySheets {
    private base: URL;
    private sessions = new Map<string, Session>();
    private starts = new Map<string, Promise<V.PlaybackPlan>>();
    /** Each library's shelf by id, learned from the viewer's views. */
    private shelves = new Map<string, Shelf>();
    /** What a books library holds, read once per library: tabs appear only for what is there. */
    private bookCounts = new Map<string, Promise<{ books: number; audiobooks: number }>>();
    /** Emby answers in its own shapes in a few places (audiobooks as albums, user data writes). */
    private emby?: boolean;
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
    /** This client's MediaBrowser authorization, with the session's token when there is one. */
    private authorization(tokens: V.Tokens | null): Record<string, string> {
        const quote = (s: string) => s.replace(/["\\\r\n]/g, '');
        const device = this.credentials.device;
        const authorization = `MediaBrowser Client="Vela", Device="${quote(device.name)}", DeviceId="${quote(device.id)}", Version="${quote(device.appVersion)}"${tokens ? `, Token="${quote(tokens.accessToken)}"` : ''}`;
        return { Authorization: authorization, ...(tokens ? { 'X-Emby-Token': tokens.accessToken } : {}) };
    }
    private async rejected(response: Response, tokens: V.Tokens | null): Promise<never> {
        if (response.status === 401 && tokens) {
            await this.credentials.set(null);
            this.sessions.clear();
            this.starts.clear();
            this.onSessionRejected?.();
        }
        throw this.error(response.status === 401 ? 'auth' : response.status === 404 ? 'not-found' : response.status === 403 ? 'policy' : 'request', 'jellyfin_http_error', `Server returned ${response.status}`, response.status);
    }
    private async request<T>(method: string, path: string, body?: unknown, auth = true, signal?: AbortSignal): Promise<T> {
        const tokens = auth ? await this.credentials.get() : null;
        if (auth && !tokens)
            throw this.error('auth', 'sign_in_required', 'Sign in required', 401);
        const response = await fetch(this.url(path).href, {
            method, signal, redirect: 'error', headers: {
                ...this.authorization(tokens), ...(body === undefined ? {} : {
                    'Content-Type': 'application/json'
                })
            }, ...(body === undefined ? {} : {
                body: JSON.stringify(body)
            })
        });
        if (!response.ok)
            await this.rejected(response, tokens);
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
        this.emby = !/jellyfin/i.test(info.ProductName ?? '');
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
            searchLibraries: true,
            searchKinds: [{ id: 'movie', label: 'Movies' }, { id: 'show', label: 'Shows' }],
            searchSorts: [{ id: 'relevance', label: 'Relevance', directions: [] }, ...['title', 'released', 'added', 'rating'].map(id => ({ id, directions: ['asc', 'desc'] as V.SearchDirection[] }))],
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
                // Music, books, audiobooks and photos map to Vela's media classes (./media.ts).
                mediaClasses: { available: true, classes: ['video', 'music', 'audiobook', 'book', 'photo'] },
                audioPlayback: offered,
                reading: { available: true, formats: READING },
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
        const backdropId = i.ParentBackdropItemId || (episode ? i.SeriesId : undefined);
        const logoId = i.ParentLogoItemId || (episode ? i.SeriesId : undefined);
        const seriesPoster = (episode || i.Type === 'Season') && i.SeriesId && i.SeriesPrimaryImageTag;
        if (seriesPoster) art.push(this.image(i.SeriesId!, 'Primary', i.SeriesPrimaryImageTag!, 'poster'));
        for (const [type, kind] of [['Primary', 'poster'], ['Thumb', 'still'], ['Logo', 'logo']] as const)
            if (i.ImageTags?.[type] && !(episode && type === 'Logo' && logoId && i.ParentLogoImageTag))
                if (!(seriesPoster && type === 'Primary' && !episode))
                    art.push(this.image(i.Id, type, i.ImageTags[type], episode && type === 'Primary' ? 'still' : kind));
        if ((!i.ImageTags?.Logo || episode) && logoId && i.ParentLogoImageTag)
            art.push(this.image(logoId, 'Logo', i.ParentLogoImageTag, 'logo'));
        if ((!i.BackdropImageTags?.[0] || episode) && backdropId && i.ParentBackdropImageTags?.[0])
            art.push(this.image(backdropId, 'Backdrop/0', i.ParentBackdropImageTags[0], 'backdrop'));
        if (i.BackdropImageTags?.[0] && !(episode && backdropId && i.ParentBackdropImageTags?.[0]))
            art.push(this.image(i.Id, 'Backdrop/0', i.BackdropImageTags[0], 'backdrop'));
        // A track without its own cover shows its album's.
        if (!i.ImageTags?.Primary && i.AlbumId && i.AlbumPrimaryImageTag)
            art.push(this.image(i.AlbumId, 'Primary', i.AlbumPrimaryImageTag, 'poster'));
        // A photo or a clip is its own picture, on landscape cards too.
        if ((i.Type === 'Photo' || i.Type === 'Video') && i.ImageTags?.Primary)
            art.push(this.image(i.Id, 'Primary', i.ImageTags.Primary, 'thumb'));
        return art;
    }
    private title(i: Item, hint?: MediaHint): V.Title {
        const projection = titleProjection(i, { ...hint, emby: this.emby });
        if (!projection)
            throw this.error('request', 'unsupported_item', 'Unsupported catalogue item');
        const fraction = projection.media?.reading ? bookFraction(i) : 0;
        const reading = fraction > 0
            ? { reading: { locator: '', fraction, updatedAt: i.UserData?.LastPlayedDate ?? new Date(0).toISOString() } } : {};
        return {
            ...(projection.media ? { media: projection.media } : {}),
            id: i.Id, kind: projection.kind, name: i.Name, summary: i.Overview ?? '', year: i.ProductionYear, airDate: i.PremiereDate?.slice(0, 10), genres: i.Genres ?? [], durationSeconds: seconds(i.RunTimeTicks), rating: i.OfficialRating, ratings: [...(i.CommunityRating === undefined ? [] : [{
                        source: 'Community', kind: 'audience' as const, value: i.CommunityRating, scale: 10
                    }]), ...(i.CriticRating === undefined ? [] : [{
                        source: 'Critic', kind: 'critic' as const, value: i.CriticRating, scale: 100
                    }])], artwork: this.artwork(i), showId: i.SeriesId, showName: i.SeriesName, seasonId: i.SeasonId, seasonNumber: i.Type === 'Season' ? i.IndexNumber : i.ParentIndexNumber, episodeNumber: i.Type === 'Episode' ? i.IndexNumber : undefined, watch: {
                positionSeconds: seconds(i.UserData?.PlaybackPositionTicks) ?? 0, played: i.UserData?.Played ?? false, favorite: i.UserData?.IsFavorite ?? false, watchlisted: false, ...reading
            }
        };
    }
    private isTitle(i: Item, hint?: MediaHint): boolean {
        return titleProjection(i, hint) !== undefined;
    }
    private entry(i: Item, hint?: MediaHint): V.RowEntry {
        if (this.isTitle(i, hint))
            return {
                id: i.Id, kind: 'title', receiptToken: '', title: this.title(i, hint)
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
        const [capabilities, rows] = await Promise.all([this.describe(), this.rows({})]);
        const featured = homeHeroes(rows.items, 'jellyfin', (path, width, height) => {
            const url = new URL(path); url.searchParams.set('maxWidth', String(width)); url.searchParams.set('maxHeight', String(height)); url.searchParams.set('quality', '90'); return url.href;
        });
        return { viewer: token.viewer, capabilities, defaultSkinId: 'cinematic', ...featured };
    }
    async rows(q: V.RowsQuery): Promise<V.Page<V.Row>> {
        if (q.placement === 'detail' && q.titleId) {
            const result = await this.request<Result>('GET', `Items/${e(q.titleId)}/Similar${query({
                UserId: (await this.credentials.get())?.viewer.id, Limit: q.limit ?? 20, Fields: fields
            })}`);
            return {
                items: [{
                        id: `similar:${q.titleId}`, name: 'Similar', purpose: 'recommendation', receiptToken: '', ...this.page(result.Items.filter(i => this.isTitle(i)).map(i => this.entry(i)), result, 0)
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
        const library = /^library:(.+):(latest|nextup)$/.exec(id);
        const source = library?.[2] ?? id;
        const parent = library?.[1];
        if (source === 'latest') {
            result = await this.request<Result>('GET', `${user}/Items${query({
                ...p, ParentId: parent, Recursive: true, EnableTotalRecordCount: true, Fields: fields, IncludeItemTypes: 'Movie,Series,Episode', SortBy: 'DateCreated', SortOrder: 'Descending'
            })}`);
        }
        else if (source === 'resume' || source === 'nextup')
            result = await this.request<Result>('GET', `${source === 'resume' ? `${user}/Items/Resume` : 'Shows/NextUp'}${query({
                ...p, ParentId: parent, EnableTotalRecordCount: true, UserId: (await this.credentials.get())?.viewer.id, Fields: fields, MediaTypes: 'Video'
            })}`);
        else
            throw this.error('not-found', 'row_not_found', 'Unknown row', 404);
        return {
            id, name: source === 'resume' ? 'Continue Watching' : source === 'nextup' ? 'Next Up' : 'Recently Added', purpose: source === 'resume' ? 'continue' : source === 'nextup' ? 'nextUp' : 'recentlyAdded', receiptToken: '', ...this.page(result.Items.filter(i => this.isTitle(i)).map(i => this.entry(i)), result, p.StartIndex)
        };
    }
    /** A media library's shelves: what was added, what is under way, what was played last. */
    private async mediaRows(id: string, shelf: Shelf): Promise<V.Row[]> {
        const user = await this.userPath();
        const base = { ParentId: id, Recursive: true, Fields: fields, Limit: 20, EnableTotalRecordCount: false };
        const row = async (key: string, name: string, purpose: V.Row['purpose'], params: Record<string, unknown>, audiobook = false): Promise<V.Row> => {
            const result = await this.request<Result>('GET', `${user}/Items${query({ ...base, ...params })}`);
            const items = audiobook ? await this.foldedEntries(result.Items, true) : result.Items.filter(i => this.isTitle(i)).map(i => this.entry(i));
            return { id: `library:${id}:${key}`, name, purpose, receiptToken: '', items, continuation: 'exhausted' };
        };
        const added = { SortBy: 'DateCreated', SortOrder: 'Descending' };
        const played = { SortBy: 'DatePlayed', SortOrder: 'Descending', Filters: 'IsPlayed' };
        const audio = this.emby ? 'Audio' : 'AudioBook';
        const resume = (types: string): Promise<V.Row> => this.request<Result>('GET', `${user}/Items/Resume${query({ ParentId: id, Limit: 20, Fields: fields, MediaTypes: types === 'Book' ? 'Book' : 'Audio', IncludeItemTypes: types })}`)
            .then(async result => ({ id: `library:${id}:resume`, name: types === 'Book' ? 'Continue Reading' : 'Continue Listening', purpose: 'continue' as const, receiptToken: '',
                items: types === 'Book' ? result.Items.filter(i => this.isTitle(i)).map(i => this.entry(i)) : await this.foldedEntries(result.Items, true), continuation: 'exhausted' as const }))
            .catch(() => ({ id: `library:${id}:resume`, name: '', purpose: 'continue' as const, receiptToken: '', items: [], continuation: 'exhausted' as const }));
        switch (shelf) {
            case 'music': return Promise.all([
                row('latest', 'Recently Added', 'recentlyAdded', { ...added, IncludeItemTypes: 'MusicAlbum' }),
                row('played', 'Recently Played', 'recommendation', { ...played, IncludeItemTypes: 'Audio' }),
                row('favorites', 'Favourites', 'recommendation', { SortBy: 'SortName', Filters: 'IsFavorite', IncludeItemTypes: 'MusicAlbum,Audio,MusicArtist' }),
            ]);
            case 'books': case 'audiobooks': {
                const counts = shelf === 'books' ? await this.bookCountsOf(id) : { books: 0, audiobooks: 1 };
                return Promise.all([
                    ...(counts.books ? [resume('Book'), row('latest-books', 'Recently Added Books', 'recentlyAdded', { ...added, IncludeItemTypes: 'Book' })] : []),
                    ...(counts.audiobooks ? [resume(audio), row('latest-audiobooks', 'Recently Added Audiobooks', 'recentlyAdded', { ...added, IncludeItemTypes: audio, Limit: 60 }, true)] : []),
                ]);
            }
            case 'photos': return Promise.all([row('latest', 'Recently Added', 'recentlyAdded', { ...added, IncludeItemTypes: 'Photo,Video' })]);
            default: return Promise.all([row('latest', 'Recently Added', 'recentlyAdded', { ...added, IncludeItemTypes: shelf === 'musicvideos' ? 'MusicVideo' : 'Movie,Series,Video,MusicVideo' })]);
        }
    }
    async libraryRows(id: string, kind: V.Library['kind']): Promise<V.Row[]> {
        // Movies and shows libraries are what they say; any other kind may be a media library.
        const shelf = kind === 'movies' || kind === 'shows' ? kind : await this.shelf(id);
        if (!['movies', 'shows', 'mixed', 'live'].includes(shelf))
            return (await this.mediaRows(id, shelf)).filter(row => row.items.length > 0);
        const user = await this.userPath();
        const userId = (await this.credentials.get())?.viewer.id;
        const rows: V.Row[] = [await this.row(`library:${id}:latest`)];
        if (kind === 'movies') {
            const suggestions = await this.request<{ BaselineItemName?: string; CategoryId?: string; RecommendationType?: string; Items: Item[] }[]>('GET', `Movies/Recommendations${query({ ParentId: id, UserId: userId, Fields: fields, CategoryLimit: 5, ItemLimit: 20 })}`);
            rows.push(...suggestions.map((group, index): V.Row => ({ id: `library:${id}:suggestion:${group.CategoryId ?? index}`, name: group.BaselineItemName || 'Suggested for you', purpose: 'recommendation', receiptToken: '', items: (group.Items ?? []).filter(i => this.isTitle(i)).map(i => this.entry(i)), continuation: 'exhausted' })));
        } else if (kind === 'shows') {
            rows.unshift(await this.row(`library:${id}:nextup`));
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
    private libraryModel(i: Item, counts?: { books: number; audiobooks: number }): V.Library {
        const shelf = shelfOf(i.CollectionType);
        const sorts = Object.keys(sortKeys).map(id => ({ id: id as V.LibrarySort, directions: ['asc', 'desc'] as V.SortDirection[] }));
        const browse = (filters: V.LibraryBrowseOptions['filters']): V.LibraryBrowseOptions => ({ sorts, defaultSort: 'title', defaultDirection: 'asc', filters });
        const base = { id: i.Id, name: i.Name, artwork: this.artwork(i) };
        const media = { genre: true, year: true, played: true, favorite: true };
        const recommended = tab('recommended', 'Recommended', 'recommended');
        switch (shelf) {
            case 'music': return { ...base, kind: 'mixed', media: 'music', presentation: { card: 'square' }, browse: browse(media), tabs: [recommended,
                tab('albums', 'Albums', 'library'), tab('artists', 'Artists', 'library', { level: 'artist' }), tab('tracks', 'Songs', 'library', { level: 'track', layout: 'list' })] };
            case 'books': {
                // A books library may hold books, audiobooks or both (Jellyfin keeps audiobooks there).
                const audiobooksOnly = !!counts && !counts.books && counts.audiobooks > 0;
                const both = !!counts && counts.books > 0 && counts.audiobooks > 0;
                return { ...base, kind: 'mixed', media: audiobooksOnly ? 'audiobook' : 'book', presentation: { card: audiobooksOnly ? 'square' : 'poster' }, browse: browse(media),
                    tabs: [recommended, tab('library', audiobooksOnly ? 'Audiobooks' : 'Books', 'library'), ...(both ? [tab('audiobooks', 'Audiobooks', 'library', { level: 'audiobook', card: 'square' })] : [])] };
            }
            case 'audiobooks': return { ...base, kind: 'mixed', media: 'audiobook', presentation: { card: 'square' }, browse: browse(media), tabs: [recommended, tab('library', 'Audiobooks', 'library')] };
            case 'photos': return { ...base, kind: 'mixed', media: 'photo', presentation: { card: 'square' }, dateDisplay: 'date', browse: browse({ year: true, favorite: true }), tabs: [recommended, tab('library', 'Library', 'library')] };
            case 'musicvideos': return { ...base, kind: 'mixed', presentation: { card: 'landscape' }, browse: browse(media) };
            case 'playlists': return { ...base, kind: 'mixed', browse: browse({}), tabs: [tab('library', 'Playlists', 'library')] };
            case 'boxsets': return { ...base, kind: 'mixed', browse: browse({}), tabs: [tab('library', 'Collections', 'library')] };
            default: return { ...base, kind: shelf === 'movies' ? 'movies' : shelf === 'shows' ? 'shows' : shelf === 'live' ? 'live' : 'mixed',
                browse: browse({ kind: ['movie', 'show', 'season', 'episode'], genre: true, year: true, played: true, favorite: true }) };
        }
    }
    /** A library's shelf, from the views when the id is one of them, else its own CollectionType. */
    private async shelf(id: string): Promise<Shelf> {
        const known = this.shelves.get(id);
        if (known) return known;
        const item = await this.request<Item>('GET', `${await this.userPath()}/Items/${e(id)}`).catch(() => undefined);
        const shelf = shelfOf(item?.CollectionType);
        this.shelves.set(id, shelf);
        return shelf;
    }
    private bookCountsOf(id: string): Promise<{ books: number; audiobooks: number }> {
        let counts = this.bookCounts.get(id);
        if (!counts) {
            counts = (async () => {
                const user = await this.userPath();
                const total = (types: string) => this.request<Result>('GET', `${user}/Items${query({ ParentId: id, Recursive: true, IncludeItemTypes: types, Limit: 0, EnableTotalRecordCount: true })}`).then(r => r.TotalRecordCount ?? r.Items.length);
                // Emby keeps audiobooks in a library type of their own and has no AudioBook items.
                const [books, audiobooks] = await Promise.all([total('Book'), (await this.isEmby()) ? 0 : total('AudioBook')]);
                return { books, audiobooks };
            })();
            this.bookCounts.set(id, counts);
            void counts.catch(() => this.bookCounts.delete(id));
        }
        return counts;
    }
    /** Emby names no product in its public info; Jellyfin does. Unknown until the server answers. */
    private async isEmby(): Promise<boolean> {
        if (this.emby === undefined) {
            const info = await this.request<Info>('GET', 'System/Info/Public', undefined, false).catch(() => undefined);
            if (!info) return false;
            this.emby = !/jellyfin/i.test(info.ProductName ?? '');
        }
        return this.emby;
    }
    async libraries(q: V.LibrariesQuery): Promise<V.Page<V.Library>> {
        const result = await this.request<Result>('GET', `${await this.userPath()}/Views`);
        const p = this.paging(q.cursor, q.limit);
        const items = result.Items.slice(p.StartIndex, p.StartIndex + p.Limit);
        for (const i of result.Items) this.shelves.set(i.Id, shelfOf(i.CollectionType));
        const counts = await Promise.all(items.map(i => shelfOf(i.CollectionType) === 'books' ? this.bookCountsOf(i.Id).catch(() => undefined) : undefined));
        return this.page(items.map((i, n) => this.libraryModel(i, counts[n])), {
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
        const shelf = shelfOf(item.CollectionType);
        this.shelves.set(id, shelf);
        const counts = shelf === 'books' ? await this.bookCountsOf(id) : undefined;
        const library = this.libraryModel(item, counts);
        const order = { SortBy: sortKeys[sort], SortOrder: q.direction === 'desc' ? 'Descending' : 'Ascending' };
        const filters = { Genres: q.genre, Years: q.year, IsPlayed: q.played, IsFavorite: q.favorite };
        const contents = (page: V.Page<V.RowEntry>, total?: number): V.LibraryContents => ({ library, sort, direction: q.direction ?? 'asc', ...page, ...(total !== undefined ? { total } : {}) });
        const audiobooks = shelf === 'audiobooks' || (shelf === 'books' && (q.tab === 'audiobooks' || (!!counts && !counts.books && counts.audiobooks > 0)));
        if (audiobooks) {
            const page = await this.audiobookPage(id, p, order, filters, sort === 'title');
            return contents(page.page, page.total);
        }
        const params: Record<string, unknown> = (() => {
            switch (shelf) {
                case 'music': return q.tab === 'artists' ? {} : { Recursive: true, IncludeItemTypes: q.tab === 'tracks' ? 'Audio' : 'MusicAlbum' };
                case 'books': return { Recursive: true, IncludeItemTypes: 'Book' };
                // Albums of photos open as directories; the root lists them with any loose photos and clips.
                case 'photos': return { SortBy: q.sort ? order.SortBy : 'IsFolder,SortName' };
                case 'musicvideos': return { Recursive: true, IncludeItemTypes: 'MusicVideo' };
                case 'playlists': return { Recursive: true, IncludeItemTypes: 'Playlist' };
                case 'boxsets': return { Recursive: true, IncludeItemTypes: 'BoxSet' };
                default: return { Recursive: true, IncludeItemTypes: q.kind ? Object.keys(kinds).find(k => kinds[k] === q.kind) : 'Movie,Series' };
            }
        })();
        // Artists are read from the artists index, scoped to the library like every other listing.
        const artists = shelf === 'music' && q.tab === 'artists';
        const result = await this.request<Result>('GET', `${artists ? 'Artists/AlbumArtists' : `${user}/Items`}${query({ ...p, ParentId: id, Fields: fields, ...order, ...filters,
            EnableTotalRecordCount: true, ...(artists ? { UserId: (await this.credentials.get())?.viewer.id } : {}), ...params })}`);
        return contents(this.page(result.Items.map(i => this.entry(i)), result, p.StartIndex), result.TotalRecordCount);
    }
    /** A page of audiobooks with each multi-file book folded into one title. The whole library is
     * indexed first (ids and groups only), so a book's parts are never split across pages. */
    private async audiobookPage(id: string, p: { StartIndex: number; Limit: number }, order: { SortBy?: string; SortOrder: string }, filters: object, byTitle: boolean): Promise<{ page: V.Page<V.RowEntry>; total: number }> {
        const emby = await this.isEmby();
        const user = await this.userPath();
        const scan: Item[] = [];
        for (;;) {
            const result = await this.request<Result>('GET', `${user}/Items${query({ ParentId: id, Recursive: true, IncludeItemTypes: emby ? 'Audio' : 'AudioBook', ...order, ...filters, Fields: 'ParentId', StartIndex: scan.length, Limit: 1000, EnableImages: false, EnableUserData: false, EnableTotalRecordCount: true })}`);
            scan.push(...result.Items);
            if (!result.Items.length || scan.length >= (result.TotalRecordCount ?? scan.length) || scan.length >= 20000) break;
        }
        const folded = foldAudiobooks(scan, emby);
        if (byTitle) {
            const name = (x: (typeof folded)[number]) => 'item' in x ? x.item.Name : x.parts[0]!.Album || x.parts[0]!.Name;
            folded.sort((a, b) => name(a).localeCompare(name(b), undefined, { sensitivity: 'base', numeric: true }) * (order.SortOrder === 'Descending' ? -1 : 1));
        }
        const slice = folded.slice(p.StartIndex, p.StartIndex + p.Limit);
        // A group is read with its first part, which names the author a folder does not.
        const ids = slice.flatMap(x => 'item' in x ? [x.item.Id] : [x.group, x.parts[0]!.Id]);
        const byId = await this.itemsById(ids);
        const items = slice.flatMap(x => {
            const i = byId.get('item' in x ? x.item.Id : x.group);
            if (!i) return [];
            const entry = this.entry(i, 'item' in x ? { audiobook: true } : { audiobook: true, group: true });
            if (entry.kind !== 'title' || !('parts' in x)) return [entry];
            const first = byId.get(x.parts[0]!.Id);
            const credits = entry.title.media?.credits?.length ? entry.title.media.credits : first ? this.title(first, { audiobook: true }).media?.credits ?? [] : [];
            return [{ ...entry, title: { ...entry.title, media: { ...entry.title.media!, childCount: x.parts.length, credits },
                durationSeconds: entry.title.durationSeconds || seconds(x.parts.reduce((sum, part) => sum + (part.RunTimeTicks ?? 0), 0)) } }];
        });
        return { page: this.page(items, { Items: slice as unknown as Item[], TotalRecordCount: folded.length }, p.StartIndex), total: folded.length };
    }
    /** Items by id. Emby's audiobook albums are virtual and only answer a read of their own. */
    private async itemsById(ids: string[]): Promise<Map<string, Item>> {
        if (!ids.length) return new Map();
        const user = await this.userPath();
        const read = await this.request<Result>('GET', `${user}/Items${query({ Ids: ids.join(','), Fields: fields })}`);
        const byId = new Map(read.Items.map(i => [i.Id, i]));
        await Promise.all(ids.filter(id => !byId.has(id)).map(async id => {
            const item = await this.request<Item>('GET', `${user}/Items/${e(id)}`).catch(() => undefined);
            if (item) byId.set(id, item);
        }));
        return byId;
    }
    /** Rows of audio items (a Continue or Recently Added shelf) with multi-file books shown once, as their book. */
    private async foldedEntries(items: Item[], audiobook: boolean): Promise<V.RowEntry[]> {
        const emby = await this.isEmby();
        const audio = items.filter(i => isAudioItem(i));
        const groups = new Set<string>();
        for (const i of audio) {
            const key = emby ? i.AlbumId ?? i.ParentId : i.ParentId;
            if (key) groups.add(key);
        }
        const multi = new Set<string>();
        await Promise.all([...groups].map(async key => {
            const count = await this.request<Result>('GET', `${await this.userPath()}/Items${query({ ParentId: key, IncludeItemTypes: emby ? 'Audio' : 'AudioBook', Limit: 0, EnableTotalRecordCount: true })}`).then(r => r.TotalRecordCount ?? 0).catch(() => 0);
            if (count > 1) multi.add(key);
        }));
        const parents = await this.itemsById([...multi]);
        const seen = new Set<string>();
        return items.flatMap(i => {
            const key = isAudioItem(i) ? (emby ? i.AlbumId ?? i.ParentId : i.ParentId) : undefined;
            const parent = key && multi.has(key) ? parents.get(key) : undefined;
            const shown = parent ?? i;
            if (seen.has(shown.Id) || !this.isTitle(shown, { audiobook, group: !!parent })) return [];
            seen.add(shown.Id);
            const entry = this.entry(shown, { audiobook, group: !!parent });
            // A folder names no author: the part shown in its place does.
            if (parent && entry.kind === 'title' && entry.title.media && !entry.title.media.credits?.length)
                entry.title.media = { ...entry.title.media, credits: this.title(i, { audiobook: true }).media?.credits ?? [] };
            return [entry];
        });
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
    async personTitles(id: string, libraryId?: string, cursor?: string): Promise<V.Page<V.RowEntry>> {
        const p = this.paging(cursor, 100);
        const result = await this.request<Result>('GET', `${await this.userPath()}/Items${query({
            ...p, ParentId: libraryId, PersonIds: id, Recursive: true, Fields: fields, IncludeItemTypes: 'Movie,Series'
        })}`);
        return this.page(result.Items.map(i => this.entry(i)), result, p.StartIndex);
    }
    private chapters(i: Item): V.Chapter[] {
        return (i.Chapters ?? []).map((c, n) => ({
            id: String(n), name: c.Name ?? `Chapter ${n + 1}`, startSeconds: seconds(c.StartPositionTicks)!, ...(i.Chapters?.[n + 1] ? {
                endSeconds: seconds(i.Chapters[n + 1].StartPositionTicks)
            } : {})
        }));
    }
    /** How a title reads in its library: audio in an audiobooks library is a book or a book's part;
     * a folder (Jellyfin) or album (Emby) holding a book's files is that book. */
    private async hintFor(item: Item): Promise<MediaHint> {
        const user = await this.userPath();
        const emby = await this.isEmby();
        const audioType = emby ? 'Audio' : 'AudioBook';
        const audioIn = (parent: string) => this.request<Result>('GET', `${user}/Items${query({ ParentId: parent, IncludeItemTypes: audioType, Limit: 0, EnableTotalRecordCount: true })}`)
            .then(r => r.TotalRecordCount ?? r.Items.length).catch(() => 0);
        const inAudiobooks = async (id: string) => emby && (await this.request<Item[]>('GET', `Items/${e(id)}/Ancestors${query({ UserId: (await this.credentials.get())?.viewer.id })}`).catch(() => []))
            .some(a => a.CollectionType === 'audiobooks');
        if (item.Type === 'Folder') return await audioIn(item.Id) > 0 ? { audiobook: true, group: true } : {};
        if (item.Type === 'MusicAlbum') {
            // Emby's albums are virtual and have no ancestors: an album is a book when its audio is in an audiobooks library.
            const first = emby ? (await this.request<Result>('GET', `${user}/Items${query({ ParentId: item.Id, Limit: 1 })}`).catch(() => undefined))?.Items[0] : undefined;
            return first && await inAudiobooks(first.Id) ? { audiobook: true, group: true } : {};
        }
        if (item.Type === 'AudioBook' || (item.Type === 'Audio' && await inAudiobooks(item.Id))) {
            const key = emby ? item.AlbumId ?? item.ParentId : item.ParentId;
            if (!key || await audioIn(key) < 2) return { audiobook: true };
            const name = item.Album || (await this.request<Item>('GET', `${user}/Items/${e(key)}`).catch(() => undefined))?.Name || '';
            return { audiobook: true, parent: { id: key, name } };
        }
        return {};
    }
    /** An artist's albums (newest first), an album's tracks, a multi-file book's parts. */
    async children(id: string, cursor?: string, limit = 100): Promise<V.ChildrenPage> {
        const user = await this.userPath();
        const p = this.paging(cursor, limit);
        const item = await this.request<Item>('GET', `${user}/Items/${e(id)}`);
        const hint = await this.hintFor(item);
        const read = async (params: Record<string, unknown>, childHint: MediaHint = {}): Promise<V.ChildrenPage> => {
            const result = await this.request<Result>('GET', `${user}/Items${query({ ...p, Fields: fields, EnableTotalRecordCount: true, ...params })}`);
            return this.page(result.Items.filter(i => this.isTitle(i, childHint)).map(i => this.title(i, childHint)), result, p.StartIndex);
        };
        if (item.Type === 'MusicArtist') {
            const newest = { IncludeItemTypes: 'MusicAlbum', SortBy: 'ProductionYear,SortName', SortOrder: 'Descending' };
            const tagged = await read({ AlbumArtistIds: id, Recursive: true, ...newest });
            // Albums without album-artist tags belong to the artist's folder (the Jellyfin demo's are so).
            return tagged.items.length || p.StartIndex ? tagged : read({ ParentId: id, ...newest });
        }
        if (hint.group)
            return read({ ParentId: id, IncludeItemTypes: (await this.isEmby()) ? 'Audio' : 'AudioBook', SortBy: 'ParentIndexNumber,IndexNumber,SortName' }, { audiobook: true, parent: { id, name: item.Name } });
        if (item.Type === 'MusicAlbum')
            return read({ ParentId: id, IncludeItemTypes: 'Audio', SortBy: 'ParentIndexNumber,IndexNumber,SortName' });
        return { items: [], continuation: 'exhausted' };
    }
    async detail(id: string): Promise<V.TitleDetail> {
        const item = await this.request<Item>('GET', `${await this.userPath()}/Items/${e(id)}`);
        if (!kinds[item.Type ?? ''] && item.Type !== 'MusicVideo' && item.Type !== 'Video' && item.Type !== 'Trailer') {
            const hint = await this.hintFor(item);
            const title = this.title(item, hint);
            const children = hint.group ? await this.children(id, undefined, 200).catch(() => undefined) : undefined;
            // A multi-file book's length is its parts'.
            if (children && !title.durationSeconds) title.durationSeconds = children.items.reduce((sum, part) => sum + (part.durationSeconds ?? 0), 0) || undefined;
            if (children && title.media && !title.media.childCount) title.media = { ...title.media, childCount: children.items.length };
            // A folder names no author: its parts do.
            if (children && title.media && !title.media.credits?.length && children.items[0]?.media?.credits?.length) title.media = { ...title.media, credits: children.items[0].media.credits };
            const people = (item.People ?? []).filter(p => p.Type !== 'Author' && p.Type !== 'Narrator').map(p => ({ ...(p.Id ? { id: p.Id } : {}), name: p.Name, role: p.Role || p.Type }));
            return { title, canPlay: isAudioItem(item) || !!children?.items.length, cast: [], crew: people, extras: [], chapters: this.chapters(item) };
        }
        const [trailers, extras] = await Promise.all(['LocalTrailers', 'SpecialFeatures'].map(path => this.request<Item[]>('GET', `Items/${e(id)}/${path}`).catch(error => {
            if (error instanceof VelaError && error.status === 404)
                return [];
            throw error;
        })));
        const people = (item.People ?? []).map(p => ({
            ...(p.Id ? { id: p.Id } : {}), name: p.Name, role: p.Role ?? p.Type, ...(p.PrimaryImageTag ? {
                artwork: this.image(p.Id, 'Primary', p.PrimaryImageTag, 'person')
            } : {})
        }));
        const source = item.MediaSources?.[0];
        const streams = source?.MediaStreams ?? [];
        const userId = (await this.credentials.get())?.viewer.id;
        const seriesId = item.Type === 'Series' ? id : item.Type === 'Season' ? item.SeriesId : undefined;
        const seasons = item.Type === 'Series' ? await this.every(`Shows/${e(id)}/Seasons`, { UserId: userId }) : undefined;
        const episodes = seriesId ? await this.every(`Shows/${e(seriesId)}/Episodes`, {
            UserId: userId, SeasonId: item.Type === 'Season' ? id : undefined, SortBy: 'ParentIndexNumber,IndexNumber', SortOrder: 'Ascending'
        }) : undefined;
        const next = seriesId ? await this.request<Result>('GET', `Shows/NextUp${query({
            UserId: userId, SeriesId: seriesId, Limit: 1, Fields: fields, EnableResumable: true
        })}`) : undefined;
        const nextItem = next?.Items[0];
        return {
            title: this.title(item), canPlay: ['Movie', 'Episode', 'MusicVideo', 'Video', 'Trailer'].includes(item.Type ?? ''), seasons: seasons ? seriesOrder(seasons) : undefined,
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
    private async every(path: string, params: object): Promise<V.Title[]> {
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
    async search(r: CatalogueSearch, signal?: AbortSignal): Promise<V.SearchResponse> {
        const p = this.paging(r.cursor, r.limit);
        const result = await this.request<Result>('GET', `${await this.userPath()}/Items${query({
            ...p, ParentId: r.library, SearchTerm: r.query, Recursive: true, IncludeItemTypes: r.kind === 'movie' ? 'Movie' : r.kind === 'show' ? 'Series' : `Movie,Series,Season,Episode,${MEDIA_TYPES}`,
            SortBy: r.sort && r.sort !== 'relevance' ? ({ title: 'SortName', released: 'PremiereDate', added: 'DateCreated', rating: 'CommunityRating' } as Record<string, string>)[r.sort] : undefined,
            SortOrder: r.sort && r.sort !== 'relevance' ? (r.direction === 'desc' ? 'Descending' : 'Ascending') : undefined, Fields: fields
        })}`, undefined, true, signal);
        return {
            query: r.query, generation: r.generation, ...this.page(result.Items.filter(i => this.isTitle(i)).map(i => this.title(i, i.Type === 'AudioBook' ? { audiobook: true } : undefined)), result, p.StartIndex)
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
        return withToken(url, token.accessToken);
    }
    /** Audio plays as the file where every platform's audio player decodes it, else as MP3. */
    private audioProfile(c: V.ClientCapabilities) {
        return {
            Name: 'Vela', MaxStreamingBitrate: c.maxBitrate ?? 120000000, MusicStreamingTranscodingBitrate: 320000,
            DirectPlayProfiles: [{ Type: 'Audio', Container: DIRECT_AUDIO.join(',') }],
            TranscodingProfiles: [{ Type: 'Audio', Container: 'mp3', AudioCodec: 'mp3', Protocol: 'http', Context: 'Streaming', MaxAudioChannels: '2' }],
            SubtitleProfiles: []
        };
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
    async titleActions(id: string): Promise<TitleActions> {
        const item = await this.request<Item>('GET', `${await this.userPath()}/Items/${e(id)}`);
        return { watched: true, favorite: true, watchlist: false, removeFromContinue: false, watch: this.title(item).watch!, versions: (item.MediaSources || []).flatMap(s => {
            const audio = (s.MediaStreams || []).filter(t => t.Type === 'Audio');
            return audio.length > 1 ? audio.map(t => ({ id: s.Id, audioTrackId: String(t.Index), name: `${s.Name || s.Id} · ${t.DisplayTitle || t.Language || t.Codec}` })) : [{ id: s.Id, name: s.Name || s.Id }];
        }) };
    }
    async setTitleWatch(id: string, change: V.WatchRequest) {
        if (change.continueWatching !== undefined) throw new Error('Removing from Continue Watching is unavailable');
        const user = await this.userPath();
        if (change.played !== undefined) await this.request(change.played ? 'POST' : 'DELETE', `${user}/PlayedItems/${e(id)}`);
        if (change.favorite !== undefined) await this.request(change.favorite ? 'POST' : 'DELETE', `${user}/FavoriteItems/${e(id)}`);
    }
    /** A book's file, as the server's own download. The reader fetches it without headers, so the
     * URL carries the session token, minted per open and never stored. */
    async openReading(id: string, _r: V.ReadingRequest): Promise<V.ReadingGrant> {
        const item = await this.request<Item>('GET', `${await this.userPath()}/Items/${e(id)}${query({ Fields: 'Path,MediaSources' })}`);
        const format = item.Type === 'Book' ? readingFormat(item) : undefined;
        if (!format) throw this.error('request', 'not_readable', 'This title cannot be read here');
        const token = await this.credentials.get();
        if (!token) throw this.error('auth', 'sign_in_required', 'Sign in required', 401);
        const url = withToken(this.url(`Items/${e(id)}/Download`), token.accessToken);
        const title = this.title(item);
        return { titleId: id, format, mimeType: readingMime[format], url, expiresAt: new Date(Date.now() + 6 * 3600_000).toISOString(),
            ...(item.MediaSources?.[0]?.Size ? { byteLength: item.MediaSources[0].Size } : {}), ...(title.watch?.reading ? { progress: title.watch.reading } : {}) };
    }
    /** The servers keep how far through a book the viewer is, not where: the place is the fraction,
     * kept as the position in the book's runtime (bookFraction). */
    async saveReadingProgress(id: string, r: V.ReadingProgressRequest): Promise<V.Ack> {
        const fraction = Math.min(1, Math.max(0, r.fraction));
        const user = await this.userPath();
        const item = await this.request<Item>('GET', `${user}/Items/${e(id)}`);
        const body = { PlaybackPositionTicks: Math.round(fraction * (item.RunTimeTicks || BOOK_TICKS)), Played: fraction >= 0.98, LastPlayedDate: new Date().toISOString() };
        if (await this.isEmby()) await this.request('POST', `${user}/Items/${e(id)}/UserData`, body);
        else await this.request('POST', `UserItems/${e(id)}/UserData${query({ userId: (await this.credentials.get())?.viewer.id })}`, body)
            .catch(error => {
                if (error instanceof VelaError && error.status === 404) return this.request('POST', `${user}/Items/${e(id)}/UserData`, body);
                throw error;
            });
        return { accepted: true };
    }
    private cultures?: Promise<SubtitleLanguage[]>;
    /** The server's cultures (three-letter codes, its own names); the viewer's subtitle language preference first. */
    async subtitleLanguages(_sessionId: string): Promise<SubtitleLanguages> {
        this.cultures ??= this.request<{ DisplayName?: string; ThreeLetterISOLanguageName?: string }[]>('GET', 'Localization/Cultures')
            .then(list => list.flatMap(c => c.ThreeLetterISOLanguageName ? [{ code: c.ThreeLetterISOLanguageName, ...(c.DisplayName ? { name: c.DisplayName } : {}) }] : []))
            .catch(() => KNOWN_SUBTITLE_LANGUAGES.map(code => ({ code: iso6392(code) })));
        const [languages, user] = await Promise.all([this.cultures, this.userPath().then(path => this.request<User>('GET', path)).catch(() => undefined)]);
        const preferred = user?.Configuration?.SubtitleLanguagePreference;
        return { languages: languages.length ? languages : KNOWN_SUBTITLE_LANGUAGES.map(code => ({ code: iso6392(code) })), preferred: preferred ? [preferred] : [] };
    }
    async searchSubtitles(sessionId: string, language?: string): Promise<SubtitleSearchResult> {
        const s = this.session(sessionId);
        const { languages, preferred } = await this.subtitleLanguages(sessionId);
        const searched = language ?? pickSubtitleLanguage(languages, [...preferred, ...deviceLanguages()]) ?? 'eng';
        const results = await this.request<RemoteSubtitleInfo[]>('GET', `Items/${e(s.itemId)}/RemoteSearch/Subtitles/${e(searched)}`);
        return { language: searched, preferred, offers: results.map(t => jellyfinSubtitleOffer(t, searched)) };
    }
    async downloadSubtitle(sessionId: string, id: string, _idempotencyKey?: string): Promise<V.PlaybackPlan> {
        const s = this.session(sessionId);
        await this.request('POST', `Items/${e(s.itemId)}/RemoteSearch/Subtitles/${e(id)}`);
        const item = await this.request<Item>('GET', `${await this.userPath()}/Items/${e(s.itemId)}`);
        const source = item.MediaSources?.find(m => m.Id === s.source.Id);
        for (const t of source?.MediaStreams || []) {
            if (t.Type !== 'Subtitle' || s.plan.subtitleTracks.some(p => p.id === String(t.Index))) continue;
            const url = this.mediaURL(this.url(`Videos/${e(s.itemId)}/${e(s.source.Id)}/Subtitles/${t.Index}/Stream.vtt`).href);
            s.plan.subtitleTracks.push({ id: String(t.Index), kind: 'subtitle', name: t.DisplayTitle || t.Language || 'Subtitle', language: t.Language || 'und', codec: 'webvtt', delivery: { kind: 'external', format: 'webvtt', url } });
        }
        s.plan.revision++;
        return structuredClone(s.plan);
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
        const audio = isAudioItem(item) && !r.channelId;
        // Intro and outro segments (Jellyfin 10.10+), read beside the playback answer; none from an older server.
        const segments = audio || r.channelId || r.extraId ? Promise.resolve(undefined)
            : this.request<{ Items?: MediaSegment[] }>('GET', `MediaSegments/${e(id)}?includeSegmentTypes=Intro&includeSegmentTypes=Outro`).then(answer => answer.Items, () => undefined);
        const position = r.positionSeconds ?? seconds(item.UserData?.PlaybackPositionTicks) ?? 0;
        const info = await this.request<{
            PlaySessionId?: string;
            MediaSources: MediaSource[];
            ErrorCode?: string;
        }>('POST', `Items/${e(id)}/PlaybackInfo`, {
            UserId: (await this.credentials.get())?.viewer.id, DeviceProfile: audio ? this.audioProfile(r.client) : this.profile(r.client), StartTimeTicks: ticks(position),
            ...(r.mediaSourceId ? { MediaSourceId: r.mediaSourceId } : {}),
            IsPlayback: true, AutoOpenLiveStream: !!r.channelId, EnableDirectPlay: !r.channelId, EnableDirectStream: true,
            EnableTranscoding: r.allowTranscode !== false, MaxStreamingBitrate: r.client.maxBitrate ?? 120000000,
            ...(r.audioTrackId !== undefined ? {
                AudioStreamIndex: this.trackIndex(r.audioTrackId)
            } : {}),
            ...(r.subtitleTrackId !== undefined ? {
                SubtitleStreamIndex: r.subtitleTrackId === null ? -1 : this.trackIndex(r.subtitleTrackId)
            } : {}),
        });
        let source = r.mediaSourceId ? info.MediaSources?.find(s => s.Id === r.mediaSourceId) : info.MediaSources?.find(s => s.SupportsDirectPlay) ?? info.MediaSources?.[0];
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
        if (audio) {
            // An audio title: its file where it plays as is, else the server's progressive transcode.
            if (source.SupportsDirectPlay && DIRECT_AUDIO.includes((source.Container ?? '').toLowerCase().split(',')[0]!))
                paths.push({ id: 'direct', kind: 'direct', transport: 'file', mimeType: audioMime(source.Container), sourceId: source.Id, original: true, range: true, byteLength: source.Size, readiness: 'ready',
                    url: this.url(`Audio/${e(id)}/stream${query({ Static: true, MediaSourceId: source.Id, PlaySessionId: sessionId, DeviceId: r.client.device.id })}`).href, qualities: [], boundaries: [] });
            else if (source.TranscodingUrl && r.allowTranscode !== false) {
                const hls = source.TranscodingSubProtocol === 'hls';
                paths.push({ id: 'transcode', kind: 'transcode', transport: hls ? 'hls' : 'file', mimeType: hls ? 'application/vnd.apple.mpegurl' : 'audio/mpeg', sourceId: source.Id, readiness: 'ready',
                    url: this.mediaURL(source.TranscodingUrl), ...(hls ? { timelineOriginSeconds: position } : {}), qualities: [], boundaries: [] });
            }
        }
        else if (source.SupportsDirectPlay && !r.channelId) {
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
        if (!audio && source.TranscodingUrl && r.allowTranscode !== false && (r.client.hls || r.client.mse))
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
        const trickplay = r.channelId ? null : jellyfinTrickplay(item.Trickplay, source.Id);
        const markers = jellyfinMarkers(await segments, seconds(source.RunTimeTicks ?? item.RunTimeTicks));
        const plan: V.PlaybackPlan = {
            sessionId, revision: 1, sourceGeneration: 0, seekGeneration: 0, ...(audio ? { media: 'audio' as const } : {}), ...(trickplay ? { trickplay: offerOf(trickplay) } : {}), ...(markers ? { markers } : {}), ...(r.channelId ? {
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
            plan, itemId: id, client: r.client, playSessionId: sessionId, source, sequence: -1, started: false, stopped: false, pending: Promise.resolve(), mutations: new Map(),
            ...(trickplay ? { trickplaySource: trickplay.sourceId } : {})
        });
        return plan;
    }
    /** The item's scrub thumbnails, read again: a server that makes them while a session streams
     * offers them only after playback starts. The plan keeps what the session started with. */
    async trickplayOffer(sessionId: string): Promise<V.TrickplayMetadata | null> {
        const s = this.session(sessionId);
        if (s.plan.channelId)
            return null;
        const item = await this.request<Item>('GET', `${await this.userPath()}/Items/${e(s.itemId)}${query({ Fields: 'Trickplay,MediaSources' })}`);
        const trickplay = jellyfinTrickplay(item.Trickplay, s.source.Id);
        if (!trickplay)
            return null;
        s.trickplaySource = trickplay.sourceId;
        return offerOf(trickplay);
    }
    async trickplaySheet(sessionId: string, offer: V.TrickplayMetadata, index: number, etag?: string, signal?: AbortSignal): Promise<TrickplaySheet | null> {
        const s = this.session(sessionId);
        if (!Number.isInteger(index) || index < 0 || !Number.isInteger(offer.width) || offer.width <= 0)
            return null;
        const tokens = await this.credentials.get();
        if (!tokens)
            throw this.error('auth', 'sign_in_required', 'Sign in required', 401);
        const path = `Videos/${e(s.itemId)}/Trickplay/${offer.width}/${index}.jpg${query({ MediaSourceId: s.trickplaySource ?? s.source.Id })}`;
        const response = await fetch(this.url(path).href, { signal, redirect: 'error', headers: { ...this.authorization(tokens), ...(etag ? { 'If-None-Match': etag } : {}) } });
        if (response.status === 304 && etag)
            return 'unchanged';
        if (response.status === 404)
            return null;
        if (!response.ok)
            await this.rejected(response, tokens);
        const bytes = new Uint8Array(await response.arrayBuffer());
        const tag = response.headers.get('etag');
        return { bytes, mimeType: response.headers.get('content-type') ?? 'image/jpeg', ...(tag ? { etag: tag } : {}) };
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
/** A token as a query parameter, for a player or reader that sends no headers: Emby and older
 * Jellyfin read `api_key`, Jellyfin 10.11 and later only `ApiKey`; each ignores the other. */
function withToken(url: URL, token: string): string {
    url.searchParams.set('api_key', token);
    url.searchParams.set('ApiKey', token);
    return url.href;
}
/** A book without a runtime (Emby's) keeps its place as a fraction of one virtual second. */
const BOOK_TICKS = 10_000_000;
/** How far through a book the viewer is: Jellyfin derives PlayedPercentage from the position in the
 * book's runtime; Emby books have no runtime and keep the position as a fraction of BOOK_TICKS. */
export function bookFraction(i: Item): number {
    const percent = i.UserData?.PlayedPercentage;
    const position = i.UserData?.PlaybackPositionTicks ?? 0;
    const value = percent !== undefined && percent > 0 ? percent / 100 : position > 0 ? position / (i.RunTimeTicks || BOOK_TICKS) : 0;
    return Math.min(1, Math.max(0, value));
}
function query(values: object): string {
    const params = Object.entries(values).filter(([, v]) => v !== undefined).map(([k, v]) => `${e(k)}=${e(String(v))}`);
    return params.length ? `?${params.join('&')}` : '';
}

/** Jellyfin's and Emby's RemoteSubtitleInfo. */
interface RemoteSubtitleInfo { Id: string; Name?: string; Language?: string; ThreeLetterISOLanguageName?: string; ProviderName?: string; Format?: string; Author?: string;
    DownloadCount?: number; CommunityRating?: number; IsHashMatch?: boolean; HearingImpaired?: boolean; Forced?: boolean; AiTranslated?: boolean; MachineTranslated?: boolean }
export function jellyfinSubtitleOffer(t: RemoteSubtitleInfo, searched: string): RemoteSubtitle {
    const offer: RemoteSubtitle = { id: t.Id, name: t.Name || t.ProviderName || searched, language: t.ThreeLetterISOLanguageName || t.Language || searched };
    if (t.ProviderName) offer.provider = t.ProviderName;
    if (t.Format) offer.format = t.Format;
    if (t.Author) offer.author = t.Author;
    if (typeof t.DownloadCount === 'number' && t.DownloadCount >= 0) offer.downloads = t.DownloadCount;
    if (typeof t.CommunityRating === 'number' && t.CommunityRating > 0) offer.rating = Math.min(10, t.CommunityRating);
    if (t.IsHashMatch) offer.releaseMatch = true;
    if (t.HearingImpaired) offer.hearingImpaired = true;
    if (t.Forced) offer.forced = true;
    if (t.AiTranslated || t.MachineTranslated) offer.aiTranslated = true;
    return offer;
}

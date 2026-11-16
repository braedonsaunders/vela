/** Jellyfin BaseItemDto subset, shared by compatible Emby endpoints. */
export interface Item {
    Id: string;
    Name: string;
    Type?: string;
    Overview?: string;
    ProductionYear?: number;
    PremiereDate?: string;
    Genres?: string[];
    RunTimeTicks?: number;
    OfficialRating?: string;
    CommunityRating?: number;
    CriticRating?: number;
    SeriesId?: string;
    SeriesName?: string;
    SeriesPrimaryImageTag?: string;
    SeasonId?: string;
    ParentIndexNumber?: number;
    IndexNumber?: number;
    CollectionType?: string;
    ImageTags?: Record<string, string>;
    BackdropImageTags?: string[];
    ParentBackdropItemId?: string;
    ParentBackdropImageTags?: string[];
    ParentLogoItemId?: string;
    ParentLogoImageTag?: string;
    UserData?: {
        PlaybackPositionTicks?: number;
        Played?: boolean;
        IsFavorite?: boolean;
    };
    People?: {
        Id: string;
        Name: string;
        Role?: string;
        Type?: string;
        PrimaryImageTag?: string;
    }[];
    Chapters?: {
        Name?: string;
        StartPositionTicks: number;
    }[];
    MediaSources?: MediaSource[];
    StartDate?: string;
    EndDate?: string;
    ChannelId?: string;
    Number?: string;
    ChannelNumber?: string;
    EpisodeTitle?: string;
}
export interface Stream {
    Index: number;
    Type: string;
    Codec?: string;
    Language?: string;
    DisplayTitle?: string;
    Title?: string;
    Channels?: number;
    Width?: number;
    Height?: number;
    BitDepth?: number;
    ColorTransfer?: string;
    IsDefault?: boolean;
    IsForced?: boolean;
    IsHearingImpaired?: boolean;
    IsTextSubtitleStream?: boolean;
    DeliveryUrl?: string;
}
export interface MediaSource {
    Id: string;
    Container?: string;
    Size?: number;
    RunTimeTicks?: number;
    MediaStreams?: Stream[];
    SupportsDirectPlay?: boolean;
    SupportsDirectStream?: boolean;
    SupportsTranscoding?: boolean;
    DirectStreamUrl?: string;
    TranscodingUrl?: string;
    TranscodingSubProtocol?: string;
    DefaultAudioStreamIndex?: number;
    DefaultSubtitleStreamIndex?: number;
    LiveStreamId?: string;
    RequiresOpening?: boolean;
    OpenToken?: string;
    Path?: string;
    Protocol?: string;
}
export interface Result {
    Items: Item[];
    TotalRecordCount?: number;
    StartIndex?: number;
}
export interface User {
    Id: string;
    Name: string;
    PrimaryImageTag?: string;
    Policy?: {
        EnableLiveTvAccess?: boolean;
    };
}
export interface Auth {
    AccessToken: string;
    User: User;
}
export interface Info {
    Id: string;
    ServerName: string;
    Version: string;
    ProductName?: string;
}

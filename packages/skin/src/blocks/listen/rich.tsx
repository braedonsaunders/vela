// The Listen rich blocks as document nodes (docs/experiences.md: Blocks; the registry is
// packages/protocol/rich-blocks.ts). The resolver hands a block its props (holes compiled as
// arguments), its parts (document, node and skin styles already merged) and its part templates;
// this file reads them in the block's context, publishes the parts and templates to the engine
// below (look.tsx), and draws the engine. Engines keep their own data reads, focus and timing.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform, View } from 'react-native';
import { currentInQueue, msg, withBand, type HistoryRecapPeriod } from '@vela/core';
import { useVela, useVelaState } from '@vela/core/react';
import { useHost, type ScreenPress } from '../../host';
import { fill, type RNode } from '../../resolve';
import type { Arg } from '../../screen/holes';
import { bind } from '../../screen/items';
import { useScopedReads } from '../../screen/scoped-reads';
import type { Ctx, Env } from '../../vocabulary';
import { useMediaLook } from '../../widgets/media/parts';
import { useScreenBlockRuntime } from '../types';
import { isRichBlock, type RichBlockName } from '../../../../protocol/rich-blocks';
import { deref } from '../../screen/scope';
import { DuplicatesBlock } from '../duplicates';
import { PlaylistImportBlock } from '../import';
import { RecapBlock } from '../recap';
import { EqBlock, SoundBlock } from '../sound';
import { placeOf, useMusic } from './app';
import { LyricsPanel } from './lyrics';
import { QueuePanel } from './queue';
import { RailChips, RailFirstFocus, RailIcons, Sidebar } from './rail';
import { openNowPlaying } from './hub';
import { useListenDock } from './dock';
import { isPageBlock, PageBlock } from './page-blocks';
import { useVisualizerHost, VisualizerBlock, type VisualizerSwitch } from './visualizer';
import { MINI_PLAYER_HEIGHT, MiniPlayer, NowPlaying } from '../../widgets/media/player';
import { BarPanelView, NowPlayingBar, NOW_PLAYING_BAR_HEIGHT, type BarPanel } from './bar';
import { ListenLookProvider, usePart, type ListenLook } from './look';
import { fillParts } from './part-style';
import { asCard, barPresses, parseBool, parseEnum, parseNumber, propDefault, tableTracks } from './props';
import { TrackList, type TrackListOptions } from './track-table';

/** A rich block node as resolved (resolve.ts). */
export type RichNode = Extract<RNode, { kind: 'rich' }>;

/** A block's props read in its context: raw values, text, and the registry's defaults. */
export interface Props {
  /** The raw value (a list, a record), or its text when the prop is not a single hole. */
  value(name: string): unknown;
  text(name: string): string;
  bool(name: string): boolean;
  num(name: string, min?: number, max?: number): number;
  enum<T extends string>(name: string, values: readonly T[]): T;
}

export function readProps(block: RichBlockName, props: Record<string, Arg>, ctx: Ctx, env: Env): Props {
  const text = (name: string) => {
    const arg = props[name];
    return arg ? fill(arg.template, ctx, env) : propDefault(block, name);
  };
  const value = (name: string) => {
    const arg = props[name];
    if (!arg) return undefined;
    return arg.value ? arg.value(ctx, env) : fill(arg.template, ctx, env);
  };
  return {
    value,
    text,
    bool: name => {
      const raw = props[name] ? value(name) : undefined;
      return parseBool(raw, parseBool(propDefault(block, name), false));
    },
    num: (name, min, max) => parseNumber(text(name), parseNumber(propDefault(block, name), 0), min, max),
    enum: (name, values) => parseEnum(text(name), values, parseEnum(propDefault(block, name), values, values[0]!)),
  };
}

export function RichBlock({ node, ctx }: { node: RichNode; ctx: Ctx }) {
  const host = useHost();
  const runtime = useScreenBlockRuntime();
  // The block subscribes to the records it reads (a pushed item: record redraws this block only).
  const scoped = useScopedReads(ctx);
  const env = host.env;
  const parts = fillParts(node.parts, template => fill(template, scoped, env));
  const look = useMemo<ListenLook>(() => {
    const names = Object.keys(node.templates ?? {});
    return {
      parts,
      templates: new Set(names),
      template: runtime && names.length ? (name, item, part, index) => {
        const template = node.templates[name];
        return template ? runtime.renderNode(template, bind(bind(scoped, 'item', item, index), 'part', part, index)) : null;
      } : undefined,
    };
  // Parts are filled afresh each draw; their rows decide whether anything changed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(parts), node.templates, runtime, scoped]);
  if (!isRichBlock(node.block)) return node.fallback && runtime ? runtime.renderNode(node.fallback, ctx) : null;
  const props = readProps(node.block, node.props ?? {}, scoped, env);
  let drawn: ReactNode;
  switch (node.block) {
    case 'trackTable': drawn = <TrackTableBlock props={props} ctx={scoped} empty={node.templates?.['trackTable.empty'] && runtime ? at => runtime.renderNode(node.templates['trackTable.empty'], at) : undefined} />; break;
    case 'bar': drawn = <BarBlock props={props} ctx={scoped} press={host.screenPress} />; break;
    case 'queue': drawn = <QueuePanel onClose={closer(props.text('closeFlag'), host.screenPress)} options={{ header: props.bool('header'), limit: props.num('limit', 1, 200) }} />; break;
    case 'lyrics': drawn = <LyricsBlock props={props} ctx={scoped} />; break;
    case 'eq': drawn = <EqRichBlock props={props} press={host.screenPress} />; break;
    case 'rail': drawn = <RailFirstFocus.Provider value={runtime?.focusInitial ?? ''}><RailBlock props={props} ctx={scoped} press={host.screenPress} /></RailFirstFocus.Provider>; break;
    case 'recap': drawn = <RecapRichBlock props={props} ctx={scoped} press={host.screenPress} />; break;
    case 'playlistImport': drawn = <ImportRichBlock props={props} press={host.screenPress} />; break;
    case 'duplicates': drawn = <DuplicatesRichBlock props={props} />; break;
    case 'nowPlaying': drawn = <NowPlayingBlock props={props} press={host.screenPress} background={look.template && look.templates?.has('nowPlaying.background') ? (item, part) => look.template!('nowPlaying.background', item, part, 0) : undefined} />; break;
    case 'player': drawn = <PlayerRichBlock props={props} press={host.screenPress} />; break;
    case 'visualizer': drawn = <VisualizerBlock mode={props.enum('mode', ['background', 'fullscreen'] as const)} sceneId={props.text('sceneId') || undefined}
      fallback={node.fallback && runtime ? runtime.renderNode(node.fallback, ctx) : undefined} />; break;
    default: drawn = isPageBlock(node.block)
      ? <PageBlock name={node.block} props={props} read={scoped.screen?.record ?? (() => undefined)} template={part => look.template && look.templates?.has(part) ? look.template(part, undefined, {}, 0) : null} press={host.screenPress} />
      : node.fallback && runtime ? runtime.renderNode(node.fallback, ctx) : null;
  }
  return <ListenLookProvider look={look}>{drawn}</ListenLookProvider>;
}

// ——— trackTable ————————————————————————————————————————————————————————————————————

function TrackTableBlock({ props, ctx, empty }: { props: Props; ctx: Ctx; empty?: (ctx: Ctx) => ReactNode }) {
  const read = ctx.screen?.record ?? (() => undefined);
  const all = tableTracks(props.value('tracks'), props.value('entryIds'), read);
  const limit = props.num('limit', 0, 5000);
  const { tracks, entryIds } = limit ? { tracks: all.tracks.slice(0, limit), entryIds: all.entryIds.slice(0, limit) } : all;
  const playlistId = props.text('playlist');
  const sourceId = props.text('sourceId');
  const options: TrackListOptions = {
    covers: props.bool('covers'),
    album: props.bool('album'),
    position: props.bool('position'),
    header: props.bool('header'),
    discs: props.bool('discs'),
    reorder: props.bool('reorder'),
    ...(sourceId ? { source: { id: sourceId, name: props.text('sourceName'), kind: props.enum('sourceKind', ['title', 'playlist', 'favorites'] as const) } } : {}),
    ...(playlistId && entryIds.some(Boolean) ? { playlist: { id: playlistId, entryIds } } : {}),
  };
  // A stable list while the same tracks are named (the engine's progressive drawing keys on it).
  const key = tracks.map(t => t.id).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stable = useMemo(() => tracks, [key]);
  if (!stable.length && empty) return <>{empty(ctx)}</>;
  return <TrackList tracks={stable} options={options} />;
}

// ——— bar ———————————————————————————————————————————————————————————————————————————

function BarBlock({ props, ctx, press }: { props: Props; ctx: Ctx; press?(p: ScreenPress): void }) {
  const m = useMediaLook();
  const root = usePart('bar.root');
  const [panel, setPanel] = useState<BarPanel>('');
  const state = ctx.screen?.state ?? {};
  const queueFlag = props.text('queueFlag') || 'queue';
  const soundFlag = props.text('soundFlag') || 'sound';
  const soundOpen = state[soundFlag] === 'true';
  const queueOpen = state[queueFlag] === 'true' && !soundOpen;
  const send = (which: 'queue' | 'sound') => {
    for (const p of barPresses(which, queueFlag, soundFlag, state)) press?.({ action: p.action, arg: p.flag, args: {}, control: `bar-${which}` });
  };
  return (
    <View style={[{ height: NOW_PLAYING_BAR_HEIGHT, backgroundColor: m.ui.raised }, root.box]} testID="listen-bar">
      <NowPlayingBar queueOpen={queueOpen} onQueue={() => send('queue')} soundOpen={soundOpen} onSound={props.bool('sound') ? () => send('sound') : undefined} panel={panel} onPanel={setPanel} />
      <BarPanelView panel={panel} onClose={() => setPanel('')} />
    </View>
  );
}

/** A close button's press: clear the document flag that shows the block (none without a flag). */
function closer(flag: string, press?: (p: ScreenPress) => void): (() => void) | undefined {
  return flag && press ? () => press({ action: 'close', arg: flag, args: {}, control: `close-${flag}` }) : undefined;
}

// ——— lyrics ————————————————————————————————————————————————————————————————————————

function LyricsBlock({ props, ctx }: { props: Props; ctx: Ctx }) {
  const playing = useVelaState(s => currentInQueue(s.audio.queue));
  const read = ctx.screen?.record ?? (() => undefined);
  const named = asCard(deref(props.value('item'), read));
  return <LyricsPanel card={named ?? playing} large={props.bool('large')} translate={props.bool('translate')} />;
}

// ——— eq ————————————————————————————————————————————————————————————————————————————

function EqRichBlock({ props, press }: { props: Props; press?(p: ScreenPress): void }) {
  const store = useVela();
  const sound = useVelaState(s => s.audio.sound);
  const tv = Platform.isTV;
  if (props.bool('bands')) return <EqBlock tv={tv} bands={sound.eq.bands} on={sound.eq.on} onBand={(band, gain) => store.audio.setSound(withBand(sound, band, gain))} />;
  return <SoundBlock onClose={closer(props.text('closeFlag'), press)} tv={tv} />;
}

// ——— rail ——————————————————————————————————————————————————————————————————————————

function RailBlock({ props, ctx, press }: { props: Props; ctx: Ctx; press?(p: ScreenPress): void }) {
  const m = useMediaLook();
  const mode = props.enum('mode', ['auto', 'expanded', 'collapsed', 'embedded', 'icons', 'chips'] as const);
  const flag = props.text('collapseFlag') || 'railCollapsed';
  const collapsed = ctx.screen?.state[flag] === 'true';
  const toggle = () => press?.({ action: 'toggle', arg: flag, args: {}, control: 'rail-collapse' });
  if (mode === 'icons') return <RailIcons />;
  if (mode === 'chips') return <RailChips />;
  if (mode === 'embedded') return <Sidebar rail={false} onToggle={() => undefined} embedded />;
  // auto: the viewer's collapse, and always a rail in a narrow window (the shell sizes it: 84 or 316).
  const rail = mode === 'collapsed' || (mode === 'auto' && (collapsed || m.width < 1180));
  return <Sidebar rail={rail} onToggle={toggle} />;
}

// ——— recap, playlist import, duplicates (the section-B blocks) ——————————————————————

const PERIODS = ['week', 'month', 'year', 'all'] as const;

function RecapRichBlock({ props, ctx, press }: { props: Props; ctx: Ctx; press?(p: ScreenPress): void }) {
  const app = useMusic();
  // The period lives in a page param (the vela.recap source re-reads on it) or, older documents, in state.
  const periodParam = props.text('periodParam');
  const periodState = props.text('periodState');
  const chosen = (periodParam ? ctx.screen?.page.params[periodParam] : '') || (periodState ? ctx.screen?.state[periodState] : '');
  const period: HistoryRecapPeriod = parseEnum(chosen || props.text('period'), PERIODS, 'month');
  return (
    <RecapBlock libraryId={props.text('libraryId') || app.libraryId}
      listening={app.listening === 'audiobook' || app.listening === 'podcast' ? app.listening : 'music'}
      period={period}
      onPeriodChange={next => {
        if (periodParam) press?.({ action: 'setParam', arg: periodParam, args: { name: periodParam, value: next }, control: 'recap-period' });
        if (periodState) press?.({ action: 'open', arg: `${periodState}=${next}`, args: {}, control: 'recap-period' });
      }}
      onSelectCard={card => app.go(placeOf(card))}
      onPlayCards={(cards, index) => app.play(cards, index, { id: 'rewind', name: msg('music.rewind.title') })} />
  );
}

function ImportRichBlock({ props, press }: { props: Props; press?(p: ScreenPress): void }) {
  const app = useMusic();
  const nameState = props.text('nameState');
  return (
    <PlaylistImportBlock libraryId={props.text('libraryId') || app.libraryId || 'music'}
      onNameChange={name => { if (nameState) press?.({ action: 'open', arg: `${nameState}=${name}`, args: {}, control: 'import-name' }); }}
      onSaved={playlistId => app.go({ kind: 'playlist', id: playlistId })} />
  );
}

function DuplicatesRichBlock({ props }: { props: Props }) {
  const app = useMusic();
  return (
    <DuplicatesBlock libraryId={props.text('libraryId') || app.libraryId || 'music'}
      onPlayRelease={(release, source) => app.play([release], 0, source)}
      onOpenAlbum={albumId => app.go({ kind: 'title', id: albumId })} />
  );
}

// ——— nowPlaying, player ————————————————————————————————————————————————————————————

const noSwitch = (): VisualizerSwitch | undefined => undefined;

function NowPlayingBlock({ props, press, background }: { props: Props; press?(p: ScreenPress): void; background?: (item: unknown, part: Record<string, unknown>) => ReactNode }) {
  const host = useHost();
  const visualizer = useVisualizerHost();
  // The app's hook, the same one every draw (the host is a constant).
  const visualizerSwitch = (visualizer?.useSwitch ?? noSwitch)();
  const item = useVelaState(s => currentInQueue(s.audio.queue));
  const playing = useVelaState(s => s.audio.phase === 'playing' || s.audio.phase === 'buffering' || s.audio.phase === 'loading');
  const offered = props.bool('visualizer') && host.env.canVisualize !== false;
  const flag = props.text('visualizerFlag');
  const panel = props.text('panel');
  // Inside the app's audio dock the dock closes Now Playing and opens the visualizer.
  const dock = useListenDock();
  const drawn = !!item && !dock?.hidden;
  const shown = dock?.shown;
  useEffect(() => { if (drawn && Platform.isTV) shown?.(); }, [drawn, shown]);
  const onClose = dock?.close ?? closer(props.text('closeFlag'), press) ?? (() => undefined);
  const onOpenVisualizer = dock ? dock.openVisualizer
    : offered && flag && visualizerSwitch?.on && press ? () => press({ action: 'open', arg: flag, args: {}, control: 'now-playing-visualizer' }) : undefined;
  return (
    <View style={{ flex: 1, minHeight: 0 }} testID="listen-now-playing">
      <NowPlaying onClose={onClose} panel={panel === 'lyrics' || panel === 'sound' || panel === 'queue' ? panel : undefined} hidden={dock?.hidden}
        visualizer={dock ? dock.visualizer : offered ? visualizerSwitch : undefined} onOpenVisualizer={onOpenVisualizer}
        background={background && item ? background(item, { playing, accent: item.accent }) : undefined} />
    </View>
  );
}

function PlayerRichBlock({ props, press }: { props: Props; press?(p: ScreenPress): void }) {
  const flag = props.text('openFlag');
  const open = () => (flag && press ? press({ action: 'open', arg: flag, args: {}, control: 'mini-player-open' }) : openNowPlaying());
  return (
    <View style={{ height: MINI_PLAYER_HEIGHT + 4 }} pointerEvents="box-none" testID="listen-player">
      <MiniPlayer onOpen={open} bottom={0} />
    </View>
  );
}

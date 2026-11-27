import { guideSelection } from './diagnostics';
import { GuideFocusScope, GuideToolbar } from './focus';
import { programmeSelection } from './selection';
import { hasFlowHeader } from '../../resolve/inherit';
// The channel guide as an app (widget `guide`, and the Live TV route): a half-height header with
// the selected programme beside the live preview tile, a toolbar of days, time and filters, the
// owner's named Guides, then the EPG grid scrolling inside its panel. Phones open on the On now
// list and switch to the grid. Its look comes from the document's `ui` block.
import { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import { Platform, View, type ViewStyle } from 'react-native';
import { msg, type GuideChannel, type GuideModel, type GuideProgramme } from '@vela/core';
import { HostContext, useHost, type WidgetProps } from '../../host';
import type { LiveController, LiveView } from './controller';
import { DayChips, FilterMenu, GuideTabs, IconButton, NowChip, Segments } from './controls-bar';
import { guideBand, guideTop, gutter, keeps, programmeAt, type ChannelFilter, type Zoom } from './geometry';
import { GuideGrid, type GridHandle } from './grid';
import { currentlyAiring } from './content';
import { GuideTile } from './header-tile';
import { GuideHero } from './hero';
import { useLiveContext, useLiveView } from './live';
import { useGuideLook, type GuideLook } from './look';
import { NowList } from './now-list';
import { GuideStatus } from './status';
import { tvPixelScale } from '../../tv-pixel-scale';
import { focusShellNavigation, useGuideTopRequest } from './top';

/** A search hand-off: open on this channel (and programme) at this minute of the shown day. */
export interface GuideFocus {
  channelId: string;
  programmeId: string;
  minute: number;
}

export function GuideWidget({ params }: WidgetProps) {
  return <Guide layout={params.layout === 'cinematic' ? 'cinematic' : undefined} />;
}

export function Guide({ focus, layout, active = true }: { focus?: GuideFocus; layout?: 'cinematic'; active?: boolean }) {
  const host = useHost();
  const [area, setArea] = useState({ width: host.viewport.width, height: host.viewport.height });
  if (!Platform.isTV || Platform.OS !== 'android') return <GuideContent focus={focus} layout={layout} active={active} />;
  // The guide's authored geometry is a 1080-point TV canvas. Android's dp canvas is
  // commonly 540 points; scale the whole widget, including grid measurements and focus.
  const scale = tvPixelScale(host.viewport.width, host.viewport.height) / 1.25;
  const viewport = { ...host.viewport, width: area.width / scale, height: area.height / scale };
  return (
    <View style={{ flex: 1, overflow: 'hidden' }} onLayout={event => {
      const { width, height } = event.nativeEvent.layout;
      setArea(old => old.width === width && old.height === height ? old : { width, height });
    }}>
      <View style={{ width: viewport.width, height: viewport.height, transform: [{ scale }], transformOrigin: 'top left' }}>
        <HostContext.Provider value={{ ...host, viewport }}><GuideContent focus={focus} layout={layout} active={active} /></HostContext.Provider>
      </View>
    </View>
  );
}

function GuideContent({ focus, layout, active }: { focus?: GuideFocus; layout?: 'cinematic'; active: boolean }) {
  const look = useGuideLook();
  const live = useLiveContext();
  const view = useLiveView(active);
  if (!live) return <GuideStatus look={look} text={msg('ui.loadingTheGuide')} busy />;
  if (!view.guide) {
    if (view.load === 'failed') {
      return (
        <GuideStatus
          look={look}
          text={msg('ui.theGuideCouldnTBeLoadedCheckYourConnection')}
          onRetry={() => live.controller.retry()}
        />
      );
    }
    return <GuideStatus look={look} text={msg('ui.loadingTheGuide')} busy />;
  }
  return <GuidePage look={look} model={view.guide} view={view} controller={live.controller} focus={focus} layout={layout} active={active} />;
}

interface PageProps {
  look: GuideLook;
  model: GuideModel;
  view: LiveView;
  controller: LiveController;
  focus?: GuideFocus;
  layout?: 'cinematic';
  active: boolean;
}

function GuidePage({ look, model, view, controller, focus, layout, active }: PageProps) {
  const { viewport, env, doc } = useHost();
  const small = viewport.width < 640;
  const landscape = env.shortLandscape === true && !small;
  const still = env.still;
  const side = Math.max(gutter(small, viewport.width), viewport.insets.left, viewport.insets.right);
  const [selected, setSelected] = useState(() => {
    const channel = model.channels.find(c => c.id === (focus?.channelId || view.tunedId)) ?? model.channels[0];
    return { channel: channel?.id ?? '', programme: focus?.programmeId || channel?.nowId || '' };
  });
  const initialChannel = useRef(selected.channel);
  useEffect(() => controller.initializePreview(initialChannel.current), [controller]);
  const [filter, setFilter] = useState<ChannelFilter>('all');
  const [tab, setTab] = useState('');
  const [mode, setMode] = useState<'now' | 'guide'>('now');
  const [zoom, setZoom] = useState<Zoom>(1);
  const [expanded, setExpanded] = useState(false);
  const [holding, setHolding] = useState(false);
  const grid = useRef<GridHandle>(null);
  const nowList = useRef<{ toTop(): void }>(null);
  const visible = active && !view.tile.fullscreen;
  const wasVisible = useRef(visible);
  useEffect(() => {
    const returning = visible && !wasVisible.current;
    wasVisible.current = visible;
    if (!visible) { grid.current?.leaveGrid(); return; }
    if (!returning) return;
    const frame = requestAnimationFrame(() => grid.current?.focusGrid(selected.channel));
    return () => cancelAnimationFrame(frame);
  }, [visible, selected.channel]);

  const tabOn = model.guides.some(g => g.id === tab) ? tab : '';
  // A hand-off shows its channel whatever the filter, on its own day.
  const handOff = focus && focus.channelId ? focus : undefined;
  const handOffOffset = handOff && handOff.minute >= 0 ? model.dayStarts?.[view.day] ?? (model.day === view.day ? 0 : undefined) : 0;
  const gridKey = useRef('');
  if (handOff) gridKey.current = `${handOff.channelId}|${handOff.minute}`;
  const rows = useMemo(
    () => model.channels.filter(c => keeps(c, filter, tabOn) || c.id === handOff?.channelId),
    [model.channels, filter, tabOn, handOff?.channelId],
  );
  const showGrid = !small || mode === 'guide';
  const picked = pickHero(model, selected, handOff);
  const tunedName = model.channels.find(c => c.id === view.tile.channelId)?.name ?? '';

  const select = useCallback((channel: GuideChannel, programme: GuideProgramme | null) => {
    guideSelection(channel.id, programme?.id ?? '');
    setSelected(old => old.channel === channel.id && old.programme === (programme?.id ?? '')
      ? old : { channel: channel.id, programme: programme?.id ?? '' });
  }, []);
  useEffect(() => {
    if (!view.zapping || !view.tunedId || view.tunedId === selected.channel) return;
    if (grid.current?.selectChannel(view.tunedId)) return;
    const channel = model.channels.find(channel => channel.id === view.tunedId);
    if (channel) select(channel, programmeAt(channel, Math.max(0, model.nowMinute)) ?? null);
  }, [view.zapping, view.tunedId, selected.channel, model.channels, model.nowMinute, select]);
  // Select opens airing programmes in full screen; focus changes only update details.
  const press = useCallback((channel: GuideChannel, programme: GuideProgramme) => {
    select(channel, programme);
    const current = controller.view().guide?.channels.find(c => c.id === channel.id)?.programmes.find(p => p.id === programme.id);
    const action = programmeSelection(currentlyAiring(controller.view().guide, channel.id, programme.id), current?.replay ?? programme.replay);
    if (action === 'watch') controller.watch(channel.id);
    else if (action === 'replay') controller.playProgramme(channel.id, programme.id, 'catchUp');
  }, [controller, select]);
  const watch = useCallback((channelId: string) => controller.watch(channelId), [controller]);
  const replay = useCallback((channelId: string, programmeId: string, kind: 'catchUp' | 'startOver') =>
    controller.playProgramme(channelId, programmeId, kind), [controller]);
  const archive = controller.catchUpOffer.archive;
  useEffect(() => {
    controller.setRetainedChannels([selected.channel, handOff?.channelId ?? "", view.tunedId]);
  }, [controller, selected.channel, handOff?.channelId, view.tunedId]);
  useEffect(() => () => controller.setRetainedChannels([]), [controller]);
  const onRange = useCallback((from: number, to: number) => controller.setGuideRange(from, to), [controller]);
  const onVisible = useCallback((ids: string[]) => controller.setGuideChannels(ids), [controller]);
  const pickDay = (day: number) => {
    controller.chooseDay(day);
    grid.current?.jumpDay(day);
  };
  const jumpNow = () => {
    controller.chooseDay(0);
    grid.current?.jumpNow();
  };
  // Back to the first channel at now; Back, Menu or Escape also hands focus to the top bar.
  const liveLibraries = (env.libraries ?? []).filter(library => library.kind === 'live').map(library => library.id);
  const rewind = () => {
    if (controller.view().day !== 0) controller.chooseDay(0);
    grid.current?.toTop();
    nowList.current?.toTop();
  };
  const toNavigation = () => { focusShellNavigation(liveLibraries); };
  const escape = () => { toNavigation(); rewind(); };
  useGuideTopRequest(visible, rewind);
  const shift = (hours: number) => {
    const runOff = grid.current?.shift(hours) ?? 0;
    if (runOff !== 0) pickDay(model.day + runOff);
  };

  const cinematic = (layout ?? doc.guideLayout) === 'cinematic';
  const flowHeader = hasFlowHeader(doc.document.slots?.shell);
  const top = !flowHeader && Platform.isTV && Platform.OS === 'android' ? 108 : guideTop(flowHeader, small, viewport.insets.top);
  const band = guideBand(viewport.width, viewport.height, top, side);
  const previewWidth = Math.min(232, Math.round(viewport.width * 0.25));
  // Leave room for the sidebar's channel heading, Watch button and listing status on short screens.
  const sidebarTileHeight = clamp(viewport.height - 314, 36, 72);
  const sidebarTileWidth = Math.min(180, previewWidth - 6);
  const tileHeight = landscape ? sidebarTileHeight : cinematic ? band.pictureHeight : Platform.isTV ? 200 : small ? 72 : Math.round(clamp(viewport.height * 0.16 - 14, 120, 168) * 0.7);
  const headerHeight = cinematic ? band.height : Platform.isTV ? tileHeight + 32 : small ? 196 : 60 + Math.round(clamp(viewport.height * 0.16, 128, 168) * 0.7);
  const landing = useMemo(() => ({
    minute: handOff && handOff.minute >= 0 ? handOff.minute + (handOffOffset ?? 0) : model.landing,
    channelId: handOff?.channelId || view.tunedId || rows[0]?.id || '',
    explicit: !!handOff && handOff.minute >= 0,
  }), [handOff?.channelId, handOff?.minute, handOffOffset]);
  const zoomOptions = ([0, 1, 2] as Zoom[]).map(z => {
    const hours = z === 0 ? '4½' : z === 1 ? '3' : '2';
    return { value: z, label: msg('live.hours', { hours }), name: msg('live.hoursAcross', { hours }) };
  });
  const favourites = filter === 'favourites';
  const toggleFavourites = () => setFilter(favourites ? 'all' : 'favourites');
  const page = {
    flex: 1,
    minHeight: 0,
    backgroundColor: look.page,
    paddingTop: top,
    backgroundImage: `radial-gradient(ellipse 70% 60% at 82% 0%, ${look.aura}, transparent 70%)`,
  } as ViewStyle;
  const highlighted =
    selected.channel || !handOff ? selected : { channel: handOff.channelId, programme: handOff.programmeId };

  if (handOffOffset === undefined) return <GuideStatus look={look} text={msg('ui.loadingTheGuide')} busy />;

  const preview = (showGrid || cinematic) && !expanded ? (
    <View style={{ ...(landscape ? { width: previewWidth } : { height: headerHeight }), flexShrink: 0, overflow: 'hidden' }}>
      {picked ? (
        <GuideHero
          look={look}
          channel={picked.channel}
          programme={picked.programme}
          small={small}
          still={still || holding}
          side={landscape ? 12 : side}
          inset={landscape ? 12 : cinematic && band.stacked ? side : small && !cinematic ? 16 + 132 : side + (tileHeight * 16) / 9 + 28}
          spacious={cinematic && !landscape}
          sidebar={landscape}
          copyTop={landscape ? (view.tile.state === 'off' ? 8 : tileHeight + 14) : cinematic && band.stacked ? tileHeight + band.gap : 0}
          compact={landscape || cinematic && (band.stacked || band.height < 240)}
          onWatch={watch}
          onReplay={archive ? replay : undefined}
        />
      ) : null}
      {view.tile.state !== 'off' ? (
        <View style={{ position: 'absolute', right: landscape ? (previewWidth - sidebarTileWidth) / 2 : cinematic && band.stacked ? (viewport.width - tileHeight * 16 / 9) / 2 : side, ...(landscape ? { top: 6 } : cinematic ? { top: band.stacked ? 0 : band.gap } : { bottom: small ? 12 : 8 }), zIndex: 2 }}>
          <GuideTile
            look={look}
            tile={view.tile}
            channelName={tunedName}
            height={tileHeight}
            width={landscape ? sidebarTileWidth : undefined}
            small={small || landscape}
            still={still}
            controller={controller}
          />
        </View>
      ) : null}
    </View>
  ) : null;

  return (
    <GuideFocusScope active={visible} enter={() => grid.current?.focusGrid()} leave={() => grid.current?.leaveGrid()} onHold={setHolding}
      escape={escape} top={toNavigation} rewind={rewind}>
    <View style={page}>
      {!landscape ? preview : null}
      <GuideToolbar>
      {small ? (
        <View style={{ zIndex: 10 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              paddingHorizontal: side,
              paddingTop: 10,
              paddingBottom: showGrid ? 8 : 12,
            }}
          >
            <Segments<'now' | 'guide'>
              look={look}
              label={msg('live.view')}
              value={mode}
              onPick={setMode}
              compact
              options={[
                { value: 'now', label: msg('live.onNow'), name: msg('live.onNow') },
                { value: 'guide', label: msg('live.guide'), name: msg('live.guide') },
              ]}
            />
            <View style={{ flex: 1 }} />
            <IconButton
              look={look}
              label={msg('live.favourites')}
              glyph="star-fill"
              on={favourites}
              color={favourites ? look.accent : look.inkSecondary}
              onPress={toggleFavourites}
              compact
            />
            {showGrid ? <NowChip look={look} still={still} onPress={jumpNow} compact /> : null}
          </View>
          {showGrid ? (
            <View style={{ paddingBottom: 8 }}>
              <DayChips look={look} model={model} onPick={pickDay} side={side} compact />
            </View>
          ) : null}
        </View>
      ) : (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 14,
            paddingHorizontal: side,
            paddingTop: 4,
            paddingBottom: landscape ? 2 : 8,
            zIndex: 10,
          }}
        >
          <View style={{ flexShrink: 1, minWidth: 0, marginLeft: -side }}>
            <DayChips look={look} model={model} onPick={pickDay} side={side} fadeEdges={landscape} />
          </View>
          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', flexShrink: 0 }}>
            <IconButton look={look} label={msg('ui.earlierProgrammes')} glyph="back" onPress={() => shift(-2)} />
            <NowChip look={look} still={still} onPress={jumpNow} />
            <IconButton
              look={look}
              label={msg('ui.laterProgrammes')}
              glyph="forward-chevron"
              onPress={() => shift(2)}
            />
          </View>
          <View style={{ flex: 1, minWidth: 0 }} />
          <Segments<Zoom> look={look} label={msg('live.zoom')} value={zoom} onPick={setZoom} options={zoomOptions} />
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexShrink: 0 }}>
            <IconButton
              look={look}
              label={expanded ? msg('live.exitFullGuide') : msg('live.fullGuide')}
              glyph={expanded ? 'close' : 'layers'}
              on={expanded}
              onPress={() => setExpanded(e => !e)}
            />
            <IconButton
              look={look}
              label={msg('live.favourites')}
              glyph="star-fill"
              on={favourites}
              color={favourites ? look.accent : look.inkSecondary}
              onPress={toggleFavourites}
            />
            <FilterMenu look={look} filter={filter} groups={model.groups} onPick={setFilter} />
          </View>
        </View>
      )}
      {model.guides.length > 0 ? (
        <GuideTabs look={look} model={model} tab={tabOn} onPick={setTab} side={side} small={small} />
      ) : null}
      </GuideToolbar>
      <View style={{ flex: 1, minHeight: 0, flexDirection: landscape ? 'row' : 'column' }}>
        {landscape ? preview : null}
        <GuideBody
          look={look}
          liveView={controller.view}
          model={model}
          rows={rows}
          small={small}
          compact={landscape}
          showGrid={showGrid}
          active={visible}
          zoom={zoom}
          still={still}
          selected={highlighted}
          landing={landing}
          gridKey={gridKey.current}
          grid={grid}
          nowList={nowList}
          onSelect={select}
          onPress={press}
          onWatch={watch}
          onRange={onRange}
          onVisible={onVisible}
          onAll={() => setFilter('all')}
        />
      </View>
    </View>
    </GuideFocusScope>
  );
}

interface BodyProps {
  liveView: LiveController['view'];
  look: GuideLook;
  model: GuideModel;
  rows: GuideChannel[];
  small: boolean;
  compact: boolean;
  showGrid: boolean;
  active: boolean;
  zoom: Zoom;
  still: boolean;
  selected: { channel: string; programme: string };
  landing: { minute: number; channelId: string; explicit: boolean };
  gridKey: string;
  grid: React.RefObject<GridHandle | null>;
  nowList: React.RefObject<{ toTop(): void } | null>;
  onSelect(channel: GuideChannel, programme: GuideProgramme | null): void;
  onPress(channel: GuideChannel, programme: GuideProgramme): void;
  onWatch(channelId: string): void;
  onRange(from: number, to: number): void;
  onVisible(ids: string[]): void;
  onAll(): void;
}

function GuideBody(props: BodyProps) {
  const { look, model, rows, small } = props;
  if (model.channels.length === 0) return <GuideStatus look={look} text={msg('live.noChannels')} />;
  if (rows.length === 0)
    return (
      <GuideStatus look={look} text={msg('live.noMatches')} action={msg('live.allChannels')} onRetry={props.onAll} />
    );
  if (!props.showGrid) return <NowList handle={props.nowList} look={look} rows={rows} onWatch={props.onWatch} onVisible={props.onVisible} />;
  return (
    <View
      style={{
        flex: 1,
        minHeight: 0,
        marginHorizontal: small ? 0 : 8,
        marginBottom: small || props.compact ? 0 : 8,
        overflow: 'hidden',
        borderRadius: small ? 0 : 8,
        borderTopWidth: 1,
        borderColor: look.edge,
        backgroundColor: look.panel,
      }}
    >
      <GuideGrid
        key={props.gridKey}
        handle={props.grid}
        liveView={props.liveView}
        look={look}
        model={model}
        rows={rows}
        small={small}
        compact={props.compact}
        zoom={props.zoom}
        still={props.still}
        active={props.active}
        selected={props.selected}
        landing={props.landing}
        onSelect={props.onSelect}
        onPress={props.onPress}
        onWatch={props.onWatch}
        onRange={props.onRange}
        onVisible={props.onVisible}
      />
    </View>
  );
}

/** The details follow selection; with none it shows the hand-off's channel, else the first airing. */
function pickHero(model: GuideModel, selected: { channel: string; programme: string }, handOff?: GuideFocus) {
  const id = selected.channel || handOff?.channelId || model.channels.find(c => c.nowId)?.id || model.channels[0]?.id;
  const channel = model.channels.find(c => c.id === id);
  if (!channel) return undefined;
  if (selected.channel && !selected.programme) return { channel, programme: undefined };
  const wanted = selected.channel ? selected.programme : handOff?.programmeId || channel.nowId;
  const programme =
    channel.programmes.find(p => p.id === wanted) ?? channel.programmes.find(p => p.id === channel.nowId);
  return { channel, programme };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

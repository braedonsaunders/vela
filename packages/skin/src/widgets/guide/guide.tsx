// The channel guide as an app (widget `guide`, and the Live TV route): a half-height header with
// the selected programme beside the live preview tile, a toolbar of days, time and filters, the
// owner's named Guides, then the EPG grid scrolling inside its panel. Phones open on the On now
// list and switch to the grid. Its look comes from the document's `ui` block.
import { useMemo, useRef, useState } from 'react';
import { View, type ViewStyle } from 'react-native';
import { msg, type GuideChannel, type GuideModel, type GuideProgramme } from '@vela/core';
import { useHost, type WidgetProps } from '../../host';
import type { LiveController, LiveView } from './controller';
import { DayChips, FilterMenu, GuideTabs, IconButton, NowChip, Segments } from './controls-bar';
import { gutter, keeps, type ChannelFilter, type Zoom } from './geometry';
import { GuideGrid, type GridHandle } from './grid';
import { GuideTile } from './header-tile';
import { GuideHero } from './hero';
import { useLiveContext, useLiveView } from './live';
import { useGuideLook, type GuideLook } from './look';
import { NowList } from './now-list';
import { GuideStatus } from './status';

/** A search hand-off: open on this channel (and programme) at this minute of the shown day. */
export interface GuideFocus { channelId: string; programmeId: string; minute: number }

export function GuideWidget(_: WidgetProps) {
  return <Guide />;
}

export function Guide({ focus }: { focus?: GuideFocus }) {
  const look = useGuideLook();
  const live = useLiveContext();
  const view = useLiveView();
  if (!live) return <GuideStatus look={look} text={msg('live.noChannels')} />;
  if (!view.guide) {
    if (view.load === 'failed') {
      return <GuideStatus look={look} text={msg('ui.theGuideCouldnTBeLoadedCheckYourConnection')} onRetry={() => live.controller.retry()} />;
    }
    return <GuideStatus look={look} text={msg('ui.loadingTheGuide')} busy />;
  }
  return <GuidePage look={look} model={view.guide} view={view} controller={live.controller} focus={focus} />;
}

interface PageProps {
  look: GuideLook;
  model: GuideModel;
  view: LiveView;
  controller: LiveController;
  focus?: GuideFocus;
}

function GuidePage({ look, model, view, controller, focus }: PageProps) {
  const { viewport, env } = useHost();
  const small = viewport.width < 640;
  const still = env.still;
  const side = gutter(small, viewport.width);
  const [selected, setSelected] = useState({ channel: '', programme: '' });
  const [filter, setFilter] = useState<ChannelFilter>('all');
  const [tab, setTab] = useState('');
  const [mode, setMode] = useState<'now' | 'guide'>('now');
  const [zoom, setZoom] = useState<Zoom>(1);
  const [expanded, setExpanded] = useState(false);
  const grid = useRef<GridHandle>(null);

  const tabOn = model.guides.some(g => g.id === tab) ? tab : '';
  // A hand-off shows its channel whatever the filter, on its own day.
  const handOff = focus && focus.channelId ? focus : undefined;
  const rows = useMemo(
    () => model.channels.filter(c => keeps(c, filter, tabOn) || c.id === handOff?.channelId),
    [model.channels, filter, tabOn, handOff?.channelId],
  );
  const showGrid = !small || mode === 'guide';
  const picked = pickHero(model, selected, handOff);
  const tunedName = model.channels.find(c => c.id === view.tile.channelId)?.name ?? '';

  const select = (channel: GuideChannel, programme: GuideProgramme | null) =>
    setSelected({ channel: channel.id, programme: programme?.id ?? '' });
  // Pressing what is airing puts it on the tile; pressing it again once it is there watches it.
  const press = (channel: GuideChannel, programme: GuideProgramme) => {
    select(channel, programme);
    if (!programme.airing) return;
    if (view.tile.channelId === channel.id && view.tile.state === 'playing') controller.watch(channel.id);
    else controller.preview(channel.id);
  };
  const watch = (channelId: string) => controller.watch(channelId);
  const pickDay = (day: number) => {
    setSelected({ channel: '', programme: '' });
    controller.chooseDay(day);
  };
  const jumpNow = () => {
    setSelected({ channel: '', programme: '' });
    if (model.day !== 0) pickDay(0);
    else grid.current?.jumpNow();
  };
  const shift = (hours: number) => {
    const runOff = grid.current?.shift(hours) ?? 0;
    if (runOff !== 0) pickDay(model.day + runOff);
  };

  const headerHeight = small ? 196 : 84 + clamp(viewport.height * 0.16, 128, 168);
  const tileHeight = small ? 72 : clamp(viewport.height * 0.16 - 14, 120, 168);
  const landing = {
    minute: handOff && handOff.minute >= 0 ? handOff.minute : model.landing,
    channelId: handOff?.channelId ?? '',
  };
  const zoomOptions = ([0, 1, 2] as Zoom[]).map(z => {
    const hours = z === 0 ? '4½' : z === 1 ? '3' : '2';
    return { value: z, label: msg('live.hours', { hours }), name: msg('live.hoursAcross', { hours }) };
  });
  const favourites = filter === 'favourites';
  const toggleFavourites = () => setFilter(favourites ? 'all' : 'favourites');
  const page = {
    flex: 1, minHeight: 0, backgroundColor: look.page, paddingTop: expanded ? 96 : 0,
    backgroundImage: `radial-gradient(ellipse 70% 60% at 82% 0%, ${look.aura}, transparent 70%)`,
  } as ViewStyle;
  const highlighted = selected.channel || !handOff ? selected : { channel: handOff.channelId, programme: handOff.programmeId };

  return (
    <View style={page}>
      {showGrid && !expanded ? (
        <View style={{ height: headerHeight, flexShrink: 0, overflow: 'hidden' }}>
          {picked ? (
            <GuideHero
              look={look}
              channel={picked.channel}
              programme={picked.programme}
              small={small}
              still={still}
              side={side}
              inset={small ? 16 + 132 : side + (tileHeight * 16) / 9 + 28}
              onWatch={watch}
            />
          ) : null}
          {view.tile.state !== 'off' ? (
            <View style={{ position: 'absolute', right: side, bottom: small ? 12 : 14, zIndex: 2 }}>
              <GuideTile look={look} tile={view.tile} channelName={tunedName} height={tileHeight} small={small} still={still} controller={controller} />
            </View>
          ) : null}
        </View>
      ) : null}
      {small ? (
        <View style={{ zIndex: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: side, paddingTop: 10, paddingBottom: showGrid ? 8 : 12 }}>
            <Segments<'now' | 'guide'>
              look={look}
              label={msg('live.view')}
              value={mode}
              onPick={setMode}
              options={[
                { value: 'now', label: msg('live.onNow'), name: msg('live.onNow') },
                { value: 'guide', label: msg('live.guide'), name: msg('live.guide') },
              ]}
            />
            <View style={{ flex: 1 }} />
            <IconButton look={look} label={msg('live.favourites')} glyph="star-fill" on={favourites} color={favourites ? look.accent : look.inkSecondary} onPress={toggleFavourites} />
            {showGrid ? <NowChip look={look} still={still} onPress={jumpNow} /> : null}
          </View>
          {showGrid ? <View style={{ paddingBottom: 12 }}><DayChips look={look} model={model} onPick={pickDay} side={side} /></View> : null}
        </View>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: side, paddingTop: 6, paddingBottom: 16, zIndex: 10 }}>
          <View style={{ flexShrink: 1, minWidth: 0, marginLeft: -side }}>
            <DayChips look={look} model={model} onPick={pickDay} side={side} />
          </View>
          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', flexShrink: 0 }}>
            <IconButton look={look} label={msg('ui.earlierProgrammes')} glyph="back" onPress={() => shift(-2)} />
            <NowChip look={look} still={still} onPress={jumpNow} />
            <IconButton look={look} label={msg('ui.laterProgrammes')} glyph="forward-chevron" onPress={() => shift(2)} />
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
            <IconButton look={look} label={msg('live.favourites')} glyph="star-fill" on={favourites} color={favourites ? look.accent : look.inkSecondary} onPress={toggleFavourites} />
            <FilterMenu look={look} filter={filter} groups={model.groups} onPick={setFilter} />
          </View>
        </View>
      )}
      {model.guides.length > 0 ? <GuideTabs look={look} model={model} tab={tabOn} onPick={setTab} side={side} small={small} /> : null}
      <GuideBody
        look={look}
        model={model}
        rows={rows}
        small={small}
        side={side}
        showGrid={showGrid}
        zoom={zoom}
        still={still}
        selected={highlighted}
        landing={landing}
        gridKey={`${model.day}|${handOff?.channelId ?? ''}|${handOff?.minute ?? ''}`}
        grid={grid}
        onSelect={select}
        onPress={press}
        onWatch={watch}
        onAll={() => setFilter('all')}
      />
    </View>
  );
}

interface BodyProps {
  look: GuideLook;
  model: GuideModel;
  rows: GuideChannel[];
  small: boolean;
  side: number;
  showGrid: boolean;
  zoom: Zoom;
  still: boolean;
  selected: { channel: string; programme: string };
  landing: { minute: number; channelId: string };
  gridKey: string;
  grid: React.RefObject<GridHandle | null>;
  onSelect(channel: GuideChannel, programme: GuideProgramme | null): void;
  onPress(channel: GuideChannel, programme: GuideProgramme): void;
  onWatch(channelId: string): void;
  onAll(): void;
}

function GuideBody(props: BodyProps) {
  const { look, model, rows, small, side } = props;
  if (model.channels.length === 0) return <GuideStatus look={look} text={msg('live.noChannels')} />;
  if (rows.length === 0) return <GuideStatus look={look} text={msg('live.noMatches')} action={msg('live.allChannels')} onRetry={props.onAll} />;
  if (!props.showGrid) return <NowList look={look} rows={rows} onWatch={props.onWatch} />;
  return (
    <View style={{
      flex: 1, minHeight: 0, marginHorizontal: small ? 0 : side, marginBottom: small ? 0 : 24, overflow: 'hidden',
      borderRadius: small ? 0 : look.radiusPanel, borderWidth: small ? 0 : 1, borderTopWidth: 1, borderColor: look.edge,
      backgroundColor: look.panel, boxShadow: small ? undefined : `0px 40px 120px ${look.shadow}`,
    }}>
      <GuideGrid
        key={props.gridKey}
        handle={props.grid}
        look={look}
        model={model}
        rows={rows}
        small={small}
        zoom={props.zoom}
        still={props.still}
        selected={props.selected}
        landing={props.landing}
        onSelect={props.onSelect}
        onPress={props.onPress}
        onWatch={props.onWatch}
      />
    </View>
  );
}

/** The preview follows selection; with none it shows the hand-off's channel, else the first airing. */
function pickHero(model: GuideModel, selected: { channel: string; programme: string }, handOff?: GuideFocus) {
  const id = selected.channel || handOff?.channelId || model.channels.find(c => c.nowId)?.id || model.channels[0]?.id;
  const channel = model.channels.find(c => c.id === id);
  if (!channel) return undefined;
  const wanted = selected.channel ? selected.programme : handOff?.programmeId || channel.nowId;
  const programme = channel.programmes.find(p => p.id === wanted) ?? channel.programmes.find(p => p.id === channel.nowId);
  return { channel, programme };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

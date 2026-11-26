// Self-contained rich block for B6 Listening recap ("Rewind").
// Exposes the recap charts, headline stats, period switcher, ranked top entries, and shareable
// summary card modal over `@vela/core`'s `store.music.recap` engine.
import { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import {
  formatFirstPlayLabel,
  formatRecapSummary,
  msg,
  number,
  plural,
  recapChartBuckets,
  recapKey,
  recapLabels,
  recapStatCards,
  type Card,
  type HistoryRecapModel,
  type HistoryRecapPeriod,
  type Loadable,
  type RecapChartBucket,
  type RecapEntryModel,
  type RecapLabels,
} from '@vela/core';
import { useVela, useVelaState } from '@vela/core/react';
import { FocusPressable as Pressable } from '../focus';
import { DismissScope } from '../escape';
import { SheetModal } from '../widgets/common/sheet-modal';
import { NO_RING, Glyph, useInteraction } from '../widgets/common/controls';
import { alpha, Cover, useMediaLook } from '../widgets/media/parts';
import { MediaGlyph } from '../widgets/media/icons';

const web = Platform.OS === 'web';
const transition = (properties: string, ms = 160): ViewStyle =>
  web ? ({ transitionProperty: properties, transitionDuration: `${ms}ms`, transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)' } as ViewStyle) : {};

/** Hook into `@vela/core`'s listening recap store (`store.music.recap`). */
export function useHistoryRecap(period: HistoryRecapPeriod, libraryId?: string, at?: string): {
  recap: HistoryRecapModel | undefined;
  load: Loadable<HistoryRecapModel>['load'];
  available: boolean;
  periods: HistoryRecapPeriod[];
  retry(): void;
} {
  const store = useVela();
  const key = recapKey(period, libraryId, at);
  const entry = useVelaState(state => state.music.recaps[key]);
  useVelaState(state => state.home.load);
  const available = store.music.recapAvailable;
  const periods = store.music.recapPeriods;
  useEffect(() => {
    if (available) void store.music.recap(period, libraryId, at);
  }, [store, available, period, libraryId, at]);
  return {
    recap: entry?.value,
    load: entry?.load ?? (available ? 'loading' : 'idle'),
    available,
    periods,
    retry: () => void store.music.recap(period, libraryId, at, true),
  };
}

export function RewindCover({ size }: { size: number }) {
  const m = useMediaLook();
  return (
    <View style={[{ width: size, height: size, borderRadius: size > 100 ? 8 : 4, alignItems: 'center', justifyContent: 'center' },
      m.box({ 'background-image': `linear-gradient(135deg, ${m.ui.accent} 0%, #6d3b9e 52%, #1d2642 100%)`, ...(size > 100 ? { 'box-shadow': '0px 22px 48px -16px rgba(0,0,0,0.7)' } : {}) })]}>
      <Glyph symbol="sparkles" size={size * 0.4} color="#ffffff" />
    </View>
  );
}

export interface RecapBlockProps {
  libraryId?: string;
  listening?: 'music' | 'audiobook' | 'podcast';
  period?: HistoryRecapPeriod;
  onPeriodChange?(period: HistoryRecapPeriod): void;
  onSelectCard?(card: Card): void;
  onPlayCards?(cards: Card[], index: number): void;
}

/** Self-contained listening recap rich block: period pills, stats grid, daily minutes chart, top lists and share card modal. */
export function RecapBlock({
  libraryId,
  listening = 'music',
  period: controlledPeriod,
  onPeriodChange,
  onSelectCard,
  onPlayCards,
}: RecapBlockProps) {
  const m = useMediaLook();
  const [internalPeriod, setInternalPeriod] = useState<HistoryRecapPeriod>('month');
  const period = controlledPeriod ?? internalPeriod;
  const setPeriod = (next: HistoryRecapPeriod) => {
    setInternalPeriod(next);
    onPeriodChange?.(next);
  };
  const [shareOpen, setShareOpen] = useState(false);
  const { recap, load, periods, retry } = useHistoryRecap(period, libraryId);
  const viewer = useVelaState(s => s.auth.viewer) || 'Viewer';
  const topArtist = recap?.topArtists[0]?.card;
  const topTrack = recap?.topTracks[0]?.card;
  const accent = topArtist?.accent || topTrack?.accent || m.ui.accent;
  const labels = useMemo(() => recapLabels(listening), [listening]);

  return (
    <View testID="recap-block">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 14 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="radiogroup" testID="music-rewind-periods">
          {periods.map(p => (
            <RecapPeriodChip key={p} label={msg(`music.rewind.period.${p}`)} on={period === p} onPress={() => setPeriod(p)} />
          ))}
        </View>
        {recap && recap.plays > 0 ? (
          <RecapActionPill symbol="sparkles" label={msg('music.rewind.shareCard')} onPress={() => setShareOpen(true)} testID="music-rewind-share-open" />
        ) : null}
      </View>

      {load === 'failed' && !recap ? (
        <View style={{ paddingVertical: 40, gap: 12, alignItems: 'flex-start' }}>
          <Text style={m.text({ 'font-size': '16px', color: '$ui.inkSecondary' })}>{msg('media.ui.loadFailed')}</Text>
          <RecapActionPill symbol="restart" label={msg('media.ui.retry')} onPress={retry} />
        </View>
      ) : !recap ? (
        <View style={{ paddingVertical: 48 }} testID="music-rewind-loading">
          <View style={{ height: 140, borderRadius: 16, backgroundColor: alpha(m.ui.ink, 0.06) }} />
        </View>
      ) : recap.plays === 0 ? (
        <View style={{ padding: 28, borderRadius: 16, backgroundColor: alpha(m.ui.ink, 0.05), borderWidth: 1, borderColor: m.ui.glassEdge, gap: 8, marginTop: 12 }} testID="music-rewind-empty">
          <Text style={m.text({ 'font-family': '$ui.fontDisplay', 'font-size': '24px', color: '$ui.ink' })}>{msg('music.rewind.emptyTitle')}</Text>
          <Text style={m.text({ 'font-size': '15px', color: '$ui.inkSecondary' })}>{msg('music.rewind.emptyBody')}</Text>
        </View>
      ) : (
        <View style={{ gap: 32, marginTop: 8 }}>
          <RecapStatsGrid recap={recap} labels={labels} />
          <RecapDailyChart byDay={recap.byDay} period={recap.period} accent={accent} />
          <View style={m.small ? { gap: 28 } : { flexDirection: 'row', flexWrap: 'wrap', gap: 28 }}>
            {recap.topArtists.length ? (
              <View style={m.small ? { alignSelf: 'stretch' } : { flex: 1, minWidth: 320 }}>
                <RecapRankedSection
                  title={labels.topArtists}
                  entries={recap.topArtists}
                  scope="rewind-artists"
                  round={listening === 'music'}
                  onSelectCard={onSelectCard}
                  onPlayCards={onPlayCards}
                />
              </View>
            ) : null}
            {recap.topAlbums.length ? (
              <View style={m.small ? { alignSelf: 'stretch' } : { flex: 1, minWidth: 320 }}>
                <RecapRankedSection
                  title={labels.topAlbums}
                  entries={recap.topAlbums}
                  scope="rewind-albums"
                  round={false}
                  onSelectCard={onSelectCard}
                  onPlayCards={onPlayCards}
                />
              </View>
            ) : null}
          </View>
          {recap.topTracks.length ? (
            <RecapRankedSection
              title={labels.topTracks}
              entries={recap.topTracks}
              scope="rewind-tracks"
              round={false}
              playableList
              onSelectCard={onSelectCard}
              onPlayCards={onPlayCards}
            />
          ) : null}
        </View>
      )}

      {recap ? (
        <RewindShareModal open={shareOpen} close={() => setShareOpen(false)} recap={recap} viewer={viewer} accent={accent} labels={labels} />
      ) : null}
    </View>
  );
}

export function RecapStatsGrid({ recap, labels }: { recap: HistoryRecapModel; labels: RecapLabels }) {
  const m = useMediaLook();
  const compact = m.small;
  const stats = useMemo(() => recapStatCards(recap, labels), [recap, labels]);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: compact ? 10 : 14 }} testID="music-rewind-stats">
      {stats.map(stat => (
        <View key={stat.key} testID={`music-rewind-stat-${stat.key}`}
          style={{ width: (compact ? '48%' : '23.5%') as never, flexGrow: 1, minWidth: compact ? 140 : 180, padding: compact ? 14 : 18, borderRadius: 14, backgroundColor: alpha(m.ui.ink, 0.06), borderWidth: 1, borderColor: m.ui.glassEdge, gap: 4 }}>
          <Text style={m.text({ 'font-size': '12px', 'font-weight': '700', 'letter-spacing': '0.1em', 'text-transform': 'uppercase', color: '$ui.inkQuiet' })}>{stat.label}</Text>
          <Text style={m.text({ 'font-family': '$ui.fontDisplay', 'font-size': compact ? '28px' : '36px', 'font-weight': '750', color: '$ui.ink', 'font-variant-numeric': 'tabular-nums' })}>{stat.value}</Text>
          {stat.detail ? <Text numberOfLines={1} style={m.text({ 'font-size': '13px', color: '$ui.inkSecondary' })}>{stat.detail}</Text> : null}
        </View>
      ))}
    </View>
  );
}

/** Daily minutes chart (`byDay`). For year/all (365 days), aggregates into display buckets so every bar is crisp on phones and wide displays, with hover/focus/tap tooltips. */
export function RecapDailyChart({ byDay, period, accent }: { byDay: { date: string; minutes: number }[]; period: HistoryRecapPeriod; accent: string }) {
  const m = useMediaLook();
  const buckets = useMemo(() => recapChartBuckets(byDay, m.small ? 21 : 31), [byDay, m.small]);
  const max = Math.max(1, ...buckets.map(b => b.minutes));
  const firstDate = byDay[0]?.date ?? '';
  const lastDate = byDay[byDay.length - 1]?.date ?? '';
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  useEffect(() => {
    setActiveIndex(null);
  }, [period, firstDate, lastDate]);

  const activeBucket = activeIndex !== null ? buckets[activeIndex] : undefined;

  return (
    <View testID="music-rewind-chart" style={{ padding: m.small ? 14 : 20, borderRadius: 16, backgroundColor: alpha(m.ui.ink, 0.05), borderWidth: 1, borderColor: m.ui.glassEdge, gap: 14 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Text accessibilityRole="header" style={m.text({ 'font-family': '$ui.fontDisplay', 'font-size': '22px', color: '$ui.ink' })}>{msg('music.rewind.byDay')}</Text>
        {activeBucket ? (
          <View testID="music-rewind-chart-tooltip"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: alpha(accent || m.ui.accent, 0.2), borderWidth: 1, borderColor: accent || m.ui.accent }}>
            <Text style={m.text({ 'font-size': '12px', 'font-weight': '750', color: '$ui.ink', 'font-variant-numeric': 'tabular-nums' })}>
              {activeBucket.tooltip}
            </Text>
          </View>
        ) : (
          <Text style={m.text({ 'font-size': '12px', color: '$ui.inkQuiet', 'font-variant-numeric': 'tabular-nums' })}>
            {period === 'year' || period === 'all' ? `${byDay.length} days (${firstDate} → ${lastDate})` : `${firstDate} → ${lastDate}`}
          </Text>
        )}
      </View>
      <View style={{ height: 112, flexDirection: 'row', alignItems: 'flex-end', gap: m.small ? 3 : 5, paddingTop: 8 }}>
        {buckets.map((b, i) => (
          <RecapChartBar
            key={`${b.label}-${i}`}
            bucket={b}
            index={i}
            max={max}
            accent={accent || m.ui.accent}
            active={activeIndex === i}
            onActivate={() => setActiveIndex(i)}
            onDeactivate={() => setActiveIndex(prev => (prev === i ? null : prev))}
            onToggle={() => setActiveIndex(prev => (prev === i ? null : i))}
          />
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={m.text({ 'font-size': '11px', color: '$ui.inkQuiet', 'font-variant-numeric': 'tabular-nums' })}>{firstDate}</Text>
        <Text style={m.text({ 'font-size': '11px', color: '$ui.inkQuiet', 'font-variant-numeric': 'tabular-nums' })}>{lastDate}</Text>
      </View>
    </View>
  );
}

function RecapChartBar({
  bucket,
  index,
  max,
  accent,
  active,
  onActivate,
  onDeactivate,
  onToggle,
}: {
  bucket: RecapChartBucket;
  index: number;
  max: number;
  accent: string;
  active: boolean;
  onActivate(): void;
  onDeactivate(): void;
  onToggle(): void;
}) {
  const m = useMediaLook();
  const { state, handlers } = useInteraction();
  const lit = active || state.hover || state.focus;
  useEffect(() => {
    if (state.hover || state.focus) onActivate();
  }, [state.hover, state.focus]);
  const heightPct = Math.max(6, Math.round((bucket.minutes / max) * 100));
  return (
    <Pressable
      {...handlers}
      {...(web ? ({ title: bucket.tooltip, onMouseLeave: onDeactivate } as object) : {})}
      onBlur={onDeactivate}
      onPress={onToggle}
      testID={`music-rewind-bar-${index}`}
      accessibilityRole="button"
      accessibilityLabel={bucket.tooltip}
      style={[
        NO_RING,
        {
          flex: 1,
          height: '100%',
          justifyContent: 'flex-end',
          alignItems: 'center',
          paddingHorizontal: 1,
        },
      ]}>
      <View
        style={[
          {
            width: '100%',
            height: `${heightPct}%`,
            minHeight: 4,
            borderRadius: 3,
            backgroundColor: bucket.minutes > 0 ? accent : alpha(m.ui.ink, 0.14),
            opacity: lit ? 1 : bucket.minutes > 0 ? 0.85 : 0.7,
            transform: [{ scaleY: lit ? 1.04 : 1 }],
            borderWidth: lit ? 1 : 0,
            borderColor: lit ? m.ui.ink : 'transparent',
          },
          transition('opacity, transform', 120),
        ]}
      />
    </Pressable>
  );
}

export function RecapRankedSection({
  title,
  entries,
  scope,
  round,
  playableList = false,
  onSelectCard,
  onPlayCards,
}: {
  title: string;
  entries: RecapEntryModel[];
  scope: string;
  round: boolean;
  playableList?: boolean;
  onSelectCard?(card: Card): void;
  onPlayCards?(cards: Card[], index: number): void;
}) {
  const m = useMediaLook();
  const cards = useMemo(() => entries.map(e => e.card), [entries]);
  const audioCards = useMemo(() => cards.filter(c => c.media?.audio), [cards]);
  return (
    <View style={{ gap: 10 }} testID={`music-${scope}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text accessibilityRole="header" style={m.text({ 'font-family': '$ui.fontDisplay', 'font-size': '24px', color: '$ui.ink' })}>{title}</Text>
        {playableList && audioCards.length && onPlayCards ? (
          <RecapPlayButton size={40} onPress={() => onPlayCards(audioCards, 0)} testID="music-rewind-play-top" />
        ) : null}
      </View>
      <View style={{ gap: 4 }}>
        {entries.slice(0, 5).map((entry, idx) => (
          <RecapRankedRow
            key={entry.card.id}
            entry={entry}
            idx={idx}
            scope={scope}
            round={round}
            onPress={() => {
              if (playableList && entry.card.media?.audio && onPlayCards) {
                onPlayCards(audioCards, idx);
              } else {
                onSelectCard?.(entry.card);
              }
            }}
          />
        ))}
      </View>
    </View>
  );
}

function RecapRankedRow({
  entry,
  idx,
  scope,
  round,
  onPress,
}: {
  entry: RecapEntryModel;
  idx: number;
  scope: string;
  round: boolean;
  onPress(): void;
}) {
  const m = useMediaLook();
  const { state, handlers } = useInteraction();
  const lit = state.hover || state.focus;
  const card = entry.card;
  const stats = msg('music.rewind.playsMinutes', { plays: number(entry.plays), minutes: number(entry.minutes) });
  const subtitle = [card.media?.byline || card.media?.parent?.name, stats].filter(Boolean).join(' · ');
  return (
    <Pressable
      {...handlers}
      onPress={onPress}
      testID={`music-${scope}-${idx}`}
      accessibilityRole="button"
      accessibilityLabel={`${idx + 1}. ${card.name}, ${subtitle}`}
      style={[
        NO_RING,
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderRadius: 10,
          backgroundColor: lit ? m.ui.control : alpha(m.ui.ink, 0.04),
          borderWidth: m.tv ? 2 : 0,
          borderColor: m.tv && state.focus ? m.ui.ink : 'transparent',
        },
        transition('background-color', 120),
      ]}>
      <Text style={[m.text({ 'font-family': '$ui.fontDisplay', 'font-size': '18px', 'font-weight': '750', color: idx === 0 ? m.ui.accent : '$ui.inkQuiet', 'font-variant-numeric': 'tabular-nums' }), { width: 24, textAlign: 'center' }]}>
        {number(idx + 1)}
      </Text>
      <View pointerEvents="none">
        <Cover uri={card.poster} shape={round ? 'round' : 'square'} size={48} title={card.name} accent={card.accent} lift={0.3} />
      </View>
      <View pointerEvents="none" style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text numberOfLines={1} style={m.text({ 'font-size': '15px', 'font-weight': '650', color: '$ui.ink' })}>{card.name}</Text>
        <Text numberOfLines={1} style={m.text({ 'font-size': '13px', color: '$ui.inkSecondary' })}>{subtitle}</Text>
      </View>
    </Pressable>
  );
}

export function RecapPeriodChip({ label, on, onPress }: { label: string; on: boolean; onPress(): void }) {
  const m = useMediaLook();
  const { state, handlers } = useInteraction();
  const lit = state.hover || state.focus;
  return (
    <Pressable {...handlers} onPress={onPress} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={label}
      style={[NO_RING, { height: 34, paddingHorizontal: 14, borderRadius: 17, justifyContent: 'center',
        backgroundColor: on ? m.ui.ink : lit ? m.ui.controlHover : m.ui.control,
        borderWidth: m.tv ? 2 : 0, borderColor: m.tv && state.focus ? m.ui.accent : 'transparent' },
        transition('background-color', 120)]}>
      <Text style={m.text({ 'font-size': '13px', 'font-weight': '650', color: on ? m.ui.inkInverse : '$ui.ink' })}>{label}</Text>
    </Pressable>
  );
}

export function RecapActionPill({ symbol, label, onPress, testID }: { symbol: string; label: string; onPress(): void; testID?: string }) {
  const m = useMediaLook();
  const { state, handlers } = useInteraction();
  const lit = state.hover || state.focus;
  return (
    <Pressable {...handlers} onPress={onPress} testID={testID} accessibilityRole="button" accessibilityLabel={label}
      style={[NO_RING, { flexDirection: 'row', alignItems: 'center', gap: 8, height: 36, paddingHorizontal: 16, borderRadius: 18,
        backgroundColor: lit ? m.ui.accent : alpha(m.ui.accent, 0.18), borderWidth: 1, borderColor: m.ui.accent }, transition('background-color', 120)]}>
      <Glyph symbol={symbol} size={16} color={lit ? m.ui.onAccent : m.ui.ink} />
      <Text style={m.text({ 'font-size': '13px', 'font-weight': '700', color: lit ? m.ui.onAccent : '$ui.ink' })}>{label}</Text>
    </Pressable>
  );
}

function RecapPlayButton({ size = 40, onPress, testID }: { size?: number; onPress(): void; testID?: string }) {
  const m = useMediaLook();
  const { state, handlers } = useInteraction();
  const lit = state.hover || state.focus;
  return (
    <Pressable {...handlers} onPress={onPress} testID={testID} accessibilityRole="button" accessibilityLabel={msg('media.ui.play')}
      style={[NO_RING, { width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center',
        backgroundColor: m.ui.accent, transform: [{ scale: state.pressed ? 0.96 : lit ? 1.05 : 1 }] },
        m.box({ 'box-shadow': '0px 8px 20px -4px rgba(0, 0, 0, 0.55)' }), transition('transform', 140)]}>
      <MediaGlyph name="play" size={Math.round(size * 0.42)} color={m.ui.onAccent} />
    </Pressable>
  );
}

export function RewindShareModal({ open, close, recap, viewer, accent, labels }: {
  open: boolean;
  close(): void;
  recap: HistoryRecapModel;
  viewer: string;
  accent: string;
  labels: { topArtists: string; topTracks: string; topAlbums: string };
}) {
  const m = useMediaLook();
  const [copied, setCopied] = useState(false);
  const topArtist: Card | undefined = recap.topArtists[0]?.card;
  const topTrack: Card | undefined = recap.topTracks[0]?.card;
  const topAlbum: Card | undefined = recap.topAlbums[0]?.card;

  const copySummary = () => {
    const text = formatRecapSummary(recap, viewer, {
      ...recapLabels(),
      ...labels,
    });
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(text).catch(() => undefined);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <DismissScope open={open} dismiss={close}>
      <SheetModal open={open} scrim="rgba(3,5,8,0.72)" onRequestClose={close}>
        <View style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center', padding: 20 }]} accessibilityViewIsModal>
          <Pressable accessible={false} focusable={false} onPress={close} style={StyleSheet.absoluteFill} />
          <View testID="music-rewind-share-card"
            style={[{ width: '100%', maxWidth: 420, borderRadius: 24, padding: 28, gap: 20, overflow: 'hidden' },
              m.box({
                'background-image': `linear-gradient(155deg, ${accent || m.ui.accent} 0%, #1c1833 55%, #0d1017 100%)`,
                border: '1px solid rgba(255,255,255,0.22)',
                'box-shadow': '0px 32px 96px rgba(0,0,0,0.75)',
              })]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={m.text({ 'font-size': '12px', 'font-weight': '800', 'letter-spacing': '0.18em', 'text-transform': 'uppercase', color: 'rgba(255,255,255,0.78)' })}>
                VELA REWIND · {msg(`music.rewind.period.${recap.period}`).toUpperCase()}
              </Text>
              <Glyph symbol="sparkles" size={20} color="#ffffff" />
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
              {topArtist || topTrack ? (
                <Cover uri={(topArtist ?? topTrack)!.poster} shape="square" size={88} title={(topArtist ?? topTrack)!.name} accent={accent} lift={1} />
              ) : <RewindCover size={88} />}
              <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                <Text style={m.text({ 'font-family': '$ui.fontDisplay', 'font-size': '34px', 'font-weight': '800', color: '#ffffff', 'line-height': '1.05' })}>
                  {number(recap.minutes)} min
                </Text>
                <Text style={m.text({ 'font-size': '14px', color: 'rgba(255,255,255,0.82)' })}>
                  {number(recap.plays)} plays · {msg(`music.rewind.streakDays.${plural(recap.streak.longest)}`, { count: number(recap.streak.longest) })} streak
                </Text>
              </View>
            </View>

            <View style={{ gap: 12, paddingVertical: 12, borderTopWidth: 1, borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.16)' }}>
              {topArtist ? (
                <View style={{ gap: 2 }}>
                  <Text style={m.text({ 'font-size': '11px', 'font-weight': '700', 'letter-spacing': '0.12em', 'text-transform': 'uppercase', color: 'rgba(255,255,255,0.65)' })}>{labels.topArtists}</Text>
                  <Text numberOfLines={1} style={m.text({ 'font-size': '18px', 'font-weight': '750', color: '#ffffff' })}>{topArtist.name}</Text>
                </View>
              ) : null}
              {topTrack ? (
                <View style={{ gap: 2 }}>
                  <Text style={m.text({ 'font-size': '11px', 'font-weight': '700', 'letter-spacing': '0.12em', 'text-transform': 'uppercase', color: 'rgba(255,255,255,0.65)' })}>{labels.topTracks}</Text>
                  <Text numberOfLines={1} style={m.text({ 'font-size': '18px', 'font-weight': '750', color: '#ffffff' })}>{topTrack.name}</Text>
                </View>
              ) : null}
              {topAlbum ? (
                <View style={{ gap: 2 }}>
                  <Text style={m.text({ 'font-size': '11px', 'font-weight': '700', 'letter-spacing': '0.12em', 'text-transform': 'uppercase', color: 'rgba(255,255,255,0.65)' })}>{labels.topAlbums}</Text>
                  <Text numberOfLines={1} style={m.text({ 'font-size': '16px', 'font-weight': '650', color: 'rgba(255,255,255,0.9)' })}>{topAlbum.name}</Text>
                </View>
              ) : null}
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <Pressable onPress={copySummary} testID="music-rewind-copy" accessibilityRole="button"
                style={[NO_RING, { flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, paddingHorizontal: 18, borderRadius: 20, backgroundColor: '#ffffff' }]}>
                <Glyph symbol="copy" size={16} color="#0d1017" />
                <Text style={m.text({ 'font-size': '14px', 'font-weight': '750', color: '#0d1017' })}>
                  {copied ? msg('music.rewind.copied') : msg('music.rewind.copySummary')}
                </Text>
              </Pressable>
              <Pressable onPress={close} testID="music-rewind-share-close" accessibilityRole="button"
                style={[NO_RING, { height: 40, paddingHorizontal: 16, borderRadius: 20, justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)' }]}>
                <Text style={m.text({ 'font-size': '14px', 'font-weight': '700', color: '#ffffff' })}>{msg('music.rewind.closeCard')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </SheetModal>
    </DismissScope>
  );
}

export { formatFirstPlayLabel };

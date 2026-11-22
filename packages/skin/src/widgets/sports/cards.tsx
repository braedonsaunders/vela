// The Sports screen's cards: the hero (the featured game, in its teams' colours), the compact
// cards beside it, the event cards rows and schedules are made of, the generic table (standings,
// box scores) and the favourite-team chip. Each reads its event live (useLiveEvent), so a pushed
// update changes only the card it belongs to.
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useMemo, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { msg, type LiveEntity, type LiveEvent, type LiveTable } from '@vela/core';
import { useLiveEvent, useSportsActions } from './context';
import type { SportsLook } from './look';
import { airingText, cardLine, heroTint, matchup, probabilityLead, rankRows, targetLabel, watchLabel, watchTarget, type Matchup, type Side } from './model';
import { fitTable } from './table';
import { Crest, FavouriteMark, FocusRow, Glyph, GridMark, LiveBadge, Pill, ProbabilityBar, Score, Surface, Txt } from './parts';
import { alpha } from './colour';

const WHITE = '#ffffff';

function Meta({ look, left, right, live, color }: { look: SportsLook; left: string; right?: string; live?: boolean; color?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: look.px(8), marginBottom: look.px(8) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: look.px(6), flexShrink: 1 }}>
        {live ? <LiveBadge look={look} small /> : null}
        <Txt look={look} size={11.5} weight={600} color={color ?? look.inkQuiet} lines={1} style={{ flexShrink: 1 }}>{left}</Txt>
      </View>
      {right ? <Txt look={look} size={11.5} weight={600} color={color ?? look.inkQuiet} lines={1} style={{ maxWidth: '50%' }}>{right}</Txt> : null}
    </View>
  );
}

/** One side's line: crest, name, and its score (or record before the start). */
function SideLine({ look, side, m, size = 14, ink }: { look: SportsLook; side: Side; m: Matchup; size?: number; ink?: string }) {
  const color = ink ?? look.ink;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: look.px(9), paddingVertical: look.px(2.5) }}>
      <Crest look={look} side={side} size={look.px(size + 10)} />
      <Txt look={look} size={size} weight={side.winner ? 750 : 600} color={color} lines={1} style={{ flex: 1, opacity: side.loser ? 0.62 : 1 }}>{side.short}</Txt>
      {m.scored
        ? <Score look={look} value={side.score} size={size + 2} color={color} dim={side.loser} />
        : m.phase === 'upcoming' && side.record ? <Txt look={look} size={size - 1.5} weight={600} color={look.inkQuiet} digits>{side.record}</Txt> : null}
    </View>
  );
}

/** A race or tournament: its leaders. The place, the name (one line, never crowded out), the
 * headline value bold and its context quieter beside it. */
export function Ranking({ look, event, rows = 3, ink, quiet, size = 13.5, focusRows }: { look: SportsLook; event: LiveEvent; rows?: number; ink?: string; quiet?: string; size?: number; focusRows?: boolean }) {
  if (event.spoiler) return <Txt look={look} size={13} color={quiet ?? look.inkQuiet}>{msg('sports.spoilerHidden')}</Txt>;
  const list = rankRows(event.ranking).slice(0, rows);
  const placeWidth = look.px(size * (list.some(row => row.place.length > 2) ? 2.2 : 1.7));
  return (
    <View style={{ gap: look.px(3) }}>
      {list.map((row, n) => (
        <FocusRow key={`${row.place}-${row.name}-${n}`} look={look} on={!!focusRows} style={{ flexDirection: 'row', alignItems: 'baseline', gap: look.px(8), ...(focusRows ? { paddingVertical: look.px(6), paddingHorizontal: look.px(6), marginHorizontal: -look.px(6) } : null) }}>
          <Txt look={look} size={size - 1.5} weight={800} color={row.pos === 1 ? look.gold : quiet ?? look.inkQuiet} digits lines={1} style={{ width: placeWidth }}>{row.place}</Txt>
          <Txt look={look} size={size} weight={row.pos === 1 ? 700 : 560} color={ink} lines={1} style={{ flex: 1, minWidth: '40%' }}>{row.name}</Txt>
          {row.secondary ? <Txt look={look} size={size - 2} weight={500} color={quiet ?? look.inkQuiet} digits lines={1} style={{ flexShrink: 1 }}>{row.secondary}</Txt> : null}
          {row.detail ? <Txt look={look} size={size - 0.5} weight={750} color={ink ?? look.ink} digits lines={1} style={{ flexShrink: 0, maxWidth: '38%', textAlign: 'right' }}>{row.detail}</Txt> : null}
        </FocusRow>
      ))}
    </View>
  );
}

/** A game in a row or schedule. Pressing it opens the game page. */
export const EventCard = memo(function EventCard({ look, event: given, width, testID }: { look: SportsLook; event: LiveEvent; width: number; testID?: string }) {
  const event = useLiveEvent(given);
  const actions = useSportsActions();
  const m = matchup(event);
  const line = cardLine(event, m);
  return (
    <Surface look={look} onPress={() => actions?.openEvent(event)} testID={testID} label={`${m.title}, ${m.status}`}
      style={{ width, padding: look.px(13), borderWidth: 1, borderColor: m.close ? alpha(look.gold, 0.55) : look.hairline, minHeight: look.px(128) }}>
      <Meta look={look} live={m.phase === 'live' && !m.spoiler} left={m.phase === 'live' ? `${m.league} · ${m.status}` : `${m.status}`} right={m.phase === 'live' ? (m.close ? msg('sports.closeGame') : undefined) : m.league} color={m.close ? look.gold : undefined} />
      {m.sides ? (
        <View>
          <SideLine look={look} side={m.sides[0]} m={m} />
          <SideLine look={look} side={m.sides[1]} m={m} />
        </View>
      ) : (
        <View style={{ gap: look.px(6) }}>
          <Txt look={look} size={14} weight={700} lines={1}>{m.title}</Txt>
          <Ranking look={look} event={event} rows={2} />
        </View>
      )}
      {line ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: look.px(6), marginTop: 'auto', paddingTop: look.px(9) }}>
          <Glyph name={line.glyph} size={look.px(12)} color={line.action ? look.accent : look.inkQuiet} />
          <Txt look={look} size={12} weight={line.action ? 650 : 520} color={line.action ? look.accent : look.inkQuiet} lines={1} style={{ flex: 1 }}>{line.text}</Txt>
        </View>
      ) : null}
    </Surface>
  );
});

/** A compact card beside the hero: league, status and where, then the two sides. */
export const MiniCard = memo(function MiniCard({ look, event: given, testID }: { look: SportsLook; event: LiveEvent; testID?: string }) {
  const event = useLiveEvent(given);
  const actions = useSportsActions();
  const m = matchup(event);
  return (
    <Surface look={look} onPress={() => actions?.openEvent(event)} testID={testID} label={`${m.title}, ${m.status}`} lift={1.03}
      style={{ flex: 1, paddingHorizontal: look.px(13), paddingVertical: look.px(10), borderWidth: 1, borderColor: look.hairline, justifyContent: 'center' }}>
      <Meta look={look} live={m.phase === 'live' && !m.spoiler} left={`${m.league} · ${m.status}`} right={watchLabel(event)} />
      {m.sides ? m.sides.map(side => (
        <View key={side.id} style={{ flexDirection: 'row', alignItems: 'center', gap: look.px(8), paddingVertical: look.px(1) }}>
          <Txt look={look} size={13.5} weight={600} lines={1} style={{ flex: 1, opacity: side.loser ? 0.6 : 1 }}>{side.short}</Txt>
          {m.scored ? <Score look={look} value={side.score} size={14} /> : <Txt look={look} size={12.5} weight={650} color={look.inkSecondary} digits>{side.record}</Txt>}
        </View>
      )) : <Ranking look={look} event={event} rows={2} />}
    </Surface>
  );
});

/** The featured game: its teams' colours behind a big live score, the clock and situation, win
 * probability, and where to watch. */
export function HeroCard({ look, event: given, favourite, testID }: { look: SportsLook; event: LiveEvent; favourite: boolean; testID?: string }) {
  const event = useLiveEvent(given);
  const actions = useSportsActions();
  const m = matchup(event);
  const watch = watchTarget(event);
  const airing = watch ? '' : airingText(event);
  const lead = probabilityLead(event, m.sides);
  const away = m.sides?.[0], home = m.sides?.[1];
  const tintA = away ? heroTint(away) : '#18264a', tintB = home ? heroTint(home) : '#3a1020';
  const compact = look.small;
  const crest = look.px(compact ? 40 : 54);
  const eyebrow = [m.league, m.phase === 'live' ? '' : m.status, favourite ? msg('sports.yourTeam') : ''].filter(Boolean).join(' · ');
  return (
    <View testID={testID} style={{ borderRadius: look.radiusPanel, overflow: 'hidden', flex: 1, minHeight: look.px(compact ? 220 : 252) }}>
      <LinearGradient colors={[tintA, tintB]} start={{ x: 0, y: 0.2 }} end={{ x: 1, y: 0.8 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
      <LinearGradient colors={['rgba(5,7,13,0.15)', 'rgba(5,7,13,0.55)']} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
      <View style={{ padding: look.px(compact ? 16 : 22), flex: 1, justifyContent: 'space-between', gap: look.px(14) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: look.px(9) }}>
          {m.phase === 'live' && !m.spoiler ? <LiveBadge look={look} /> : null}
          <Txt look={look} size={12.5} weight={650} color={alpha(WHITE, 0.82)} lines={1} style={{ flex: 1 }}>{eyebrow}</Txt>
          {m.close ? <Txt look={look} size={12} weight={800} color={look.gold}>{msg('sports.closeGame')}</Txt> : null}
        </View>
        {away && home ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: look.px(10) }}>
            <View style={{ flex: 1, flexDirection: compact ? 'column' : 'row', alignItems: 'center', gap: look.px(12) }}>
              <Crest look={look} side={away} size={crest} ring />
              <Txt look={look} size={compact ? 15 : 19} weight={700} color={WHITE} lines={1} style={{ flexShrink: 1 }}>{away.short}</Txt>
            </View>
            <View style={{ alignItems: 'center', minWidth: look.px(compact ? 110 : 170) }}>
              {m.scored ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: look.px(12) }}>
                  <Score look={look} value={away.score} size={compact ? 38 : 52} color={WHITE} weight={800} testID="sports-hero-away-score" />
                  <Txt look={look} size={compact ? 26 : 34} weight={300} color={alpha(WHITE, 0.6)}>–</Txt>
                  <Score look={look} value={home.score} size={compact ? 38 : 52} color={WHITE} weight={800} testID="sports-hero-home-score" />
                </View>
              ) : m.spoiler ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: look.px(8) }}>
                  <Glyph name="eye-off" size={look.px(18)} color={alpha(WHITE, 0.8)} />
                  <Txt look={look} size={15} weight={650} color={alpha(WHITE, 0.85)}>{msg('sports.spoilersHidden')}</Txt>
                </View>
              ) : (
                <Txt look={look} size={compact ? 24 : 32} weight={800} color={WHITE} digits>{m.status}</Txt>
              )}
              <Txt look={look} size={12.5} weight={650} color="#ffd7dc" lines={1} style={{ marginTop: look.px(4) }}>
                {[m.phase === 'live' ? m.status : m.phase === 'final' ? m.status : '', m.situation].filter(Boolean).join(' · ')}
              </Txt>
            </View>
            <View style={{ flex: 1, flexDirection: compact ? 'column' : 'row-reverse', alignItems: 'center', gap: look.px(12) }}>
              <Crest look={look} side={home} size={crest} ring />
              <Txt look={look} size={compact ? 15 : 19} weight={700} color={WHITE} lines={1} style={{ flexShrink: 1, textAlign: 'right' }}>{home.short}</Txt>
            </View>
          </View>
        ) : (
          <View style={{ gap: look.px(8) }}>
            <Txt look={look} size={24} weight={800} color={WHITE} lines={1}>{m.title}</Txt>
            <Ranking look={look} event={event} rows={3} ink={WHITE} quiet={alpha(WHITE, 0.62)} size={15} />
          </View>
        )}
        <View style={{ gap: look.px(10) }}>
          {lead && away && home ? (
            <View style={{ gap: look.px(5) }}>
              <ProbabilityBar look={look} home={lead.home} awayColor={alpha(WHITE, 0.32)} homeColor="#9fc0ff" height={look.px(5)} />
              <Txt look={look} size={11.5} weight={600} color={alpha(WHITE, 0.78)}>{msg('sports.winProbability', { team: lead.abbr, share: lead.share })}</Txt>
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: look.px(10) }}>
            {watch ? <Pill look={look} primary glyph="play-fill" label={msg('sports.watchOn', { name: targetLabel(watch) })} onPress={() => actions?.watch(watch, event)} testID="sports-hero-watch" /> : null}
            {watch && actions?.addToMultiview ? (
              <HeroButton look={look} label={msg('sports.addToMultiview')} onPress={() => actions.addToMultiview?.(watch, event)} icon={<GridMark size={look.px(15)} color={WHITE} />} testID="sports-hero-multiview" />
            ) : null}
            <HeroButton look={look} label={msg('sports.gameDetails')} onPress={() => actions?.openEvent(event)} icon={<Glyph name="list" size={look.px(15)} color={WHITE} />} testID="sports-hero-details" />
            {airing ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: look.px(7), height: look.px(42), paddingHorizontal: look.px(4), flexShrink: 1 }}>
                <Glyph name="tv" size={look.px(15)} color={alpha(WHITE, 0.7)} />
                <Txt look={look} size={13.5} weight={600} color={alpha(WHITE, 0.78)} lines={1} style={{ flexShrink: 1 }}>{msg('sports.onBroadcast', { name: airing })}</Txt>
              </View>
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );
}

function HeroButton({ look, label, onPress, icon, testID }: { look: SportsLook; label: string; onPress(): void; icon: ReactNode; testID?: string }) {
  const height = look.px(42);
  return (
    <Surface look={look} onPress={onPress} label={label} testID={testID} radius={height / 2} lift={1.06} fill={alpha(WHITE, 0.14)} focusFill={alpha(WHITE, 0.3)}
      style={{ height, paddingHorizontal: look.px(18), flexDirection: 'row', alignItems: 'center', gap: look.px(8) }}>
      {icon}
      <Txt look={look} size={14.5} weight={650} color={WHITE} lines={1}>{label}</Txt>
    </Surface>
  );
}

/** The type a table is set in, as the fit measures it. */
export function tableText(look: SportsLook, compact?: boolean) {
  return { size: look.px(compact ? 13 : 13.5), headerSize: look.px(11.5), gap: look.px(compact ? 9 : 12) };
}

/** A table's natural width (every column at its content), for sizing a card around it. */
export function tableWidth(look: SportsLook, table: LiveTable, compact?: boolean): number {
  return fitTable(table, Infinity, tableText(look, compact)).natural;
}

/**
 * A generic table: a title, a header row and display cells. Columns are as wide as their content:
 * the names read whole, numbers are tight and right-aligned, and when the room runs out the least
 * useful columns go before a name is cut.
 */
export function TableView({ look, table, highlight, compact, testID, focusRows }: { look: SportsLook; table: LiveTable; highlight?: (row: readonly string[]) => boolean; compact?: boolean; testID?: string; focusRows?: boolean }) {
  const [width, setWidth] = useState(0);
  const text = tableText(look, compact);
  const fit = useMemo(() => fitTable(table, width || Infinity, text), [table, width, text.size, text.headerSize, text.gap]); // eslint-disable-line react-hooks/exhaustive-deps
  // Each column's gap is on its leading side (the first column's on its trailing side), so a
  // right-aligned number never runs into the words after it.
  const cellStyle = (c: (typeof fit.columns)[number], n: number) => {
    const pad = n === 0 ? { paddingRight: text.gap } : c.align === 'left' ? { paddingLeft: text.gap } : null;
    return c.name ? { flex: 1, minWidth: 0, textAlign: 'left' as const, ...pad } : { width: c.width, textAlign: c.align, ...pad };
  };
  return (
    <View testID={testID} style={{ gap: look.px(2), opacity: width ? 1 : 0 }} onLayout={event => setWidth(Math.floor(event.nativeEvent.layout.width))}>
      {table.title ? <Txt look={look} size={12} weight={700} color={look.inkQuiet} lines={2} style={{ letterSpacing: look.px(1.1), textTransform: 'uppercase', marginBottom: look.px(6) }}>{table.title}</Txt> : null}
      <View style={{ flexDirection: 'row', paddingBottom: look.px(6), borderBottomWidth: 1, borderBottomColor: look.hairline }}>
        {fit.columns.map((c, n) => (
          <Txt key={`${c.index}-${table.columns[c.index]}`} look={look} size={11.5} weight={650} color={look.inkQuiet} lines={1} style={cellStyle(c, n)}>{table.columns[c.index] ?? ''}</Txt>
        ))}
      </View>
      {table.rows.map((row, r) => {
        const on = highlight?.(row) ?? false;
        const last = r === table.rows.length - 1;
        return (
          <FocusRow key={r} look={look} on={!!focusRows} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: look.px(compact ? 5 : 7), borderBottomWidth: last ? 0 : 1, borderBottomColor: on ? 'transparent' : look.hairline,
            marginHorizontal: -look.px(6), paddingHorizontal: look.px(6), backgroundColor: on ? alpha(look.accent, 0.14) : 'transparent', borderRadius: on ? look.px(7) : 0 }}>
            {fit.columns.map((c, n) => {
              const lead = c.name || n === 0;
              const total = c.index === table.columns.length - 1 && !c.name;
              return (
                <Txt key={c.index} look={look} size={compact ? 13 : 13.5} weight={c.name ? 650 : total ? 700 : 520} color={c.name || total ? look.ink : lead ? look.inkSecondary : look.inkSecondary} lines={1} digits
                  style={cellStyle(c, n)}>{row[c.index] ?? ''}</Txt>
              );
            })}
          </FocusRow>
        );
      })}
    </View>
  );
}

/** A team to favourite: its crest, its name, a star that fills. */
export function EntityChip({ look, entity, on, onPress, testID }: { look: SportsLook; entity: LiveEntity; on: boolean; onPress(): void; testID?: string }) {
  const height = look.px(48);
  const side = { abbr: entity.abbr || entity.name.slice(0, 3).toUpperCase(), logo: entity.logo ?? '', color: entity.color ?? '', altColor: '', name: entity.name };
  return (
    <Surface look={look} onPress={onPress} testID={testID} label={msg(on ? 'sports.unfavourite' : 'sports.favourite', { name: entity.name })} radius={height / 2} lift={1.05}
      fill={on ? alpha(look.gold, 0.14) : alpha(look.ink, 0.06)} focusFill={on ? alpha(look.gold, 0.24) : alpha(look.ink, 0.14)}
      style={{ height, paddingLeft: look.px(6), paddingRight: look.px(14), flexDirection: 'row', alignItems: 'center', gap: look.px(10), borderWidth: 1, borderColor: on ? alpha(look.gold, 0.5) : look.hairline }}>
      <Crest look={look} side={side} size={height - look.px(12)} />
      <Txt look={look} size={13.5} weight={620} lines={1}>{entity.name}</Txt>
      <FavouriteMark look={look} on={on} size={look.px(16)} />
    </Surface>
  );
}

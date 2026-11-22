// The Sports screen's cards: the hero (the featured game, in its teams' colours), the compact
// cards beside it, the event cards rows and schedules are made of, the generic table (standings,
// box scores) and the favourite-team chip. Each reads its event live (useLiveEvent), so a pushed
// update changes only the card it belongs to.
import { LinearGradient } from 'expo-linear-gradient';
import { memo, type ReactNode } from 'react';
import { View } from 'react-native';
import { msg, type LiveEntity, type LiveEvent, type LiveTable } from '@vela/core';
import { useLiveEvent, useSportsActions } from './context';
import type { SportsLook } from './look';
import { bestWatch, heroTint, matchup, numericColumn, probabilityLead, tunable, watchLabel, type Matchup, type Side } from './model';
import { Crest, FavouriteMark, Glyph, GridMark, LiveBadge, Pill, ProbabilityBar, Score, Surface, Txt } from './parts';
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

/** A race or tournament: its leaders. */
function Ranking({ look, event, rows = 3, ink }: { look: SportsLook; event: LiveEvent; rows?: number; ink?: string }) {
  if (event.spoiler) return <Txt look={look} size={13} color={look.inkQuiet}>{msg('sports.spoilerHidden')}</Txt>;
  return (
    <View style={{ gap: look.px(3) }}>
      {(event.ranking ?? []).slice(0, rows).map(row => (
        <View key={`${row.pos}-${row.name}`} style={{ flexDirection: 'row', alignItems: 'center', gap: look.px(8) }}>
          <Txt look={look} size={12} weight={800} color={row.pos === 1 ? look.gold : look.inkQuiet} digits style={{ width: look.px(22) }}>P{row.pos}</Txt>
          <Txt look={look} size={13.5} weight={row.pos === 1 ? 700 : 560} color={ink} lines={1} style={{ flex: 1 }}>{row.name}</Txt>
          {row.detail ? <Txt look={look} size={12} color={look.inkQuiet} digits lines={1}>{row.detail}</Txt> : null}
        </View>
      ))}
    </View>
  );
}

/** What pressing the card leads to, in the accent: watch, spoilers, the start. */
function cardAction(event: LiveEvent, m: Matchup): { glyph: string; text: string } | null {
  if (m.spoiler) return { glyph: 'eye-off', text: msg('sports.spoilersHidden') };
  const label = watchLabel(event);
  if (m.phase === 'live' && label) return { glyph: 'play-fill', text: msg('sports.watchOn', { name: label }) };
  if (m.phase === 'upcoming' && label) return { glyph: 'calendar', text: label };
  if (m.phase === 'final') return { glyph: 'forward-chevron', text: msg('sports.recap') };
  return null;
}

/** A game in a row or schedule. Pressing it opens the game page. */
export const EventCard = memo(function EventCard({ look, event: given, width, testID }: { look: SportsLook; event: LiveEvent; width: number; testID?: string }) {
  const event = useLiveEvent(given);
  const actions = useSportsActions();
  const m = matchup(event);
  const action = cardAction(event, m);
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
      {action ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: look.px(6), marginTop: 'auto', paddingTop: look.px(9) }}>
          <Glyph name={action.glyph} size={look.px(12)} color={look.accent} />
          <Txt look={look} size={12} weight={600} color={look.accent} lines={1} style={{ flex: 1 }}>{action.text}</Txt>
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
  const watch = bestWatch(event);
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
            <Ranking look={look} event={event} rows={3} ink={WHITE} />
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
            {tunable(watch) ? <Pill look={look} primary glyph="play-fill" label={msg('sports.watchOn', { name: watchLabel(event) })} onPress={() => actions?.watch(watch, event)} testID="sports-hero-watch" /> : null}
            {tunable(watch) && actions?.addToMultiview ? (
              <HeroButton look={look} label={msg('sports.addToMultiview')} onPress={() => actions.addToMultiview?.(watch, event)} icon={<GridMark size={look.px(15)} color={WHITE} />} testID="sports-hero-multiview" />
            ) : null}
            <HeroButton look={look} label={msg('sports.gameDetails')} onPress={() => actions?.openEvent(event)} icon={<Glyph name="list" size={look.px(15)} color={WHITE} />} testID="sports-hero-details" />
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

/** A generic table: a title, a header row and display cells; numbers align right and keep their width. */
export function TableView({ look, table, highlight, compact, testID }: { look: SportsLook; table: LiveTable; highlight?: (row: readonly string[]) => boolean; compact?: boolean; testID?: string }) {
  const numeric = table.columns.map((_, n) => numericColumn(table.rows, n));
  const cell = look.px(compact ? 38 : 46);
  return (
    <View testID={testID} style={{ gap: look.px(2) }}>
      {table.title ? <Txt look={look} size={12} weight={700} color={look.inkQuiet} style={{ letterSpacing: look.px(1.1), textTransform: 'uppercase', marginBottom: look.px(6) }}>{table.title}</Txt> : null}
      <View style={{ flexDirection: 'row', paddingBottom: look.px(6), borderBottomWidth: 1, borderBottomColor: look.hairline }}>
        {table.columns.map((column, n) => (
          <Txt key={`${n}-${column}`} look={look} size={11.5} weight={650} color={look.inkQuiet} lines={1}
            style={n === 0 ? { flex: 1 } : { width: cell, textAlign: numeric[n] ? 'right' : 'center' }}>{column}</Txt>
        ))}
      </View>
      {table.rows.map((row, r) => {
        const on = highlight?.(row) ?? false;
        const last = r === table.rows.length - 1;
        return (
          <View key={r} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: look.px(compact ? 5 : 7), borderBottomWidth: last ? 0 : 1, borderBottomColor: look.hairline,
            backgroundColor: on ? alpha(look.accent, 0.1) : 'transparent', borderRadius: on ? look.px(6) : 0 }}>
            {table.columns.map((_, n) => (
              <Txt key={n} look={look} size={13.5} weight={n === 0 || n === row.length - 1 && numeric[n] ? 650 : 520} color={n === 0 ? look.ink : look.inkSecondary} lines={1} digits
                style={n === 0 ? { flex: 1, paddingLeft: on ? look.px(6) : 0 } : { width: cell, textAlign: numeric[n] ? 'right' : 'center', color: n === row.length - 1 && numeric[n] ? look.ink : look.inkSecondary }}>{row[n] ?? ''}</Txt>
            ))}
          </View>
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

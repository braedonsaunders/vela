// A game's page: the score in its teams' colours with the clock and situation, where to watch,
// the win-probability graph, the generic tables (linescore, box score) and the plays, newest first,
// scoring plays lit. Live while open: the stream moves the score at once and the plays and tables
// follow within seconds. A spoiler-free viewer sees no result until they reveal it.
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState, type ReactNode } from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { msg, venueText, type LiveEvent, type LiveEventDetail, type LivePlay } from '@vela/core';
import { useVela, useVelaState } from '@vela/core/react';
import { useLiveEvent, useSportsActions } from './context';
import { useSportsLook, type SportsLook } from './look';
import { airingText, heroTint, newestFirst, matchup, probabilityLead, targetLabel, tunable, type Matchup, type Side } from './model';
import { Crest, Glyph, GridMark, LiveBadge, Pill, Placeholder, ProbabilityBar, Rise, Score, Surface, Txt } from './parts';
import { Ranking, TableView } from './cards';
import { ProbabilityGraph, readableTeam } from './graph';
import { alpha } from './colour';

const WHITE = '#ffffff';

export function GamePage({ id, active = true }: { id: string; active?: boolean }) {
  const vela = useVela();
  const look = useSportsLook();
  const loadable = useVelaState(state => state.liveEvents.details[id]);
  const detail = loadable?.value;
  const event = useLiveEvent(useVelaState(state => state.liveEvents.events[id]));
  useEffect(() => { void vela.liveEvents.loadDetail(id); }, [vela, id]);
  useEffect(() => (active ? vela.liveEvents.follow({ events: [id] }) : undefined), [vela, id, active]);
  const actions = useSportsActions();
  if (!detail || !event) {
    if (loadable?.load === 'failed') return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: look.px(16) }}>
        <Txt look={look} size={18} weight={700}>{msg('sports.gameUnavailable')}</Txt>
        <Pill look={look} primary label={msg('sports.retry')} glyph="restart" onPress={() => void vela.liveEvents.loadDetail(id)} hasTVPreferredFocus />
      </View>
    );
    return <GameSkeleton look={look} />;
  }
  const m = matchup(event);
  const wide = !look.small;
  return (
    <ScrollView testID="sports-game" style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: look.px(48) }} showsVerticalScrollIndicator={!Platform.isTV}>
      <Rise look={look} index={0}>
        <ScoreBand look={look} event={event} m={m} close={actions?.close} />
      </Rise>
      <View style={{ paddingHorizontal: look.gutter, paddingTop: look.px(20), gap: look.px(22) }}>
        {m.spoiler ? <Rise look={look} index={1}><Reveal look={look} id={id} /></Rise> : null}
        <Rise look={look} index={1}><WatchRow look={look} event={event} /></Rise>
        <View style={{ flexDirection: wide ? 'row' : 'column', gap: look.px(22), alignItems: 'flex-start' }}>
          <View style={{ flex: wide ? 1.25 : undefined, alignSelf: 'stretch', gap: look.px(22) }}>
            {detail.probabilitySeries.length > 1 && m.sides && !m.spoiler ? (
              <Rise look={look} index={2}><ProbabilityPanel look={look} event={event} detail={detail} m={m} /></Rise>
            ) : null}
            {detail.tables.map((table, n) => (
              <Rise key={`${n}-${table.title}`} look={look} index={3 + n}>
                <Panel look={look} focusable>
                  <TableView look={look} table={table} testID={`sports-table-${n}`} />
                </Panel>
              </Rise>
            ))}
            {!m.sides && event.ranking?.length && !detail.tables.length ? (
              <Rise look={look} index={3}>
                <Panel look={look} focusable>
                  <Txt look={look} size={12} weight={700} color={look.inkQuiet} style={{ letterSpacing: look.px(1.1), textTransform: 'uppercase', marginBottom: look.px(10) }}>{msg('sports.standingsTitle')}</Txt>
                  <Ranking look={look} event={event} rows={event.ranking.length} size={14.5} />
                </Panel>
              </Rise>
            ) : null}
          </View>
          {detail.plays.length || m.phase === 'upcoming' || m.spoiler ? (
            <View style={{ flex: wide ? 1 : undefined, alignSelf: 'stretch' }}>
              <Rise look={look} index={2}><Plays look={look} plays={detail.plays} m={m} /></Rise>
            </View>
          ) : null}
        </View>
        {detail.links.length && actions?.openLink && !Platform.isTV ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: look.px(10) }}>
            {detail.links.map(link => <Pill key={link.url} look={look} small label={link.label} glyph="external" onPress={() => actions.openLink?.(link.url)} />)}
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

/** The score across the page in both teams' colours. */
function ScoreBand({ look, event, m, close }: { look: SportsLook; event: LiveEvent; m: Matchup; close?: () => void }) {
  const away = m.sides?.[0], home = m.sides?.[1];
  const compact = look.small;
  const crest = look.px(compact ? 52 : 84);
  const scoreSize = compact ? 44 : 72;
  const venue = venueText(event.venue);
  const meta = [event.league.name, m.phase === 'live' ? '' : m.status, venue].filter(Boolean).join(' · ');
  return (
    <View style={{ overflow: 'hidden' }}>
      <LinearGradient colors={[away ? heroTint(away) : '#18264a', home ? heroTint(home) : '#3a1020']} start={{ x: 0, y: 0.3 }} end={{ x: 1, y: 0.7 }}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
      <LinearGradient colors={['rgba(5,7,13,0.2)', alpha(look.page, 0.8), look.page]} locations={[0, 0.78, 1]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
      <View style={{ paddingHorizontal: look.gutter, paddingTop: look.px(compact ? 16 : 26), paddingBottom: look.px(compact ? 18 : 30), gap: look.px(compact ? 14 : 20) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: look.px(10) }}>
          {m.phase === 'live' && !m.spoiler ? <LiveBadge look={look} /> : null}
          <Txt look={look} size={13} weight={650} color={alpha(WHITE, 0.82)} lines={1} style={{ flex: 1 }}>{meta}</Txt>
          {m.close ? <Txt look={look} size={12.5} weight={800} color={look.gold}>{msg('sports.closeGame')}</Txt> : null}
          {close && !Platform.isTV ? (
            <Surface look={look} onPress={close} label={msg('sports.close')} testID="sports-game-close" radius={look.px(19)} fill={alpha(WHITE, 0.14)} focusFill={alpha(WHITE, 0.28)} lift={1.08}
              style={{ width: look.px(38), height: look.px(38), alignItems: 'center', justifyContent: 'center' }}>
              <Glyph name="close" size={look.px(18)} color={WHITE} />
            </Surface>
          ) : null}
        </View>
        {away && home ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: look.px(12) }}>
            <TeamBlock look={look} side={away} crest={crest} />
            <View style={{ alignItems: 'center', minWidth: look.px(compact ? 120 : 260) }}>
              {m.scored ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: look.px(compact ? 10 : 18) }}>
                  <Score look={look} value={away.score} size={scoreSize} color={WHITE} dim={away.loser} testID="sports-game-away-score" />
                  <Txt look={look} size={scoreSize * 0.6} weight={300} color={alpha(WHITE, 0.55)}>–</Txt>
                  <Score look={look} value={home.score} size={scoreSize} color={WHITE} dim={home.loser} testID="sports-game-home-score" />
                </View>
              ) : (
                m.spoiler ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: look.px(10) }}>
                    <Glyph name="eye-off" size={look.px(compact ? 20 : 28)} color={alpha(WHITE, 0.85)} />
                    <Txt look={look} size={compact ? 18 : 26} weight={750} color={WHITE}>{msg('sports.spoilersHidden')}</Txt>
                  </View>
                ) : <Txt look={look} size={compact ? 22 : 34} weight={800} color={WHITE} digits>{m.status}</Txt>
              )}
              <Txt look={look} size={compact ? 13 : 15} weight={700} color="#ffd7dc" lines={1} style={{ marginTop: look.px(6) }}>{m.phase === 'upcoming' ? msg('sports.startsAt', { time: m.status }) : m.status}</Txt>
            </View>
            <TeamBlock look={look} side={home} crest={crest} />
          </View>
        ) : (
          <Txt look={look} size={compact ? 26 : 40} weight={800} color={WHITE} lines={2}>{m.title}</Txt>
        )}
        {!m.spoiler && event.situation && Object.keys(event.situation).length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: away ? 'center' : 'flex-start', gap: look.px(10) }}>
            {Object.entries(event.situation).map(([label, value]) => (
              <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: look.px(7), paddingHorizontal: look.px(12), height: look.px(30), borderRadius: look.px(15), backgroundColor: alpha(WHITE, 0.12) }}>
                <Txt look={look} size={11.5} weight={600} color={alpha(WHITE, 0.7)}>{label}</Txt>
                <Txt look={look} size={13} weight={750} color={WHITE} digits>{value}</Txt>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function TeamBlock({ look, side, crest }: { look: SportsLook; side: Side; crest: number }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: look.px(8), opacity: side.loser ? 0.7 : 1 }}>
      <Crest look={look} side={side} size={crest} ring />
      <Txt look={look} size={look.small ? 14 : 20} weight={750} color={WHITE} lines={1} style={{ textAlign: 'center' }}>{look.small ? side.short : side.name}</Txt>
      {side.record ? <Txt look={look} size={12} weight={600} color={alpha(WHITE, 0.65)} digits>{side.record}</Txt> : null}
    </View>
  );
}

/** Where to watch: each channel that can be tuned is a button (and can join the multiview); where
 * else it airs is said quietly beside them, never as something to press. */
function WatchRow({ look, event }: { look: SportsLook; event: LiveEvent }) {
  const actions = useSportsActions();
  const targets = (event.watch ?? []).filter(tunable);
  const airing = airingText(event);
  if (!targets.length && !airing) return null;
  const first = targets[0];
  return (
    <View style={{ gap: look.px(10) }}>
      <Txt look={look} size={12} weight={700} color={look.inkQuiet} style={{ letterSpacing: look.px(1.1), textTransform: 'uppercase' }}>{msg(targets.length ? 'sports.whereToWatch' : 'sports.broadcasts')}</Txt>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: look.px(10), paddingVertical: look.px(6), paddingHorizontal: look.px(4), alignItems: 'center' }} style={{ marginHorizontal: -look.px(4) }}>
        {targets.map((target, n) => {
          const label = targetLabel(target);
          return <Pill key={`${n}-${target.channelId}`} look={look} primary={n === 0} glyph="play-fill" label={msg('sports.watchOn', { name: label })} onPress={() => actions?.watch(target, event)} testID={`sports-watch-${n}`} hasTVPreferredFocus={n === 0} />;
        })}
        {first && actions?.addToMultiview ? (
          <Surface look={look} onPress={() => actions.addToMultiview?.(first, event)} label={msg('sports.addToMultiview')} testID="sports-game-multiview" radius={look.px(21)} fill={alpha(look.ink, 0.12)} focusFill={alpha(look.ink, 0.22)} lift={1.06}
            style={{ height: look.px(42), paddingHorizontal: look.px(18), flexDirection: 'row', alignItems: 'center', gap: look.px(8) }}>
            <GridMark size={look.px(15)} color={look.ink} />
            <Txt look={look} size={14.5} weight={650}>{msg('sports.addToMultiview')}</Txt>
          </Surface>
        ) : null}
        {airing ? (
          <View testID="sports-airing" style={{ flexDirection: 'row', alignItems: 'center', gap: look.px(8), height: look.px(42), paddingHorizontal: look.px(targets.length ? 8 : 0) }}>
            <Glyph name="tv" size={look.px(16)} color={look.inkQuiet} />
            <Txt look={look} size={14} weight={560} color={look.inkSecondary}>{targets.length ? msg('sports.onBroadcast', { name: airing }) : airing}</Txt>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function ProbabilityPanel({ look, event, detail, m }: { look: SportsLook; event: LiveEvent; detail: LiveEventDetail; m: Matchup }) {
  const lead = probabilityLead(event, m.sides);
  const [away, home] = m.sides!;
  const subject = event.probability?.competitorId ?? event.competitors[0]?.id;
  const top = subject === away.id ? away : home, bottom = top === away ? home : away;
  // Each side's colour as the graph draws it, so the legend, line and bar agree.
  const colors: Record<string, string> = { [away.id]: readableTeam(away.color, look.page), [home.id]: readableTeam(home.color, look.page) };
  return (
    <Panel look={look} focusable>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: look.px(12) }}>
        <Txt look={look} size={12} weight={700} color={look.inkQuiet} style={{ letterSpacing: look.px(1.1), textTransform: 'uppercase' }}>{msg('sports.probability')}</Txt>
        {lead ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: look.px(14) }}>
            {[away, home].map(side => {
              // Whole percentages that add up to 100.
              const homeShare = Math.round(lead.home * 100);
              const share = (side === home ? homeShare : 100 - homeShare) / 100;
              return (
                <View key={side.id} style={{ flexDirection: 'row', alignItems: 'center', gap: look.px(6), opacity: share >= 0.5 ? 1 : 0.7 }}>
                  <View style={{ width: look.px(9), height: look.px(9), borderRadius: look.px(5), backgroundColor: colors[side.id] }} />
                  <Txt look={look} size={13.5} weight={share >= 0.5 ? 800 : 600} digits>{side.abbr} {Math.round(share * 100)}%</Txt>
                </View>
              );
            })}
          </View>
        ) : null}
      </View>
      <ProbabilityGraph look={look} series={detail.probabilitySeries} top={{ abbr: top.abbr, color: top.color }} bottom={{ abbr: bottom.abbr, color: bottom.color }} live={m.phase === 'live'} height={look.px(look.small ? 96 : 132)} />
      {lead ? <View style={{ marginTop: look.px(12) }}><ProbabilityBar look={look} home={lead.home} awayColor={colors[away.id]!} homeColor={colors[home.id]!} height={look.px(5)} /></View> : null}
    </Panel>
  );
}

/** The plays, newest first. A scoring play is lit in gold, a key play in the ink. */
function Plays({ look, plays, m }: { look: SportsLook; plays: LivePlay[]; m: Matchup }) {
  return (
    <Panel look={look}>
      <Txt look={look} size={12} weight={700} color={look.inkQuiet} style={{ letterSpacing: look.px(1.1), textTransform: 'uppercase', marginBottom: look.px(8) }}>{msg('sports.plays')}</Txt>
      {!plays.length ? <Txt look={look} size={14} color={look.inkQuiet}>{m.spoiler ? msg('sports.spoilersHidden') : msg('sports.noPlays')}</Txt> : null}
      {newestFirst(plays).slice(0, 30).map((play, n) => <PlayRow key={`${play.period ?? ''}-${play.clock ?? ''}-${play.text}`} look={look} play={play} index={n} />)}
    </Panel>
  );
}

function PlayRow({ look, play, index }: { look: SportsLook; play: LivePlay; index: number }) {
  const scoring = play.emphasis === 'score';
  const key = play.emphasis === 'key';
  return (
    <Rise look={look} index={Math.min(index, 3)}>
      <Surface look={look} fill="transparent" focusFill={alpha(look.ink, 0.07)} lift={1.015} ring={false} radius={look.px(8)}
        style={{ flexDirection: 'row', gap: look.px(12), paddingVertical: look.px(9), paddingHorizontal: look.px(8), borderTopWidth: index ? 1 : 0, borderTopColor: look.hairline }}>
        <View style={{ width: look.px(3), alignSelf: 'stretch', borderRadius: look.px(2), backgroundColor: scoring ? look.gold : 'transparent' }} />
        <Txt look={look} size={13} weight={750} color={look.accent} digits style={{ width: look.px(52) }}>{play.clock ?? ''}</Txt>
        <Txt look={look} size={14} weight={scoring ? 700 : key ? 650 : 480} color={scoring ? look.ink : key ? look.ink : look.inkSecondary} style={{ flex: 1 }}>{play.text}</Txt>
      </Surface>
    </Rise>
  );
}

/** A spoiler-free viewer's choice to see the result. */
function Reveal({ look, id }: { look: SportsLook; id: string }) {
  const vela = useVela();
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle');
  return (
    <Panel look={look}>
      <View style={{ flexDirection: look.small ? 'column' : 'row', alignItems: look.small ? 'flex-start' : 'center', gap: look.px(16) }}>
        <Glyph name="eye-off" size={look.px(26)} color={look.accent} />
        <View style={{ flex: 1, gap: look.px(4) }}>
          <Txt look={look} size={16} weight={750}>{msg('sports.revealTitle')}</Txt>
          <Txt look={look} size={13.5} color={look.inkSecondary}>{state === 'failed' ? msg('sports.revealFailed') : msg('sports.revealBody')}</Txt>
        </View>
        <Pill look={look} primary label={msg('sports.reveal')} testID="sports-reveal" hasTVPreferredFocus onPress={() => {
          if (state === 'busy') return;
          setState('busy');
          vela.liveEvents.reveal(id).then(() => setState('idle'), () => setState('failed'));
        }} />
      </View>
    </Panel>
  );
}

function Panel({ look, children, focusable }: { look: SportsLook; children: ReactNode; focusable?: boolean }) {
  const style = { padding: look.px(18), borderRadius: look.radiusCard, borderWidth: 1, borderColor: look.hairline };
  // On a TV a panel takes focus so the remote can scroll down to it.
  if (focusable && Platform.isTV) return <Surface look={look} lift={1.01} style={style}>{children}</Surface>;
  return <View style={[style, { backgroundColor: look.card }]}>{children}</View>;
}

function GameSkeleton({ look }: { look: SportsLook }) {
  return (
    <View style={{ padding: look.gutter, gap: look.px(22) }} accessibilityLabel={msg('sports.loading')}>
      <Placeholder look={look} width="100%" height={look.px(220)} radius={look.radiusPanel} />
      <View style={{ flexDirection: 'row', gap: look.px(22) }}>
        <View style={{ flex: 1.25, gap: look.px(16) }}><Placeholder look={look} width="100%" height={look.px(180)} /><Placeholder look={look} width="100%" height={look.px(120)} /></View>
        <View style={{ flex: 1 }}><Placeholder look={look} width="100%" height={look.px(316)} /></View>
      </View>
    </View>
  );
}

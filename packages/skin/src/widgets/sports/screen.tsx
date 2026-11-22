// A plugin screen (Sports): its sections drawn natively from the screen payload, in order: the
// hero with the games beside it, league chips, rows of events, a date-paged schedule, standings
// tables and the favourite-team picker. Live while on screen: one shared stream follows the screen
// and every card reads its own event, so a goal redraws one card, not the page.
//
// The skeleton shows at once and the sections stream in a frame apart once the screen answers, so
// a long screen never holds the first frame. Rows are virtualised. Each section (and each card)
// draws inside its own boundary: one that cannot be drawn is logged and left out, never the page.
import { Component, memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FlatList, Platform, ScrollView, Text, View, type TextStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { entitiesKey, isFavoriteCompetitor, msg, screenKey, spoilerFreeOf, type EntitiesSection, type EventsSection, type HeroSection, type LeaguesSection, type LiveEntity, type LiveEvent, type LiveLeague, type Screen, type ScheduleSection, type ScreenParams, type TableSection } from '@vela/core';
import { useVela, useVelaState } from '@vela/core/react';
import { useSportsLook, type SportsLook } from './look';
import { EntityChip, EventCard, HeroCard, MiniCard, TableView, tableWidth } from './cards';
import { Chip, Glyph, Heading, Pill, Placeholder, Rise, Surface, Txt } from './parts';
import { alpha } from './colour';
import { leagueLabel } from './model';
import { entityKey, leagueTeams, openingLeague, pickerLeagues } from './teams';

export interface SportsScreenProps {
  id: string;
  /** The section is the one on show: only then does it follow the live stream. */
  active: boolean;
}

/** How often a screen on show is read again (new games, a new day), beside the stream's updates. */
const REFRESH_MS = 5 * 60_000;
/** Sections drawn with the first frame; the rest follow one a frame. */
const FIRST_SECTIONS = 3;

export function SportsScreen({ id, active }: SportsScreenProps) {
  const vela = useVela();
  const look = useSportsLook();
  const [params, setParams] = useState<ScreenParams>({});
  const key = screenKey(id, params);
  const loadable = useVelaState(state => state.liveEvents.screens[key]);
  // A new league or day keeps the screen on show until its answer arrives.
  const shown = useRef<Screen | undefined>(undefined);
  if (loadable?.value) shown.current = loadable.value;
  const screen = loadable?.value ?? shown.current;
  const stale = !!screen && !loadable?.value && loadable?.load !== 'failed';
  const changed = useVelaState(state => state.liveEvents.favorites);
  // The viewer's favourites: the picker's as the server listed them, with changes made here.
  const favourites = useMemo(() => {
    const keys = new Set<string>();
    for (const section of screen?.sections ?? []) if (section.type === 'entities') for (const entity of section.entities) if (entity.favorite) keys.add(entityKey(entity));
    for (const [key, on] of Object.entries(changed)) if (on) keys.add(key); else keys.delete(key);
    return keys;
  }, [screen, changed]);
  const read = useVelaState(state => state.liveEvents.entities);
  // Followed teams by name, so standings can light their rows.
  const followedNames = useMemo(() => {
    const names = new Set<string>();
    const add = (entity: LiveEntity) => { if (favourites.has(entityKey(entity))) names.add(entity.name); };
    for (const section of screen?.sections ?? []) if (section.type === 'entities') section.entities.forEach(add);
    for (const list of Object.values(read)) list.value?.forEach(add);
    return names;
  }, [screen, read, favourites]);
  const leagues = useMemo(() => screen?.sections.flatMap(section => section.type === 'leagues' ? section.leagues : []) ?? [], [screen]);

  useEffect(() => { void vela.liveEvents.loadScreen(id, params); }, [vela, id, key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!active) return;
    const stop = vela.liveEvents.follow({ screens: [id] });
    const timer = setInterval(() => void vela.liveEvents.loadScreen(id, params), REFRESH_MS);
    return () => { stop(); clearInterval(timer); };
  }, [vela, id, key, active]); // eslint-disable-line react-hooks/exhaustive-deps

  const count = screen?.sections.length ?? 0;
  const mounted = useStreamedCount(count);

  const choose = (change: ScreenParams) => setParams(current => {
    const next = { ...current, ...change };
    for (const name of Object.keys(next) as (keyof ScreenParams)[]) if (!next[name]) delete next[name];
    return next;
  });

  if (!screen) {
    if (loadable?.load === 'failed') return <Failure look={look} message={loadable.error} retry={() => void vela.liveEvents.loadScreen(id, params)} />;
    return <Skeleton look={look} />;
  }
  return (
    <ScrollView testID={`sports-screen-${id}`} style={{ flex: 1 }} contentContainerStyle={{ paddingTop: look.barTop + look.px(look.tv ? 8 : 12), paddingBottom: look.px(64) }}
      showsVerticalScrollIndicator={!Platform.isTV}>
      {Platform.OS === 'web' ? <Text accessibilityRole="header" {...{ 'aria-level': 1 }} style={HIDDEN}>{screen.title}</Text> : null}
      {!screen.sections.some(section => section.type === 'leagues') ? (
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: look.gutter, paddingBottom: look.px(14) }}><ScoresSwitch look={look} /></View>
      ) : null}
      {screen.sections.slice(0, mounted).map((section, index) => (
        <SectionBoundary key={section.id} id={section.id}>
          <Rise look={look} index={Math.min(index, FIRST_SECTIONS)} style={{ marginBottom: look.px(section.type === 'leagues' ? 20 : 30) }}>
            <Dim look={look} on={stale && section.type !== 'leagues'}>
              <SectionView look={look} section={section} params={params} choose={choose} favourites={favourites} leagues={leagues} followedNames={followedNames}
                pendingDate={stale && section.type === 'schedule' && params.date && params.date !== section.date ? params.date : ''} />
            </Dim>
          </Rise>
        </SectionBoundary>
      ))}
      {mounted < count ? <SectionsPlaceholder look={look} /> : null}
    </ScrollView>
  );
}

/** How many of `count` sections to draw: the first few at once, then one more each frame. */
function useStreamedCount(count: number): number {
  const [mounted, setMounted] = useState(FIRST_SECTIONS);
  useEffect(() => {
    if (mounted >= count) return;
    const frame = requestAnimationFrame(() => setMounted(n => n + 1));
    return () => cancelAnimationFrame(frame);
  }, [mounted, count]);
  return mounted;
}

/** A section (or card) that throws while drawing is logged and left out; the rest of the page stays. */
export class SectionBoundary extends Component<{ id: string; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override componentDidCatch(error: unknown) { console.warn(`Vela Sports: "${this.props.id}" could not be drawn and is left out`, error); }
  override render() { return this.state.failed ? null : this.props.children; }
}

/** Content waiting on a new league or day fades back until it arrives. */
function Dim({ look, on, children }: { look: SportsLook; on: boolean; children: ReactNode }) {
  const t = useSharedValue(on ? 1 : 0);
  useEffect(() => { t.value = look.still ? (on ? 1 : 0) : withTiming(on ? 1 : 0, { duration: on ? 260 : 180 }); }, [on, look.still, t]);
  const style = useAnimatedStyle(() => ({ opacity: 1 - 0.45 * t.value }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

const SectionView = memo(function SectionView({ look, section, params, choose, favourites, leagues, pendingDate, followedNames }: {
  look: SportsLook; section: Screen['sections'][number]; params: ScreenParams; choose(change: ScreenParams): void; favourites: ReadonlySet<string>; leagues: readonly LiveLeague[]; pendingDate: string; followedNames: ReadonlySet<string>;
}) {
  switch (section.type) {
    case 'hero': return <Hero look={look} section={section} favourites={favourites} />;
    case 'leagues': return <Leagues look={look} section={section} selected={params.league ?? section.selected ?? ''} choose={league => choose({ league, date: params.date })} />;
    case 'events': return <EventsRow look={look} section={section} following={favourites.size > 0} />;
    case 'schedule': return <Schedule look={look} section={section} pending={pendingDate} choose={date => choose({ date })} />;
    case 'table': return <Tables look={look} section={section} followedNames={followedNames} />;
    case 'entities': return <Entities look={look} section={section} leagues={leagues} chosen={params.league ?? ''} />;
    default: return null;
  }
});

function Gutter({ look, children }: { look: SportsLook; children: ReactNode }) {
  return <View style={{ paddingHorizontal: look.gutter }}>{children}</View>;
}

/** The featured game, with the next few beside it (under it on a phone). */
function Hero({ look, section, favourites }: { look: SportsLook; section: HeroSection; favourites: ReadonlySet<string> }) {
  if (!section.event) return null;
  const also = section.also ?? [];
  const favourite = section.event.competitors.some(c => isFavoriteCompetitor(c, favourites));
  const wide = !look.small;
  return (
    <Gutter look={look}>
      <View style={{ flexDirection: wide ? 'row' : 'column', gap: look.px(16), minHeight: wide ? look.px(268) : undefined }}>
        <View style={{ flex: wide ? 1.65 : undefined }}>
          <SectionBoundary id={`hero ${section.event.id}`}>
            <HeroCard key={section.event.id} look={look} event={section.event} favourite={favourite} testID="sports-hero" />
          </SectionBoundary>
        </View>
        {also.length ? (
          <View style={{ flex: wide ? 1 : undefined, gap: look.px(10) }}>
            {also.slice(0, 3).map(event => (
              <SectionBoundary key={event.id} id={`event ${event.id}`}>
                <MiniCard look={look} event={event} testID={`sports-mini-${event.id}`} />
              </SectionBoundary>
            ))}
          </View>
        ) : null}
      </View>
    </Gutter>
  );
}

function Leagues({ look, section, selected, choose }: { look: SportsLook; section: LeaguesSection; selected: string; choose(league: string): void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: look.gutter, paddingVertical: look.px(6), gap: look.px(10) }}>
      <Chip look={look} label={msg('sports.allLeagues')} on={!selected} onPress={() => choose('')} testID="sports-league-all" />
      {section.leagues.map(league => (
        <Chip key={league.id} look={look} label={leagueLabel(league)} on={selected === league.id} onPress={() => choose(league.id)} testID={`sports-league-${league.id}`} />
      ))}
      <ScoresSwitch look={look} />
    </ScrollView>
  );
}

/** "Hide scores": the viewer's spoiler-free switch, beside the league chips. Shown once the
 * preference is known and the server can change it; a change re-reads the screen. */
function ScoresSwitch({ look }: { look: SportsLook }) {
  const vela = useVela();
  const on = useVelaState(spoilerFreeOf);
  const [failed, setFailed] = useState(false);
  useEffect(() => { void vela.liveEvents.loadPreferences(); }, [vela]);
  if (on === undefined || !vela.liveEvents.canSetPreferences()) return null;
  const height = look.px(36);
  const track = look.px(30), knob = look.px(14);
  return (
    <Surface look={look} radius={height / 2} lift={1.06} testID="sports-hide-scores" label={msg('ui.hideScores')}
      fill={on ? alpha(look.accent, 0.18) : alpha(look.ink, 0.08)} focusFill={on ? alpha(look.accent, 0.3) : alpha(look.ink, 0.18)}
      onPress={() => { setFailed(false); vela.liveEvents.setSpoilerFree(!on).catch(() => setFailed(true)); }}
      style={{ height, paddingLeft: look.px(14), paddingRight: look.px(10), flexDirection: 'row', alignItems: 'center', gap: look.px(9), marginLeft: look.px(10) }}>
      <Glyph name="eye-off" size={look.px(16)} color={on ? look.accent : look.inkSecondary} />
      <Txt look={look} size={14} weight={on ? 700 : 560} color={failed ? look.live : look.ink} lines={1}>{msg(failed ? 'sports.hideScoresFailed' : 'ui.hideScores')}</Txt>
      <SwitchMark look={look} on={on} track={track} knob={knob} />
    </Surface>
  );
}

function SwitchMark({ look, on, track, knob }: { look: SportsLook; on: boolean; track: number; knob: number }) {
  const t = useSharedValue(on ? 1 : 0);
  useEffect(() => { t.value = look.still ? (on ? 1 : 0) : withTiming(on ? 1 : 0, { duration: 220 }); }, [on, look.still, t]);
  const pad = (look.px(18) - knob) / 2;
  const knobStyle = useAnimatedStyle(() => ({ transform: [{ translateX: t.value * (track - knob - pad * 2) }] }));
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: track, height: look.px(18), borderRadius: look.px(9), padding: pad, backgroundColor: on ? look.accent : alpha(look.ink, 0.22) }}>
      <Animated.View style={[{ width: knob, height: knob, borderRadius: knob / 2, backgroundColor: on ? look.onAccent : look.ink }, knobStyle]} />
    </View>
  );
}

function cardWidth(look: SportsLook): number {
  if (look.small) return Math.min(look.px(272), look.width * 0.74);
  return look.px(look.tv ? 300 : 286);
}

function EventsRow({ look, section, following }: { look: SportsLook; section: EventsSection; following: boolean }) {
  const favourites = section.query?.favorites === true;
  if (!section.events.length && !favourites) return null;
  return (
    <View>
      <Gutter look={look}><Heading look={look}>{section.title ?? ''}</Heading></Gutter>
      {section.events.length ? (
        <Cards look={look} events={section.events} prefix={section.id} />
      ) : (
        <Gutter look={look}><Txt look={look} size={14} color={look.inkQuiet}>{msg(following ? 'sports.noFavouriteGames' : 'sports.noFavourites')}</Txt></Gutter>
      )}
    </View>
  );
}

/** A row of game cards, virtualised: a day of thirty games draws the few on screen. */
function Cards({ look, events, prefix }: { look: SportsLook; events: LiveEvent[]; prefix: string }) {
  const width = cardWidth(look);
  const gap = look.px(14);
  return (
    <FlatList
      horizontal
      data={events}
      keyExtractor={event => event.id}
      renderItem={({ item }) => (
        <SectionBoundary id={`event ${item.id}`}>
          <EventCard look={look} event={item} width={width} testID={`sports-${prefix}-${item.id}`} />
        </SectionBoundary>
      )}
      ItemSeparatorComponent={() => <View style={{ width: gap }} />}
      getItemLayout={(_, index) => ({ length: width + gap, offset: look.gutter + index * (width + gap), index })}
      initialNumToRender={Math.ceil(look.width / (width + gap)) + 1}
      maxToRenderPerBatch={4}
      windowSize={5}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: look.gutter, paddingVertical: look.px(8) }}
    />
  );
}

/** A day at a time: the days as chips (Today, Tomorrow, …), that day's games below. A day chosen
 * lights at once and its games stand in as placeholders until the day arrives. */
function Schedule({ look, section, pending, choose }: { look: SportsLook; section: ScheduleSection; pending: string; choose(date: string): void }) {
  const days = section.days?.length ? section.days : [{ date: section.date, label: section.date }];
  const current = pending || section.date;
  const width = cardWidth(look);
  return (
    <View>
      <Gutter look={look}><Heading look={look}>{section.title ?? msg('sports.schedule')}</Heading></Gutter>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: look.gutter, paddingVertical: look.px(6), gap: look.px(10) }}>
        {days.map(day => (
          <Chip key={day.date} look={look} label={day.label} on={day.date === current} onPress={() => choose(day.date)} testID={`sports-day-${day.date}`}
            leading={day.count ? <Txt look={look} size={11} weight={800} color={day.date === current ? look.inkInverse : look.inkQuiet} digits>{day.count}</Txt> : undefined} />
        ))}
      </ScrollView>
      {pending ? (
        <View style={{ flexDirection: 'row', gap: look.px(14), paddingHorizontal: look.gutter, paddingVertical: look.px(8), overflow: 'hidden' }}>
          {[0, 1, 2, 3, 4].map(n => <Placeholder key={n} look={look} width={width} height={look.px(128)} />)}
        </View>
      ) : section.events.length
        ? <Cards look={look} events={section.events} prefix={`day-${section.date}`} />
        : <Gutter look={look}><Txt look={look} size={14} color={look.inkQuiet} style={{ marginTop: look.px(10) }}>{msg('sports.noGames')}</Txt></Gutter>}
    </View>
  );
}

/** Standings: each table in a card as wide as its columns want (up to a limit), side by side. */
function Tables({ look, section, followedNames }: { look: SportsLook; section: TableSection; followedNames: ReadonlySet<string> }) {
  const highlight = followedNames.size ? (row: readonly string[]) => row.some(cell => followedNames.has(cell)) : undefined;
  const available = look.width - look.gutter * 2;
  const pad = look.px(16);
  const widths = useMemo(() => section.tables.map(table => {
    if (look.small) return available;
    const natural = tableWidth(look, table, true) + pad * 2 + look.px(8);
    return Math.round(Math.min(available, look.px(look.tv ? 680 : 640), Math.max(look.px(320), natural)));
  }), [section.tables, look, available, pad]);
  if (!section.tables.length) return null;
  return (
    <View>
      <Gutter look={look}><Heading look={look}>{section.title ?? msg('sports.standings')}</Heading></Gutter>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: look.gutter, gap: look.px(16), alignItems: 'flex-start' }}>
        {section.tables.map((table, n) => (
          <SectionBoundary key={`${n}-${table.title}`} id={`table ${table.title}`}>
            <View style={{ width: widths[n], padding: pad, borderRadius: look.radiusCard, backgroundColor: look.card, borderWidth: 1, borderColor: look.hairline }}>
              <TableView look={look} table={table} compact highlight={highlight} />
            </View>
          </SectionBoundary>
        ))}
      </ScrollView>
    </View>
  );
}

/** Teams to follow, one league at a time (the league chips above the teams). A league whose teams
 * the screen did not carry is read from the feed's entities. */
function Entities({ look, section, leagues: screenLeagues, chosen }: { look: SportsLook; section: EntitiesSection; leagues: readonly LiveLeague[]; chosen: string }) {
  const vela = useVela();
  const changed = useVelaState(state => state.liveEvents.favorites);
  const [failed, setFailed] = useState('');
  const followed = (entity: LiveEntity) => changed[entityKey(entity)] ?? entity.favorite === true;
  const leagues = useMemo(() => pickerLeagues(screenLeagues, section.entities), [screenLeagues, section.entities]);
  const [picked, setPicked] = useState('');
  const league = picked && leagues.some(l => l.id === picked) ? picked : openingLeague(leagues, section.entities, chosen, followed);
  useEffect(() => { if (chosen) setPicked(chosen); }, [chosen]);
  const query = { feed: section.feed, league };
  const read = useVelaState(state => state.liveEvents.entities[entitiesKey(query)]);
  const listed = leagueTeams(league, section.entities, read?.value, followed);
  const { needsRead } = listed;
  // The order is set when a league's teams first show: following one does not reshuffle the row
  // under the remote (it moves to the front the next time the league is opened).
  const order = useRef(new Map<string, string[]>());
  const teams = useMemo(() => {
    const known = order.current.get(league) ?? [];
    const rank = new Map(known.map((key, n) => [key, n]));
    const fresh = listed.teams.filter(team => !rank.has(entityKey(team)));
    if (fresh.length) order.current.set(league, [...known, ...fresh.map(entityKey)]);
    const at = (team: LiveEntity) => rank.get(entityKey(team)) ?? known.length + fresh.indexOf(team);
    return [...listed.teams].sort((a, b) => at(a) - at(b));
  }, [league, listed.teams.map(entityKey).join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (needsRead && !read) void vela.liveEvents.loadEntities(query);
  }, [needsRead, read, league]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!leagues.length && !section.entities.length) return null;
  const height = look.px(48);
  return (
    <View>
      <Gutter look={look}>
        <Heading look={look} aside={failed ? <Txt look={look} size={12.5} color={look.live}>{failed}</Txt> : undefined}>{section.title ?? msg('sports.pickTeams')}</Heading>
      </Gutter>
      {leagues.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: look.gutter, paddingBottom: look.px(6), gap: look.px(8) }}>
          {leagues.map(l => <Chip key={l.id} look={look} small label={leagueLabel(l)} on={l.id === league} onPress={() => setPicked(l.id)} testID={`sports-teams-league-${l.id}`} />)}
        </ScrollView>
      ) : null}
      {teams.length ? (
        <FlatList
          key={league}
          horizontal
          data={teams}
          keyExtractor={entityKey}
          renderItem={({ item }) => {
            const key = entityKey(item);
            const on = followed(item);
            return (
              <SectionBoundary id={`team ${key}`}>
                <EntityChip look={look} entity={item} on={on} testID={`sports-team-${item.id}`}
                  onPress={() => { setFailed(''); vela.liveEvents.setFavorite(key, !on).catch(() => setFailed(msg('sports.favouriteFailed'))); }} />
              </SectionBoundary>
            );
          }}
          ItemSeparatorComponent={() => <View style={{ width: look.px(10) }} />}
          initialNumToRender={8}
          maxToRenderPerBatch={6}
          windowSize={5}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: look.gutter, paddingVertical: look.px(8) }}
        />
      ) : read?.load === 'loading' || needsRead ? (
        <View style={{ flexDirection: 'row', gap: look.px(10), paddingHorizontal: look.gutter, paddingVertical: look.px(8), overflow: 'hidden' }}>
          {[0, 1, 2, 3, 4, 5].map(n => <Placeholder key={n} look={look} width={look.px(200)} height={height} radius={height / 2} />)}
        </View>
      ) : (
        <Gutter look={look}><Txt look={look} size={14} color={look.inkQuiet} style={{ marginTop: look.px(6) }}>{msg(read?.load === 'failed' ? 'sports.teamsFailed' : 'sports.noTeams')}</Txt></Gutter>
      )}
    </View>
  );
}

function Skeleton({ look }: { look: SportsLook }) {
  const width = cardWidth(look);
  return (
    <View style={{ paddingHorizontal: look.gutter, paddingTop: look.barTop + look.px(12), gap: look.px(24) }} accessibilityLabel={msg('sports.loading')} testID="sports-skeleton">
      <View style={{ flexDirection: 'row', gap: look.px(10) }}>{[0, 1, 2, 3, 4, 5].map(n => <Placeholder key={n} look={look} width={look.px(n ? 64 : 48)} height={look.px(36)} radius={look.px(18)} />)}</View>
      <View style={{ flexDirection: look.small ? 'column' : 'row', gap: look.px(16) }}>
        <View style={{ flex: 1.65 }}><Placeholder look={look} width="100%" height={look.px(252)} radius={look.radiusPanel} /></View>
        {!look.small ? <View style={{ flex: 1, gap: look.px(10) }}>{[0, 1, 2].map(n => <Placeholder key={n} look={look} width="100%" height={look.px(77)} />)}</View> : null}
      </View>
      <Placeholder look={look} width={look.px(180)} height={look.px(20)} radius={look.px(6)} />
      <View style={{ flexDirection: 'row', gap: look.px(14), overflow: 'hidden' }}>{[0, 1, 2, 3, 4].map(n => <Placeholder key={n} look={look} width={width} height={look.px(128)} />)}</View>
    </View>
  );
}

/** Below the drawn sections while the rest stream in. */
function SectionsPlaceholder({ look }: { look: SportsLook }) {
  return (
    <View style={{ paddingHorizontal: look.gutter, gap: look.px(14) }}>
      <Placeholder look={look} width={look.px(180)} height={look.px(20)} radius={look.px(6)} />
      <View style={{ flexDirection: 'row', gap: look.px(14), overflow: 'hidden' }}>{[0, 1, 2, 3, 4].map(n => <Placeholder key={n} look={look} width={cardWidth(look)} height={look.px(128)} />)}</View>
    </View>
  );
}

function Failure({ look, message, retry }: { look: SportsLook; message: string; retry(): void }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: look.px(16), padding: look.gutter }}>
      <Txt look={look} size={18} weight={700}>{msg('sports.unavailable')}</Txt>
      {message ? <Txt look={look} size={14} color={look.inkQuiet}>{message}</Txt> : null}
      <Pill look={look} primary label={msg('sports.retry')} onPress={retry} glyph="restart" hasTVPreferredFocus />
    </View>
  );
}

const HIDDEN = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 } as TextStyle;

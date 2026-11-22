// A plugin screen (Sports): its sections drawn natively from the screen payload, in order: the
// hero with the games beside it, league chips, rows of events, a date-paged schedule, standings
// tables and the favourite-team picker. Live while on screen: one shared stream follows the screen
// and every card reads its own event, so a goal redraws one card, not the page.
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform, ScrollView, Text, View, type TextStyle } from 'react-native';
import { msg, screenKey, type EntitiesSection, type EventsSection, type HeroSection, type LeaguesSection, type LiveEvent, type Screen, type ScheduleSection, type ScreenParams, type TableSection } from '@vela/core';
import { useVela, useVelaState } from '@vela/core/react';
import { useSportsLook, type SportsLook } from './look';
import { EntityChip, EventCard, HeroCard, MiniCard, TableView } from './cards';
import { Chip, Heading, Pill, Placeholder, Rise, Txt } from './parts';
import { isFavoriteCompetitor } from '@vela/core';

export interface SportsScreenProps {
  id: string;
  /** The section is the one on show: only then does it follow the live stream. */
  active: boolean;
}

/** How often a screen on show is read again (new games, a new day), beside the stream's updates. */
const REFRESH_MS = 5 * 60_000;

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
  const changed = useVelaState(state => state.liveEvents.favorites);
  // The viewer's favourites: the picker's as the server listed them, with changes made here.
  const favourites = useMemo(() => {
    const keys = new Set<string>();
    for (const section of screen?.sections ?? []) if (section.type === 'entities') for (const entity of section.entities) if (entity.favorite) keys.add(entity.key ?? entity.id);
    for (const [key, on] of Object.entries(changed)) if (on) keys.add(key); else keys.delete(key);
    return keys;
  }, [screen, changed]);

  useEffect(() => { void vela.liveEvents.loadScreen(id, params); }, [vela, id, key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!active) return;
    const stop = vela.liveEvents.follow({ screens: [id] });
    const timer = setInterval(() => void vela.liveEvents.loadScreen(id, params), REFRESH_MS);
    return () => { stop(); clearInterval(timer); };
  }, [vela, id, key, active]); // eslint-disable-line react-hooks/exhaustive-deps

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
      {screen.sections.map((section, index) => (
        <Rise key={section.id} look={look} index={index} style={{ marginBottom: look.px(section.type === 'leagues' ? 20 : 30) }}>
          <SectionView look={look} section={section} params={params} choose={choose} favourites={favourites} />
        </Rise>
      ))}
    </ScrollView>
  );
}

const SectionView = memo(function SectionView({ look, section, params, choose, favourites }: {
  look: SportsLook; section: Screen['sections'][number]; params: ScreenParams; choose(change: ScreenParams): void; favourites: ReadonlySet<string>;
}) {
  switch (section.type) {
    case 'hero': return <Hero look={look} section={section} favourites={favourites} />;
    case 'leagues': return <Leagues look={look} section={section} selected={params.league ?? section.selected ?? ''} choose={league => choose({ league, date: params.date })} />;
    case 'events': return <EventsRow look={look} section={section} />;
    case 'schedule': return <Schedule look={look} section={section} choose={date => choose({ date })} />;
    case 'table': return <Tables look={look} section={section} />;
    case 'entities': return <Entities look={look} section={section} />;
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
          <HeroCard key={section.event.id} look={look} event={section.event} favourite={favourite} testID="sports-hero" />
        </View>
        {also.length ? (
          <View style={{ flex: wide ? 1 : undefined, gap: look.px(10) }}>
            {also.slice(0, 3).map(event => <MiniCard key={event.id} look={look} event={event} testID={`sports-mini-${event.id}`} />)}
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
        <Chip key={league.id} look={look} label={league.abbr || league.name} on={selected === league.id} onPress={() => choose(league.id)} testID={`sports-league-${league.id}`} />
      ))}
    </ScrollView>
  );
}

function cardWidth(look: SportsLook): number {
  if (look.small) return Math.min(look.px(272), look.width * 0.74);
  return look.px(look.tv ? 300 : 286);
}

function EventsRow({ look, section }: { look: SportsLook; section: EventsSection }) {
  const favourites = section.query?.favorites === true;
  if (!section.events.length && !favourites) return null;
  return (
    <View>
      <Gutter look={look}><Heading look={look}>{section.title ?? ''}</Heading></Gutter>
      {section.events.length ? (
        <Cards look={look} events={section.events} prefix={section.id} />
      ) : (
        <Gutter look={look}><Txt look={look} size={14} color={look.inkQuiet}>{msg('sports.noFavourites')}</Txt></Gutter>
      )}
    </View>
  );
}

function Cards({ look, events, prefix }: { look: SportsLook; events: LiveEvent[]; prefix: string }) {
  const width = cardWidth(look);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: look.gutter, paddingVertical: look.px(8), gap: look.px(14) }}>
      {events.map(event => <EventCard key={event.id} look={look} event={event} width={width} testID={`sports-${prefix}-${event.id}`} />)}
    </ScrollView>
  );
}

/** A day at a time: the days as chips (Today, Tomorrow, …), that day's games below. */
function Schedule({ look, section, choose }: { look: SportsLook; section: ScheduleSection; choose(date: string): void }) {
  const days = section.days?.length ? section.days : [{ date: section.date, label: section.date }];
  return (
    <View>
      <Gutter look={look}><Heading look={look}>{section.title ?? msg('sports.schedule')}</Heading></Gutter>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: look.gutter, paddingVertical: look.px(6), gap: look.px(10) }}>
        {days.map(day => (
          <Chip key={day.date} look={look} label={day.label} on={day.date === section.date} onPress={() => choose(day.date)} testID={`sports-day-${day.date}`}
            leading={day.count ? <Txt look={look} size={11} weight={800} color={day.date === section.date ? look.inkInverse : look.inkQuiet} digits>{day.count}</Txt> : undefined} />
        ))}
      </ScrollView>
      {section.events.length
        ? <Cards look={look} events={section.events} prefix={`day-${section.date}`} />
        : <Gutter look={look}><Txt look={look} size={14} color={look.inkQuiet} style={{ marginTop: look.px(10) }}>{msg('sports.noGames')}</Txt></Gutter>}
    </View>
  );
}

function Tables({ look, section }: { look: SportsLook; section: TableSection }) {
  if (!section.tables.length) return null;
  const width = look.small ? look.width - look.gutter * 2 : look.px(look.tv ? 470 : 440);
  return (
    <View>
      <Gutter look={look}><Heading look={look}>{section.title ?? msg('sports.standings')}</Heading></Gutter>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: look.gutter, gap: look.px(16) }}>
        {section.tables.map(table => (
          <View key={table.title} style={{ width, padding: look.px(16), borderRadius: look.radiusCard, backgroundColor: look.card, borderWidth: 1, borderColor: look.hairline }}>
            <TableView look={look} table={table} compact />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function Entities({ look, section }: { look: SportsLook; section: EntitiesSection }) {
  const vela = useVela();
  const changed = useVelaState(state => state.liveEvents.favorites);
  const [failed, setFailed] = useState('');
  if (!section.entities.length) return null;
  return (
    <View>
      <Gutter look={look}>
        <Heading look={look} aside={failed ? <Txt look={look} size={12.5} color={look.live}>{failed}</Txt> : undefined}>{section.title ?? msg('sports.pickTeams')}</Heading>
      </Gutter>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: look.gutter, paddingVertical: look.px(8), gap: look.px(10) }}>
        {section.entities.map(entity => {
          const key = entity.key ?? entity.id;
          const on = changed[key] ?? entity.favorite === true;
          return <EntityChip key={key} look={look} entity={entity} on={on} testID={`sports-team-${entity.id}`}
            onPress={() => { setFailed(''); vela.liveEvents.setFavorite(key, !on).catch(() => setFailed(msg('sports.favouriteFailed'))); }} />;
        })}
      </ScrollView>
    </View>
  );
}

function Skeleton({ look }: { look: SportsLook }) {
  const width = cardWidth(look);
  return (
    <View style={{ paddingHorizontal: look.gutter, paddingTop: look.barTop + look.px(12), gap: look.px(24) }} accessibilityLabel={msg('sports.loading')}>
      <View style={{ flexDirection: look.small ? 'column' : 'row', gap: look.px(16) }}>
        <View style={{ flex: 1.65 }}><Placeholder look={look} width="100%" height={look.px(252)} radius={look.radiusPanel} /></View>
        {!look.small ? <View style={{ flex: 1, gap: look.px(10) }}>{[0, 1, 2].map(n => <Placeholder key={n} look={look} width="100%" height={look.px(77)} />)}</View> : null}
      </View>
      <Placeholder look={look} width={look.px(180)} height={look.px(20)} radius={look.px(6)} />
      <View style={{ flexDirection: 'row', gap: look.px(14) }}>{[0, 1, 2, 3].map(n => <Placeholder key={n} look={look} width={width} height={look.px(128)} />)}</View>
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

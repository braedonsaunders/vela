// The audio app for spoken word: Home with Continue listening, an audiobook (author, narrator,
// chapters or parts, where the viewer left off), a podcast show (hosts, episodes newest first with
// played state and resume) and any other container a plugin serves. The shell, the bar, the queue
// and Now Playing are music's; only the words, the lists and what Play means differ.
import { useMemo, useRef, useState, type ComponentRef } from 'react';
import { Platform, Text, View } from 'react-native';
import { clock, currentInQueue, durationLabel, localeContext, msg, number, plural, podcastOrder, type Card, type DetailModel, type Row } from '@vela/core';
import { useVela, useVelaState } from '@vela/core/react';
import { FocusPressable as Pressable } from '../../focus';
import { NO_RING } from '../common/controls';
import { alpha, Cover, Progress, useMediaLook } from '../media/parts';
import { MediaGlyph } from '../media/icons';
import { placeOf, useMusic } from './context';
import { useChildren, useLibraryRows, useTitle } from './data';
import { creditLines, listColumns, listenFrom, listenedFraction, roleLabel } from './listening';
import { musicTV } from './layout';
import { ActionBar, coverSize, Genres, greeting, Header, MoreButton, MusicHome, MusicTitle, pad, usePlayingFrom } from './pages';
import { FocusGroup, FocusScope, Heart, IconButton, MusicTile, PlayFab, Shelf, Surface, transition, Wash, type MenuOpen } from './parts';
import { Meter } from './tracks';

const web = Platform.OS === 'web';
const EMPTY: Card[] = [];

const underway = (card: Card) => card.progressSeconds > 0 && !card.played;

/** "3 h 2 min left": what remains of a title under way ('' when it is not). */
function leftLabel(card: Card): string {
  return underway(card) && card.durationSeconds ? msg('media.ui.left', { time: durationLabel(Math.max(0, card.durationSeconds - card.progressSeconds)) }) : '';
}

/** A date as the viewer reads it ("23 Nov 2026"), else the year. */
function dayLabel(card: Card): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(card.airDate)) {
    const date = new Date(`${card.airDate}T00:00:00Z`);
    if (Number.isFinite(date.getTime())) {
      try { return new Intl.DateTimeFormat(localeContext().formatLocale, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date); } catch { /* The year below. */ }
    }
  }
  return card.yearLabel;
}

// ——— Which page ——————————————————————————————————————————————————————————————————————

/** Home for what the library holds: music's, or spoken word's. */
export function ListeningHome() {
  const app = useMusic();
  return app.listening === 'music' ? <MusicHome /> : <SpokenHome />;
}

/** A title's page by its class and role: music's album and artist, an audiobook, a podcast show,
 * or any other container. */
export function ListeningTitle({ id }: { id: string }) {
  const detail = useTitle(id);
  const card = detail?.value?.title[0];
  const media = card?.media;
  if (!card || !media || media.class === 'music') return <MusicTitle id={id} />;
  if (media.role === 'audiobook' || (media.role === 'book' && media.audio)) return <AudiobookView card={card} detail={detail!.value!} />;
  if (media.role === 'show' || media.class === 'podcast') return <ShowView card={card} />;
  return <CollectionView card={card} />;
}

// ——— Home ————————————————————————————————————————————————————————————————————————

/** Spoken word's Home: what the viewer is in the middle of first, then the library's shelves. */
export function SpokenHome() {
  const app = useMusic();
  const m = useMediaLook();
  const { rows } = useLibraryRows(app.libraryId);
  const resume = rows.find(row => row.purpose === 'continue');
  const shelves = rows.filter(row => row !== resume && row.items.length);
  const accent = resume?.items[0]?.accent ?? shelves[0]?.items[0]?.accent ?? '';
  return (
    <View testID="spoken-home">
      <Wash accent={accent} height={360} />
      <View style={{ paddingHorizontal: m.small ? 16 : 20, paddingTop: m.small ? 16 : 28 }}>
        <Text accessibilityRole="header" style={[m.text({ 'font-family': '$ui.fontDisplay', 'font-size': m.small ? '30px' : '38px', color: '$ui.ink', 'letter-spacing': '-0.01em' }), { marginBottom: m.small ? 14 : 20 }]}>{greeting()}</Text>
        {resume?.items.length ? <ContinueListening row={resume} /> : null}
      </View>
      <View style={{ paddingHorizontal: m.small ? 4 : 8 }}>
        {shelves.map(row => <SpokenShelf key={row.id} row={row} />)}
        <Genres />
      </View>
    </View>
  );
}

function SpokenShelf({ row }: { row: Row }) {
  return <Shelf title={row.name}>{row.items.map(card => <MusicTile key={card.id} card={card} size={176} />)}</Shelf>;
}

/** Continue listening: a card per title under way, its progress and what is left; Play resumes. */
function ContinueListening({ row }: { row: Row }) {
  const m = useMediaLook();
  const tv = musicTV();
  const columns = tv ? 3 : m.width >= 1200 ? 3 : m.width >= 700 ? 2 : 1;
  return (
    <View style={{ marginBottom: m.small ? 24 : 34 }} testID="spoken-continue">
      <Text accessibilityRole="header" style={[m.text({ 'font-family': '$ui.fontDisplay', 'font-size': m.small ? '22px' : '26px', color: '$ui.ink' }), { marginBottom: 12 }]}>{row.name || msg('media.ui.continueListening')}</Text>
      <FocusScope.Provider value="continue"><FocusGroup style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {row.items.slice(0, tv ? 6 : 6).map(card => <ResumeCard key={card.id} card={card} width={`${100 / columns - (columns > 1 ? 1.4 : 0)}%`} />)}
      </FocusGroup></FocusScope.Provider>
    </View>
  );
}

function ResumeCard({ card, width }: { card: Card; width: string }) {
  const app = useMusic();
  const m = useMediaLook();
  const tv = musicTV();
  const nowId = useVelaState(s => currentInQueue(s.audio.queue)?.id);
  const phase = useVelaState(s => s.audio.phase);
  const playing = nowId === card.id && (phase === 'playing' || phase === 'buffering' || phase === 'loading');
  // A part names its book, an episode its show.
  const from = card.media?.parent?.name || card.media?.byline || '';
  const resume = () => (nowId === card.id ? app.toggle() : app.play([card], 0, { id: card.media?.parent?.id ?? card.id, name: card.media?.parent?.name ?? card.name }, false, card.progressSeconds));
  return (
    <Surface onPress={tv ? resume : () => app.go(placeOf(card))} onMenu={(anchor, mode, opener) => app.menu({ card, anchor, mode, opener })} focusId={card.id} testID={`spoken-resume-${card.id}`}
      label={[card.name, from, leftLabel(card)].filter(Boolean).join(', ')}
      style={(lit, focus) => [{ width: width as never, borderRadius: tv ? 14 : 10, backgroundColor: lit ? m.ui.controlHover : alpha(m.ui.ink, 0.07) },
        tv ? { borderWidth: 2, borderColor: focus ? m.ui.ink : 'transparent', transform: [{ scale: focus ? 1.03 : 1 }] } : {}, transition('background-color, transform', 140)]}
      contentStyle={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 10 }}>
      {() => (
        <>
          <View pointerEvents="none"><Cover uri={card.poster} shape="square" size={tv ? 88 : 72} title={card.name} accent={card.accent} lift={0.3} /></View>
          <View pointerEvents="none" style={{ flex: 1, minWidth: 0, gap: 4 }}>
            <Text numberOfLines={1} style={m.text({ 'font-size': tv ? '19px' : '15px', 'font-weight': '700', color: '$ui.ink' })}>{card.name}</Text>
            {from ? <Text numberOfLines={1} style={m.text({ 'font-size': '13px', color: '$ui.inkSecondary' })}>{from}</Text> : null}
            <View style={{ marginTop: 4 }}><Progress fraction={listenedFraction(card)} height={4} /></View>
            <Text numberOfLines={1} style={m.text({ 'font-size': '12px', color: '$ui.inkQuiet' })}>{leftLabel(card)}</Text>
          </View>
          {tv ? null : <PlayFab playing={playing} size={44} onPress={resume} label={`${msg('media.ui.resume')} ${card.name}`} testID={`spoken-resume-play-${card.id}`} />}
        </>
      )}
    </Surface>
  );
}

// ——— Credits ——————————————————————————————————————————————————————————————————————

/** "by Ione Ashcombe · Narrated by Beatrix Thornfield", or "Hosted by …". */
function Credits({ card, size = 15 }: { card: Card; size?: number }) {
  const m = useMediaLook();
  const lines = creditLines(card);
  if (!lines.length) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 6, rowGap: 2 }} testID="spoken-credits">
      {lines.map((line, i) => (
        <Text key={line.key} style={m.text({ 'font-size': `${size}px`, color: i === 0 ? '$ui.ink' : '$ui.inkSecondary', 'font-weight': i === 0 ? '700' : '450' })}>
          {i > 0 ? '· ' : ''}{msg(line.key, { name: line.names.map(n => n.name).join(', ') })}
        </Text>
      ))}
    </View>
  );
}

function Facts({ items }: { items: string[] }) {
  const m = useMediaLook();
  const shown = items.filter(Boolean);
  return shown.length ? <Text style={m.text({ 'font-size': '15px', color: '$ui.inkSecondary' })}>{shown.join(' · ')}</Text> : null;
}

/** Where the viewer is: a bar and what is left (and the chapter). */
function Underway({ fraction, label }: { fraction: number; label: string }) {
  const m = useMediaLook();
  return (
    <View style={{ gap: 8, maxWidth: 420, marginTop: 4 }} testID="spoken-progress">
      <Progress fraction={fraction} height={5} />
      <Text style={m.text({ 'font-size': '13px', color: '$ui.inkQuiet' })}>{label}</Text>
    </View>
  );
}

function About({ card }: { card: Card }) {
  const m = useMediaLook();
  if (!card.summary && !card.media?.facts.length) return null;
  return (
    <View style={{ paddingVertical: 28, gap: 14, maxWidth: 860 }}>
      <Text accessibilityRole="header" style={m.text({ 'font-family': '$ui.fontDisplay', 'font-size': '26px', color: '$ui.ink' })}>{msg('music.about')}</Text>
      {card.summary ? <Text style={m.text({ 'font-size': '15px', 'line-height': '1.6', color: '$ui.inkSecondary' })}>{card.summary}</Text> : null}
      {card.media?.facts.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 28, rowGap: 10 }}>
          {card.media.facts.map(fact => (
            <View key={`${fact.label}-${fact.value}`} style={{ gap: 2 }}>
              <Text style={m.text({ 'font-size': '12px', 'font-weight': '700', 'letter-spacing': '0.08em', 'text-transform': 'uppercase', color: '$ui.inkQuiet' })}>{fact.label}</Text>
              <Text style={m.text({ 'font-size': '14px', color: '$ui.inkSecondary' })}>{fact.value}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function StartOver({ onPress }: { onPress(): void }) {
  return <IconButton symbol="back15" label={msg('media.ui.startOver')} size={44} iconSize={24} onPress={onPress} testID="spoken-start-over" />;
}

// ——— Audiobook ————————————————————————————————————————————————————————————————————

export function AudiobookView({ card, detail }: { card: Card; detail: DetailModel }) {
  const app = useMusic();
  const m = useMediaLook();
  const store = useVela();
  const children = useChildren(card.media?.childCount ? card.id : undefined);
  const parts = useMemo(() => (children?.value?.items ?? EMPTY).filter(part => part.media?.audio).sort((a, b) => (a.media?.index ?? 0) - (b.media?.index ?? 0)), [children?.value]);
  const chapters = detail.chapters ?? [];
  const now = useVelaState(s => currentInQueue(s.audio.queue)?.id);
  const livePosition = useVelaState(s => s.audio.positionSeconds);
  const playing = usePlayingFrom(card.id);
  const source = { id: card.id, name: card.name, kind: 'title' as const };
  // Where the viewer is through the whole book (a book in parts adds the parts before).
  const start = listenFrom(card, parts.length ? parts : [card]);
  const before = parts.slice(0, start.index).reduce((sum, part) => sum + part.durationSeconds, 0);
  const total = card.durationSeconds || parts.reduce((sum, part) => sum + part.durationSeconds, 0);
  const position = now === card.id ? livePosition : parts.length ? before + (start.positionSeconds ?? 0) : card.progressSeconds;
  const resumable = position > 0 && !card.played;
  const chapter = [...chapters].reverse().find(c => c.startSeconds <= position);
  const canListen = store.media.features().audio;
  const listen = (from: 'resume' | 'start') => from === 'resume'
    ? app.play(start.items, start.index, source, false, parts.length ? start.positionSeconds : card.progressSeconds)
    : app.play(parts.length ? parts : [card], 0, source, false, 0);
  const counted = parts.length ? msg(`media.count.parts.${plural(parts.length)}`, { count: number(parts.length) })
    : chapters.length ? msg(`media.count.chapters.${plural(chapters.length)}`, { count: number(chapters.length) }) : '';
  return (
    <View testID="spoken-audiobook">
      <Wash accent={card.accent} image={card.poster} />
      <View style={{ paddingHorizontal: pad(m) }}>
        <Header eyebrow={msg(roleLabel(card))} title={card.name} cover={<Cover uri={card.poster} shape="square" size={coverSize(m)} title={card.name} byline={card.media?.byline} accent={card.accent} lift={2} />}>
          <Credits card={card} />
          <Facts items={[card.yearLabel, total ? durationLabel(total) : '', counted, card.genres[0] ?? '']} />
          {resumable && total ? <Underway fraction={Math.min(1, position / total)} label={[msg('media.ui.left', { time: durationLabel(Math.max(0, total - position)) }), chapter?.name].filter(Boolean).join(' · ')} /> : null}
          {card.played ? <Text style={m.text({ 'font-size': '13px', 'font-weight': '700', color: '$ui.inkQuiet' })}>{msg('media.ui.finished')}</Text> : null}
        </Header>
        <ActionBar>
          <PlayFab playing={playing} size={58} onPress={() => (playing ? app.toggle() : canListen ? listen('resume') : undefined)} testID="music-play" opensPage
            label={playing ? msg('media.player.pause') : resumable ? msg('media.ui.resume') : msg('media.ui.listen')} />
          {resumable ? <StartOver onPress={() => listen('start')} /> : null}
          <Heart card={card} size={44} iconSize={26} />
          <MoreButton card={card} />
        </ActionBar>
        {!canListen ? <Text style={m.text({ 'font-size': '13px', color: '$ui.inkQuiet' })}>{msg('media.ui.cannotListen')}</Text> : null}
        {parts.length ? (
          <ItemList role="part" items={parts} source={source} />
        ) : chapters.length ? (
          <ChapterList card={card} chapters={chapters} position={position} source={source} />
        ) : null}
        <About card={card} />
      </View>
    </View>
  );
}

/** An audiobook's chapters: the one under way marked (with a meter while it plays), the ones
 * before it dimmed; a press plays from its start (or seeks there, the book already playing). */
function ChapterList({ card, chapters, position, source }: { card: Card; chapters: NonNullable<DetailModel['chapters']>; position: number; source: { id: string; name: string; kind: 'title' } }) {
  const app = useMusic();
  const store = useVela();
  const m = useMediaLook();
  const columns = listColumns('chapter');
  const now = useVelaState(s => currentInQueue(s.audio.queue)?.id === card.id);
  const phase = useVelaState(s => s.audio.phase);
  const live = now && (phase === 'playing' || phase === 'buffering' || phase === 'loading');
  const at = [...chapters].map((c, i) => ({ c, i })).reverse().find(({ c }) => c.startSeconds <= position)?.i ?? -1;
  return (
    <View testID="spoken-chapters" accessibilityRole="list">
      <ListHead title={msg(columns.title)} time={msg('music.time')} />
      <FocusScope.Provider value={`chapters:${card.id}`}><FocusGroup>
        {chapters.map((chapter, i) => (
          <Row key={chapter.id} focusId={chapter.id} testID={`spoken-chapter-${i}`} number={number(i + 1)} title={chapter.name} current={at === i && (now || position > 0)} playing={at === i && live} dim={i < at}
            time={clock(chapter.startSeconds)} label={`${chapter.name}, ${clock(chapter.startSeconds)}`}
            onPlay={() => (now ? store.audio.seek(chapter.startSeconds) : app.play([card], 0, source, false, chapter.startSeconds))}
            onMenu={(anchor, mode, opener) => app.menu({ card, anchor, mode, opener })} m={m} />
        ))}
      </FocusGroup></FocusScope.Provider>
    </View>
  );
}

// ——— Podcast show ——————————————————————————————————————————————————————————————————

export function ShowView({ card }: { card: Card }) {
  const app = useMusic();
  const m = useMediaLook();
  const store = useVela();
  const show = card.media?.role === 'show';
  const children = useChildren(show ? card.id : undefined);
  const episodes = useMemo(() => (show ? podcastOrder((children?.value?.items ?? EMPTY).filter(e => e.media?.audio)) : [card]), [show, children?.value, card]);
  const playing = usePlayingFrom(card.id);
  const source = { id: card.id, name: card.name, kind: 'title' as const };
  const start = listenFrom(card, episodes);
  const first = start.items[0];
  const canListen = store.media.features().audio;
  const count = show ? (episodes.length || card.media?.childCount || 0) : 0;
  const [filter, setFilter] = useState<'all' | 'unplayed'>('all');
  const shown = filter === 'unplayed' ? episodes.filter(e => !e.played) : episodes;
  return (
    <View testID="spoken-show">
      <Wash accent={card.accent} image={card.poster} />
      <View style={{ paddingHorizontal: pad(m) }}>
        <Header eyebrow={msg(roleLabel(card))} title={card.name} cover={<Cover uri={card.poster} shape="square" size={coverSize(m)} title={card.name} byline={card.media?.byline} accent={card.accent} lift={2} />}>
          <Credits card={card} />
          <Facts items={[count ? msg(`media.count.episodes.${plural(count)}`, { count: number(count) }) : '', card.genres[0] ?? '']} />
        </Header>
        <ActionBar>
          <PlayFab playing={playing} size={58} onPress={() => (playing ? app.toggle() : canListen && first ? app.play(start.items, 0, source, false, start.positionSeconds) : undefined)} testID="music-play" opensPage
            label={playing ? msg('media.player.pause') : first && underway(first) ? `${msg('media.ui.resume')} ${first.name}` : first ? `${msg('media.ui.play')} ${first.name}` : msg('media.ui.play')} />
          <Heart card={card} size={44} iconSize={26} />
          <MoreButton card={card} />
        </ActionBar>
        {!canListen ? <Text style={m.text({ 'font-size': '13px', color: '$ui.inkQuiet' })}>{msg('media.ui.cannotPlayPodcast')}</Text> : null}
        {card.summary ? <Text numberOfLines={3} style={[m.text({ 'font-size': '15px', 'line-height': '1.55', color: '$ui.inkSecondary' }), { maxWidth: 860, marginBottom: 18 }]}>{card.summary}</Text> : null}
        {show ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <Text accessibilityRole="header" style={[m.text({ 'font-family': '$ui.fontDisplay', 'font-size': '26px', color: '$ui.ink' }), { marginRight: 12 }]}>{msg('media.ui.episodes')}</Text>
            <ChoiceChip label={msg('listening.allEpisodes')} on={filter === 'all'} onPress={() => setFilter('all')} />
            <ChoiceChip label={msg('listening.new')} on={filter === 'unplayed'} onPress={() => setFilter('unplayed')} />
          </View>
        ) : null}
        <ItemList role="episode" items={shown} source={source} />
        {show && children?.load === 'loading' && !episodes.length ? <View style={{ height: 240 }} /> : null}
        <About card={{ ...card, summary: '' }} />
      </View>
    </View>
  );
}

// ——— Any other container (a series of audiobooks, a plugin's own level) ————————————————

export function CollectionView({ card }: { card: Card }) {
  const app = useMusic();
  const m = useMediaLook();
  const children = useChildren(card.id);
  const items = children?.value?.items ?? EMPTY;
  const playable = items.filter(item => item.media?.audio);
  const playing = usePlayingFrom(card.id);
  const source = { id: card.id, name: card.name, kind: 'title' as const };
  return (
    <View testID="spoken-collection">
      <Wash accent={card.accent} image={card.poster} />
      <View style={{ paddingHorizontal: pad(m) }}>
        <Header eyebrow={msg(roleLabel(card))} title={card.name} cover={<Cover uri={card.poster} shape="square" size={coverSize(m)} title={card.name} accent={card.accent} lift={2} />}>
          <Credits card={card} />
          <Facts items={[card.yearLabel, card.media?.childCount ? msg(`media.count.titles.${plural(card.media.childCount)}`, { count: number(card.media.childCount) }) : '']} />
        </Header>
        <ActionBar>
          {playable.length ? <PlayFab playing={playing} size={58} onPress={() => (playing ? app.toggle() : app.play(playable, 0, source))} testID="music-play" opensPage /> : null}
          <Heart card={card} size={44} iconSize={26} />
          <MoreButton card={card} />
        </ActionBar>
        {playable.length === items.length && items.length ? <ItemList role="part" items={items} source={source} /> : null}
      </View>
      {playable.length !== items.length && items.length ? <View style={{ paddingHorizontal: 16 }}><Shelf title="">{items.map(item => <MusicTile key={item.id} card={item} size={168} />)}</Shelf></View> : null}
      <View style={{ paddingHorizontal: pad(m) }}><About card={card} /></View>
    </View>
  );
}

// ——— Lists ——————————————————————————————————————————————————————————————————————————

function ChoiceChip({ label, on, onPress }: { label: string; on: boolean; onPress(): void }) {
  const m = useMediaLook();
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ checked: on }}
      style={[NO_RING, { height: 32, paddingHorizontal: 14, borderRadius: 16, justifyContent: 'center', backgroundColor: on ? m.ui.ink : m.ui.control }, transition('background-color', 120)]}>
      <Text style={m.text({ 'font-size': '13px', 'font-weight': '650', color: on ? m.ui.inkInverse : m.ui.ink })}>{label}</Text>
    </Pressable>
  );
}

function ListHead({ title, time }: { title: string; time: string }) {
  const m = useMediaLook();
  if (m.small) return null;
  const head = m.text({ 'font-size': '12px', 'font-weight': '650', 'letter-spacing': '0.08em', 'text-transform': 'uppercase', color: '$ui.inkQuiet' });
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 16, height: 36, marginBottom: 8 }, m.box({ 'border-bottom': '1px solid $ui.glassEdge' })]}>
      <Text style={[head, { width: 28, textAlign: 'center' }]}>#</Text>
      <Text style={[head, { flex: 1 }]}>{title}</Text>
      <Text style={[head, { width: 76, textAlign: 'right' }]}>{time}</Text>
      <View style={{ width: 32 }} />
    </View>
  );
}

/** A book's parts or a show's episodes: each a title of its own, with the heart, its menu and
 * where the viewer is in it. An episode shows its date, what is left or that it was played. */
function ItemList({ role, items, source }: { role: 'part' | 'episode'; items: Card[]; source: { id: string; name: string; kind: 'title' } }) {
  const app = useMusic();
  const m = useMediaLook();
  const columns = listColumns(role);
  const nowId = useVelaState(s => currentInQueue(s.audio.queue)?.id);
  const phase = useVelaState(s => s.audio.phase);
  const live = phase === 'playing' || phase === 'buffering' || phase === 'loading';
  return (
    <View testID={`spoken-${role}s`} accessibilityRole="list">
      {role === 'part' ? <ListHead title={msg(columns.title)} time={msg('music.time')} /> : null}
      <FocusScope.Provider value={`${role}s:${source.id}`}><FocusGroup>
        {items.map((item, i) => {
          const current = nowId === item.id;
          // A book plays on from a part; an episode plays alone.
          const play = () => (current ? app.toggle() : role === 'part'
            ? app.play(items, i, source, false, underway(item) ? item.progressSeconds : 0)
            : app.play([item], 0, source, false, underway(item) ? item.progressSeconds : 0));
          const state = item.played ? msg('listening.played') : leftLabel(item);
          return role === 'episode'
            ? <EpisodeRow key={item.id} episode={item} current={current} playing={current && live} state={state} onPlay={play} />
            : <Row key={item.id} focusId={item.id} testID={`spoken-part-${item.id}`} number={number(item.media?.index || i + 1)} title={item.name} subtitle={state}
                current={current} playing={current && live} dim={item.played} time={item.durationSeconds ? durationLabel(item.durationSeconds) : ''}
                label={[item.name, state].filter(Boolean).join(', ')} onPlay={play} onMenu={(anchor, mode, opener) => app.menu({ card: item, anchor, mode, opener })} m={m} />;
        })}
      </FocusGroup></FocusScope.Provider>
    </View>
  );
}

function Row({ number: n, title, subtitle, time, current, playing, dim, label, onPlay, onMenu, focusId, testID, m }: {
  number: string; title: string; subtitle?: string; time: string; current: boolean; playing: boolean; dim: boolean; label: string;
  onPlay(): void; onMenu: MenuOpen; focusId: string; testID: string; m: ReturnType<typeof useMediaLook>;
}) {
  const tv = musicTV();
  const touch = !tv && (!web || m.width < 980);
  return (
    <Surface onPress={touch || tv ? onPlay : undefined} onDoubleClick={touch || tv ? undefined : onPlay} onMenu={onMenu} focusId={focusId} testID={testID} selected={current} label={label}
      style={(lit, focus) => [{ minHeight: tv ? 68 : 52, borderRadius: tv ? 12 : 8, backgroundColor: lit ? m.ui.control : current ? alpha(m.ui.accent, 0.1) : 'transparent', transform: [{ scale: tv && focus ? 1.02 : 1 }] },
        focus ? (tv ? { borderWidth: 2, borderColor: m.ui.ink } : m.box({ 'box-shadow': `inset 0px 0px 0px 1.5px ${m.ui.ink}` })) : tv ? { borderWidth: 2, borderColor: 'transparent' } : {}, transition('background-color, transform', 120)]}
      contentStyle={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: touch ? 12 : 16, paddingHorizontal: touch ? 8 : 16, paddingVertical: 8 }}>
      {lit => (
        <>
          <View style={{ width: 28, alignItems: 'center' }} pointerEvents="box-none">
            {lit && !tv ? (
              <Pressable onPress={onPlay} accessibilityRole="button" accessibilityLabel={playing ? msg('media.player.pause') : `${msg('media.ui.play')} ${title}`} style={NO_RING}>
                <MediaGlyph name={playing ? 'pause' : 'play'} size={16} color={m.ui.ink} />
              </Pressable>
            ) : playing ? <Meter /> : <Text style={m.text({ 'font-size': '15px', color: current ? m.ui.accent : '$ui.inkQuiet', 'font-variant-numeric': 'tabular-nums' })}>{n}</Text>}
          </View>
          <View pointerEvents="none" style={{ flex: 1, minWidth: 0, opacity: dim && !current ? 0.62 : 1 }}>
            <Text numberOfLines={1} style={m.text({ 'font-size': tv ? '20px' : '15px', 'font-weight': '550', color: current ? m.ui.accent : '$ui.ink' })}>{title}</Text>
            {subtitle ? <Text numberOfLines={1} style={m.text({ 'font-size': '13px', color: '$ui.inkQuiet' })}>{subtitle}</Text> : null}
          </View>
          <View pointerEvents="none" style={{ width: 76, alignItems: 'flex-end' }}>
            <Text style={m.text({ 'font-size': '14px', color: '$ui.inkQuiet', 'font-variant-numeric': 'tabular-nums' })}>{time}</Text>
          </View>
          {tv ? null : <View style={{ width: 32 }} />}
        </>
      )}
    </Surface>
  );
}

/** An episode: its date, name, a line of what it is about, where the viewer is in it (or that it
 * was played), its length, a play button always in reach, the heart and its menu. */
function EpisodeRow({ episode, current, playing, state, onPlay }: { episode: Card; current: boolean; playing: boolean; state: string; onPlay(): void }) {
  const app = useMusic();
  const m = useMediaLook();
  const tv = musicTV();
  const touch = !tv && (!web || m.width < 980);
  const more = useRef<ComponentRef<typeof View>>(null);
  const openMenu: MenuOpen = (anchor, mode, opener) => app.menu({ card: episode, anchor, mode, opener });
  const fraction = listenedFraction(episode);
  return (
    <Surface onPress={touch || tv ? onPlay : undefined} onDoubleClick={touch || tv ? undefined : onPlay} onMenu={openMenu} focusId={episode.id} testID={`spoken-episode-${episode.id}`} selected={current}
      label={[episode.name, dayLabel(episode), state, episode.durationSeconds ? durationLabel(episode.durationSeconds) : ''].filter(Boolean).join(', ')}
      style={(lit, focus) => [{ borderRadius: tv ? 12 : 10, backgroundColor: lit ? m.ui.control : current ? alpha(m.ui.accent, 0.1) : 'transparent', transform: [{ scale: tv && focus ? 1.015 : 1 }] },
        focus ? (tv ? { borderWidth: 2, borderColor: m.ui.ink } : m.box({ 'box-shadow': `inset 0px 0px 0px 1.5px ${m.ui.ink}` })) : tv ? { borderWidth: 2, borderColor: 'transparent' } : {},
        m.box({ 'border-bottom': '1px solid $ui.glassEdge' }), transition('background-color, transform', 120)]}
      contentStyle={{ flexDirection: 'row', alignItems: 'center', gap: m.small ? 12 : 18, paddingHorizontal: m.small ? 8 : 16, paddingVertical: tv ? 16 : 14 }}>
      {lit => (
        <>
          {m.small ? null : <View pointerEvents="none"><Cover uri={episode.poster} shape="square" size={tv ? 96 : 80} title={episode.name} accent={episode.accent} lift={0.3} /></View>}
          <View pointerEvents="none" style={{ flex: 1, minWidth: 0, gap: 4, opacity: episode.played && !current ? 0.66 : 1 }}>
            <Text numberOfLines={1} style={m.text({ 'font-size': '12px', 'font-weight': '650', 'letter-spacing': '0.04em', color: '$ui.inkQuiet' })}>
              {[dayLabel(episode), !episode.played && !underway(episode) ? msg('listening.new') : ''].filter(Boolean).join(' · ')}
            </Text>
            <Text numberOfLines={2} style={m.text({ 'font-size': tv ? '21px' : '16px', 'font-weight': '700', color: current ? m.ui.accent : '$ui.ink' })}>{episode.name}</Text>
            {episode.summary ? <Text numberOfLines={2} style={m.text({ 'font-size': '13px', 'line-height': '1.45', color: lit ? '$ui.inkSecondary' : '$ui.inkQuiet' })}>{episode.summary}</Text> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 }}>
              {fraction > 0 ? <View style={{ width: 96 }}><Progress fraction={fraction} height={4} /></View> : null}
              <Text style={m.text({ 'font-size': '12px', 'font-weight': episode.played ? '700' : '450', color: '$ui.inkQuiet', 'font-variant-numeric': 'tabular-nums' })}>
                {[state || '', !state && episode.durationSeconds ? durationLabel(episode.durationSeconds) : ''].filter(Boolean).join(' · ')}
              </Text>
            </View>
          </View>
          {tv ? <View pointerEvents="none">{playing ? <Meter /> : null}</View> : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} pointerEvents="box-none">
              {m.small ? null : <View style={{ opacity: lit || app.liked(episode.id) ? 1 : 0 }} pointerEvents={lit || app.liked(episode.id) ? 'box-none' : 'none'}><Heart card={episode} size={34} iconSize={18} /></View>}
              <View ref={more} style={{ opacity: lit || touch ? 1 : 0 }} pointerEvents={lit || touch ? 'box-none' : 'none'}>
                <IconButton symbol="more" label={msg('cardMenu.actionsFor', { title: episode.name })} size={34} iconSize={18} testID={`spoken-episode-more-${episode.id}`}
                  onPress={() => more.current?.measureInWindow((x: number, y: number, width: number, height: number) => app.menu({ card: episode, anchor: { kind: 'card', rect: { left: x, top: y, right: x + width, bottom: y + height } }, mode: 'pointer' }))} />
              </View>
              <PlayFab playing={playing} size={40} onPress={onPlay} label={playing ? msg('media.player.pause') : `${underway(episode) ? msg('media.ui.resume') : msg('media.ui.play')} ${episode.name}`} testID={`spoken-episode-play-${episode.id}`} />
            </View>
          )}
        </>
      )}
    </Surface>
  );
}

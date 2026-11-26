import { joinMeta } from '../../meta-line';
import { useMemo, type ReactNode } from 'react';
import { Platform, Text, View, type TextStyle } from 'react-native';
import { msg, number, percent, type Card } from '@vela/core';
import { useVela } from '@vela/core/react';
import { useMediaActions } from '../media/context';
import { Cover, CoverTile, PillButton, Progress, SectionHeading, TextLink, TileGrid, useMediaLook } from '../media/parts';
import { Buttons, Eyebrow, FactList, Facts, Hero, openByline, Summary, tilesPerRow, Title } from '../media/title';
import { usePart, usePartStyler, useListenLook } from '../listen/look';
import { readingChapterLabel } from './book-layout';
import { READ_SERIES_PRIMARY, seriesCanStart, seriesCopy, seriesKind, seriesOrder, seriesStart, tvSeriesBook } from './series';

/** Books are read on phones, tablets, the web and desktop. A TV offers no Read at all: a book's page
 * there is its details, with a quiet line saying where reading is. */
const READS_HERE = !Platform.isTV;

/** On a TV, in place of Read: the reader's own words for where books are read. */
function ReadElsewhere({ style }: { style?: TextStyle }) {
  const m = useMediaLook();
  return <Text testID="media-read-elsewhere" style={[m.text({ 'font-size': '13px', color: '$ui.inkQuiet' }), style]}>{msg('media.reader.unsupported')}</Text>;
}

function readLabel(card: Card): string {
  const fraction = card.media?.readingFraction ?? 0;
  if (card.played || fraction >= 0.98) return msg('media.ui.readAgain');
  return fraction > 0 ? msg('media.ui.continueReading') : msg('media.ui.read');
}

export function BookHero({ card, cover = true, action = true }: { card: Card; cover?: boolean; action?: boolean }) {
  const m = useMediaLook();
  const actions = useMediaActions();
  const media = card.media!;
  const series = media.parents.find(parent => parent.role === 'series');
  const fraction = media.readingFraction;
  const title = usePart('bookHero.title');
  const byline = usePart('bookHero.author');
  const seriesPart = usePart('bookHero.series');
  const progress = usePart('bookHero.progress');
  const look = useListenLook();
  const template = (part: string, fallback: ReactNode) => look.templates?.has(part)
    ? look.template?.(part, card, {}, 0)
    : fallback;
  return (
    <Hero cover={cover ? template('bookHero.cover', <BookCover card={card} />) : null}>
      {series ? <TextLink label={media.index ? msg('media.ui.bookOf', { index: number(media.index), series: series.name }) : series.name}
        onPress={() => actions.openTitle({ id: series.id, kind: 'series' })} testID="media-series"
        style={{ ...m.text({ 'font-size': '12px', 'font-weight': '700', 'letter-spacing': '0.2em', 'text-transform': 'uppercase', color: '$ui.inkSecondary' }), ...seriesPart.text }} />
        : <Eyebrow style={seriesPart.text}>{msg('media.ui.book')}</Eyebrow>}
      <Title style={title.text}>{card.name}</Title>
      {media.byline ? <TextLink label={msg('media.ui.by', { name: media.byline })} onPress={openByline(card, actions)} testID="media-byline"
        style={{ ...m.text({ 'font-family': '$ui.fontDisplay', 'font-size': '22px', 'font-style': 'italic', color: '$ui.ink' }), ...byline.text }} /> : null}
      <Facts items={[card.yearLabel, media.pages ? msg(`media.pages.${media.pages === 1 ? 'one' : 'other'}`, { count: number(media.pages) }) : '',
        media.readingFormat ? msg(`media.ui.format.${media.readingFormat}`) : '', card.genres.slice(0, 2).join(', ')]} />
      {fraction > 0 && fraction < 0.98 ? (
        <View style={[{ gap: 8, maxWidth: 420, marginTop: 4 }, progress.box]} testID="media-reading-progress">
          <Progress fraction={fraction} height={5} />
          <Text style={[m.text({ 'font-size': '13px', color: '$ui.inkQuiet' }), progress.text]}>{joinMeta([msg('media.ui.readProgress', { percent: percent(fraction) }), readingChapterLabel(media.readingLabel)])}</Text>
        </View>
      ) : card.played || fraction >= 0.98 ? <Text style={[m.text({ 'font-size': '13px', color: '$ui.accent', 'font-weight': '600' }), progress.text]}>{msg('media.ui.finished')}</Text> : null}
      {action ? template('bookHero.action', <BookReadAction card={card} />) : null}
    </Hero>
  );
}

export function BookCover({ card }: { card: Card }) {
  const m = useMediaLook();
  const part = usePart('bookCover.root');
  const size = m.small ? Math.min(230, m.width - m.gutter * 2 - 60) : m.wide ? 280 : 230;
  return (
    <View style={[{ paddingRight: 6, paddingBottom: 6 }, part.box]}>
      <Cover uri={card.poster} shape="book" size={size} title={card.name} byline={card.media?.byline} accent={card.accent} lift={1.7} />
    </View>
  );
}

export function BookReadAction({ card }: { card: Card }) {
  const m = useMediaLook();
  const store = useVela();
  const actions = useMediaActions();
  const part = usePart('bookReadAction.button');
  const buttonStyle = usePartStyler(['bookReadAction.button']);
  const message = usePart('bookReadAction.message');
  const format = card.media?.readingFormat;
  const canRead = !!format && store.media.features().reading.includes(format);
  if (!READS_HERE) return <ReadElsewhere style={message.text} />;
  return (
    <>
      <Buttons>
        <PillButton primary icon="book" label={readLabel(card)} onPress={() => actions.read(card)} disabled={!canRead}
          testID="media-read" nativeID="media-primary" style={buttonStyle} labelStyle={part.text} />
      </Buttons>
      {!canRead ? <Text style={[m.text({ 'font-size': '13px', color: '$ui.inkQuiet' }), message.text]}>{msg('media.ui.cannotRead')}</Text> : null}
    </>
  );
}

export function BookSummary({ card }: { card: Card }) {
  const part = usePart('bookSummary.root');
  return card.summary ? (
    <View style={[{ marginBottom: card.media?.role === 'series' ? 40 : 44 }, part.box]}>
      <Summary text={card.summary} serif style={part.text} />
    </View>
  ) : null;
}

export function BookSeriesList({ card, items }: { card: Card; items: readonly Card[] }) {
  const series = card.media?.parents.find(parent => parent.role === 'series');
  if (card.media?.role === 'series') return <SeriesGrid card={card} items={items} />;
  return series ? <SeriesShelf items={items} name={series.name} current={card.id} /> : null;
}

function SeriesGrid({ card, items }: { card: Card; items: readonly Card[] }) {
  const m = useMediaLook();
  const actions = useMediaActions();
  const part = usePart('bookSeriesList.root');
  const books = useMemo(() => seriesOrder(items), [items]);
  const { size, gap } = tilesPerRow(m, m.small ? 130 : 170);
  const copy = seriesCopy(seriesKind(books, card), books.length || card.media?.childCount || 0);
  const grid = (
    <>
      <SectionHeading title={copy.heading} />
      <TileGrid gap={gap}>
        {books.map(book => <CoverTile key={book.id} card={book} size={size} subtitle={joinMeta([book.media?.indexLabel, book.yearLabel])}
          progress={book.media?.readingFraction} onPress={() => actions.openTitle(book)} testID={`media-book-${book.id}`} />)}
      </TileGrid>
    </>
  );
  return part.box ? <View style={part.box}>{grid}</View> : grid;
}

export function SeriesHero({ card, items }: { card: Card; items: readonly Card[] }) {
  const m = useMediaLook();
  const store = useVela();
  const actions = useMediaActions();
  const books = useMemo(() => seriesOrder(items), [items]);
  const title = usePart('seriesHero.title');
  const author = usePart('seriesHero.author');
  const next = books.find(book => !book.played && (book.media?.readingFraction ?? 0) < 0.98) ?? books[0];
  const canStart = seriesCanStart(next, store.media.features());
  const start = next ? seriesStart(next) : null;
  const tvBook = !READS_HERE && start?.icon === 'book' ? tvSeriesBook(books) : undefined;
  const entry = tvBook ?? next;
  const label = tvBook
    ? !tvBook.played && (tvBook.media?.readingFraction ?? 0) > 0 && (tvBook.media?.readingFraction ?? 0) < 0.98
      ? msg('media.ui.continueReading') : tvBook.name
    : start?.label;
  const fan = books.slice(0, 3);
  const size = m.small ? 150 : 190;
  const byline = card.media?.byline || books[0]?.media?.byline || '';
  const copy = seriesCopy(seriesKind(books, card), books.length || card.media?.childCount || 0);
  return (
    <Hero cover={
      <View style={{ width: size + (fan.length - 1) * size * 0.32, height: size * 1.5 + 12 }} accessibilityElementsHidden>
        {(fan.length ? fan : [card]).map((book, i, all) => (
          <View key={book.id} style={{ position: 'absolute', left: i * size * 0.32, top: (all.length - 1 - i) * 4, zIndex: all.length - i,
            transform: [{ rotate: `${(i - (all.length - 1) / 2) * 3}deg` }] }}>
            <Cover uri={book.poster} shape="book" size={size} title={book.name} byline={book.media?.byline} accent={book.accent} lift={1.3} />
          </View>
        )).reverse()}
      </View>}>
      <Eyebrow>{msg('media.ui.series')}</Eyebrow>
      <Title style={title.text}>{card.name}</Title>
      {byline ? <TextLink label={msg('media.ui.by', { name: byline })} onPress={openByline(books[0] ?? card, actions)}
        style={{ ...m.text({ 'font-family': '$ui.fontDisplay', 'font-size': '22px', 'font-style': 'italic', color: '$ui.ink' }), ...author.text }} /> : null}
      <Facts items={[copy.count, card.genres.slice(0, 2).join(', ')]} />
      <Buttons>
        {entry && start && label ? <PillButton primary icon={start.icon} label={label}
          onPress={() => actions.openTitle(entry)} disabled={!tvBook && !canStart} testID="media-play"
          nativeID={Platform.isTV ? READ_SERIES_PRIMARY : 'media-primary'} preferred={Platform.isTV} /> : null}
      </Buttons>
      {start && !canStart && (READS_HERE || start.icon !== 'book') ? <Text style={m.text({ 'font-size': '13px', color: '$ui.inkQuiet' })}>{start.unavailable}</Text> : null}
      {start && !READS_HERE && start.icon === 'book' ? <ReadElsewhere /> : null}
    </Hero>
  );
}

function SeriesShelf({ items, name, current }: { items: readonly Card[]; name: string; current: string }) {
  const m = useMediaLook();
  const actions = useMediaActions();
  const part = usePart('bookSeriesList.root');
  const books = items.filter(book => book.id !== current);
  if (!books.length) return null;
  const { size, gap } = tilesPerRow(m, m.small ? 120 : 160);
  return (
    <View style={[{ marginBottom: 32 }, part.box]}>
      <SectionHeading title={msg('media.ui.moreIn', { name })} />
      <TileGrid gap={gap}>
        {books.map(book => <CoverTile key={book.id} card={book} size={size} subtitle={book.media?.indexLabel || book.yearLabel}
          progress={book.media?.readingFraction} onPress={() => actions.openTitle(book)} testID={`media-book-${book.id}`} />)}
      </TileGrid>
    </View>
  );
}

export function BookFacts({ card }: { card: Card }) {
  const part = usePart('bookFacts.root');
  return <FactList card={card} style={part.box} />;
}

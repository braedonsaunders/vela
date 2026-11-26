// The `lyrics` block's engine. Synced lyrics beside Now Playing: the line being sung is lit (word
// by word when the lyrics are word-timed), the ones sung fade, the list keeps the current line in
// view, and pressing a line seeks there. A translation, when asked for and present, sits under
// each line. Plain lyrics scroll as text. Lyrics come from the server (features.lyrics: GET
// /titles/:id/lyrics), which asks the title's source and remembers the answer. A document styles
// the parts (lyrics.*).
import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { msg, type Card } from '@vela/core';
import { useVela, useVelaState } from '@vela/core/react';
import { FocusPressable as Pressable } from '../../focus';
import { NO_RING } from '../../widgets/common/controls';
import { useMediaLook } from '../../widgets/media/parts';
import { transition } from './parts';
import { usePart } from './look';
import { litWords, lyricLine } from './props';

export interface LyricWord { startMs: number; endMs?: number; text: string }
export interface LyricLine { startMs: number; endMs?: number; text: string; words?: LyricWord[]; translation?: string; romanised?: string }
export interface Lyrics { synced: LyricLine[]; plain: string; source: string }

export function useLyrics(card: Card | undefined): { lyrics: Lyrics | null | undefined } {
  const store = useVela();
  const served = useVelaState(state => (card ? state.music.lyrics[card.id] : undefined));
  const fromServer = store.music.lyricsAvailable;
  useEffect(() => { if (card && fromServer) void store.music.lyrics(card.id); }, [store, card, fromServer]);
  if (!fromServer || !card) return { lyrics: null };
  if (!served || served.load === 'loading') return { lyrics: undefined };
  const value = served.value;
  return { lyrics: value ? { synced: value.lines as LyricLine[], plain: value.plain, source: value.source } : null };
}

export function LyricsPanel({ card, large = false, translate = false }: { card: Card | undefined; large?: boolean; translate?: boolean }) {
  const m = useMediaLook();
  const store = useVela();
  const position = useVelaState(s => s.audio.positionSeconds);
  const { lyrics } = useLyrics(card);
  const lines = lyrics?.synced ?? [];
  const at = useMemo(() => lyricLine(lines, position * 1000), [lines, position]);
  const linePart = usePart('lyrics.line');
  const activePart = usePart('lyrics.activeLine');
  const pastPart = usePart('lyrics.pastLine');
  const translation = usePart('lyrics.translation').text;
  const source = usePart('lyrics.source').text;
  const message = usePart('lyrics.message').text;
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const offsets = useRef<number[]>([]);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const y = offsets.current[at];
    if (y !== undefined) scroll.current?.scrollTo({ y: Math.max(0, y - height * 0.32), animated: !m.look.still });
  }, [at, height, m.look.still]);
  const size = large ? 34 : 24;
  if (lyrics === undefined) return <Text style={[m.text({ 'font-size': '16px', color: '$ui.inkQuiet' }), { padding: 24 }, message]}>{msg('music.lyricsLoading')}</Text>;
  if (!lyrics) return <Text style={[m.text({ 'font-size': '16px', color: '$ui.inkQuiet' }), { padding: 24 }, message]}>{msg('music.lyricsNone')}</Text>;
  return (
    <ScrollView ref={scroll} onLayout={e => setHeight(e.nativeEvent.layout.height)} style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 24, paddingHorizontal: 8 }} testID="music-lyrics">
      {lines.length ? lines.map((line, i) => (
        <Pressable key={`${line.startMs}-${i}`} onPress={() => store.audio.seek(line.startMs / 1000)} accessibilityRole="button"
          onLayout={e => { offsets.current[i] = e.nativeEvent.layout.y; }} style={[NO_RING, { paddingVertical: large ? 8 : 6 }, linePart.box, i === at ? activePart.box : i < at ? pastPart.box : null]}>
          <Text style={[m.text({ 'font-size': `${size}px`, 'line-height': '1.25', 'font-weight': '750', color: i === at ? '$ui.ink' : i < at ? '$ui.inkSecondary' : '$ui.inkQuiet' }),
            { opacity: i === at ? 1 : i < at ? 0.55 : 0.75, transform: [{ scale: i === at ? 1 : 0.985 }] }, transition('opacity, transform, color', 320),
            linePart.text, i === at ? activePart.text : i < at ? pastPart.text : null]}>
            {i === at && line.words?.length ? <Words words={line.words} text={line.text} /> : line.text || '♪'}
          </Text>
          {translate && line.translation ? <Text style={[m.text({ 'font-size': `${Math.round(size * 0.6)}px`, 'line-height': '1.3', color: '$ui.inkSecondary' }), { marginTop: 2, opacity: i === at ? 1 : 0.7 }, translation]}>{line.translation}</Text> : null}
        </Pressable>
      )) : <Text style={m.text({ 'font-size': `${size * 0.7}px`, 'line-height': '1.5', color: '$ui.inkSecondary' })}>{lyrics.plain}</Text>}
      <Text style={[m.text({ 'font-size': '12px', color: '$ui.inkQuiet' }), { marginTop: 24 }, source]}>{msg('music.lyricsSource', { source: lyrics.source })}</Text>
    </ScrollView>
  );
}

/** The active line of word-timed lyrics: the words sung so far lit, the rest still to come. Only
 * this line follows the position closely, so the list does not redraw per word. */
function Words({ words, text }: { words: LyricWord[]; text: string }) {
  const m = useMediaLook();
  const ms = useVelaState(s => s.audio.positionSeconds) * 1000;
  const lit = litWords(words, ms);
  // Words carry their own spaces when they spell the line exactly (or none, as in Japanese).
  const glue = words.map(w => w.text).join('') === text ? '' : ' ';
  const word = usePart('lyrics.word').text;
  const active = usePart('lyrics.activeWord').text;
  return <>{words.map((w, i) => (
    <Text key={`${w.startMs}-${i}`} style={[{ opacity: i < lit ? 1 : 0.45 }, transition('opacity', 160), word, i < lit ? active : null, i < lit ? null : m.text({ color: '$ui.inkSecondary' })]}>
      {w.text}{i < words.length - 1 ? glue : ''}
    </Text>
  ))}</>;
}

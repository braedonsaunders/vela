// Synced lyrics beside Now Playing: the line being sung is lit, the ones sung fade, the list keeps
// the current line in view, and pressing a line seeks there. Plain lyrics scroll as text.
// Lyrics come from the server (features.lyrics: GET /titles/:id/lyrics), which asks the
// title's source and remembers the answer.
import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { msg, type Card } from '@vela/core';
import { useVela, useVelaState } from '@vela/core/react';
import { FocusPressable as Pressable } from '../../focus';
import { NO_RING } from '../common/controls';
import { useMediaLook } from '../media/parts';
import { transition } from './parts';

export interface Lyrics { synced: { startMs: number; text: string }[]; plain: string; source: string }

export function useLyrics(card: Card | undefined): { lyrics: Lyrics | null | undefined } {
  const store = useVela();
  const served = useVelaState(state => (card ? state.music.lyrics[card.id] : undefined));
  const fromServer = store.music.lyricsAvailable;
  useEffect(() => { if (card && fromServer) void store.music.lyrics(card.id); }, [store, card, fromServer]);
  if (!fromServer || !card) return { lyrics: null };
  if (!served || served.load === 'loading') return { lyrics: undefined };
  const value = served.value;
  return { lyrics: value ? { synced: value.lines, plain: value.plain, source: value.source } : null };
}

export function LyricsPanel({ card, large = false }: { card: Card | undefined; large?: boolean }) {
  const m = useMediaLook();
  const store = useVela();
  const position = useVelaState(s => s.audio.positionSeconds);
  const { lyrics } = useLyrics(card);
  const lines = lyrics?.synced ?? [];
  const at = useMemo(() => {
    const ms = position * 1000 + 250;
    let i = -1;
    for (let n = 0; n < lines.length; n++) { if (lines[n]!.startMs <= ms) i = n; else break; }
    return i;
  }, [lines, position]);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const offsets = useRef<number[]>([]);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const y = offsets.current[at];
    if (y !== undefined) scroll.current?.scrollTo({ y: Math.max(0, y - height * 0.32), animated: !m.look.still });
  }, [at, height, m.look.still]);
  const size = large ? 34 : 24;
  if (lyrics === undefined) return <Text style={[m.text({ 'font-size': '16px', color: '$ui.inkQuiet' }), { padding: 24 }]}>{msg('music.lyricsLoading')}</Text>;
  if (!lyrics) return <Text style={[m.text({ 'font-size': '16px', color: '$ui.inkQuiet' }), { padding: 24 }]}>{msg('music.lyricsNone')}</Text>;
  return (
    <ScrollView ref={scroll} onLayout={e => setHeight(e.nativeEvent.layout.height)} style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 24, paddingHorizontal: 8 }} testID="music-lyrics">
      {lines.length ? lines.map((line, i) => (
        <Pressable key={`${line.startMs}-${i}`} onPress={() => store.audio.seek(line.startMs / 1000)} accessibilityRole="button"
          onLayout={e => { offsets.current[i] = e.nativeEvent.layout.y; }} style={[NO_RING, { paddingVertical: large ? 8 : 6 }]}>
          <Text style={[m.text({ 'font-size': `${size}px`, 'line-height': '1.25', 'font-weight': '750', color: i === at ? '$ui.ink' : i < at ? '$ui.inkSecondary' : '$ui.inkQuiet' }),
            { opacity: i === at ? 1 : i < at ? 0.55 : 0.75, transform: [{ scale: i === at ? 1 : 0.985 }] }, transition('opacity, transform, color', 320)]}>
            {line.text || '♪'}
          </Text>
        </Pressable>
      )) : <Text style={m.text({ 'font-size': `${size * 0.7}px`, 'line-height': '1.5', color: '$ui.inkSecondary' })}>{lyrics.plain}</Text>}
      <Text style={[m.text({ 'font-size': '12px', color: '$ui.inkQuiet' }), { marginTop: 24 }]}>{msg('music.lyricsSource', { source: lyrics.source })}</Text>
    </ScrollView>
  );
}

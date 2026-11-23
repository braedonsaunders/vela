// Synced lyrics beside Now Playing: the line being sung is lit, the ones sung fade, the list keeps
// the current line in view, and pressing a line seeks there. Plain lyrics scroll as text.
//
// S0 (screenshots): read from LRCLIB directly in development builds. S1 replaces this with Ether's
// GET /titles/:id/lyrics (features.lyrics), which asks the kind plugin and caches the answer.
import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { msg, type Card } from '@vela/core';
import { useVela, useVelaState } from '@vela/core/react';
import { FocusPressable as Pressable } from '../../focus';
import { NO_RING } from '../common/controls';
import { useMediaLook } from '../media/parts';
import { transition } from './parts';

export interface Lyrics { synced: { startMs: number; text: string }[]; plain: string; source: string }

const cache = new Map<string, Lyrics | null>();

function parseLrc(lrc: string): Lyrics['synced'] {
  const out: Lyrics['synced'] = [];
  for (const line of lrc.split('\n')) {
    const match = /^\[(\d+):(\d+(?:\.\d+)?)\]\s?(.*)$/.exec(line.trim());
    if (match) out.push({ startMs: Math.round((Number(match[1]) * 60 + Number(match[2])) * 1000), text: match[3] ?? '' });
  }
  return out;
}

export function useLyrics(card: Card | undefined): { lyrics: Lyrics | null | undefined } {
  const key = card?.id ?? '';
  const [lyrics, setLyrics] = useState<Lyrics | null | undefined>(() => cache.get(key));
  useEffect(() => {
    if (!card) return;
    if (cache.has(card.id)) { setLyrics(cache.get(card.id)); return; }
    setLyrics(undefined);
    if (typeof __DEV__ === 'undefined' || !__DEV__) { cache.set(card.id, null); setLyrics(null); return; }
    const album = card.media?.parents.find(p => p.role === 'album')?.name ?? '';
    const q = new URLSearchParams({ artist_name: card.media?.byline ?? '', track_name: card.name, album_name: album });
    if (card.durationSeconds) q.set('duration', String(Math.round(card.durationSeconds)));
    let live = true;
    void fetch(`https://lrclib.net/api/get?${q}`).then(r => (r.ok ? r.json() : null)).then((body: { syncedLyrics?: string; plainLyrics?: string } | null) => {
      const value = body && (body.syncedLyrics || body.plainLyrics) ? { synced: parseLrc(body.syncedLyrics ?? ''), plain: body.plainLyrics ?? '', source: 'LRCLIB' } : null;
      cache.set(card.id, value);
      if (live) setLyrics(value);
    }).catch(() => { if (live) setLyrics(null); });
    return () => { live = false; };
  }, [card]);
  return { lyrics: key ? lyrics : null };
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

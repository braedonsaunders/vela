// Chapters as a strip over the timeline: one card per chapter with its start time and name,
// the one playing marked and filling as it plays. Choosing a card seeks to its start. The
// strip opens on the chapter playing (on TV, with focus on it).
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { msg } from '@vela/core';
import type { PlayerLook } from './look';
import { timecode, type ChapterMark, type PlayerView } from './present';

interface Props {
  look: PlayerLook;
  view: PlayerView;
  disabled: boolean;
  onSeek(seconds: number): void;
}

/** The chapter playing: the last one that starts at or before the position. */
export function chapterAt(chapters: ChapterMark[], position: number): number {
  let index = 0;
  chapters.forEach((c, i) => { if (c.seconds <= position) index = i; });
  return index;
}

export function ChapterStrip({ look, view, disabled, onSeek }: Props) {
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null);
  const current = chapterAt(view.chapters, view.position);
  const width = look.size(look.small ? 168 : 208);
  const gap = look.size(10);

  useEffect(() => {
    scroller.current?.scrollTo({ x: Math.max(0, current * (width + gap) - gap), animated: false });
    // Only on opening: the strip does not chase the playhead while the viewer browses it.
  }, []);

  return (
    <ScrollView ref={scroller} horizontal showsHorizontalScrollIndicator={false} accessibilityLabel={msg('ui.chapters')}
      contentContainerStyle={{ gap, paddingVertical: look.size(4) }} testID="player-chapters">
      {view.chapters.map((chapter, i) => {
        const end = view.chapters[i + 1]?.seconds ?? view.duration;
        const played = i === current && end > chapter.seconds ? (view.position - chapter.seconds) / (end - chapter.seconds) : 0;
        return (
          <ChapterCard key={chapter.id} look={look} chapter={chapter} width={width} playing={i === current}
            played={Math.max(0, Math.min(1, played))} disabled={disabled} onPress={() => onSeek(chapter.seconds)} />
        );
      })}
    </ScrollView>
  );
}

interface Card {
  look: PlayerLook;
  chapter: ChapterMark;
  width: number;
  playing: boolean;
  played: number;
  disabled: boolean;
  onPress(): void;
}

function ChapterCard({ look, chapter, width, playing, played, disabled, onPress }: Card) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const lit = look.tv && focus;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${timecode(chapter.seconds)}, ${chapter.name}`}
      accessibilityState={{ selected: playing, disabled }} disabled={disabled} hasTVPreferredFocus={playing}
      onPress={onPress} onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)}
      onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
      style={{ width, gap: look.size(4), padding: look.size(12), borderRadius: look.size(12), overflow: 'hidden',
        borderWidth: 1, borderColor: playing ? look.glassEdgeStrong : look.glassEdge,
        backgroundColor: lit ? look.ink : hover || playing ? look.controlHover : look.glass,
        outlineColor: look.accent, outlineStyle: 'solid', outlineWidth: focus && !look.tv ? 2 : 0,
        transform: [{ scale: lit && !look.still ? 1.05 : 1 }] }}>
      <Text style={[look.text(11, 650, lit ? look.inkInverse : playing ? look.accent : look.inkQuiet),
        { fontVariant: ['tabular-nums'] }]}>
        {timecode(chapter.seconds)}
      </Text>
      <Text numberOfLines={1} style={look.text(14, 550, lit ? look.inkInverse : look.ink)}>{chapter.name}</Text>
      {playing ? (
        <View style={{ position: 'absolute', left: 0, bottom: 0, height: look.size(3), width: `${played * 100}%`,
          backgroundColor: look.accent }} />
      ) : null}
    </Pressable>
  );
}

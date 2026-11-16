// The timeline: buffered ranges, the played fill, chapter marks and a thumb. Dragging (pointer
// or touch) moves the thumb at once and seeks on release; the thumb stays where it was let go
// until the engine's position catches up, so it never jumps back. On TV the focused timeline
// takes left and right as ten-second steps and seeks when the presses stop. On the web the
// timeline is a focusable slider: the arrows step ten seconds (the chrome's shortcuts), Page Up and
// Page Down a minute, Home and End go to the start and the end. A bubble over the thumb shows the
// target time and, once a session offers trickplay, its frame.
import { Image } from 'expo-image';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Platform, Pressable, Text, View, type GestureResponderEvent } from 'react-native';
import { msg } from '@vela/core';
import type { PlayerChromeState } from './context';
import type { PlayerLook } from './look';
import { timecode, type PlayerView } from './present';
import { pressed, useRemote } from './remote';

const STEP_SECONDS = 10;
const PAGE_SECONDS = 60;
/** TV: the presses stop for this long, then the timeline seeks. */
const SETTLE_MS = 650;
/** A released target is held until the engine reports a position this close, or this long passes. */
const CAUGHT_UP_SECONDS = 1.5;
const HOLD_MS = 5000;

interface Props {
  look: PlayerLook;
  view: PlayerView;
  disabled: boolean;
  onSeek(seconds: number): void;
  /** Dragging or stepping: the chrome stays up meanwhile. */
  onActive(active: boolean): void;
  thumbnail?: PlayerChromeState['thumbnail'];
}

export function Scrubber({ look, view, disabled, onSeek, onActive, thumbnail }: Props) {
  const box = useRef<ComponentRef<typeof View>>(null);
  const frame = useRef({ left: 0, width: 1 });
  const [target, setTarget] = useState<number | null>(null);
  const [held, setHeld] = useState<{ seconds: number; at: number } | null>(null);
  const [focused, setFocused] = useState(false);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const duration = view.duration;

  // Let go of a released target once the engine is there (or has had its chance).
  useEffect(() => {
    if (!held) return;
    if (Math.abs(view.position - held.seconds) < CAUGHT_UP_SECONDS) setHeld(null);
    const timer = setTimeout(() => setHeld(null), Math.max(0, held.at + HOLD_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [held, view.position]);

  useEffect(() => () => clearTimeout(settle.current), []);

  const commit = (seconds: number) => {
    const clamped = Math.max(0, Math.min(duration, seconds));
    setTarget(null);
    setHeld({ seconds: clamped, at: Date.now() });
    onActive(false);
    onSeek(clamped);
  };

  /** Where the timeline sits in the window, kept current so a quick click needs no measuring. */
  const measure = () => {
    box.current?.measureInWindow((left, _top, width) => {
      frame.current = { left, width };
    });
  };

  const fromEvent = (event: GestureResponderEvent) => {
    const { left, width } = frame.current;
    return Math.max(0, Math.min(1, (event.nativeEvent.pageX - left) / Math.max(1, width))) * duration;
  };

  const grant = (event: GestureResponderEvent) => {
    onActive(true);
    setTarget(fromEvent(event));
    measure();
  };

  /** Web keys on the focused timeline; the arrows are the chrome's own shortcuts. */
  const keys =
    Platform.OS === 'web'
      ? {
          onKeyDown: (event: { nativeEvent: object; preventDefault(): void }) => {
            if (disabled || duration <= 0) return;
            const key = (event.nativeEvent as { key?: string }).key;
            const from = held?.seconds ?? view.position;
            const to =
              key === 'Home'
                ? 0
                : key === 'End'
                  ? duration
                  : key === 'PageUp'
                    ? from + PAGE_SECONDS
                    : key === 'PageDown'
                      ? from - PAGE_SECONDS
                      : null;
            if (to === null) return;
            event.preventDefault();
            commit(to);
          },
        }
      : {};

  useRemote(event => {
    if (!focused || disabled) return;
    if (event.eventType !== 'left' && event.eventType !== 'right') return;
    if (!pressed(event)) return;
    const from = target ?? held?.seconds ?? view.position;
    const next = Math.max(0, Math.min(duration, from + (event.eventType === 'right' ? STEP_SECONDS : -STEP_SECONDS)));
    onActive(true);
    setTarget(next);
    clearTimeout(settle.current);
    settle.current = setTimeout(() => commit(next), SETTLE_MS);
  });

  const shown = target ?? held?.seconds ?? view.position;
  const fraction = duration > 0 ? Math.max(0, Math.min(1, shown / duration)) : 0;
  const active = target !== null;
  const bar = look.size(active || focused ? 6 : 4);
  const thumb = look.size(14);
  const height = look.size(look.tv ? 30 : 22);
  const frameImage = active && thumbnail ? thumbnail(target) : null;
  const bubbleWidth = look.size(frameImage ? 160 : 72);
  return (
    <View
      ref={box}
      onLayout={measure}
      style={{ height, justifyContent: 'center' }}
      onStartShouldSetResponderCapture={() => !disabled && duration > 0}
      onMoveShouldSetResponderCapture={() => !disabled && duration > 0}
      onResponderTerminationRequest={() => false}
      onResponderGrant={grant}
      onResponderMove={event => setTarget(fromEvent(event))}
      onResponderRelease={event => commit(fromEvent(event))}
      onResponderTerminate={() => {
        setTarget(null);
        onActive(false);
      }}
    >
      <Pressable
        accessibilityRole="adjustable"
        accessibilityLabel={msg('ui.playbackPosition')}
        accessibilityValue={{ min: 0, max: Math.round(duration), now: Math.round(shown), text: timecode(shown) }}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(shown)}
        aria-valuetext={timecode(shown)}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={e =>
          commit(shown + (e.nativeEvent.actionName === 'increment' ? STEP_SECONDS : -STEP_SECONDS))
        }
        disabled={disabled || duration <= 0}
        focusable={(look.tv || Platform.OS === 'web') && !disabled && duration > 0}
        testID="player-scrub"
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          if (target !== null) commit(target);
        }}
        onPress={() => {
          if (target !== null) {
            clearTimeout(settle.current);
            commit(target);
          }
        }}
        style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'center' }}
        {...keys}
      >
        <View style={{ height: bar, borderRadius: bar / 2, backgroundColor: look.track, overflow: 'hidden' }}>
          {view.buffered.map((range, i) => (
            <View
              key={i}
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${range.start * 100}%`,
                width: `${Math.max(0, range.end - range.start) * 100}%`,
                backgroundColor: look.trackStrong,
              }}
            />
          ))}
          <View
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              width: `${fraction * 100}%`,
              backgroundColor: focused && look.tv ? look.accent : look.ink,
            }}
          />
        </View>
        {view.chapters
          .filter(c => c.at > 0)
          .map(chapter => (
            <View
              key={chapter.id}
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: `${chapter.at * 100}%`,
                width: 2,
                height: bar,
                backgroundColor: look.page,
                opacity: 0.7,
              }}
            />
          ))}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: `${fraction * 100}%`,
            marginLeft: -thumb / 2,
            width: thumb,
            height: thumb,
            borderRadius: thumb / 2,
            backgroundColor: look.ink,
            transform: [{ scale: active || focused || look.still ? 1 : 0.85 }],
            boxShadow:
              active || focused ? `0px 0px 0px ${look.size(6)}px ${look.focusHalo}` : `0px 2px 10px ${look.shadow}`,
          }}
        />
      </Pressable>
      {active ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            bottom: height + look.size(8),
            left: `${fraction * 100}%`,
            width: bubbleWidth,
            marginLeft: -bubbleWidth / 2,
            alignItems: 'center',
            gap: look.size(6),
          }}
        >
          {frameImage ? (
            <Image
              source={frameImage}
              contentFit="cover"
              style={{
                width: bubbleWidth,
                aspectRatio: 16 / 9,
                borderRadius: look.size(8),
                backgroundColor: look.raised,
              }}
            />
          ) : null}
          <Text
            style={[
              look.text(13, 600),
              {
                paddingHorizontal: look.size(8),
                paddingVertical: look.size(3),
                borderRadius: look.size(6),
                backgroundColor: look.popover,
                fontVariant: ['tabular-nums'],
                overflow: 'hidden',
              },
            ]}
          >
            {timecode(target)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

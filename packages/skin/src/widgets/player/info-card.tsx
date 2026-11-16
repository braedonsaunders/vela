// Live playback facts in a small glass card: the bitrate, the connection against what this
// quality needs (with its recent history), the buffer, the resolution, the codec, the delivery
// path and dropped frames. A fact the engine does not report is left out, never guessed.
import { BlurView } from 'expo-blur';
import { StyleSheet, Text, View } from 'react-native';
import { msg } from '@vela/core';
import type { PlayerLook } from './look';
import type { PlayerView } from './present';

export function InfoCard({ look, view, top }: { look: PlayerLook; view: PlayerView; top: number }) {
  const s = view.stats;
  const facts: [string, string][] = [
    [msg('player.info.buffer'), s.buffer],
    [msg('player.info.resolution'), s.resolution],
    [msg('player.info.video'), s.video],
    [msg('player.info.delivery'), view.path || s.delivery],
    [msg('player.info.dropped'), s.dropped],
  ];
  const known = facts.filter(([, value]) => value !== '');
  const connection = s.required
    ? msg('player.info.versus', { measured: s.throughput, needed: s.required })
    : s.throughput;
  const sparkHeight = look.size(24);
  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={msg('player.info')}
      pointerEvents="none"
      testID="player-info"
      style={{
        position: 'absolute',
        top,
        right: look.small ? look.size(12) : look.gutter,
        left: look.small ? look.size(12) : undefined,
        width: look.small ? undefined : look.size(300),
        padding: look.size(18),
        gap: look.size(14),
        borderRadius: Math.min(look.radiusPanel, look.size(18)),
        borderWidth: 1,
        borderColor: look.glassEdge,
        overflow: 'hidden',
        boxShadow: `0px 24px 70px ${look.shadow}`,
      }}
    >
      <BlurView intensity={70} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: look.popover }]} />
      <View
        style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: look.size(12) }}
      >
        <Text
          style={[look.text(11, 650, look.inkQuiet), { letterSpacing: look.size(0.9), textTransform: 'uppercase' }]}
        >
          {msg('player.info.bitrate')}
        </Text>
        <Text style={[look.display(26), { fontVariant: ['tabular-nums'] }]}>{s.bitrate || '–'}</Text>
      </View>
      {s.throughput ? (
        <View style={{ gap: look.size(8) }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: look.size(12) }}>
            <Text style={look.text(12, 400, look.inkSecondary)}>{msg('player.info.connection')}</Text>
            <Text style={[look.text(12), { fontVariant: ['tabular-nums'] }]}>{connection}</Text>
          </View>
          {s.required ? <Headroom look={look} headroom={s.headroom} /> : null}
          {s.history.length > 1 ? (
            <View style={{ height: sparkHeight, flexDirection: 'row', alignItems: 'flex-end', gap: 2 }}>
              {s.history.map((v, i) => (
                <View
                  key={i}
                  style={{
                    flex: 1,
                    minWidth: 2,
                    height: Math.max(2, v * sparkHeight),
                    borderRadius: 1,
                    backgroundColor: look.trackStrong,
                  }}
                />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
      {known.length ? (
        <View style={{ gap: look.size(6) }}>
          {known.map(([name, value]) => (
            <View key={name} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: look.size(16) }}>
              <Text style={look.text(12, 400, look.inkQuiet)}>{name}</Text>
              <Text
                numberOfLines={1}
                style={[look.text(12), { flexShrink: 1, textAlign: 'right', fontVariant: ['tabular-nums'] }]}
              >
                {value}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** Measured against needed: the midpoint is what this quality needs, the fill what the line gives. */
function Headroom({ look, headroom }: { look: PlayerLook; headroom: number }) {
  const fill = Math.min(1, Math.max(0, headroom) / 2);
  return (
    <View
      style={{
        height: look.size(6),
        borderRadius: look.size(3),
        backgroundColor: look.trackStrong,
        overflow: 'hidden',
      }}
    >
      <View
        style={{ width: `${fill * 100}%`, height: '100%', backgroundColor: headroom >= 1 ? look.ink : look.accent }}
      />
      <View style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 2, backgroundColor: look.page }} />
    </View>
  );
}

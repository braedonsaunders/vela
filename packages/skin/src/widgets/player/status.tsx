// The middle of the screen: nothing while playback runs, the spinner while the engine waits,
// and a failure card when playback cannot go on: what happened in the server's or engine's
// words (all streams in use, a refusal, a decoder failure), with Try again and Close.
import { BlurView } from 'expo-blur';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { msg } from '@vela/core';
import { PlayerIcon } from './icons';
import type { PlayerLook } from './look';
import { Spinner } from './spinner';

export interface Failed {
  message: string;
  /** All of the server's streams are in use: trying again later may work. */
  capacity: boolean;
}

interface Props {
  look: PlayerLook;
  failed: Failed | null;
  waiting: boolean;
  /** What the engine is doing while it waits, for screen readers. */
  waitingLabel: string;
  onRetry(): void;
  onClose(): void;
}

export function Status({ look, failed, waiting, waitingLabel, onRetry, onClose }: Props) {
  if (failed) return <FailureCard look={look} failed={failed} onRetry={onRetry} onClose={onClose} />;
  if (!waiting) return null;
  return (
    <View pointerEvents="none" testID="player-status" style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Spinner look={look} size={look.size(look.small ? 52 : 64)} label={waitingLabel} />
    </View>
  );
}

function FailureCard({
  look,
  failed,
  onRetry,
  onClose,
}: {
  look: PlayerLook;
  failed: Failed;
  onRetry(): void;
  onClose(): void;
}) {
  return (
    <View
      accessibilityRole="alert"
      testID="player-status"
      style={{
        alignItems: 'center',
        gap: look.size(14),
        marginHorizontal: 16,
        maxWidth: look.size(440),
        paddingVertical: look.size(look.small ? 26 : 34),
        paddingHorizontal: look.size(look.small ? 22 : 40),
        borderRadius: Math.min(look.radiusPanel, look.size(24)),
        borderWidth: 1,
        borderColor: look.glassEdge,
        overflow: 'hidden',
        boxShadow: `0px 30px 90px ${look.shadow}`,
      }}
    >
      <BlurView intensity={70} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: look.glass }]} />
      <PlayerIcon name="alert" size={look.size(26)} color={look.accent} />
      <Text style={[look.display(30), { textAlign: 'center' }]}>{msg('ui.playbackInterrupted')}</Text>
      {failed.message ? (
        <Text style={[look.text(14, 400, look.inkSecondary), { textAlign: 'center', lineHeight: look.size(22) }]}>
          {failed.message}
        </Text>
      ) : null}
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: look.size(10),
          marginTop: look.size(6),
        }}
      >
        <Pill look={look} label={msg('ui.tryAgain')} primary preferred onPress={onRetry} testID="player-retry" />
        <Pill look={look} label={msg('ui.closePlayer')} onPress={onClose} testID="player-failure-close" />
      </View>
    </View>
  );
}

interface PillProps {
  look: PlayerLook;
  label: string;
  primary?: boolean;
  preferred?: boolean;
  onPress(): void;
  testID: string;
}

function Pill({ look, label, primary, preferred, onPress, testID }: PillProps) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const filled = primary || (look.tv && focus);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hasTVPreferredFocus={preferred}
      testID={testID}
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={{
        height: look.size(44),
        paddingHorizontal: look.size(24),
        justifyContent: 'center',
        borderRadius: look.radiusControl >= look.size(22) ? look.size(22) : look.radiusControl,
        backgroundColor: filled ? look.ink : hover ? look.controlHover : look.control,
        borderWidth: filled ? 0 : 1,
        borderColor: look.glassEdgeStrong,
        opacity: hover && filled ? 0.9 : 1,
        outlineColor: look.accent,
        outlineStyle: 'solid',
        outlineWidth: focus ? (look.tv ? look.size(3) : 2) : 0,
        outlineOffset: look.tv ? look.size(3) : 2,
        transform: [{ scale: look.tv && focus && !look.still ? 1.06 : 1 }],
      }}
    >
      <Text style={look.text(14, 600, filled ? look.inkInverse : look.ink)}>{label}</Text>
    </Pressable>
  );
}

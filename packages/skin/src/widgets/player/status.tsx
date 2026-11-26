// The middle of the screen: nothing while playback runs, the spinner while the engine waits
// (with "Retrying…" and the reason while a refused start is asked again on the server's terms),
// and a failure card when playback cannot go on: what happened in the server's or engine's
// words (all streams in use, a refusal, a decoder failure), with Try again and Close, and on a
// channel, channel up and down so the viewer can zap away.
import { FocusPressable as Pressable } from '../../focus';
import { BlurView } from 'expo-blur';
import { useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { msg } from '@vela/core';
import { PlayerIcon, type PlayerIconName } from './icons';
import type { PlayerLook } from './look';
import { Spinner } from './spinner';
import { useFocusClaim } from '../common/focus-claim';

export interface Failed {
  unreleased?: boolean;
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
  /** A refused start being asked again: shown in words under the spinner. */
  retrying?: { seconds: number; message: string } | null;
  onRetry(): void;
  useOriginal?: () => void;
  onClose(): void;
  /** On a channel: channel up (-1) and down (+1) from the failure card. */
  zap?: (step: -1 | 1) => void;
  /** The channel being dialled from the failure card (the mini guide), or null. */
  dial?: ReactNode;
}

export function Status({ look, failed, waiting, waitingLabel, retrying, onRetry, useOriginal, onClose, zap, dial }: Props) {
  if (failed) {
    return (
      <View style={{ alignItems: 'center', gap: look.size(16) }} pointerEvents="box-none">
        <FailureCard look={look} failed={failed} onRetry={onRetry} useOriginal={useOriginal} onClose={onClose} zap={zap} />
        {dial}
      </View>
    );
  }
  if (!waiting && !retrying) return null;
  return (
    <View pointerEvents="none" testID="player-status" style={{ alignItems: 'center', justifyContent: 'center', gap: look.size(14), maxWidth: look.size(440), marginHorizontal: 16 }}>
      <Spinner look={look} size={look.size(look.small ? 52 : 64)} label={retrying ? msg('player.retrying') : waitingLabel} />
      {retrying ? (
        <View accessibilityLiveRegion="polite" testID="player-retrying" style={{ alignItems: 'center', gap: look.size(6) }}>
          <Text style={look.text(16, 600, look.ink)}>{msg('player.retrying')}</Text>
          {retrying.message ? (
            <Text style={[look.text(13, 400, look.inkSecondary), { textAlign: 'center', lineHeight: look.size(20) }]}>{retrying.message}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function FailureCard({
  look,
  failed,
  onRetry,
  useOriginal,
  onClose,
  zap,
}: {
  look: PlayerLook;
  failed: Failed;
  onRetry(): void;
  useOriginal?: () => void;
  onClose(): void;
  zap?: (step: -1 | 1) => void;
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
      <PlayerIcon name={failed.unreleased ? 'clock' : 'alert'} size={look.size(26)} color={look.accent} />
      <Text accessibilityRole="header" style={[look.display(30), { textAlign: 'center' }]}>
        {msg(failed.unreleased ? 'release.notOutYet' : 'ui.playbackInterrupted')}
      </Text>
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
        {failed.unreleased ? null : <Pill look={look} label={msg('ui.tryAgain')} primary preferred onPress={onRetry} testID="player-retry" />}
        {useOriginal ? <Pill look={look} label={msg('player.streaming.useOriginal')} onPress={useOriginal} testID="player-use-original" /> : null}
        <Pill look={look} label={msg('ui.closePlayer')} preferred={failed.unreleased} onPress={onClose} testID="player-failure-close" />
      </View>
      {zap ? (
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: look.size(10) }}>
          <Pill look={look} icon="channelUp" label={msg('live.channelUp')} onPress={() => zap(-1)} testID="player-failure-channel-up" />
          <Pill look={look} icon="channelDown" label={msg('live.channelDown')} onPress={() => zap(1)} testID="player-failure-channel-down" />
        </View>
      ) : null}
    </View>
  );
}

interface PillProps {
  look: PlayerLook;
  label: string;
  /** An icon-only pill (the label is for screen readers). */
  icon?: PlayerIconName;
  primary?: boolean;
  preferred?: boolean;
  onPress(): void;
  testID: string;
}

function Pill({ look, label, icon, primary, preferred, onPress, testID }: PillProps) {
  const claim = useFocusClaim(preferred);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const filled = primary || (look.tv && focus);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hasTVPreferredFocus={claim}
      testID={testID}
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={{
        height: look.size(44),
        paddingHorizontal: look.size(icon ? 14 : 24),
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
      {icon ? (
        <PlayerIcon name={icon} size={look.size(20)} color={filled ? look.inkInverse : look.ink} />
      ) : (
        <Text style={look.text(14, 600, filled ? look.inkInverse : look.ink)}>{label}</Text>
      )}
    </Pressable>
  );
}

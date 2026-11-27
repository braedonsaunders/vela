// The guide header's preview tile: the ambient picture with its channel and an honest state.
// Pressing it opens full watch with the owned session; the speaker unmutes in place.
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { msg } from '@vela/core';
import type { LiveController } from './controller';
import type { GuideLook } from './look';
import { Glyph, Line, LiveBadge, Press } from './parts';
import { TilePicture } from './picture';
import type { TileView } from './tile';

interface TileProps {
  look: GuideLook;
  tile: TileView;
  channelName: string;
  height: number;
  width?: number;
  small: boolean;
  still: boolean;
  controller: LiveController;
}

export function GuideTile({ look, tile, channelName, height, width, small, still, controller }: TileProps) {
  const radius = small ? 10 : look.radiusTile;
  // Keep the video at 16:9 and crop it in the wide, shallow phone tile.
  const pictureHeight = width === undefined ? height : width * 9 / 16;
  return (
    <View
      style={{
        position: 'relative',
        height,
        ...(width === undefined ? { aspectRatio: 16 / 9 } : { width }),
        borderRadius: radius,
        overflow: 'hidden',
        backgroundColor: look.media,
        borderWidth: 1,
        borderColor: look.edgeStrong,
        boxShadow: `0px 18px 50px ${look.shadow}`,
      }}
    >
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: (height - pictureHeight) / 2, height: pictureHeight }}>
        <TilePicture />
      </View>
      {tile.state === 'connecting' ? <Tuning look={look} still={still} channelName={channelName} /> : null}
      <TileAction look={look} tile={tile} channelName={channelName} controller={controller} />
      <LinearGradient
        colors={['rgba(0, 0, 0, 0.85)', 'rgba(0, 0, 0, 0)']}
        style={[styles.top, { paddingVertical: small ? 5 : 8, paddingHorizontal: small ? 6 : 10 }]}
        pointerEvents="none"
      >
        <LiveBadge look={look} size={width === undefined ? 12 : 11} />
        {!small ? (
          <Line
            look={look}
            size={12}
            weight={650}
            style={{ flexShrink: 1, textShadowColor: look.shadow, textShadowRadius: 4 }}
          >
            {channelName}
          </Line>
        ) : null}
      </LinearGradient>
      {tile.state === 'playing' ? (
        <Speaker look={look} muted={tile.muted} small={small} onPress={() => controller.toggleMute()} />
      ) : null}
    </View>
  );
}

/** The whole tile's press: try the stop again, tune in, or open full watch. */
function TileAction({
  look,
  tile,
  channelName,
  controller,
}: {
  look: GuideLook;
  tile: TileView;
  channelName: string;
  controller: LiveController;
}) {
  const inset = (focused: boolean) => (focused ? `inset 0px 0px 0px 2px ${look.accent}` : undefined);
  if (tile.state === 'stuck' || tile.state === 'unavailable') {
    return (
      <Press
        label={msg('live.previewStuck')}
        onPress={() => controller.retryPreview()}
        style={({ hovered, focused }) => [
          StyleSheet.absoluteFill,
          styles.centre,
          { gap: 4, padding: 10, backgroundColor: hovered ? look.scrimSoft : look.scrimMid, boxShadow: inset(focused) },
        ]}
      >
        <Line look={look} size={12} color={look.inkSecondary} lines={2} style={{ textAlign: 'center' }}>
          {msg('live.previewStuck')}
        </Line>
        <Line look={look} size={12} weight={650}>
          {msg('ui.tryAgain')}
        </Line>
      </Press>
    );
  }
  if (tile.state === 'tune-in') {
    return (
      <Press
        label={msg('live.tuneInTo', { channel: channelName })}
        onPress={() => controller.tuneIn()}
        style={({ hovered, focused }) => [
          StyleSheet.absoluteFill,
          styles.centre,
          {
            flexDirection: 'row',
            gap: 8,
            backgroundColor: hovered ? look.scrimSoft : look.scrimMid,
            boxShadow: inset(focused),
          },
        ]}
      >
        <Glyph name="play-fill" size={12} color={look.ink} />
        <Line look={look} size={13} weight={650}>
          {msg('live.tuneIn')}
        </Line>
      </Press>
    );
  }
  return (
    <Press
      label={msg('ui.watchChannel', { channel: channelName })}
      onPress={() => controller.watch(tile.channelId)}
      testID="guide-tile"
      style={({ hovered, focused }) => [
        StyleSheet.absoluteFill,
        { backgroundColor: hovered ? look.scrimSoft : 'transparent', boxShadow: inset(focused) },
      ]}
    >
      {null}
    </Press>
  );
}

function Tuning({ look, still, channelName }: { look: GuideLook; still: boolean; channelName: string }) {
  const turn = useSharedValue(0);
  useEffect(() => {
    if (still) return;
    turn.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(turn);
  }, [still, turn]);
  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value * 360}deg` }] }));
  return (
    <View
      style={[StyleSheet.absoluteFill, styles.centre]}
      pointerEvents="none"
      accessibilityRole="progressbar"
      accessibilityLabel={msg('live.tuning', { channel: channelName })}
    >
      <Animated.View
        style={[
          {
            width: 18,
            height: 18,
            borderRadius: 9,
            borderWidth: 2,
            borderColor: look.trackStrong,
            borderTopColor: look.accent,
          },
          spin,
        ]}
      />
    </View>
  );
}

function Speaker({
  look,
  muted,
  small,
  onPress,
}: {
  look: GuideLook;
  muted: boolean;
  small: boolean;
  onPress(): void;
}) {
  const size = small ? 26 : 30;
  return (
    <Press
      label={muted ? msg('live.unmutePreview') : msg('live.mutePreview')}
      selected={!muted}
      role="button"
      toggled={!muted}
      onPress={onPress}
      style={({ hovered, focused }) => ({
        position: 'absolute',
        right: small ? 4 : 8,
        bottom: small ? 4 : 8,
        width: size,
        height: size,
        padding: small ? 6 : 7,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: look.edge,
        backgroundColor: hovered ? look.controlHover : look.glass,
        boxShadow: focused ? `0px 0px 0px 2px ${look.accent}` : undefined,
      })}
    >
      <Glyph name={muted ? 'speaker-mute' : 'speaker'} size={size - (small ? 12 : 14)} color={look.ink} />
    </Press>
  );
}

const styles = StyleSheet.create({
  centre: { alignItems: 'center', justifyContent: 'center' },
  top: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', gap: 6, alignItems: 'center' },
});

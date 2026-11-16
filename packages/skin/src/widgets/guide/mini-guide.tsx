// The in-player mini guide: while the viewer flicks channels in live watch, the channel being
// dialled between its neighbours, with what is on now and next. Pressing the card tunes it now.
import { View } from 'react-native';
import Animated, { FadeInLeft, FadeOutLeft } from 'react-native-reanimated';
import { msg, type GuideChannel } from '@vela/core';
import { useLiveContext, useLiveView } from './live';
import { useGuideLook, type GuideLook } from './look';
import { Line, LogoTile, Press, Progress } from './parts';

/** Drawn by the player chrome over live watch; it shows itself only while a channel is being dialled. */
export function MiniGuide({ playingId, small, still }: { playingId: string; small: boolean; still: boolean }) {
  const look = useGuideLook();
  const live = useLiveContext();
  const view = useLiveView();
  const channels = view.guide?.channels ?? [];
  if (!live || !view.watchZap || channels.length === 0) return null;
  const at = Math.max(
    0,
    channels.findIndex(c => c.id === view.watchZap),
  );
  const n = channels.length;
  const around = n < 3 ? channels : [channels[(at - 1 + n) % n]!, channels[at]!, channels[(at + 1) % n]!];
  return (
    <Animated.View
      entering={still ? undefined : FadeInLeft.duration(260)}
      exiting={still ? undefined : FadeOutLeft.duration(160)}
      accessibilityLabel={msg('live.channels')}
      accessibilityLiveRegion="polite"
      style={{ gap: 8, width: small ? '100%' : 400 }}
    >
      {around.map(c =>
        c.id === view.watchZap ? (
          <DialledCard
            key={c.id}
            look={look}
            channel={c}
            playing={c.id === playingId}
            onPress={() => live.controller.commitWatchZap()}
          />
        ) : (
          <Neighbour key={c.id} look={look} channel={c} />
        ),
      )}
    </Animated.View>
  );
}

function Neighbour({ look, channel: c }: { look: GuideLook; channel: GuideChannel }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        flexDirection: 'row',
        gap: 12,
        alignItems: 'center',
        paddingVertical: 9,
        paddingHorizontal: 14,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: look.hairline,
        backgroundColor: look.glass,
        opacity: 0.9,
      }}
    >
      <Line look={look} size={12} color={look.inkQuiet} tabular style={{ width: 40 }}>
        {c.number}
      </Line>
      <Line look={look} size={13} weight={600} color={look.inkSecondary} style={{ flex: 1, minWidth: 0 }}>
        {c.name}
      </Line>
      <Line look={look} size={12} color={look.inkQuiet} style={{ maxWidth: '50%' }}>
        {c.now || (c.listingsLoaded ? msg('live.noListings') : '')}
      </Line>
    </View>
  );
}

function DialledCard({
  look,
  channel: c,
  playing,
  onPress,
}: {
  look: GuideLook;
  channel: GuideChannel;
  playing: boolean;
  onPress(): void;
}) {
  const now = c.now || (!c.listingsLoaded ? '' : c.listed ? msg('live.nothingNow') : msg('live.noListings'));
  return (
    <Press
      label={msg('ui.watchChannel', { channel: c.name })}
      onPress={onPress}
      style={({ focused }) => ({
        flexDirection: 'row',
        gap: 14,
        alignItems: 'center',
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: look.liveEdge,
        backgroundColor: look.glass,
        boxShadow: focused
          ? `0px 0px 0px 2px ${look.accent}, 0px 24px 70px ${look.shadow}`
          : `0px 24px 70px ${look.shadow}`,
      })}
    >
      <LogoTile look={look} logo={c.logo} name={c.name} width={88} height={54} radius={10} size={16} />
      <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Line look={look} size={12} weight={650} color={look.accent} tabular>
            {c.number}
          </Line>
          <Line look={look} size={13} weight={600} color={look.inkSecondary} style={{ flexShrink: 1 }}>
            {c.name}
          </Line>
          {playing ? (
            <Line
              look={look}
              size={9}
              weight={650}
              color={look.inkQuiet}
              style={{ letterSpacing: 1.6, textTransform: 'uppercase' }}
            >
              {msg('live.watching')}
            </Line>
          ) : null}
        </View>
        <Line look={look} size={17} weight={650}>
          {now}
        </Line>
        {c.nowId ? (
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Progress look={look} percent={c.nowProgress} flex={1} />
            <Line look={look} size={11} color={look.inkQuiet} tabular>
              {c.nowRemaining}
            </Line>
          </View>
        ) : null}
        {c.nextLabel ? (
          <Line look={look} size={12} color={look.inkQuiet}>
            {c.nextLabel}
          </Line>
        ) : null}
      </View>
    </Press>
  );
}

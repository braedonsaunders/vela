// The guide's half-height header: the selected programme over its artwork, compact beside the
// live preview tile, with Watch, its times and how far it has run.
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { msg, type GuideChannel, type GuideProgramme } from '@vela/core';
import type { GuideLook } from './look';
import { Glyph, Line, LiveBadge, Press, Progress } from './parts';

interface HeroProps {
  look: GuideLook;
  channel: GuideChannel;
  programme: GuideProgramme | undefined;
  small: boolean;
  still: boolean;
  /** Room on the right for the tile. */
  inset: number;
  side: number;
  spacious?: boolean;
  copyTop?: number;
  compact?: boolean;
  onWatch(channelId: string): void;
}

export function GuideHero({ look, channel, programme, small, still, inset, side, onWatch, spacious = false, copyTop = 0, compact = false }: HeroProps) {
  const entering = still ? undefined : FadeIn.duration(420);
  return (
    <View style={StyleSheet.absoluteFill}>
      {programme ? (
        <HeroArt key={`art-${programme.id}`} look={look} programme={programme} small={small} still={still} />
      ) : null}
      <LinearGradient
        colors={[look.page, look.scrimMid, look.scrimClear]}
        locations={[0, 0.45, 1]}
        start={{ x: 0.5, y: 1 }}
        end={{ x: 0.5, y: 0 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <LinearGradient
        colors={[look.scrimDeep, look.scrimMid, look.scrimSoft]}
        locations={[0, 0.4, 1]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View
        style={{
          flex: 1,
          justifyContent: spacious && !compact ? 'center' : 'flex-end',
          paddingTop: copyTop,
          paddingLeft: side,
          paddingRight: inset,
          paddingBottom: small ? 12 : 8,
        }}
      >
        <Animated.View
          key={`copy-${programme?.id ?? channel.id}`}
          entering={entering}
          style={{ gap: small ? 4 : 3, minWidth: 0 }}
          accessibilityRole="summary"
          accessibilityLabel={msg('live.selectedProgramme')}
          accessibilityLiveRegion="polite"
        >
          {programme ? (
            <ProgrammeCopy look={look} channel={channel} programme={programme} small={small || compact} onWatch={onWatch} spacious={spacious} compact={compact} />
          ) : (
            <ChannelCopy look={look} channel={channel} small={small} onWatch={onWatch} />
          )}
        </Animated.View>
      </View>
    </View>
  );
}

function HeroArt({
  look,
  programme,
  small,
  still,
}: {
  look: GuideLook;
  programme: GuideProgramme;
  small: boolean;
  still: boolean;
}) {
  const glow = {
    position: 'absolute',
    left: '-8%',
    top: '-60%',
    width: '60%',
    height: '200%',
    opacity: 0.14,
    backgroundImage: `radial-gradient(closest-side, ${look.tone(programme.tone)} 0%, transparent 100%)`,
  } as unknown as ViewStyle;
  return (
    <Animated.View
      entering={still ? undefined : FadeIn.duration(520)}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
    >
      {programme.art ? (
        <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: small ? '100%' : '70%' }}>
          <Image
            source={{ uri: programme.art }}
            contentFit="cover"
            style={{ width: '100%', height: '100%', opacity: small ? 0.32 : 0.55 }}
          />
          <LinearGradient
            colors={[look.page, look.scrimClear]}
            locations={[0, 0.5]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        </View>
      ) : null}
      {programme.tone >= 0 ? <View style={glow} /> : null}
    </Animated.View>
  );
}

function Eyebrow({ look, children, size = 10 }: { look: GuideLook; children: string; size?: number }) {
  return (
    <Line
      look={look}
      size={size}
      weight={650}
      color={look.inkSecondary}
      style={{ letterSpacing: size * 0.18, textTransform: 'uppercase', flexShrink: 1 }}
    >
      {children}
    </Line>
  );
}

function WatchPill({
  look,
  label,
  onPress,
  testID,
}: {
  look: GuideLook;
  label: string;
  onPress(): void;
  testID?: string;
}) {
  return (
    <Press
      label={label}
      onPress={onPress}
      testID={testID}
      style={({ hovered, focused, pressed }) => ({
        flexDirection: 'row',
        gap: 8,
        alignItems: 'center',
        height: 30,
        paddingLeft: 14,
        paddingRight: 16,
        flexShrink: 0,
        borderRadius: look.radiusControl,
        backgroundColor: hovered || focused ? look.ink : look.accent,
        transform: [{ scale: pressed ? 0.97 : 1 }],
        boxShadow: focused ? `0px 0px 0px 2px ${look.page}, 0px 0px 0px 4px ${look.accent}` : undefined,
      })}
    >
      <Glyph name="play-fill" size={13} color={look.onAccent} />
      <Line look={look} size={13} weight={650} color={look.onAccent}>
        {label}
      </Line>
    </Press>
  );
}

function ProgrammeCopy({
  look,
  channel,
  programme,
  small,
  onWatch,
  spacious,
  compact,
}: {
  spacious: boolean;
  compact: boolean;
  look: GuideLook;
  channel: GuideChannel;
  programme: GuideProgramme;
  small: boolean;
  onWatch(id: string): void;
}) {
  const times = msg('ui.startEnd', { start: programme.startLabel, end: programme.endLabel });
  const watchLabel = programme.airing ? msg('live.watch') : msg('ui.watchChannel', { channel: channel.name });
  return (
    <>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', minWidth: 0 }}>
        {programme.airing ? <LiveBadge look={look} /> : null}
        <Eyebrow look={look}>{`${channel.number} · ${channel.name}`}</Eyebrow>
        {programme.genre && !small ? (
          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', flexShrink: 0 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: look.tone(programme.tone) }} />
            <Line look={look} size={12} color={look.inkSecondary}>
              {programme.genre}
            </Line>
          </View>
        ) : null}
      </View>
      <Line
        look={look}
        size={compact ? 20 : spacious ? 32 : small ? 24 : 26}
        style={[
          look.display(),
          { textShadowColor: look.shadow, textShadowRadius: 40, textShadowOffset: { width: 0, height: 4 } },
        ]}
      >
        {programme.name}
      </Line>
      <View style={{ flexDirection: 'row', flexWrap: spacious ? 'wrap' : 'nowrap', gap: compact ? 4 : 12, alignItems: 'center', minWidth: 0 }}>
        {!small ? (
          <WatchPill look={look} label={watchLabel} onPress={() => onWatch(channel.id)} testID="guide-watch" />
        ) : null}
        <Line look={look} size={13} weight={600} tabular>
          {times}
        </Line>
        {programme.airing && !compact ? (
          <>
            <Progress look={look} percent={programme.progress} width={small ? 48 : 120} color={look.accent} />
            <Line look={look} size={12} color={look.accent} tabular>
              {programme.remainingLabel}
            </Line>
          </>
        ) : (
          <Line look={look} size={12} color={look.inkSecondary}>
            {programme.ended ? msg('live.ended') : programme.startsLabel}
          </Line>
        )}
        {programme.episode && (!small || spacious) ? (
          <Line look={look} size={12} color={look.inkSecondary} style={{ flexShrink: 1, minWidth: 0 }}>
            {programme.episode}
          </Line>
        ) : null}
        {programme.rating && !small ? (
          <View
            style={{
              paddingVertical: 2,
              paddingHorizontal: 6,
              borderRadius: 4,
              borderWidth: 1,
              borderColor: look.edgeStrong,
              flexShrink: 0,
            }}
          >
            <Line look={look} size={10} weight={700} color={look.inkSecondary} style={{ letterSpacing: 0.6 }}>
              {programme.rating}
            </Line>
          </View>
        ) : null}
      </View>
      {spacious && !compact && programme.summary ? (
        <Line look={look} size={14} color={look.inkSecondary} lines={3} style={{ marginTop: 8, lineHeight: 22 }}>
          {programme.summary}
        </Line>
      ) : null}
    </>
  );
}

function ChannelCopy({
  look,
  channel,
  small,
  onWatch,
}: {
  look: GuideLook;
  channel: GuideChannel;
  small: boolean;
  onWatch(id: string): void;
}) {
  return (
    <>
      <Eyebrow look={look}>{channel.number}</Eyebrow>
      <Line look={look} size={small ? 24 : 26} style={look.display()}>
        {channel.name}
      </Line>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        {!small ? <WatchPill look={look} label={msg('live.watch')} onPress={() => onWatch(channel.id)} /> : null}
        <Line look={look} size={13} color={look.inkSecondary}>
          {!channel.listingsLoaded ? '' : channel.listed ? msg('live.nothingNow') : msg('live.noListings')}
        </Line>
      </View>
    </>
  );
}

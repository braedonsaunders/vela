// The `player` layout block (`docs/plugin-screens.md` §6): renders a muted live preview of a channel
// (`channel` template yielding `channel:<id>` or `<id>`) inside a screen page, reusing the guide's
// `TilePicture` and `LiveContext`.
// - At most one `player` block is active per page.
// - ALWAYS MUTED in preview: never emits audio on its own.
// - Pressing the preview dispatches `play` `channel:<id>` to tune into full-screen playback.
import { useCallback, useEffect, useId, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useHost } from '../host';
import { SYMBOLS } from '../icons';
import { fill, type Template } from '../resolve';
import type { Ctx } from '../vocabulary';
import { useLiveContext, useLiveView } from '../widgets/guide/live';
import { TilePicture } from '../widgets/guide/picture';
import { stripRecordPrefix } from './action-validation';
import { alpha, useBlockLook } from './look';
import type { PlayerBlockNode } from './types';

// Tracks the single claimed `player` block instance per page key so at most one plays per page.
const activePagePlayer = new Map<string, string>();

export function PlayerBlock({ node, ctx }: { node: PlayerBlockNode; ctx: Ctx }) {
  const host = useHost();
  const look = useBlockLook();
  const live = useLiveContext();
  const liveView = useLiveView(false);
  const { px } = look;
  const instanceId = useId();
  const [focused, setFocused] = useState(false);

  const rawChannel = fill(node.channel as Template, ctx, host.env).trim();
  const channelId = stripRecordPrefix(rawChannel, 'channel');
  const pageKey = ctx.screen?.page.key ?? '__default__';

  const [claimed, setClaimed] = useState(() => {
    const existing = activePagePlayer.get(pageKey);
    if (!existing || existing === instanceId) {
      activePagePlayer.set(pageKey, instanceId);
      return true;
    }
    return false;
  });

  useEffect(() => {
    const existing = activePagePlayer.get(pageKey);
    if (!existing || existing === instanceId) {
      activePagePlayer.set(pageKey, instanceId);
      setClaimed(true);
    } else {
      setClaimed(false);
    }
    return () => {
      if (activePagePlayer.get(pageKey) === instanceId) {
        activePagePlayer.delete(pageKey);
      }
    };
  }, [pageKey, instanceId]);

  const onTune = useCallback(() => {
    if (!channelId) return;
    host.dispatch('play', `channel:${channelId}`);
  }, [host, channelId]);

  if (!channelId || !claimed) return null;

  const channelEntry = ctx.screen?.record(`channel:${channelId}`);
  const channelRecord =
    channelEntry?.value && typeof channelEntry.value === 'object'
      ? (channelEntry.value as Record<string, unknown>)
      : undefined;
  const guideChannel = liveView.guide?.channels.find(c => c.id === channelId);
  const channelName = (typeof channelRecord?.name === 'string' && channelRecord.name) || guideChannel?.name || channelId;
  const channelNumber = (typeof channelRecord?.number === 'string' && channelRecord.number) || guideChannel?.number || '';

  const label = node.label
    ? fill(node.label as Template, ctx, host.env).trim()
    : channelNumber
      ? `${channelName} · ${channelNumber}`
      : channelName;

  const playPaths = SYMBOLS['play-fill']?.paths ?? [];

  return (
    <Pressable
      onPress={onTune}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        aspectRatio: 16 / 9,
        width: '100%',
        borderRadius: px(16),
        overflow: 'hidden',
        backgroundColor: '#000',
        borderWidth: focused ? 2 : 1,
        borderColor: focused ? look.ink : look.cardEdge,
      }}
    >
      {/* Always muted in preview — never emits audio from a screen page */}
      {live ? <TilePicture /> : null}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: px(14),
          right: px(14),
          bottom: px(12),
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: px(7),
            paddingVertical: px(5),
            paddingHorizontal: px(10),
            borderRadius: px(999),
            backgroundColor: alpha('#090b0e', 0.78),
          }}
        >
          <View style={{ width: px(6), height: px(6), borderRadius: px(3), backgroundColor: look.live }} />
          <Text
            numberOfLines={1}
            style={{
              ...look.face(700),
              fontSize: px(12),
              color: '#f5f1e9',
            }}
          >
            {channelNumber ? `${channelName} · ${channelNumber}` : channelName}
          </Text>
        </View>
        <View
          style={{
            width: px(32),
            height: px(32),
            borderRadius: px(16),
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: alpha('#090b0e', 0.78),
          }}
        >
          <Svg width={px(14)} height={px(14)} viewBox="0 0 24 24">
            {playPaths.map((d, i) => (
              <Path key={i} d={d} fill="#f5f1e9" />
            ))}
          </Svg>
        </View>
      </View>
    </Pressable>
  );
}

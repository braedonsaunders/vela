// The `player` layout block (`docs/plugin-screens.md` §6): renders a muted live preview of a channel
// (`channel` template yielding `channel:<id>` or `<id>`) inside a screen page, reusing the guide's
// `TilePicture` and `LiveContext`.
// - At most one `player` block is active per page.
// - ALWAYS MUTED in preview (`muted: true`): never emits audio on its own.
// - Pressing the preview dispatches `play` `{ channel }` to tune into full-screen playback.
import { useCallback, useEffect, useId, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useHost } from '../host';
import { IconGlyph } from '../icons';
import { fill, type Template } from '../resolve';
import type { Ctx } from '../vocabulary';
import { useLiveContext } from '../widgets/guide/context';
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
  const { px } = look;
  const instanceId = useId();
  const [focused, setFocused] = useState(false);

  const rawChannel = fill(node.channel as Template, ctx, host.env).trim();
  const channelId = stripRecordPrefix(rawChannel, 'channel');
  const pageKey = (ctx as { screen?: { page?: { key?: string } } }).screen?.page?.key ?? '__default__';

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
    host.dispatch('play', channelId, { args: { channel: `channel:${channelId}` } } as never);
  }, [host, channelId]);

  if (!channelId || !claimed) return null;

  const channelRecord = (
    ctx as { screen?: { record?: (k: string) => { data?: Record<string, unknown> } | undefined } }
  ).screen?.record?.(`channel:${channelId}`)?.data;

  const guideChannel = live?.channels.find(c => c.id === channelId);
  const channelName = (typeof channelRecord?.name === 'string' && channelRecord.name) || guideChannel?.name || channelId;
  const channelNumber = (typeof channelRecord?.number === 'string' && channelRecord.number) || guideChannel?.number || '';
  const channelLogo = (typeof channelRecord?.logo === 'string' && channelRecord.logo) || guideChannel?.logo || '';
  const backdrop = guideChannel?.now?.backdrop || '';
  const stream = live?.tileStream?.(channelId) ?? null;

  const label = node.label
    ? fill(node.label as Template, ctx, host.env).trim()
    : channelNumber
      ? `${channelName} · ${channelNumber}`
      : channelName;

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
      <TilePicture
        stream={stream}
        backdrop={backdrop}
        logo={channelLogo}
        name={channelName}
        ink={look.ink}
        muted
      />
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
          <IconGlyph name="play-fill" size={px(14)} color="#f5f1e9" />
        </View>
      </View>
    </Pressable>
  );
}

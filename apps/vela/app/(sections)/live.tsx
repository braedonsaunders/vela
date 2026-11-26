// The Live TV route: the channel guide in the active document's shell. While this screen is the
// focused route the guide holds Live TV open (clock, listings and the one preview tile); pushing
// full watch over it or leaving releases the tile. A search hand-off (`?ch=&prog=&at=`) opens
// the guide on that programme's day, channel and time.
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { Platform, Text, View, type TextStyle } from 'react-native';
import { guideFocus, msg } from '@vela/core';
import { Guide, useLiveContext, useLiveSurface, useLiveView, type GuideFocus } from '@vela/skin/src/widgets/guide';
import { useVela } from '../../src/vela';
import { useSectionFocus } from '../../src/section-focus';

export default function Live() {
  const { ch = '', prog = '', at = '' } = useLocalSearchParams<{ ch?: string; prog?: string; at?: string }>();
  const vela = useVela();
  const host = vela.host('live', 'live');
  const active = useSectionFocus() ?? false;
  useLiveSurface('guide', active);
  const focus = useHandOff(ch, prog, at);
  if (!host) return <View style={{ flex: 1 }} />;
  // The page's own heading: the guide's programme titles are the headings below it.
  return <View style={{ flex: 1 }}>
    {Platform.OS === 'web' && <Text accessibilityRole="header" {...{ 'aria-level': 1 }} style={VISUALLY_HIDDEN}>{msg('ui.live')}</Text>}
    <Guide focus={focus} active={active} />
  </View>;
}

/** A hand-off's channel and minute, once its day is the one the guide shows. */
function useHandOff(channelId: string, programmeId: string, at: string): GuideFocus | undefined {
  const live = useLiveContext();
  const { day } = useLiveView();
  const archiveDays = live?.controller.catchUpOffer.maxDays ?? 0;
  const place = useMemo(() => (at ? guideFocus(at, Date.now(), undefined, archiveDays) : null), [at, archiveDays]);
  useEffect(() => {
    if (live && place && place.available) live.controller.chooseDay(place.day);
  }, [live, place]);
  if (!channelId) return undefined;
  if (place && (!place.available || place.day !== day)) return undefined;
  return { channelId, programmeId, minute: place ? place.minute : -1 };
}

const VISUALLY_HIDDEN = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0, pointerEvents: 'none' } as TextStyle;

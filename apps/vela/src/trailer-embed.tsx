// A trailer played in YouTube's privacy-enhanced embed (features.trailerEmbed): the watch route's surface
// for an extra whose detail carries an embed on this device. The player sits 16:9 in the screen under a
// bar with Close; Close, Back (and Escape on the web) leave as the watch route does. When the embed
// reports an error, refuses to embed, never answers or cannot load, the server-played extra takes over
// (onFallback); when the server cannot play it (availability unavailable), the surface says the trailer
// cannot play right now, with no spinner and no server start. The end of the trailer closes it.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  EMBED_LISTENING, EMBED_START_TIMEOUT_MS, embedOutcome, embedPlayerUrl, msg, nativeEmbedHostOrigin, nativeEmbedPage, nextEmbedPhase,
  parseEmbedMessage, type EmbedPhase, type Extra,
} from '@vela/core';
import { VelaEmbedView } from '@vela/player';
import { PlayerIcon } from '@vela/skin/src/widgets/player/icons';
import { trailerEmbedOrigin } from './trailer-embed-origin';

const BAR = 56;

/** The extra a title page on hand offers with an embed, by id (any title read this session). */
export function embeddedExtra(titles: Record<string, { value?: { extras: Extra[] } } | undefined>, id: string): Extra | undefined {
  for (const known of Object.values(titles)) {
    const extra = known?.value?.extras.find(item => item.id === id);
    if (extra) return extra.embed ? extra : undefined;
  }
  return undefined;
}

/** The largest 16:9 box inside the area. */
export function sixteenByNine(width: number, height: number): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const fitted = Math.min(width, height * 16 / 9);
  return { width: Math.floor(fitted), height: Math.floor(fitted * 9 / 16) };
}

interface Props {
  extra: Extra & { embed: NonNullable<Extra['embed']> };
  close(): void;
  /** The embed failed and the server can play the extra instead. */
  onFallback(): void;
}

export function TrailerEmbedWatch({ extra, close, onFallback }: Props) {
  const { embed } = extra;
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<EmbedPhase>('starting');
  const [area, setArea] = useState({ width: 0, height: 0 });
  const source = useMemo(() => {
    const embedOrigin = trailerEmbedOrigin();
    if (Platform.OS === 'web') {
      return { playerUrl: embedPlayerUrl(embed, window.location.origin, embedOrigin), page: '', pageOrigin: '' };
    }
    const pageOrigin = nativeEmbedHostOrigin(embedOrigin);
    const playerUrl = embedPlayerUrl(embed, pageOrigin, embedOrigin);
    return { playerUrl, page: nativeEmbedPage(playerUrl), pageOrigin };
    // The same video keeps its player when the title is read again.
  }, [embed.videoId]);

  const onMessage = useCallback((data: string) => {
    const signal = parseEmbedMessage(data);
    if (signal) setPhase(current => nextEmbedPhase(current, signal));
  }, []);
  const onFailure = useCallback(() => setPhase(current => current === 'ended' ? current : 'failed'), []);

  // A player that never answers is as good as refused.
  useEffect(() => {
    if (phase !== 'starting') return;
    const timer = setTimeout(() => setPhase(current => current === 'starting' ? 'failed' : current), EMBED_START_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  const fallback = useRef(onFallback);
  fallback.current = onFallback;
  const leave = useRef(close);
  leave.current = close;
  const outcome = embedOutcome(phase, embed.fallback);
  useEffect(() => {
    if (outcome === 'server') fallback.current();
    if (outcome === 'close') leave.current();
  }, [outcome]);

  // Escape leaves on the web while focus is on the page (the player's own frame keeps its keys).
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') leave.current(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setArea(current => current.width === width && current.height === height ? current : { width, height });
  };
  const box = sixteenByNine(area.width, area.height);
  const label = msg('trailer.embedLabel', { name: extra.name });
  return (
    <View
      style={[styles.stage, { paddingTop: insets.top, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right }]}
      testID="trailer-embed"
      {...(Platform.OS === 'web' ? { dataSet: { embedState: phase } } : {})}
    >
      <View style={styles.bar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={msg('ui.closePlayer')}
          onPress={close}
          hitSlop={8}
          style={({ pressed }) => [styles.close, pressed && styles.pressed]}
          testID="trailer-embed-close"
        >
          <PlayerIcon name="back" size={24} color="#fff" />
        </Pressable>
        <Text numberOfLines={1} style={styles.title} testID="trailer-embed-title">{extra.name}</Text>
      </View>
      <View style={styles.area} onLayout={onLayout}>
        {outcome === 'unavailable' ? (
          <Text style={styles.message} accessibilityRole="alert" testID="trailer-embed-unavailable">{msg('trailer.embedUnavailable')}</Text>
        ) : outcome !== 'embed' ? null : box.width > 0 ? (
          <VelaEmbedView
            playerUrl={source.playerUrl}
            handshake={EMBED_LISTENING}
            page={source.page}
            pageOrigin={source.pageOrigin}
            onMessage={onMessage}
            onFailure={onFailure}
            accessibilityLabel={label}
            testID="trailer-embed-player"
            style={{ width: box.width, height: box.height }}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, backgroundColor: '#000' },
  bar: { height: BAR, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12 },
  close: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  pressed: { backgroundColor: 'rgba(255,255,255,0.24)' },
  title: { flex: 1, minWidth: 0, color: '#fff', fontSize: 17, fontWeight: '600' },
  area: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  message: { color: 'rgba(255,255,255,0.8)', fontSize: 16, textAlign: 'center', paddingHorizontal: 24 },
});

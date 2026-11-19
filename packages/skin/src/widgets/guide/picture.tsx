// Keep the outgoing decoder paused on its last frame until the incoming picture is ready.
// The controller still owns/stops server sessions; these layers own only presentation.
import { memo, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import type { PlaybackPlan, Command } from '@vela/player-api';
import { PreviewMuteCommands } from './preview-command';
import type { WidgetProps } from '../../host';
import { useHost } from '../../host';
import { useLiveContext, useLiveTile } from './live';

type Picture = { key: number; plan: PlaybackPlan };
const freeze: Command = { id: Number.MAX_SAFE_INTEGER, type: 'pause' };

export const TilePicture = memo(function TilePicture() {
  const live = useLiveContext();
  const tile = useLiveTile();
  const { env } = useHost();
  const sequence = useRef(0);
  const displayed = useRef<number | undefined>(undefined);
  const [readyKey, setReadyKey] = useState<number>();
  const [pictures, setPictures] = useState<Picture[]>([]);
  const [wasFullscreen, setWasFullscreen] = useState(tile.fullscreen);
  const incoming = pictures.at(-1);
  // Preserve the mounted outgoing view through the plan-less tune interval and full screen.
  // A fresh view on return cannot inherit a paused decoder/consumed command id.
  if (wasFullscreen !== tile.fullscreen) {
    setWasFullscreen(tile.fullscreen);
    if (!tile.fullscreen && tile.plan) setPictures(old => [...old.filter(p => p.key === displayed.current).slice(-1), { key: ++sequence.current, plan: tile.plan! }]);
  } else if (!tile.fullscreen && tile.plan && incoming?.plan.sessionId !== tile.plan.sessionId) {
    setPictures(old => [...old.filter(p => p.key === displayed.current).slice(-1), { key: ++sequence.current, plan: tile.plan! }]);
  }
  const commands = useRef(new PreviewMuteCommands()).current;
  const command = commands.next(tile.command?.id, tile.muted, false);
  const Player = live?.Player;
  const showing = tile.state === 'connecting' || tile.state === 'playing' || tile.fullscreen;
  if (!live || !Player || !showing) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {pictures.map((picture, index) => {
        const active = !tile.fullscreen && picture.plan.sessionId === tile.plan?.sessionId && index === pictures.length - 1;
        return <PictureLayer key={picture.key} ready={active && readyKey === picture.key} still={env.still}
          onRevealed={() => { if (sequence.current !== picture.key) return; displayed.current = picture.key; setPictures(old => old.at(-1)?.key === picture.key ? [old[old.length - 1]!] : old); }}>
          <Player plan={active ? tile.plan! : picture.plan} command={active ? command : freeze} ambient
            onSnapshot={active ? snapshot => {
              if (snapshot.sessionId !== picture.plan.sessionId) return;
              if (snapshot.state === 'playing' && !snapshot.waiting && snapshot.totalFrames !== 0) setReadyKey(picture.key);
              live.controller.tileSnapshot(snapshot);
            } : undefined}
            onError={active ? () => live.controller.tileFailed(picture.plan.sessionId) : undefined}
            style={StyleSheet.absoluteFill} />
        </PictureLayer>;
      })}
    </View>
  );
});

function PictureLayer({ ready, still, onRevealed, children }: {
  ready: boolean; still: boolean; onRevealed(): void; children: React.ReactNode;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const revealed = useRef(false);
  useEffect(() => () => opacity.stopAnimation(), [opacity]);
  const done = useRef(onRevealed); done.current = onRevealed;
  useEffect(() => {
    if (!ready || revealed.current) return;
    revealed.current = true;
    const animation = Animated.timing(opacity, { toValue: 1, duration: still ? 0 : 200, useNativeDriver: true });
    animation.start(({ finished }) => { if (finished) done.current(); });
  }, [ready, still, opacity]);
  return <Animated.View style={[StyleSheet.absoluteFill, { opacity }]}>{children}</Animated.View>;
}

export function LiveTileWidget(_: WidgetProps) {
  return <View style={StyleSheet.absoluteFill} pointerEvents="none"><TilePicture /></View>;
}

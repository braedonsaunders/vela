// The preview tile's picture: the one ambient session, drawn by the app's player view, filling
// its box. The `liveTile` widget is this picture alone; a document draws every state, bug and
// caption over it from `tile.*` (docs/skin-schema.md).
import { memo, useRef } from 'react';
import { PreviewMuteCommands } from './preview-command';
import { StyleSheet, View } from 'react-native';
import type { WidgetProps } from '../../host';
import { useLiveContext, useLiveTile } from './live';

export const TilePicture = memo(function TilePicture({ suppressed = false }: { suppressed?: boolean }) {
  const live = useLiveContext();
  const tile = useLiveTile();
  const commands = useRef(new PreviewMuteCommands()).current;
  const command = commands.next(tile.command?.id, tile.muted, suppressed);
  const Player = live?.Player;
  const showing = !tile.fullscreen && tile.plan !== null && (tile.state === 'connecting' || tile.state === 'playing');
  if (!live || !Player || !showing || !tile.plan) return null;
  const controller = live.controller;
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Player
        key={tile.plan.sessionId}
        plan={tile.plan}
        command={command}
        ambient
        onSnapshot={snapshot => controller.tileSnapshot(snapshot)}
        onError={() => controller.tileFailed()}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
});

/** Widget `liveTile`: the monitor's picture on a live home. The home screen holds the tile while it
 * is the visible route without a query (useLiveSurface('home', …)); the widget only draws it. */
export function LiveTileWidget(_: WidgetProps) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <TilePicture />
    </View>
  );
}

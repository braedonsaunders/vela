import { useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { thumbnails } from '../../../../packages/visualizer/thumbnails';
import { currentInQueue, msg } from '@vela/core';
import { useVelaState } from '@vela/core/react';
import { focusElement, focusTarget } from '@vela/skin/src/escape';
import { hexColour, parseColour } from '@vela/skin/src/screen/colour';
import { FocusPressable } from '@vela/skin/src/focus';
import { useHost } from '@vela/skin/src/host';
import { useInteraction } from '@vela/skin/src/widgets/common/controls';
import { useLook } from '@vela/skin/src/widgets/common/look';
import { pressed, useRemote } from '@vela/skin/src/widgets/player/remote';
import { reportUnavailable, useCanVisualize } from './availability';
import { VisualizerPartsContext } from './parts';
import { adjacentScene, scenes, visualizerProfile } from './selection';
import { getVisualizerScene, setVisualizerScene, subscribeVisualizerScene } from './setting';
import { VisualizerStage } from './stage';
import type { VisualizerMode } from './stage-types';

function paletteColor(value?: string) {
  const color = value ? parseColour(value) : undefined;
  return color && color.a > 0 ? hexColour({ ...color, a: 1 }) : undefined;
}

function subscribeForeground(update: () => void) {
  const subscription = AppState.addEventListener('change', update);
  if (Platform.OS === 'web') document.addEventListener('visibilitychange', update);
  return () => {
    subscription.remove();
    if (Platform.OS === 'web') document.removeEventListener('visibilitychange', update);
  };
}
function foreground() {
  return Platform.OS === 'web' ? !document.hidden : AppState.currentState === 'active';
}

function SceneButton({ id, label, image, selected, onPress }: {
  id: string; label: string; image: number; selected: boolean; onPress(): void;
}) {
  const look = useLook();
  const parts = useContext(VisualizerPartsContext);
  const { state, handlers } = useInteraction();
  return (
    <FocusPressable {...handlers} testID={id} nativeID={id} ref={focusTarget(id)} accessibilityRole="radio"
      accessibilityState={{ checked: selected }} {...(Platform.OS === 'web' ? { 'aria-checked': selected } : {})} onPress={onPress}
      style={[{ borderRadius: 14, padding: 4, width: 138, justifyContent: 'center',
        borderWidth: 2, borderColor: state.focus ? look.ui.ink : 'transparent',
        backgroundColor: selected ? look.ui.accent : state.hover || state.focus ? look.ui.controlHover : look.ui.popover }, parts['visualizer.sceneChip'], selected && parts['visualizer.sceneChipActive']]}>
      <Image source={image} contentFit="cover" accessible={false} style={{ width: '100%', height: 64, borderRadius: 9 }} />
      <Text numberOfLines={1} style={[look.text({ color: selected ? '$ui.page' : '$ui.ink', 'font-size': '14px', 'font-weight': '600' }),
        { paddingHorizontal: 4, paddingVertical: 6 }]}>{label}</Text>
    </FocusPressable>
  );
}

function ScenePicker({ id, choose, expanded, setExpanded }: {
  id: string; choose(id: string): void; expanded: boolean; setExpanded(open: boolean): void;
}) {
  const look = useLook();
  const { viewport } = useHost();
  const parts = useContext(VisualizerPartsContext);
  const stageFocused = useRef(false);
  const selected = scenes.find(scene => scene.id === id)!;
  const toggle = 'visualizer-picker-toggle';
  useEffect(() => {
    if (Platform.OS !== 'web' && !Platform.isTV) return;
    const frame = requestAnimationFrame(() => focusElement(expanded ? 'visualizer-scene-' + id : toggle));
    return () => cancelAnimationFrame(frame);
  }, [expanded]); // Focus follows entry into the picker, not every scene change.
  const step = (direction: -1 | 1) => choose(adjacentScene(id, direction));
  useRemote(event => {
    if (!expanded && stageFocused.current && pressed(event)) {
      if (event.eventType === 'left') step(-1);
      if (event.eventType === 'right') step(1);
    }
  });
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const direction = event.key === 'ArrowLeft' ? -1 : 1;
      if (expanded) {
        const focused = document.activeElement?.getAttribute('data-testid');
        if (!focused?.startsWith('visualizer-scene-')) return;
        focusElement('visualizer-scene-' + adjacentScene(focused.slice('visualizer-scene-'.length), direction));
      } else if (stageFocused.current) step(direction);
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded, id, choose]);
  const { state, handlers } = useInteraction();
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: viewport.insets.left + 20, right: viewport.insets.right + 20,
      bottom: viewport.insets.bottom + 20, alignItems: 'flex-start', gap: 8 }}>
      {expanded ? (
        <ScrollView accessibilityRole="radiogroup" accessibilityLabel={msg('visualizer.scenes')} nativeID="visualizer.scenePicker" testID="visualizer-picker" horizontal keyboardShouldPersistTaps="handled"
          style={[{ maxWidth: '100%', borderRadius: 26, backgroundColor: look.ui.popover }, parts['visualizer.scenePicker']]} contentContainerStyle={{ gap: 6, padding: 6 }}>
          {scenes.map(scene => <SceneButton key={scene.id} id={'visualizer-scene-' + scene.id}
            label={scene.name} image={thumbnails[scene.id]!} selected={scene.id === id}
            onPress={() => { choose(scene.id); setExpanded(false); }} />)}
        </ScrollView>
      ) : null}
      <FocusPressable {...handlers} nativeID={toggle} testID={toggle} ref={focusTarget(toggle)}
        onFocus={() => { handlers.onFocus(); stageFocused.current = true; }}
        onBlur={() => { handlers.onBlur(); stageFocused.current = false; }}
        accessibilityRole="button" accessibilityLabel={msg('visualizer.pick', { scene: selected.name })}
        accessibilityState={{ expanded }} {...(Platform.OS === 'web' ? { 'aria-expanded': expanded } : {})} onPress={() => setExpanded(!expanded)}
        style={{ borderRadius: 18, paddingHorizontal: 18, paddingVertical: 10, borderWidth: 2,
          borderColor: state.focus ? look.ui.ink : 'transparent', backgroundColor: look.ui.popover }}>
        <Text style={look.text({ color: '$ui.inkSecondary', 'font-size': '12px' })}>{msg('visualizer.scenes')}</Text>
        <Text nativeID="visualizer.caption" testID="visualizer-caption" accessibilityLiveRegion="polite"
          style={[look.text({ color: '$ui.ink', 'font-family': '$ui.fontDisplay', 'font-size': '19px' }), parts['visualizer.caption']]}>{selected.name}</Text>
      </FocusPressable>
    </View>
  );
}

/** Both music surfaces mount this same host. A document can later embed it with just mode and sceneId. */
export function Visualizer({ mode, sceneId }: { mode: VisualizerMode; sceneId?: string }) {
  const profile = useVelaState(s => visualizerProfile(s.servers.selectedId, s.auth.viewerId || s.auth.viewer));
  const id = useSyncExternalStore(subscribeVisualizerScene, () => getVisualizerScene(profile, sceneId), () => getVisualizerScene(profile, sceneId));
  const choose = useCallback((value: string) => setVisualizerScene(profile, value), [profile]);
  const active = useSyncExternalStore(subscribeForeground, foreground, () => false);
  const available = useCanVisualize(active);
  const playing = useVelaState(s => s.audio.phase === 'playing');
  const artworkTint = useVelaState(s => currentInQueue(s.audio.queue)?.accent);
  const look = useLook();
  const background = mode === 'background';
  const [pickerOpen, setPickerOpen] = useState(false);
  useEffect(() => { if (background) setPickerOpen(false); }, [background]);
  // TV focus animations share the compositor with the scene. Keep the current
  // image while the viewer browses previews, and resume as soon as they select.
  const holdScene = Platform.isTV && !background && pickerOpen;
  if (!available) return null;
  return (
    <View testID={'visualizer-' + mode} pointerEvents={background ? 'none' : 'box-none'} focusable={false}
      accessibilityElementsHidden={background} importantForAccessibility={background ? 'no-hide-descendants' : 'auto'} style={StyleSheet.absoluteFill}>
      <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={StyleSheet.absoluteFill}>
        <VisualizerStage sceneId={id} mode={mode} active={active} still={look.still || !playing || holdScene} accent={paletteColor(look.ui.accent)}
          artworkTint={paletteColor(artworkTint)} onUnavailable={reportUnavailable} />
      </View>
      {!background ? <ScenePicker id={id} choose={choose} expanded={pickerOpen} setExpanded={setPickerOpen} /> : null}
    </View>
  );
}

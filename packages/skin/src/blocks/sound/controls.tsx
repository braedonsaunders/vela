// The Sound block's own controls (switch, chip, slider, round icon button, focus group), so the block
// is self-contained: the music widgets today and the Listen documents later draw it unchanged. They
// take the active document's `ui` look.
import { createContext, useContext, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Platform, Text, TVFocusGuideView, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { FocusPressable as Pressable } from '../../focus';
import { useHost } from '../../host';
import { NO_RING, useInteraction } from '../../widgets/common/controls';
import { useLook, type Look } from '../../widgets/common/look';

const web = Platform.OS === 'web';

/** Drawn for a TV (a remote and a focus engine): a block sets it for every control inside. */
export const SoundTV = createContext(false);

export interface SoundLook extends Look { width: number }

export function useSoundLook(): SoundLook {
  const host = useHost();
  return { ...useLook(), width: host.viewport.width };
}

/** A colour with alpha, for hex colours; anything else is returned as it is. */
export function alpha(color: string, value: number): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color.trim());
  if (!hex) return color;
  const full = hex[1]!.length === 3 ? hex[1]!.split('').map(c => c + c).join('') : hex[1]!;
  return `#${full}${Math.round(Math.min(1, Math.max(0, value)) * 255).toString(16).padStart(2, '0')}`;
}

export const transition = (properties: string, ms = 200): ViewStyle => (web ? ({ transitionProperty: properties, transitionDuration: `${ms}ms`, transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)' } as ViewStyle) : {});

/** On a TV a focus guide that keeps the remote inside a row of choices; a plain view elsewhere. */
export function FocusGroup({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  if (!Platform.isTV) return <View style={style}>{children}</View>;
  return <TVFocusGuideView autoFocus style={style}>{children}</TVFocusGuideView>;
}

const GLYPHS: Record<string, string[]> = {
  close: ['M6 6l12 12', 'M18 6L6 18'],
  plus: ['M12 5v14', 'M5 12h14'],
  minus: ['M5 12h14'],
};

export function SoundGlyph({ name, size, color }: { name: keyof typeof GLYPHS; size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" pointerEvents="none">
      {GLYPHS[name]!.map(d => <Path key={d} d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />)}
    </Svg>
  );
}

export function RoundIcon({ name, label, onPress, size = 36, iconSize = 16, tv: asked = false }: { name: keyof typeof GLYPHS; label: string; onPress(): void; size?: number; iconSize?: number; tv?: boolean }) {
  const m = useSoundLook();
  const tv = useContext(SoundTV) || asked;
  const { state, handlers } = useInteraction();
  const lit = state.hover || state.focus;
  return (
    <Pressable {...handlers} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={[NO_RING, { width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: lit ? m.ui.control : 'transparent',
        transform: [{ scale: state.pressed ? 0.92 : state.focus && tv ? 1.1 : 1 }] }, state.focus && tv ? { borderWidth: 2, borderColor: m.ui.ink } : {}, transition('transform, background-color', 140)]}>
      <SoundGlyph name={name} size={iconSize} color={lit ? m.ui.ink : m.ui.inkSecondary} />
    </Pressable>
  );
}

/** One choice of several (a radio). */
export function Chip({ label, on, onPress }: { label: string; on: boolean; onPress(): void }) {
  const m = useSoundLook();
  const { state, handlers } = useInteraction();
  const lit = state.hover || state.focus;
  return (
    <Pressable {...handlers} onPress={onPress} accessibilityRole="radio" accessibilityState={{ checked: on }} {...(web ? { 'aria-checked': on } : {})}
      style={[NO_RING, { height: 32, paddingHorizontal: 14, borderRadius: 16, justifyContent: 'center', backgroundColor: on ? m.ui.ink : lit ? m.ui.controlHover : m.ui.control,
        // A hairline keeps an unchosen chip visible where the control tone is the surface's own.
        borderWidth: 1, borderColor: on ? m.ui.ink : m.ui.glassEdge }, state.focus ? m.box({ 'box-shadow': `0px 0px 0px 3px ${m.ui.focusHalo}` }) : {}, transition('background-color', 120)]}>
      <Text style={m.text({ 'font-size': '13px', 'font-weight': '650', color: on ? m.ui.inkInverse : m.ui.ink })}>{label}</Text>
    </Pressable>
  );
}

/** A switch. */
export function Toggle({ on, onToggle, label, testID }: { on: boolean; onToggle(on: boolean): void; label: string; testID?: string }) {
  const m = useSoundLook();
  const tv = useContext(SoundTV);
  const { state, handlers } = useInteraction();
  return (
    <Pressable {...handlers} onPress={() => onToggle(!on)} accessibilityRole="switch" accessibilityState={{ checked: on }} accessibilityLabel={label} testID={testID}
      {...(web ? { 'aria-checked': on } : {})}
      style={[NO_RING, { width: 46, height: 28, borderRadius: 14, padding: 3, justifyContent: 'center', backgroundColor: on ? m.ui.accent : alpha(m.ui.ink, 0.22) },
        state.focus ? (tv ? { borderWidth: 2, borderColor: m.ui.ink } : m.box({ 'box-shadow': `0px 0px 0px 3px ${m.ui.focusHalo}` })) : {}, transition('background-color', 160)]}>
      <View style={[{ width: 22, height: 22, borderRadius: 11, backgroundColor: on ? m.ui.onAccent : m.ui.ink, transform: [{ translateX: on ? 18 : 0 }] }, transition('transform', 180)]} />
    </Pressable>
  );
}

/** A horizontal slider (0..1): press or drag; arrow keys step 5%. The press point and the finger's
 * travel place it, so nothing waits on a measurement. */
export function Slider({ value, onChange, label, testID }: { value: number; onChange(fraction: number): void; label: string; testID?: string }) {
  const m = useSoundLook();
  const ref = useRef<ComponentRef<typeof View>>(null);
  const press = useRef({ location: 0, page: 0 });
  const width = useRef(1);
  const [drag, setDrag] = useState<number | null>(null);
  const [hover, setHover] = useState(false);
  const shown = Math.min(1, Math.max(0, drag ?? value));
  const at = (pageX: number) => Math.min(1, Math.max(0, (press.current.location + pageX - press.current.page) / Math.max(1, width.current)));
  const lit = hover || drag !== null;
  return (
    <View ref={ref} testID={testID} accessible focusable accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: Math.round(shown * 100) }}
      onLayout={e => { width.current = e.nativeEvent.layout.width; }}
      onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true}
      onResponderGrant={e => { press.current = { location: e.nativeEvent.locationX, page: e.nativeEvent.pageX }; setDrag(at(e.nativeEvent.pageX)); }}
      onResponderMove={e => setDrag(at(e.nativeEvent.pageX))}
      onResponderRelease={e => { const to = at(e.nativeEvent.pageX); setDrag(null); onChange(to); }}
      onResponderTerminate={() => setDrag(null)}
      {...(web ? { onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false), onKeyDown: (e: { key: string; preventDefault(): void }) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); onChange(Math.min(1, Math.max(0, value + (e.key === 'ArrowLeft' ? -0.05 : 0.05)))); }
      } } as object : {})}
      style={[NO_RING, { flex: 1, height: 16, justifyContent: 'center' }, web ? ({ cursor: 'pointer' } as ViewStyle) : {}]}>
      <View pointerEvents="none" style={{ height: 4, borderRadius: 2, backgroundColor: m.ui.track, overflow: 'hidden' }}>
        <View style={[{ width: `${shown * 100}%`, height: '100%', backgroundColor: lit ? m.ui.accent : m.ui.ink }, transition('background-color', 120)]} />
      </View>
      <View pointerEvents="none" style={[{ position: 'absolute', left: `${shown * 100}%`, marginLeft: -6, width: 12, height: 12, borderRadius: 6, backgroundColor: m.ui.ink, opacity: lit ? 1 : 0 } as ViewStyle, transition('opacity', 120)]} />
    </View>
  );
}

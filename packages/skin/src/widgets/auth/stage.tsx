// The stage every signed-out page stands on (sign-in, Connect a server), on every platform: the
// full-screen horizon scene, and the current step in a centred column on the water below it. The
// step reports how tall it is; the stage puts the horizon as low as that allows (horizonPlan) and
// glides it there. A keyboard lifts the horizon in time with itself. The Back control floats in
// the top corner, outside the step, so it never moves as steps change.
// Styled from the active document's `ui`.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Dimensions, Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type KeyboardEvent, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import { useHost } from '../../host';
import { easing } from '../../motion';
import { APressable, Glyph, NO_RING, overlaid, useInteraction } from '../common/controls';
import { useLook } from '../common/look';
import { Horizon, type SceneBranding } from './horizon';
import { HORIZON_EASE, HORIZON_MS } from './horizon-motion';
import { authLayout, horizonPlan, keyboardAvoidanceEnabled, type AuthLayout, type HorizonPlan } from './layout';
import { AuthLayoutContext } from './layout-context';

export interface StageApi {
  layout: AuthLayout;
  plan: HorizonPlan;
  /** The mark is still drawing: the first step's blocks wait for it. */
  first: boolean;
  /** The step's natural height (its blocks without the space between them). */
  reportContent(height: number): void;
  /** Something is being waited for: the horizon's light travels. */
  setWaiting(on: boolean): void;
  /** The corner Back (or Cancel) control, or none. */
  setBack(back: { label: string; onPress(): void } | null): void;
  /** The flow is past its first step: the horizon rises to give the step room. */
  setDeep(deep: boolean): void;
}

const StageContext = createContext<StageApi | null>(null);
export const useStage = () => useContext(StageContext);

/** The keyboard's height over the stage and how long it takes to move. iOS reports both before it
 * moves; the web's visual viewport shrinks; Android resizes the window (KeyboardAvoidingView). */
function useKeyboard(): { height: number; ms: number } {
  const [state, setState] = useState({ height: 0, ms: 0 });
  useEffect(() => {
    if (Platform.OS === 'ios' && !Platform.isTV) {
      const change = (event: KeyboardEvent) => {
        const height = Math.max(0, Dimensions.get('window').height - event.endCoordinates.screenY);
        setState({ height, ms: event.duration || 250 });
      };
      const hide = (event: KeyboardEvent) => setState({ height: 0, ms: event.duration || 250 });
      const subs = [Keyboard.addListener('keyboardWillChangeFrame', change), Keyboard.addListener('keyboardWillHide', hide)];
      return () => subs.forEach(sub => sub.remove());
    }
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.visualViewport) {
      const viewport = window.visualViewport;
      const resize = () => {
        const covered = window.innerHeight - viewport.height;
        setState({ height: covered > 120 ? covered : 0, ms: 220 });
      };
      resize();
      viewport.addEventListener('resize', resize);
      return () => viewport.removeEventListener('resize', resize);
    }
    return undefined;
  }, []);
  return state;
}

export function Stage({ children, branding }: { children: ReactNode; branding?: SceneBranding }) {
  const look = useLook();
  const host = useHost();
  const viewport = host.viewport;
  const tv = !!Platform.isTV;
  const touch = Platform.OS !== 'web' || (typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches);
  const [height, setHeight] = useState(viewport.height);
  const [width, setWidth] = useState(viewport.width);
  const keyboard = useKeyboard();
  const [content, setContent] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const [back, setBack] = useState<{ label: string; onPress(): void } | null>(null);
  const [deep, setDeep] = useState(false);
  // The mark draws once, the first time the stage has somewhere to put it.
  const [first, setFirst] = useState(true);
  const measured = content > 0;
  useEffect(() => {
    if (!measured || !first) return;
    const timer = setTimeout(() => setFirst(false), 1600);
    return () => clearTimeout(timer);
  }, [measured, first]);
  const layout = authLayout(viewport, height - keyboard.height, tv, touch);
  const plan = horizonPlan({ viewport, height, keyboard: keyboard.height, content, tv, touch, deep });
  const maxSail = horizonPlan({ viewport, height, keyboard: 0, content: 1, tv, touch }).split ? 132 : tv ? 240 : layout.compact ? 172 : 220;
  // The horizon glides to new steps; while the keyboard moves it keeps the keyboard's pace; the
  // very first placement (before the step was measured) is not a move at all.
  const lastKeyboard = useRef(keyboard.height);
  const placed = useRef(false);
  const keyboardMoving = lastKeyboard.current !== keyboard.height;
  lastKeyboard.current = keyboard.height;
  const moveMs = !placed.current ? 0 : keyboardMoving ? keyboard.ms : HORIZON_MS;
  if (measured || plan.split) placed.current = true;
  const reportContent = useCallback((h: number) => setContent(previous => (Math.abs(previous - h) < 1 ? previous : h)), []);
  const api = useMemo<StageApi>(() => ({ layout, plan, first, reportContent, setWaiting, setBack, setDeep }),
    [layout.contentWidth, layout.headingSize, layout.gap, layout.compact, layout.minimal, layout.tight, layout.controlHeight, plan.horizon, plan.sail, plan.contentTop, plan.contentBottom, plan.split, plan.pane, first, reportContent]);
  const sideLeft = (viewport.sides?.left ?? 0) + viewport.insets.left;
  const sideRight = (viewport.sides?.right ?? 0) + viewport.insets.right;
  const glide = moveMs > 0 && !look.still ? {
    transitionProperty: ['top', 'bottom'],
    transitionDuration: moveMs,
    transitionTimingFunction: easing(HORIZON_EASE),
  } as unknown as ViewStyle : null;
  const column: ViewStyle = plan.split
    ? { position: 'absolute', left: plan.pane, right: sideRight, top: viewport.insets.top, bottom: plan.contentBottom }
    : { position: 'absolute', left: sideLeft, right: sideRight, top: plan.contentTop, bottom: plan.contentBottom };
  const stage = (
    <View style={StyleSheet.absoluteFill} onLayout={event => { setHeight(event.nativeEvent.layout.height); setWidth(event.nativeEvent.layout.width); }}>
      {measured || plan.split ? <Horizon plan={plan} width={width} height={height} maxSail={maxSail} waiting={waiting} branding={branding} draw={first} moveMs={moveMs} /> : <View style={[StyleSheet.absoluteFill, { backgroundColor: look.ui.page }]} />}
      <Animated.View style={[column, glide]}>
        <ScrollView
          testID="auth-stage-scroll"
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: plan.split ? 'center' : undefined, paddingHorizontal: 0, paddingBottom: 4 }}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View testID="auth-card" style={{ width: layout.contentWidth, flexGrow: plan.split ? 0 : 1 }}>
            <StageContext.Provider value={api}>
              <AuthLayoutContext.Provider value={layout}>{children}</AuthLayoutContext.Provider>
            </StageContext.Provider>
          </View>
        </ScrollView>
      </Animated.View>
      {back ? <BackButton label={back.label} onPress={back.onPress} top={viewport.insets.top + (layout.compact ? 6 : 16)} left={sideLeft + (layout.compact ? 12 : 24)} /> : null}
    </View>
  );
  if (Platform.OS === 'android') {
    return (
      <KeyboardAvoidingView style={[StyleSheet.absoluteFill, { backgroundColor: look.ui.page }]} enabled={keyboardAvoidanceEnabled(Platform.OS, tv)} behavior="height">
        {stage}
      </KeyboardAvoidingView>
    );
  }
  return <View style={[StyleSheet.absoluteFill, { backgroundColor: look.ui.page }]}>{stage}</View>;
}

/** The corner control: a round glass chevron, labelled for assistive technology. */
function BackButton({ label, onPress, top, left }: { label: string; onPress(): void; top: number; left: number }) {
  const look = useLook();
  const { state, handlers } = useInteraction();
  const rows = overlaid({
    width: '44px', height: '44px', 'border-radius': '22px', 'align-items': 'center', 'justify-content': 'center',
    'background-color': '$ui.control', border: '1px solid $ui.glassEdge', 'backdrop-filter': 'blur(20px) saturate(1.3)',
  }, state, { hover: { 'background-color': '$ui.controlHover' }, focus: { 'box-shadow': '0px 0px 0px 2px $ui.page, 0px 0px 0px 4px $ui.accent' } });
  return (
    <APressable accessibilityRole="button" accessibilityLabel={label} testID="auth-back" onPress={onPress} {...handlers}
      hitSlop={8} style={[look.box(rows), { position: 'absolute', top, left }, state.pressed && { opacity: 0.6 }, NO_RING]}>
      <Glyph symbol={label === 'Cancel' ? 'close' : 'back'} size={20} color={look.ui.ink} />
    </APressable>
  );
}

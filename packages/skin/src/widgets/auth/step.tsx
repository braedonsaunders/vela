// One step of the signed-out flow on the stage's water: a confident title and a line of help,
// the step's body, and its actions in the thumb's reach at the bottom. Steps dissolve into each
// other: the outgoing one fades and drifts while the incoming one's blocks rise in turn. The
// step tells the stage its natural height, so the horizon can make room for it.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import { animation } from '../../motion';
import { Words } from '../common/controls';
import { useLook } from '../common/look';
import { blockEntrance, exitDrift, STEP_EXIT_MS, type StepDirection } from './connect/steps';
import { DISPLAY_LINE_HEIGHT } from './layout';
import { useStage } from './stage';

interface StepState {
  direction: StepDirection;
  /** The stage's first step, entering after the mark has drawn. */
  first: boolean;
  /** Dissolving away: it no longer reports its size. */
  leaving: boolean;
}
const StepContext = createContext<StepState>({ direction: 'forward', first: false, leaving: false });

/** The current step, keyed by `id`; when the id changes the previous one dissolves over it. */
export function Steps({ id, direction, children }: { id: string; direction: StepDirection; children: ReactNode }) {
  const stage = useStage();
  const last = useRef<ReactNode>(children);
  const [shown, setShown] = useState<{ id: string; leaving: { id: string; node: ReactNode; direction: StepDirection } | null }>({ id, leaving: null });
  // A new step: the previous one's last drawing leaves; the new one enters.
  if (shown.id !== id) setShown({ id, leaving: { id: shown.id, node: last.current, direction } });
  else last.current = children;
  useEffect(() => {
    if (!shown.leaving) return;
    const timer = setTimeout(() => setShown(s => ({ ...s, leaving: null })), STEP_EXIT_MS + 40);
    return () => clearTimeout(timer);
  }, [shown.leaving]);
  const first = !!stage?.first && !shown.leaving;
  const entering = useRef(first);
  if (!first) entering.current = false;
  return (
    <View style={{ flexGrow: 1 }}>
      {shown.leaving ? (
        <Animated.View key={shown.leaving.id} pointerEvents="none" style={[{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }, exit(shown.leaving.direction)]}>
          <StepContext.Provider value={{ direction: shown.leaving.direction, first: false, leaving: true }}>{shown.leaving.node}</StepContext.Provider>
        </Animated.View>
      ) : null}
      <Animated.View key={id} style={{ flexGrow: 1 }}>
        <StepContext.Provider value={{ direction, first: entering.current, leaving: false }}>{children}</StepContext.Provider>
      </Animated.View>
    </View>
  );
}

function exit(direction: StepDirection): ViewStyle {
  return {
    animationName: { from: { opacity: 1, transform: [{ translateY: 0 }] }, to: { opacity: 0, transform: [{ translateY: exitDrift(direction) }] } },
    animationDuration: STEP_EXIT_MS,
    animationTimingFunction: 'ease-in',
    animationFillMode: 'both',
  } as unknown as ViewStyle;
}

/** A block of a step, rising into place `index` beats after the step begins. */
export function Rise({ index, children, style }: { index: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const look = useLook();
  const { direction, first, leaving } = useContext(StepContext);
  // The entrance is chosen once, as the block mounts: re-renders never restart it.
  const [entrance] = useState(() => (leaving ? undefined : animation(blockEntrance(index, direction, first), {}, look.still, 0)));
  return <Animated.View style={[style, entrance as ViewStyle]}>{children}</Animated.View>;
}

/** Centred lines of even length (the web balances them; native copy breaks by hand). */
const BALANCED = { textAlign: 'center', ...(Platform.OS === 'web' ? { textWrap: 'balance' } : {}) } as TextStyle;

/** The step's title in the display face, its line box tall enough for the face's ascenders. */
export function Title({ children, accessibilityLabel }: { children: string; accessibilityLabel?: string }) {
  const stage = useStage();
  const size = stage?.layout.headingSize ?? 40;
  return (
    <Words rows={{ 'font-family': '$ui.fontDisplay', 'font-weight': '400', 'font-size': `${size}px`, 'line-height': String(DISPLAY_LINE_HEIGHT), 'letter-spacing': '-0.005em' }}
      lines={2} accessibilityRole="header" accessibilityLabel={accessibilityLabel} style={BALANCED} maxScale={1.4}>
      {children}
    </Words>
  );
}

export function Subtitle({ children }: { children: string }) {
  const stage = useStage();
  return (
    <Words rows={{ 'font-size': stage?.layout.compact ? '16px' : '17px', 'line-height': '1.45', color: '$ui.inkSecondary' }} style={BALANCED} maxScale={1.6}>
      {children}
    </Words>
  );
}

/** A step: heading (a title and subtitle, or a drawn heading such as the wordmark), body and
 * actions. `spread` keeps the actions at the bottom of the water; `centre` floats the heading and
 * body in the optical centre of the space (a code to read). */
export function StepFrame({ title, subtitle, heading, body, actions, align = 'spread' }: {
  title?: string;
  subtitle?: string;
  heading?: ReactNode;
  body?: ReactNode;
  actions?: ReactNode;
  align?: 'spread' | 'centre' | 'low';
}) {
  const stage = useStage();
  const { leaving } = useContext(StepContext);
  const sizes = useRef({ top: 0, bottom: 0 });
  const gap = stage?.layout.gap ?? 16;
  const between = stage?.layout.compact ? 28 : 36;
  const report = () => {
    if (leaving || !stage) return;
    const { top, bottom } = sizes.current;
    if (top > 0) stage.reportContent(Math.ceil(top + (bottom ? bottom + between : 0)));
  };
  const split = !!stage?.plan.split;
  const minimal = !!stage?.layout.minimal;
  if (!actions) sizes.current.bottom = 0;
  let index = 0;
  return (
    <View style={{ flexGrow: split ? 0 : 1 }}>
      {align !== 'spread' && !split ? <View style={{ flexGrow: align === 'low' ? 1.4 : 1 }} /> : null}
      <View style={{ gap: gap + 4 }} onLayout={event => { sizes.current.top = event.nativeEvent.layout.height; report(); }}>
        {(heading || title || subtitle) && !minimal ? (
          <View style={{ gap: 8, alignItems: 'center' }}>
            {heading ? <Rise index={index++}>{heading}</Rise> : title ? <Rise index={index++}><Title>{title}</Title></Rise> : null}
            {subtitle ? <Rise index={index++}><Subtitle>{subtitle}</Subtitle></Rise> : null}
          </View>
        ) : null}
        {body ? <StepIndex.Provider value={index + 1}>{body}</StepIndex.Provider> : null}
      </View>
      {!split ? <View style={{ flexGrow: align === 'centre' ? 1.6 : 1, minHeight: actions ? between : 0 }} /> : actions ? <View style={{ height: gap + 8 }} /> : null}
      {actions ? (
        <View onLayout={event => { sizes.current.bottom = event.nativeEvent.layout.height; report(); }}>
          <Rise index={index + 3} style={{ gap: gap - 4 }}>{actions}</Rise>
        </View>
      ) : null}
    </View>
  );
}

/** The index the step's body blocks count from, after its heading. */
export const StepIndex = createContext(0);
export const useStepIndex = () => useContext(StepIndex);

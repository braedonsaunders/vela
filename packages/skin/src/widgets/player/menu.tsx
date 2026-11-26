// A control's menu: a compact glass panel over the control bar with the menu's name above a
// radio list. On TV focus starts on the active choice and stays inside until the menu closes.
import { FocusPressable as Pressable } from '../../focus';
import { BlurView } from 'expo-blur';
import { Children, Fragment, isValidElement, useEffect, useState, type ReactNode, type RefObject, type ComponentRef } from 'react';
import { Modal, Platform, ScrollView, StyleSheet, Text, TVFocusGuideView, View, type TextStyle } from 'react-native';
import { PlayerIcon, type PlayerIconName } from './icons';
import type { PlayerLook } from './look';
import { Spinner } from './spinner';
import { useHost } from '../../host';
import { watchWidth } from './fold-layout';
import { useFocusClaim } from '../common/focus-claim';

/** Keeps focus inside on TV; a plain view elsewhere (react-native-web has no focus guide). */
function FocusTrap({ children }: { children: ReactNode }) {
  if (!Platform.isTV) return <>{children}</>;
  return (
    <TVFocusGuideView style={{ flexShrink: 1, minHeight: 0 }} autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight>
      {children}
    </TVFocusGuideView>
  );
}

/** Drawn inside the control row's box: it opens upward from the row, at its right edge. */
export function MenuPanel({
  look,
  name,
  maxHeight,
  wide,
  children,
  anchorRef,
  onClose,
  onPanelLayout,
}: {
  look: PlayerLook;
  name: string;
  maxHeight: number;
  wide?: boolean;
  children: ReactNode;
  anchorRef: RefObject<ComponentRef<typeof View> | null>;
  onClose(): void;
  onPanelLayout?(width: number, height: number): void;
}) {
  const { viewport } = useHost();
  const [anchor, setAnchor] = useState<{ left: number; top: number; width: number } | null>(null);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let active = true;
    anchorRef.current?.measureInWindow((left, top, width) => {
      if (active) setAnchor({ left, top, width });
    });
    return () => { active = false; };
  }, [anchorRef, viewport.width, viewport.height]);
  const native = Platform.OS !== 'web';
  const preferredWidth = look.size(wide ? 420 : 320);
  const panelWidth = Math.min(preferredWidth, Math.max(0, viewport.width - look.size(24)));
  const stickyHeaderIndices: number[] = [];
  let rowIndex = 0;
  const rows = native && wide ? Children.toArray(children).flatMap<ReactNode>(row => {
    if (!isValidElement<MenuSectionProps>(row) || row.type !== MenuSection) {
      rowIndex++;
      return [row];
    }
    // Native ScrollView docks direct children. Web sections keep headings bounded by their group.
    stickyHeaderIndices.push(rowIndex);
    const sectionRows = Children.toArray(row.props.children);
    rowIndex += 1 + sectionRows.length;
    return [<MenuHeading key={row.key} look={look} text={row.props.title} sticky />,
      ...sectionRows.map(child => <Fragment key={`${row.key}:${isValidElement(child) ? child.key : String(child)}`}>{child}</Fragment>)];
  }) : children;
  const panel = (
    <View
      accessibilityRole="menu"
      accessibilityLabel={name}
      testID="player-menu"
      onLayout={event => {
        const { width, height } = event.nativeEvent.layout;
        onPanelLayout?.(width, height);
      }}
      style={{
        position: 'absolute',
        right: native && anchor ? Math.max(0, watchWidth(viewport) - anchor.left - anchor.width) : 0,
        bottom: native && anchor ? Math.max(0, viewport.height - anchor.top) : '100%',
        marginBottom: look.size(12),
        left: !wide && !native && look.small ? 0 : undefined,
        width: wide ? Math.min(panelWidth, native && anchor ? anchor.width : panelWidth)
          : look.small ? (native ? anchor?.width : undefined) : look.size(320),
        maxHeight: native && anchor ? Math.min(maxHeight, Math.max(44, anchor.top - look.size(24))) : maxHeight,
        borderRadius: Math.min(look.radiusPanel, look.size(18)),
        borderWidth: 1,
        borderColor: look.glassEdge,
        overflow: 'hidden',
        boxShadow: `0px 30px 90px ${look.shadow}`,
      }}
    >
      <BlurView intensity={70} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: look.popover }]} />
      <Text
        style={[
          look.text(11, 650, look.inkQuiet),
          {
            letterSpacing: look.size(1.1),
            textTransform: 'uppercase',
            paddingHorizontal: look.size(20),
            paddingTop: look.size(14),
            paddingBottom: look.size(8),
          },
        ]}
      >
        {name}
      </Text>
      <FocusTrap>
        <ScrollView stickyHeaderIndices={stickyHeaderIndices.length ? stickyHeaderIndices : undefined}
          contentContainerStyle={{ paddingHorizontal: look.size(8), paddingBottom: look.size(8) }}>
          {rows}
        </ScrollView>
      </FocusTrap>
    </View>
  );
  if (!native) return panel;
  // A native modal owns Menu/Back at the presented controller/dialog. A JS-only overlay
  // cannot stop tvOS's native stack from receiving that same Menu press and popping the film.
  return <Modal visible={anchor !== null} transparent animationType="none" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
    <View style={StyleSheet.absoluteFill}>
      <Pressable accessible={false} focusable={false} onPress={onClose} style={StyleSheet.absoluteFill} />
      {panel}
    </View>
  </Modal>;
}

export function MenuAction({ look, icon, label, disabled, onPress, testID }: {
  look: PlayerLook;
  icon: PlayerIconName;
  label: string;
  disabled?: boolean;
  onPress(): void;
  testID?: string;
}) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} testID={testID}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44, paddingHorizontal: 12, opacity: disabled ? 0.35 : 1 }}>
      <PlayerIcon name={icon} size={20} color={look.ink} />
      <Text style={[look.text(14), { flex: 1 }]}>{label}</Text>
    </Pressable>
  );
}

interface Choice {
  look: PlayerLook;
  name: string;
  detail?: string;
  selected: boolean;
  /** The engine is switching to it. */
  pending?: boolean;
  enabled: boolean;
  onChoose(): void;
  testID?: string;
  /** Takes TV focus when shown though not selected (the first row of a menu's new page). */
  focus?: boolean;
}

/** One choice: a check on the active item (a spinner while the engine switches), its name and one muted detail. */
export function ChoiceRow({ look, name, detail, selected, pending, enabled, onChoose, testID, focus: preferred }: Choice) {
  const claim = useFocusClaim(selected || preferred);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const lit = look.tv && focus;
  const ink = lit ? look.inkInverse : look.ink;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled: !enabled, busy: !!pending }}
      {...(Platform.OS === 'web' ? { 'aria-checked': selected, 'aria-busy': !!pending } : {})}
      accessibilityLabel={detail ? `${name}, ${detail}` : name}
      disabled={!enabled}
      hasTVPreferredFocus={claim}
      testID={testID}
      onPress={onChoose}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: look.size(12),
        minHeight: look.size(44),
        paddingHorizontal: look.size(12),
        paddingVertical: look.size(8),
        borderRadius: look.size(12),
        backgroundColor: lit ? look.ink : hover ? look.controlHover : selected ? look.control : 'transparent',
        opacity: enabled || selected ? 1 : 0.4,
        outlineColor: look.accent,
        outlineStyle: 'solid',
        outlineWidth: focus && !look.tv ? 2 : 0,
      }}
    >
      <View style={{ width: look.size(16), height: look.size(16), alignItems: 'center', justifyContent: 'center' }}>
        {pending ? (
          <Spinner look={look} size={look.size(14)} />
        ) : selected ? (
          <PlayerIcon name="check" size={look.size(14)} color={lit ? look.inkInverse : look.accent} />
        ) : null}
      </View>
      <Text numberOfLines={1} style={[look.text(14, selected ? 650 : 500, ink), { flex: 1, minWidth: 0 }]}>
        {name}
      </Text>
      {detail ? (
        <Text
          numberOfLines={enabled ? 1 : undefined}
          style={[
            look.text(12, 400, lit ? look.inkInverse : look.inkQuiet),
            { flexShrink: 0, maxWidth: '55%', fontVariant: ['tabular-nums'] },
          ]}
        >
          {detail}
        </Text>
      ) : null}
    </Pressable>
  );
}

interface VersionChoice extends Omit<Choice, 'detail'> {
  chips: string[];
  status: string;
  unavailable?: boolean;
}

/** A source version gets the horizontal room it deserves: name first, compact facts below. */
export function VersionChoiceRow({ look, name, chips, status, selected, pending, enabled, unavailable, onChoose, testID, focus: preferred }: VersionChoice) {
  const claim = useFocusClaim(selected || preferred);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const lit = look.tv && focus;
  const ink = lit ? look.inkInverse : look.ink;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled: !enabled, busy: !!pending }}
      {...(Platform.OS === 'web' ? { 'aria-checked': selected, 'aria-busy': !!pending } : {})}
      accessibilityLabel={`${name}, ${[...chips, status].filter(Boolean).join(', ')}`}
      disabled={!enabled}
      hasTVPreferredFocus={claim}
      testID={testID}
      onPress={onChoose}
      onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)}
      onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
      style={{
        flexDirection: 'row', alignItems: 'flex-start', gap: look.size(12), minHeight: look.size(58),
        paddingHorizontal: look.size(12), paddingVertical: look.size(10), borderRadius: look.size(12),
        backgroundColor: lit ? look.ink : hover ? look.controlHover : selected ? look.control : 'transparent',
        opacity: unavailable ? 0.45 : enabled || selected ? 1 : 0.55,
        outlineColor: look.accent, outlineStyle: 'solid', outlineWidth: focus && !look.tv ? 2 : 0,
      }}
    >
      <View style={{ width: look.size(16), height: look.size(20), alignItems: 'center', justifyContent: 'center' }}>
        {pending ? <Spinner look={look} size={look.size(14)} /> : selected ? <PlayerIcon name="check" size={look.size(14)} color={lit ? look.inkInverse : look.accent} /> : null}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: look.size(6) }}>
        <Text style={[look.text(14, selected ? 650 : 550, ink), { flexShrink: 1 }]}>{name}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: look.size(5) }}>
          {chips.map(chip => <Text key={chip} style={[look.text(10, 600, lit ? look.inkInverse : look.inkQuiet), {
            paddingHorizontal: look.size(6), paddingVertical: look.size(2), borderRadius: look.size(6),
            backgroundColor: lit ? 'transparent' : look.control,
          }]}>{chip}</Text>)}
          {status ? <Text style={[look.text(11, 400, lit ? look.inkInverse : look.inkQuiet), { flexShrink: 1 }]}>{status}</Text> : null}
        </View>
      </View>
    </Pressable>
  );
}

/** A heading inside a menu: a resolution above its bitrates, a subtitle setting above its segments. */
export function MenuHeading({ look, text, sticky }: { look: PlayerLook; text: string; sticky?: boolean }) {
  const stickyStyle = sticky && Platform.OS === 'web'
    ? ({ position: 'sticky', top: 0, zIndex: 2 } as unknown as TextStyle)
    : undefined;
  return (
    <Text
      accessibilityRole={sticky ? 'header' : undefined}
      aria-level={sticky ? 3 : undefined}
      style={[
        look.text(11, 650, look.inkQuiet),
        {
          letterSpacing: look.size(0.9),
          paddingHorizontal: look.size(12),
          paddingTop: look.size(10),
          paddingBottom: look.size(2),
          backgroundColor: sticky ? look.page : undefined,
        },
        stickyStyle,
      ]}
    >
      {text}
    </Text>
  );
}

interface MenuSectionProps { look: PlayerLook; title: string; children: ReactNode }

export function MenuSection({ look, title, children }: MenuSectionProps) {
  return <View><MenuHeading look={look} text={title} sticky />{children}</View>;
}

export function MenuRule({ look }: { look: PlayerLook }) {
  return (
    <View
      style={{
        height: 1,
        marginVertical: look.size(6),
        marginHorizontal: look.size(12),
        backgroundColor: look.glassEdge,
      }}
    />
  );
}

interface Segments {
  look: PlayerLook;
  name: string;
  options: { value: string; label: string }[];
  current: string;
  enabled: boolean;
  onPick(value: string): void;
}

/** One setting as a row of segments, the current one filled. */
export function SegmentRow({ look, name, options, current, enabled, onPick }: Segments) {
  return (
    <View style={{ gap: look.size(6), paddingHorizontal: look.size(12), paddingVertical: look.size(6) }}>
      <Text style={look.text(12, 400, look.inkQuiet)}>{name}</Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={name}
        style={{ flexDirection: 'row', gap: 2, padding: 3, borderRadius: look.size(11), backgroundColor: look.control }}
      >
        {options.map(option => (
          <Segment
            key={option.value}
            look={look}
            label={option.label}
            on={option.value === current}
            enabled={enabled}
            onPress={() => onPick(option.value)}
          />
        ))}
      </View>
    </View>
  );
}

function Segment({
  look,
  label,
  on,
  enabled,
  onPress,
}: {
  look: PlayerLook;
  label: string;
  on: boolean;
  enabled: boolean;
  onPress(): void;
}) {
  const [focus, setFocus] = useState(false);
  const filled = on || (look.tv && focus);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: on, disabled: !enabled }}
      accessibilityLabel={label}
      disabled={!enabled}
      onPress={onPress}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={{
        flex: 1,
        minWidth: 0,
        height: look.size(30),
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: look.size(8),
        backgroundColor: filled ? look.ink : 'transparent',
        outlineColor: look.accent,
        outlineStyle: 'solid',
        outlineWidth: focus && !look.tv ? 2 : 0,
      }}
    >
      <Text numberOfLines={1} style={look.text(12, 600, filled ? look.inkInverse : look.ink)}>
        {label}
      </Text>
    </Pressable>
  );
}

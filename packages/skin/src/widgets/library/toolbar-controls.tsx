// The library toolbar's controls: pill buttons (tabs, filter chips, Filters and Sort), and the
// field frame its search and year inputs sit in. Skins own their dimensions, shape, font and colours.
import { forwardRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Platform, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { FocusPressable } from '../../focus';
import { InheritedContext, useHost } from '../../host';
import { Glyph } from '../common/controls';
import { useFocusClaim } from '../common/focus-claim';
import { useLook } from '../common/look';

export const control = { height: '$ui.controlHeight', padding: '0px 12px', 'border-radius': '$ui.radiusControl', 'background-color': '$ui.control', border: '1px solid $ui.glassEdge', 'justify-content': 'center', 'flex-shrink': '0' };
export const controlText = { color: '$ui.ink', 'font-size': '$ui.controlFontSize', 'font-weight': '500' };
/** A phone's chips (the compact scale, vela-base/look.ts `phone`): drawn 36pt tall inside the
 * control's 44pt touch target, which stays the pressable. */
export const COMPACT_CHIP = 36;
export function useCompactControls(): boolean {
  return !!useHost().env.small && !Platform.isTV;
}

/** A control label centred on its line: Android otherwise pads the line for accents above it. */
export const CENTRED = { textAlign: 'center', includeFontPadding: false, textAlignVertical: 'center' } as const;

export interface ButtonProps {
  onLayout?(event: LayoutChangeEvent): void;
  onFocus?(): void;
  id?: string;
  testID?: string;
  label: string;
  /** Read by assistive technology instead of the label (an icon-only button, a chip's removal). */
  accessibilityLabel?: string;
  onPress(): void;
  selected?: boolean;
  quiet?: boolean;
  preferred?: boolean;
  role?: 'button' | 'tab' | 'checkbox' | 'radio';
  /** A symbol before the label (icons.ts). */
  icon?: string;
  /** A symbol after the label: a chip's ×. */
  trailing?: string;
  /** Only the icon is drawn; the label is still spoken. */
  iconOnly?: boolean;
  /** A count in an accent badge after the label (active filters). */
  badge?: number;
  expanded?: boolean;
}

export const Button = forwardRef<ComponentRef<typeof FocusPressable>, ButtonProps>(function Button({
  label, onPress, selected = false, role = 'button', id, testID, quiet = false, preferred = false, onLayout, onFocus, icon, trailing, iconOnly = false, badge, accessibilityLabel, expanded,
}, ref) {
  const look = useLook();
  const compact = useCompactControls();
  const [focused, focus] = useState(false);
  const claim = useFocusClaim(preferred);
  const tab = role === 'tab';
  const checked = role === 'checkbox' || role === 'radio';
  const ink = tab && selected ? look.ui.onAccent : quiet ? look.ui.inkSecondary : look.ui.ink;
  const text = look.text({ ...controlText, color: tab && selected ? '$ui.onAccent' : quiet ? '$ui.inkSecondary' : '$ui.ink', 'font-weight': tab && selected ? '700' : '500' });
  const glyphSize = Math.round((Number(text.fontSize) || 15) * 1.15);
  const pill = [look.box({ ...control, position: 'relative',
    'background-color': tab && selected ? '$ui.accent' : focused || selected ? '$ui.controlHover' : '$ui.control',
    'border-color': focused && tab && selected ? '$ui.ink' : focused ? '$ui.accent' : checked && selected ? '$ui.ink' : '$ui.glassEdge' }),
  compact ? { height: 'auto' as const, minHeight: COMPACT_CHIP } : null,
  iconOnly ? { paddingLeft: 0, paddingRight: 0, aspectRatio: 1, alignItems: 'center' as const } : null];
  const content = <>
    {/* A tab's bold selected label must not resize the strip while its scenes are moving. */}
    {tab && <Text accessible={false} numberOfLines={1} style={[look.text({ ...controlText, 'font-weight': '700' }), CENTRED,
      Platform.OS === 'web' ? { visibility: 'hidden' } as never : { opacity: 0 }]}>{label}</Text>}
    {tab
      // The label lies over the sizing copy, centred in the pill's inner box by layout rather than
      // a line height: a TV draws the control's px larger, and fonts place a line's glyphs differently.
      ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, look.box({ padding: control.padding, 'justify-content': 'center' })]}>
        <Text accessible={false} numberOfLines={1} style={[text, CENTRED]}>{label}</Text>
      </View>
      : <View pointerEvents="none" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        {checked && selected && <Glyph symbol="checkmark" size={glyphSize} color={ink} />}
        {icon && <Glyph symbol={icon} size={glyphSize} color={ink} />}
        {!iconOnly && <Text accessible={false} numberOfLines={1} style={[text, CENTRED]}>{label}</Text>}
        {!!badge && <View style={[look.box({ 'min-width': '20px', height: '20px', padding: '0px 6px', 'border-radius': '10px', 'background-color': '$ui.accent', 'align-items': 'center', 'justify-content': 'center' }),
          iconOnly ? { position: 'absolute', top: compact ? -10 : -14, right: compact ? -10 : -14 } : null]}>
          <Text accessible={false} style={[look.text({ color: '$ui.onAccent', 'font-size': '12px', 'font-weight': '700' }), CENTRED]}>{badge}</Text>
        </View>}
        {trailing && <Glyph symbol={trailing} size={Math.round(glyphSize * 0.8)} color={look.ui.inkSecondary} />}
      </View>}
  </>;
  return <FocusPressable ref={ref} onLayout={onLayout} nativeID={id} testID={testID} accessibilityRole={role === 'radio' ? 'radio' : role} accessibilityLabel={accessibilityLabel ?? label}
    accessibilityState={{ selected, checked: checked ? selected : undefined, expanded }}
    {...(Platform.OS === 'web' ? { 'aria-selected': tab ? selected : undefined, 'aria-checked': checked ? selected : undefined, 'aria-expanded': expanded } : {})}
    hasTVPreferredFocus={claim} onFocus={event => { focus(true); onFocus?.(); if (Platform.OS === 'web') (event.target as unknown as HTMLElement).scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }} onBlur={() => focus(false)} onPress={onPress}
    // A phone's pressable is the 44pt target, the pill drawn inside it (taller with larger text).
    style={compact ? { minHeight: 44, justifyContent: 'center', flexShrink: 0 } : pill}>
    {compact ? <View style={pill}>{content}</View> : content}
  </FocusPressable>;
});

export function ToolbarField({ children, width, flex }: { children: ReactNode; width?: number; flex?: boolean }) {
  const look = useLook();
  return <InheritedContext.Provider value={{ rows: { color: look.ui.ink, 'font-family': look.ui.font, 'font-size': `${look.ui.controlFontSize}px`, 'font-weight': '500' }, fontSize: look.ui.controlFontSize }}>
    {/* On the web the edge is drawn inside, so the select or field itself fills the whole 44px target. */}
    <View style={[look.box(control), width ? { width } : {}, flex ? { flexGrow: 1, flexShrink: 1, minWidth: 0 } : {}, Platform.OS === 'web' && { borderWidth: 0, boxShadow: `inset 0px 0px 0px 1px ${look.ui.glassEdge}` } as never]}>{children}</View>
  </InheritedContext.Provider>;
}

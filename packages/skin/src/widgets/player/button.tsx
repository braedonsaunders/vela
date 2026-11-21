// A chrome control: an icon, or an icon with a short word (Go live). Pointer platforms wash it on hover; keyboards and TV remotes
// show the document's accent ring on the button itself, and on TV the focused control fills
// with the ink and wears the ring too, so it reads from across the room and stands apart from
// the play toggle, which is always filled.
import { FocusPressable as Pressable } from '../../focus';
import { useState, type Ref } from 'react';
import { Text, View, type ViewStyle } from 'react-native';
import type { Focusable } from '../../escape';
import { isFocusVisible } from '../../focus-visible';
import { PlayerIcon, type PlayerIconName } from './icons';
import type { PlayerLook } from './look';
import { useFocusClaim } from '../common/focus-claim';

interface Props {
  look: PlayerLook;
  icon: PlayerIconName;
  label: string;
  /** A word drawn beside the icon: the button widens to fit it, with the same face and focus. */
  text?: string;
  onPress(): void;
  /** The play toggle: filled with the ink. */
  primary?: boolean;
  disabled?: boolean;
  /** A menu button whose menu is open, or a toggle that is on. */
  selected?: boolean;
  /** A smaller visible highlight inside the unchanged pointer/touch target. */
  compact?: boolean;
  size?: number;
  preferred?: boolean;
  testID?: string;
  onFocusChange?(focused: boolean): void;
  /** The button's view, so the chrome can move TV focus onto it. */
  buttonRef?: Ref<Focusable>;
}

export function ChromeButton({
  look,
  icon,
  label,
  text,
  onPress,
  primary,
  disabled,
  selected,
  compact,
  size,
  preferred,
  testID,
  onFocusChange,
  buttonRef,
}: Props) {
  const claim = useFocusClaim(preferred);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const box = look.size(size ?? (primary ? 52 : 44));
  const face = compact && !look.tv ? look.size(32) : box;
  const filled = primary || (look.tv && focus);
  const wash = selected || hover ? look.controlHover : 'transparent';
  const ink = filled ? look.inkInverse : look.ink;
  const style: ViewStyle = {
    width: text ? undefined : box,
    height: box,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: disabled ? 0.35 : 1,
    outlineWidth: 0,
    transform: [{ scale: look.tv && focus && !look.still ? 1.1 : 1 }],
  };
  const faceStyle: ViewStyle = {
    width: text ? undefined : face,
    height: face,
    borderRadius: Math.min(look.radiusControl, face / 2),
    flexDirection: 'row',
    gap: look.size(6),
    paddingHorizontal: text ? look.size(12) : 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: filled ? look.ink : wash,
    outlineColor: look.accent,
    outlineStyle: 'solid',
    outlineWidth: focus ? (look.tv ? look.size(3) : 2) : 0,
    outlineOffset: look.tv ? look.size(3) : 0,
  };
  return (
    <Pressable
      ref={buttonRef as never}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      focusable={!disabled}
      hasTVPreferredFocus={claim}
      testID={testID}
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      onFocus={event => {
        setFocus(isFocusVisible(event.currentTarget));
        onFocusChange?.(true);
      }}
      onPointerDown={() => setFocus(false)}
      onBlur={() => {
        setFocus(false);
        onFocusChange?.(false);
      }}
      style={style}
    >
      <View pointerEvents="none" style={faceStyle}>
        <PlayerIcon name={icon} size={look.size(text ? 18 : 22)} color={ink} />
        {text ? <Text numberOfLines={1} style={look.text(13, 600, ink)}>{text}</Text> : null}
      </View>
    </Pressable>
  );
}

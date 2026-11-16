// An icon-only chrome control. Pointer platforms wash it on hover; keyboards and TV remotes
// show the document's accent ring on the button itself, and on TV the focused control fills
// with the ink so it reads from across the room.
import { useState } from 'react';
import { Pressable, type ViewStyle } from 'react-native';
import { PlayerIcon, type PlayerIconName } from './icons';
import type { PlayerLook } from './look';

interface Props {
  look: PlayerLook;
  icon: PlayerIconName;
  label: string;
  onPress(): void;
  /** The play toggle: filled with the ink. */
  primary?: boolean;
  disabled?: boolean;
  /** A menu button whose menu is open, or a toggle that is on. */
  selected?: boolean;
  size?: number;
  preferred?: boolean;
  testID?: string;
  onFocusChange?(focused: boolean): void;
}

export function ChromeButton({
  look,
  icon,
  label,
  onPress,
  primary,
  disabled,
  selected,
  size,
  preferred,
  testID,
  onFocusChange,
}: Props) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const box = look.size(size ?? (primary ? 52 : 44));
  const filled = primary || (look.tv && focus);
  const wash = selected || hover ? look.controlHover : 'transparent';
  const style: ViewStyle = {
    width: box,
    height: box,
    borderRadius: look.radiusControl >= box / 2 ? box / 2 : look.radiusControl,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: filled ? look.ink : wash,
    opacity: disabled ? 0.35 : 1,
    outlineColor: look.accent,
    outlineStyle: 'solid',
    outlineWidth: focus && !look.tv ? 2 : 0,
    outlineOffset: 0,
    transform: [{ scale: look.tv && focus && !look.still ? 1.1 : 1 }],
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      focusable={!disabled}
      hasTVPreferredFocus={preferred}
      testID={testID}
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      onFocus={() => {
        setFocus(true);
        onFocusChange?.(true);
      }}
      onBlur={() => {
        setFocus(false);
        onFocusChange?.(false);
      }}
      style={style}
    >
      <PlayerIcon name={icon} size={look.size(22)} color={filled ? look.inkInverse : look.ink} />
    </Pressable>
  );
}

// The skin's TextInput. Elsewhere it is TextInput itself; on Apple TV it is drawn by the skin.
//
// tvOS gives a text field its own rounded backing, a white capsule while focused, inside whatever
// box the document draws around it: a box in a box, the capsule spilling over the border. So on
// tvOS the field is a focusable view drawing the value (or the placeholder) in the field's own
// text style, and the TextInput behind it is invisible, there only to take the system keyboard
// when the field is selected.
//
// That input is also made again whenever editing ends: on tvOS (react-native-tvos #1180, new
// architecture) a controlled input edited in the full-screen keyboard keeps its value in state but
// loses it natively, so the keyboard would open on an empty field next time.
import { forwardRef, useCallback, useRef, useState, type ComponentRef, type Ref } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

type Input = ComponentRef<typeof TextInput>;

const TV_DRAWN = Platform.OS === 'ios' && Platform.isTV;

export const TextField: typeof TextInput = TV_DRAWN ? (forwardRef(DrawnField) as unknown as typeof TextInput) : TextInput;

/** Style rows a text draws with; the rest place the field. */
const TEXT_ROWS = new Set([
  'color',
  'fontFamily',
  'fontSize',
  'fontStyle',
  'fontWeight',
  'fontVariant',
  'letterSpacing',
  'lineHeight',
  'textAlign',
  'textTransform',
]);

function DrawnField(props: TextInputProps, forwarded: Ref<Input>) {
  const { style, value, placeholder, placeholderTextColor, secureTextEntry, onFocus, onBlur, onEndEditing } = props;
  const [generation, setGeneration] = useState(0);
  const input = useRef<Input | null>(null);
  const ref = useCallback(
    (node: Input | null) => {
      input.current = node;
      if (typeof forwarded === 'function') forwarded(node);
      else if (forwarded) (forwarded as { current: Input | null }).current = node;
    },
    [forwarded],
  );

  const flat = (StyleSheet.flatten(style) ?? {}) as Record<string, unknown>;
  const text: Record<string, unknown> = {};
  const box: Record<string, unknown> = {};
  for (const [key, row] of Object.entries(flat)) (TEXT_ROWS.has(key) ? text : box)[key] = row;
  const shown = value ? (secureTextEntry ? '•'.repeat(value.length) : value) : (placeholder ?? '');
  const ink = value ? text.color : (placeholderTextColor ?? text.color);

  return (
    <Pressable
      style={[box as ViewStyle, { justifyContent: 'center' }]}
      accessibilityLabel={props.accessibilityLabel}
      accessibilityValue={value && !secureTextEntry ? { text: value } : undefined}
      hasTVPreferredFocus={props.hasTVPreferredFocus}
      onPress={() => input.current?.focus()}
      onFocus={event => onFocus?.(event as never)}
      onBlur={event => onBlur?.(event as never)}
    >
      <Text style={[text as TextStyle, { color: ink as string | undefined }]} numberOfLines={1}>
        {shown}
      </Text>
      <TextInput
        {...props}
        key={generation}
        ref={ref}
        hasTVPreferredFocus={false}
        onFocus={undefined}
        onBlur={undefined}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.hidden}
        onEndEditing={event => {
          onEndEditing?.(event);
          setGeneration(current => current + 1);
        }}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Not opacity 0: UIKit counts a view below 0.01 as hidden, and a hidden field takes no keyboard.
  hidden: { position: 'absolute', left: 0, top: 0, width: 1, height: 1, opacity: 0.02 },
});

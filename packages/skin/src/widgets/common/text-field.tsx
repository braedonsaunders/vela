// The skin's TextInput. On Apple TV (react-native-tvos #1180, new architecture) a controlled field
// that was edited in the full-screen keyboard keeps its value in state but draws its placeholder
// once the keyboard closes (and would reopen the keyboard empty). A newly made field draws its
// value, so on tvOS the field is made again whenever editing ends, and takes the focus back unless
// editing moved it on (Next on a username focuses the password). Elsewhere this is TextInput itself.
import { forwardRef, useCallback, useEffect, useRef, useState, type ComponentRef, type Ref } from 'react';
import { Platform, TextInput, type TextInputProps } from 'react-native';

type Input = ComponentRef<typeof TextInput>;

const REMAKE = Platform.OS === 'ios' && Platform.isTV;

export const TextField: typeof TextInput = REMAKE ? (forwardRef(RemadeField) as unknown as typeof TextInput) : TextInput;

function RemadeField(props: TextInputProps, forwarded: Ref<Input>) {
  const [made, setMade] = useState({ generation: 0, focus: false });
  const own = useRef<Input | null>(null);
  const ref = useCallback(
    (node: Input | null) => {
      own.current = node;
      if (typeof forwarded === 'function') forwarded(node);
      else if (forwarded) (forwarded as { current: Input | null }).current = node;
    },
    [forwarded],
  );
  // Preferred focus is asked for once, as the new field mounts: held, it would pull focus back.
  useEffect(() => {
    if (made.focus) setMade(current => ({ ...current, focus: false }));
  }, [made.focus]);
  const { onEndEditing, hasTVPreferredFocus } = props;
  return (
    <TextInput
      {...props}
      key={made.generation}
      ref={ref}
      hasTVPreferredFocus={made.focus || hasTVPreferredFocus}
      onEndEditing={event => {
        onEndEditing?.(event);
        const focused = TextInput.State.currentlyFocusedInput();
        const movedOn = focused != null && focused !== own.current;
        setMade(current => ({ generation: current.generation + 1, focus: !movedOn }));
      }}
    />
  );
}

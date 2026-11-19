// The skin's TextInput. On Apple TV (react-native-tvos #1180, new architecture) a controlled field
// that was edited in the full-screen keyboard keeps its value in state but draws its placeholder
// once the keyboard closes (and would reopen the keyboard empty). A newly made field draws its
// value, so on tvOS the field is made again whenever editing ends, and takes the focus back unless
// editing moved it on (Next on a username focuses the password).
import { forwardRef, useCallback, useEffect, useRef, useState, type ComponentRef, type Ref } from 'react';
import { Platform, TextInput, type TextInputProps } from 'react-native';

import { useFocusStyles } from '../../focus';

type Input = ComponentRef<typeof TextInput>;

const REMAKE = Platform.OS === 'ios' && Platform.isTV;

const NativeField = REMAKE ? forwardRef(RemadeField) : TextInput;
// The field's own box shows its focus (the skin's field look); on the web the shared ring backs it up.
export const TextField = forwardRef<Input, TextInputProps>(function FocusField(props, ref) {
  useFocusStyles();
  return <NativeField {...props} underlineColorAndroid={props.underlineColorAndroid ?? 'transparent'}
    style={[props.style, Platform.isTV && { backgroundColor: 'transparent', borderWidth: 0, borderRadius: 0 }]} ref={ref} />;
}) as unknown as typeof TextInput;

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

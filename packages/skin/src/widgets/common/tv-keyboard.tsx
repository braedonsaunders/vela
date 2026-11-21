// Vela's own keyboard on Android TV: a sheet over the screen whose keys are ordinary focusable
// buttons, so the remote moves across them as it moves across any of Vela's controls, whatever
// system keyboard the device has (issue #4: on a Shield the D-pad could not move across the system
// keyboard and the screen flickered instead). The text line at the top is a real text field:
// selecting it still opens the system keyboard, for voice and for phone remote apps that type.
// Back closes the sheet and keeps the text; the done key closes it and lets the field submit.
import { memo, useCallback, useRef, useState, type ComponentRef } from 'react';
import { Modal, Platform, Text, View } from 'react-native';
import { FocusPressable as Pressable } from '../../focus';
import { useFocusClaim } from './focus-claim';
import { TextField } from './text-field';
import { useLook } from './look';
import { keyboardRows, keyId, pressKey, type Key, type KeyboardKind, type KeyboardMode } from './tv-keyboard-model';

export { ownKeyboard } from './tv-keyboard-model';

export interface TvKeyboardProps {
  kind: KeyboardKind;
  /** What the field is for, over the text line. */
  label: string;
  value: string;
  onChangeText(value: string): void;
  /** The done key's words: Done, Next, Sign in, Search. */
  doneLabel: string;
  /** The done key: the sheet closes; the caller submits or moves on. */
  onDone(): void;
  /** Back, or the text line's own submit: the sheet closes, the text stays. */
  onClose(): void;
  placeholder?: string;
  testID?: string;
}

const KEY = 46;
const GAP = 6;

/** Width in key units: the action keys are wider than a character. */
function units(key: Key): number {
  switch (key.type) {
    case 'char': return 1;
    case 'space': return 3;
    case 'done': return 2.5;
    case 'clear':
    case 'shift':
    case 'symbols':
    case 'backspace': return 1.6;
  }
}

function caption(key: Key, mode: KeyboardMode, doneLabel: string): string {
  switch (key.type) {
    case 'char': return key.char;
    case 'space': return 'Space';
    case 'backspace': return 'Delete';
    case 'clear': return 'Clear';
    case 'shift': return mode.shift ? 'abc' : 'ABC';
    case 'symbols': return mode.symbols ? 'abc' : '#+=';
    case 'done': return doneLabel;
  }
}

export function TvKeyboard({ kind, label, value, onChangeText, doneLabel, onDone, onClose, placeholder, testID }: TvKeyboardProps) {
  const look = useLook();
  const [mode, setMode] = useState<KeyboardMode>({ shift: false, symbols: false });
  const rows = keyboardRows(kind, mode);
  // Keys are drawn once per layout change and keep a stable press callback: a D-pad move redraws
  // only the two keys whose focus changed, not the whole sheet (Android TV boxes are slow).
  const latest = useRef({ rows, value, mode, onChangeText, onDone });
  latest.current = { rows, value, mode, onChangeText, onDone };
  const onKey = useCallback((row: number, column: number) => {
    const { rows, value, mode, onChangeText, onDone } = latest.current;
    const key = rows[row]?.[column];
    if (!key) return;
    const next = pressKey({ ...mode, value }, key);
    if (next.state.value !== value) onChangeText(next.state.value);
    if (next.state.shift !== mode.shift || next.state.symbols !== mode.symbols) {
      setMode({ shift: next.state.shift, symbols: next.state.symbols });
    }
    if (next.done) onDone();
  }, []);
  const line = useRef<ComponentRef<typeof TextField>>(null);
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} supportedOrientations={['landscape', 'portrait']}>
      <View
        testID={testID}
        style={look.box({
          position: 'absolute', top: '0px', right: '0px', bottom: '0px', left: '0px',
          'background-color': '#050608aa', 'justify-content': 'flex-end', 'align-items': 'center',
        })}
      >
        <View
          style={[
            look.box({
              'max-width': '96%', padding: '20px 24px', gap: '14px', 'border-radius': '24px',
              border: '1px solid $ui.glassEdgeStrong', 'background-color': '$ui.popover', 'margin-bottom': '24px',
            }),
          ]}
        >
          <View style={{ gap: 6 }}>
            <Text style={look.text({ 'font-size': '11px', 'letter-spacing': '2px', color: '$ui.inkSecondary' })}>
              {label.toUpperCase()}
            </Text>
            <View style={look.box({ height: '46px', padding: '0px 16px', 'border-radius': '12px', 'background-color': '$ui.raised', 'justify-content': 'center' })}>
              <TextField
                ref={line}
                value={value}
                onChangeText={onChangeText}
                onSubmitEditing={onClose}
                secureTextEntry={kind === 'password'}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                keyboardType={kind === 'url' ? 'url' : 'default'}
                placeholder={placeholder}
                placeholderTextColor={look.ui.inkQuiet}
                accessibilityLabel={label}
                testID={testID ? `${testID}-line` : undefined}
                style={[look.text({ 'font-size': '18px' }), { padding: 0 }]}
              />
            </View>
          </View>
          <View style={{ gap: GAP, alignItems: 'center' }}>
            {rows.map((row, r) => (
              <View key={r} style={{ flexDirection: 'row', gap: GAP }}>
                {row.map((key, c) => (
                  <KeyButton
                    // By position: Shift relabels the letters without remounting the focused key.
                    key={`${r}-${c}`}
                    row={r}
                    column={c}
                    caption={caption(key, mode, doneLabel)}
                    units={units(key)}
                    primary={key.type === 'done'}
                    // The first letter takes focus as the sheet opens.
                    preferred={r === 1 && c === 0}
                    testID={testID ? `${testID}-${keyId(key)}` : undefined}
                    onKey={onKey}
                  />
                ))}
              </View>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const KeyButton = memo(function KeyButton({ row, column, caption, units, primary, preferred, testID, onKey }: {
  row: number;
  column: number;
  caption: string;
  units: number;
  primary: boolean;
  preferred: boolean;
  testID?: string;
  onKey(row: number, column: number): void;
}) {
  const look = useLook();
  const [focus, setFocus] = useState(false);
  const claim = useFocusClaim(preferred);
  const width = KEY * units + GAP * (units - 1);
  return (
    <Pressable
      focusable
      hasTVPreferredFocus={claim}
      accessibilityRole="button"
      accessibilityLabel={caption}
      testID={testID}
      onPress={() => onKey(row, column)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={[
        look.box({ height: `${KEY - 4}px`, 'border-radius': '10px', 'align-items': 'center', 'justify-content': 'center' }),
        {
          width: Math.round(width),
          backgroundColor: focus ? look.ui.ink : primary ? look.ui.accent : look.ui.control,
          transform: [{ scale: focus && !look.still ? 1.08 : 1 }],
        },
        Platform.OS === 'web' ? ({ outlineStyle: 'none' } as never) : null,
      ]}
    >
      <Text
        numberOfLines={1}
        style={look.text({
          'font-size': caption.length > 1 ? '14px' : '19px',
          'font-weight': '600',
          color: focus ? '$ui.inkInverse' : primary ? '$ui.onAccent' : '$ui.ink',
        })}
      >
        {caption}
      </Text>
    </Pressable>
  );
});

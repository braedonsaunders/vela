// Widget `textInput` (routes.auth): the bare username or password field on the sign-in form.
// The renderer draws the node's box (height, padding, border, ground) around it; the input fills
// that box and takes the inherited text rows. Enter in either field signs in when the form is
// ready. `params`: field (`username` | `password`), placeholder, label, placeholderColor.
import { Platform, TextInput as NativeInput, type TextStyle } from 'react-native';
import { withClientStrings } from '../../../../../client/src/skin/client-strings';
import { colour } from '../../css';
import { useInheritedText, type WidgetProps } from '../../host';
import { useAuthForm, type AuthField } from './form';

const FIELDS: Record<AuthField, { autoComplete: 'username' | 'current-password'; content: 'username' | 'password' }> =
  {
    username: { autoComplete: 'username', content: 'username' },
    password: { autoComplete: 'current-password', content: 'password' },
  };

export function TextInput({ params }: WidgetProps) {
  const form = useAuthForm();
  const drawn = useInheritedText();
  const field: AuthField = params.field === 'password' ? 'password' : 'username';
  // Outside the signed-out screen there is no form to edit: draw nothing rather than a dead field.
  if (!form) return null;
  const placeholder = params.placeholder ? withClientStrings(params.placeholder) : undefined;
  const label = params.label ? withClientStrings(params.label) : placeholder;
  const kind = FIELDS[field];
  const style: TextStyle = {
    flex: 1,
    alignSelf: 'stretch',
    minWidth: 0,
    padding: 0,
    ...(Platform.OS === 'web' ? ({ outlineWidth: 0 } as TextStyle) : {}),
  };
  return (
    <NativeInput
      value={form.values[field]}
      onChangeText={value => form.edit(field, value)}
      onSubmitEditing={form.submit}
      secureTextEntry={field === 'password'}
      autoComplete={kind.autoComplete}
      textContentType={kind.content}
      autoCapitalize="none"
      autoCorrect={false}
      spellCheck={false}
      returnKeyType={field === 'password' ? 'go' : 'next'}
      submitBehavior={field === 'password' ? 'blurAndSubmit' : 'submit'}
      placeholder={placeholder}
      placeholderTextColor={
        (params.placeholderColor && colour(params.placeholderColor)) || (drawn.style.color as string | undefined)
      }
      accessibilityLabel={label}
      testID={`signin-${field}`}
      nativeID={`vela-${field}`}
      style={[drawn.style, style]}
    />
  );
}

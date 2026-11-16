// Widget `textInput` (routes.auth): the bare username or password field on the sign-in form.
// The renderer draws the node's box (height, padding, border, ground) around it; the input fills
// that box and takes the inherited text rows. Native username Next focuses the password;
// password Go and web Enter submit. `params`: field, placeholder, label, placeholderColor.
import { Platform, TextInput as NativeInput, type TextStyle } from 'react-native';
import { withClientStrings } from '../../resolve/client-strings';
import { colour } from '../../css';
import { useInheritedText, useWidgetInteraction, type WidgetProps } from '../../host';
import { useAuthForm, type AuthField } from './form';

const FIELDS: Record<AuthField, { autoComplete: 'username' | 'current-password'; content: 'username' | 'password' }> =
  {
    username: { autoComplete: 'username', content: 'username' },
    password: { autoComplete: 'current-password', content: 'password' },
  };

export function TextInput({ params }: WidgetProps) {
  const form = useAuthForm();
  const drawn = useInheritedText();
  // The node's box shows its hover and focus looks (a field's accent ring) while these hold.
  const interaction = useWidgetInteraction();
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
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as unknown as TextStyle) : {}),
  };
  return (
    <NativeInput
      ref={field === 'password' ? form.registerPasswordInput : undefined}
      value={form.values[field]}
      onChangeText={value => form.edit(field, value)}
      onSubmitEditing={Platform.OS !== 'web' && field === 'username' ? form.focusPassword : form.submit}
      onFocus={() => interaction.report('focus', true)}
      onBlur={() => interaction.report('focus', false)}
      onPointerEnter={() => interaction.report('hover', true)}
      onPointerLeave={() => interaction.report('hover', false)}
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

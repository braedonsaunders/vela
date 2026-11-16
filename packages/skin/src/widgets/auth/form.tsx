// The sign-in form's fields. The signed-out screen owns the typed username and password and
// provides them here; the document's `textInput` widgets edit them.
// They never enter the binding environment, so a document can test `signin.ready` but cannot
// read what was typed.
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { TextInput } from 'react-native';

export type AuthField = 'username' | 'password';

export interface AuthForm {
  values: Record<AuthField, string>;
  edit(field: AuthField, value: string): void;
  /** Enter in a field: sign in when the form is ready. */
  submit(): void;
  registerPasswordInput(input: TextInput | null): void;
  focusPassword(): void;
}

const FormContext = createContext<AuthForm | null>(null);

export function useAuthForm(): AuthForm | null {
  return useContext(FormContext);
}

/** The fields' state, for the screen that signs in with them. */
export function useAuthFields() {
  const [values, setValues] = useState<Record<AuthField, string>>({ username: '', password: '' });
  const edit = useCallback((field: AuthField, value: string) => setValues(v => ({ ...v, [field]: value })), []);
  const clearPassword = useCallback(() => setValues(v => ({ ...v, password: '' })), []);
  const ready = values.username.trim() !== '' && values.password !== '';
  return { values, edit, clearPassword, ready };
}

export function AuthFormProvider({ values, edit, submit, children }: Pick<AuthForm, 'values' | 'edit' | 'submit'> & {
  children: ReactNode;
}) {
  const passwordInput = useRef<TextInput | null>(null);
  const registerPasswordInput = useCallback((input: TextInput | null) => {
    passwordInput.current = input;
  }, []);
  const focusPassword = useCallback(() => passwordInput.current?.focus(), []);
  const form = useMemo<AuthForm>(
    () => ({ values, edit, submit, registerPasswordInput, focusPassword }),
    [values, edit, submit, registerPasswordInput, focusPassword],
  );
  return <FormContext.Provider value={form}>{children}</FormContext.Provider>;
}

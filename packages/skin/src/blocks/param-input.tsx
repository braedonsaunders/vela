// The `paramInput` layout block (`docs/plugin-screens.md` §6): text input bound to a page parameter
// (`param`), dispatching a debounced `setParam` as the user types. Focusable on TV and never a
// password field (`secureTextEntry={false}`).
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useHost } from '../host';
import { fill, type Template } from '../resolve';
import type { Ctx } from '../vocabulary';
import { TextField } from '../widgets/common/text-field';
import { useBlockLook } from './look';
import type { ParamInputBlockNode } from './types';

const DEBOUNCE_MS = 220;

export function ParamInputBlock({ node, ctx }: { node: ParamInputBlockNode; ctx: Ctx }) {
  const host = useHost();
  const look = useBlockLook();

  const paramName = node.param;
  const externalValue =
    (ctx as { screen?: { page?: { params?: Record<string, string> } } }).screen?.page?.params?.[paramName] ?? '';
  const [value, setValue] = useState(externalValue);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setValue(externalValue);
  }, [externalValue]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const commit = useCallback(
    (nextValue: string) => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      host.dispatch('setParam', paramName, {
        args: { param: paramName, value: nextValue },
      } as never);
    },
    [host, paramName],
  );

  const onChangeText = useCallback(
    (next: string) => {
      setValue(next);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        commit(next);
      }, DEBOUNCE_MS);
    },
    [commit],
  );

  const placeholder = node.placeholder ? fill(node.placeholder as Template, ctx, host.env).trim() : '';
  const id = node.id ? fill(node.id as Template, ctx, host.env).trim() : `param-${paramName}`;

  return (
    <View style={{ paddingHorizontal: look.gutter }}>
      <TextField
        id={id || `param-${paramName}`}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={() => commit(value)}
        placeholder={placeholder}
        placeholderTextColor={look.quiet}
        color={look.ink}
        backgroundColor={look.cardFill}
        borderColor={look.cardEdge}
        focusBorderColor={look.ink}
      />
    </View>
  );
}

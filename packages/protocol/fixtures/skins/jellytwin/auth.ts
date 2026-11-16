// The signed-out page: sign-in, Quick Connect, and the connecting and offline notices.
import type { Condition, Node, Style } from '../../../skin';
import { sans, gradient, col, glyph, submit, submitFocus, spinner, raised } from './look';

// The signed-out page: the mark above a plain dark form, with a faint gradient wash.
const field: Style = {
  'box-sizing': 'border-box',
  width: '100%',
  height: '44px',
  padding: '0px 12px',
  border: '1px solid $field',
  'border-radius': '4px',
  'background-color': '$field',
  color: '$ink-strong',
  'font-size': '16px',
  outline: 'none',
};
const fieldLabel = (text: string): Node => ({
  type: 'text',
  text,
  style: { 'font-size': '14px', color: '$secondary' },
});
// The input fills its box: the box gives it the field's height and the space after it.
const textField = (name: 'username' | 'password', label: string, gapAfter: number): Node => ({
  type: 'box',
  style: col({ height: '44px', 'margin-bottom': `${gapAfter}px`, 'flex-shrink': '0' }),
  children: [
    {
      type: 'widget',
      widget: 'textInput',
      params: { field: name, label },
      style: field,
      focus: { 'border-color': '$accent', 'border-top-color': '$accent', 'border-bottom-color': '$accent' },
    } as Node,
  ],
});
const authIs = (v: string): Condition => ({ test: 'env.auth', is: 'eq', value: v });
const notAuth = (v: string): Condition => ({ test: 'env.auth', is: 'ne', value: v });
// Connecting, redeeming a web code, offline: the spinner (or the alert) and a line of copy.
const notice: Node = {
  type: 'box',
  when: [notAuth('signin'), notAuth('quick')],
  motion: 'fadeIn',
  style: col({ gap: '16px', 'align-items': 'center', 'text-align': 'center', padding: '12px 0px' }),
  children: [
    {
      type: 'box',
      when: [authIs('offline')],
      role: 'alert',
      style: col({ gap: '16px', 'align-items': 'center' }),
      children: [
        glyph('alert', 40, { style: { width: '40px', height: '40px', color: '$danger' } }),
        {
          type: 'text',
          text: '{s:unreachable}',
          role: 'heading',
          level: 1,
          style: { 'font-size': '24px', 'font-weight': '600', color: '$ink-strong' },
        },
        {
          type: 'text',
          text: '{s:unreachableHint}',
          style: { 'font-size': '15px', 'line-height': '1.5', color: '$secondary' },
        },
      ],
    },
    {
      type: 'box',
      when: [notAuth('offline')],
      role: 'status',
      style: col({ gap: '16px', 'align-items': 'center' }),
      children: [
        spinner(48),
        {
          type: 'text',
          when: [authIs('redeeming')],
          text: '{s:signingYouIn}',
          style: { 'font-size': '15px', 'line-height': '1.5', color: '$secondary' },
        },
        {
          type: 'text',
          when: [notAuth('redeeming')],
          text: '{s:connecting}',
          style: { 'font-size': '15px', 'line-height': '1.5', color: '$secondary' },
        },
      ],
    },
  ],
};
const signIn: Node = {
  type: 'box',
  when: [authIs('signin')],
  motion: 'fadeIn',
  style: col({ gap: '8px' }),
  children: [
    {
      type: 'text',
      text: '{s:pleaseSignIn}',
      role: 'heading',
      level: 1,
      style: {
        'font-size': '28px',
        'font-weight': '500',
        color: '$ink-strong',
        'text-align': 'center',
        'margin-bottom': '12px',
      },
    },
    {
      type: 'text',
      when: [{ test: 'signin.error' }],
      text: '{signin.error}',
      role: 'alert',
      style: {
        'font-size': '14px',
        'line-height': '1.45',
        color: '$ink-strong',
        padding: '10px 12px',
        'margin-bottom': '8px',
        'border-radius': '4px',
        'background-color': '$raised',
        'border-left-width': '4px',
        'border-left-color': '$danger',
        'border-style': 'solid',
        'border-width': '0px',
        'border-top-width': '0px',
        'border-bottom-width': '0px',
      },
    },
    { ...fieldLabel('{s:user}'), when: [{ test: 'signin.canPassword' }] } as Node,
    { ...textField('username', '{s:username}', 10), when: [{ test: 'signin.canPassword' }] } as Node,
    { ...fieldLabel('{s:password}'), when: [{ test: 'signin.canPassword' }] } as Node,
    { ...textField('password', '{s:password}', 18), when: [{ test: 'signin.canPassword' }] } as Node,
    {
      type: 'box',
      when: [{ test: 'signin.canPassword' }],
      press: { action: 'signIn' },
      label: '{s:signIn}',
      testId: 'sign-in',
      disabled: [{ test: 'signin.ready', not: true }],
      disabledStyle: { opacity: '0.45' },
      style: submit,
      hover: { opacity: '0.9' },
      focus: submitFocus,
      children: [
        { type: 'text', when: [{ test: 'signin.busy', not: true }], text: '{s:signIn}' },
        { type: 'text', when: [{ test: 'signin.busy' }], text: '{s:signingIn}' },
      ],
    },
    {
      type: 'box',
      when: [{ test: 'signin.canQuick' }],
      press: { action: 'startQuick' },
      label: '{s:quickConnect}',
      testId: 'quick-connect',
      disabled: [{ test: 'signin.busy' }],
      disabledStyle: { opacity: '0.45' },
      style: { ...raised, height: '46px', 'margin-top': '12px' },
      hover: { 'background-color': '$raised-hover' },
      focus: { 'box-shadow': '0px 0px 0px 2px $accent', outline: 'auto' },
      children: [{ type: 'text', text: '{s:quickConnect}' }],
    },
    {
      type: 'text',
      when: [
        { test: 'signin.canPassword', not: true },
        { test: 'signin.canQuick', not: true },
      ],
      role: 'status',
      text: '{s:noSignIn}',
      style: { 'font-size': '14px', 'line-height': '1.5', color: '$secondary', 'text-align': 'center' },
    },
  ],
};
const quick: Node = {
  type: 'box',
  when: [authIs('quick')],
  motion: 'fadeIn',
  style: col({ gap: '18px', 'align-items': 'center', 'text-align': 'center' }),
  children: [
    {
      type: 'text',
      text: '{s:quickConnect}',
      role: 'heading',
      level: 1,
      style: { 'font-size': '28px', 'font-weight': '500', color: '$ink-strong' },
    },
    {
      type: 'text',
      text: '{s:approveCode}',
      style: { 'font-size': '15px', 'line-height': '1.5', color: '$secondary', 'max-width': '320px' },
    },
    {
      type: 'text',
      text: '{quick.code}',
      label: '{quick.code}',
      testId: 'connect-code',
      style: {
        'font-family': 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
        'font-size': '44px',
        'font-weight': '600',
        'letter-spacing': '0.18em',
        color: '$accent',
        padding: '10px 18px',
        'border-radius': '6px',
        'background-color': '$raised',
      },
    },
    spinner(22, { when: [{ test: 'quick.error', not: true }] }),
    {
      type: 'text',
      when: [{ test: 'quick.error', not: true }],
      role: 'status',
      text: '{s:waitingApproval}',
      style: { 'font-size': '14px', color: '$secondary' },
    },
    {
      type: 'text',
      when: [{ test: 'quick.error' }],
      role: 'status',
      text: '{quick.error}',
      style: { 'font-size': '14px', color: '$ink-strong' },
    },
    { type: 'text', text: '{s:codeExpires}', style: { 'font-size': '13px', color: '$quiet' } },
    {
      type: 'box',
      press: { action: 'cancelQuick' },
      label: '{s:cancel}',
      style: { ...raised, width: '100%', height: '46px' },
      hover: { 'background-color': '$raised-hover' },
      focus: { 'box-shadow': '0px 0px 0px 2px $accent', outline: 'auto' },
      children: [{ type: 'text', text: '{s:cancel}' }],
    },
  ],
};
// The stage centres a 420px column: the mark, then the step, rising in together.
const step = (n: Node): Node =>
  ({
    ...n,
    motion: 'riseIn',
    style: { ...(n as { style: Style }).style, position: 'relative', width: '100%', 'max-width': '420px' },
  }) as Node;
export const auth: Node = {
  type: 'box',
  layoutTransition: '300ms ease-out',
  style: col({
    position: 'relative',
    'min-height': '100dvh',
    width: '100%',
    'box-sizing': 'border-box',
    'align-items': 'center',
    gap: '36px',
    padding: 'max(48px, 12vh) 18px 48px',
    'background-color': '$page',
    color: '$ink',
    'color-scheme': 'dark',
    'font-family': sans,
    'overflow-x': 'hidden',
    'overflow-y': 'hidden',
  }),
  children: [
    {
      type: 'box',
      style: {
        position: 'absolute',
        left: '-20%',
        right: '-20%',
        top: '-40%',
        height: '80%',
        'pointer-events': 'none',
        opacity: '0.22',
        'background-image': gradient,
        'mask-image': 'radial-gradient(closest-side, black 0%, transparent 100%)',
      },
    },
    {
      type: 'image',
      src: 'assets/brand/vela-lockup.svg',
      alt: '',
      motion: 'riseIn',
      style: { position: 'relative', width: `${46 * 2.629}px`, height: '46px', 'flex-shrink': '0' },
    },
    step(notice),
    step(signIn),
    step(quick),
  ],
};

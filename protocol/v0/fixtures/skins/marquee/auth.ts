// The signed-out page: the wordmark over one card for every sign-in state.
import type { Node, Style } from '../../../skin';
import { sans, is, set, unset, glyph, wordmark, primary, secondary } from './look';
import { spinner } from './cards';

// Every signed-out state stands on a dark page: the wordmark over one plain card.
const fieldLabel: Style = {
  'font-size': '12px',
  'font-weight': '700',
  'letter-spacing': '0.06em',
  'text-transform': 'uppercase',
  color: '$ink-faint',
};
const textField = (field: 'username' | 'password', top: string): Node => ({
  type: 'box',
  style: { display: 'flex', 'flex-direction': 'column', 'margin-top': top, width: '100%', height: '44px' },
  children: [
    {
      type: 'widget',
      widget: 'textInput',
      params: { field, label: field === 'username' ? '{s:username}' : '{s:password}' },
      style: {
        width: '100%',
        height: '100%',
        'box-sizing': 'border-box',
        padding: '0px 14px',
        border: '1px solid $line-strong',
        'border-radius': '4px',
        'background-color': '$field',
        color: '$ink',
        'font-size': '15px',
        'font-family': sans,
        outline: 'none',
      },
      hover: { 'border-color': '$ink-faint' },
      focus: { outline: 'none', 'border-color': '$amber', 'box-shadow': '0px 0px 0px 1px $amber' },
    } as Node,
  ],
});
const auth = (is_: string) => is('env.auth', is_);
const authNotice: Node[] = [
  {
    type: 'box',
    when: [auth('offline')],
    role: 'alert',
    style: {
      display: 'flex',
      'flex-direction': 'column',
      gap: '14px',
      'align-items': 'center',
      'text-align': 'center',
      padding: '8px 0px',
    },
    children: [
      glyph('alert', 32, { style: { color: '$amber' } }),
      {
        type: 'text',
        text: '{s:serverUnreachable}',
        role: 'heading',
        level: 1,
        style: { 'font-size': '22px', 'font-weight': '700' },
      },
      {
        type: 'text',
        text: '{s:serverUnreachableHint}',
        style: { color: '$ink-dim', 'font-size': '15px', 'line-height': '1.5' },
      },
    ],
  },
  ...(['connecting', 'redeeming'] as const).map((k): Node => ({
    type: 'box',
    when: [auth(k)],
    role: 'status',
    style: {
      display: 'flex',
      'flex-direction': 'column',
      gap: '14px',
      'align-items': 'center',
      'text-align': 'center',
      padding: '8px 0px',
    },
    children: [
      spinner(36),
      {
        type: 'text',
        text: k === 'redeeming' ? '{s:signingYouIn}' : '{s:connecting}',
        style: { color: '$ink-dim', 'font-size': '15px' },
      },
    ],
  })),
];
const signInButton = (busy: boolean): Node =>
  ({
    type: 'box',
    when: [{ test: 'signin.busy', not: !busy }],
    press: { action: 'signIn' },
    label: '{s:signIn}',
    testId: 'sign-in',
    disabled: busy ? [set('signin.busy')] : [{ test: 'signin.ready', not: true }],
    disabledStyle: { 'background-color': '$raised', color: '$ink-faint' },
    ...primary(46, '0px'),
    style: { ...primary(46, '0px').style, gap: '10px', 'margin-top': '20px' },
    children: [
      ...(busy ? [spinner(18)] : []),
      { type: 'text', text: busy ? '{s:signingIn}' : '{s:signIn}', style: { 'font-size': '16px' } },
    ],
  }) as Node;
const signIn: Node[] = [
  {
    type: 'text',
    when: [auth('signin')],
    text: '{s:signIn}',
    role: 'heading',
    level: 1,
    style: { 'font-size': '24px', 'font-weight': '700' },
  },
  {
    type: 'text',
    when: [auth('signin')],
    text: '{s:signInToYourLibrary}',
    style: { color: '$ink-dim', 'font-size': '15px', 'margin-top': '6px' },
  },
  {
    type: 'box',
    when: [auth('signin'), set('signin.error')],
    role: 'alert',
    style: {
      display: 'flex',
      'flex-direction': 'row',
      gap: '10px',
      'align-items': 'flex-start',
      padding: '10px 12px',
      'margin-top': '20px',
      'border-radius': '4px',
      'background-color': '$amber-soft',
      'box-shadow': 'inset 3px 0px 0px $amber',
    },
    children: [
      glyph('alert', 18, { style: { color: '$amber' } }),
      { type: 'text', text: '{signin.error}', style: { 'font-size': '14px', 'line-height': '1.45' } },
    ],
  },
  {
    type: 'text',
    when: [auth('signin'), set('signin.canPassword')],
    text: '{s:username}',
    style: { ...fieldLabel, 'margin-top': '20px' },
  },
  { ...textField('username', '6px'), when: [auth('signin'), set('signin.canPassword')] },
  {
    type: 'text',
    when: [auth('signin'), set('signin.canPassword')],
    text: '{s:password}',
    style: { ...fieldLabel, 'margin-top': '14px' },
  },
  { ...textField('password', '6px'), when: [auth('signin'), set('signin.canPassword')] },
  { ...signInButton(false), when: [auth('signin'), set('signin.canPassword'), unset('signin.busy')] },
  { ...signInButton(true), when: [auth('signin'), set('signin.canPassword'), set('signin.busy')] },
  {
    type: 'box',
    when: [auth('signin'), set('signin.canPassword'), set('signin.canQuick')],
    style: {
      display: 'flex',
      'flex-direction': 'row',
      gap: '12px',
      'align-items': 'center',
      'margin-top': '20px',
    },
    children: [
      { type: 'box', style: { flex: '1', height: '1px', 'background-color': '$line-strong' } },
      { type: 'text', text: '{s:or}', style: { 'font-size': '13px', color: '$ink-faint' } },
      { type: 'box', style: { flex: '1', height: '1px', 'background-color': '$line-strong' } },
    ],
  },
  {
    type: 'box',
    when: [auth('signin'), set('signin.canQuick')],
    press: { action: 'startQuick' },
    label: '{s:connectWithACode}',
    testId: 'quick-connect',
    disabled: [set('signin.busy')],
    disabledStyle: { opacity: '0.45' },
    ...secondary(46, '0px'),
    style: { ...secondary(46, '0px').style, gap: '10px', 'margin-top': '20px' },
    children: [
      glyph('phone', 18),
      { type: 'text', text: '{s:connectWithACode}', style: { 'font-size': '15px' } },
    ],
  } as Node,
  {
    type: 'text',
    when: [auth('signin'), unset('signin.canPassword'), unset('signin.canQuick')],
    role: 'status',
    text: '{s:noSignInMethods}',
    style: { color: '$ink-dim', 'font-size': '14px', 'line-height': '1.55', 'margin-top': '20px' },
  },
];
// Quick connect: the code to approve from a signed-in device, in large amber type.
const quickConnect: Node = {
  type: 'box',
  when: [auth('quick')],
  style: {
    display: 'flex',
    'flex-direction': 'column',
    gap: '20px',
    'align-items': 'center',
    'text-align': 'center',
  },
  children: [
    {
      type: 'box',
      style: { display: 'flex', 'flex-direction': 'column', gap: '6px', 'align-items': 'center' },
      children: [
        {
          type: 'text',
          text: '{s:connectWithACode}',
          role: 'heading',
          level: 1,
          style: { 'font-size': '24px', 'font-weight': '700' },
        },
        {
          type: 'text',
          text: '{s:approveCode}',
          style: { color: '$ink-dim', 'font-size': '15px', 'line-height': '1.5', 'max-width': '320px' },
        },
      ],
    },
    {
      type: 'text',
      text: '{quick.code}',
      label: '{quick.code}',
      testId: 'connect-code',
      style: {
        'font-family': 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
        'font-size': '38px',
        'font-weight': '700',
        'letter-spacing': '0.18em',
        color: '$amber',
        padding: '14px 20px',
        'border-radius': '6px',
        'background-color': '$chrome',
        'box-shadow': 'inset 0px 0px 0px 1px $line',
      },
    },
    {
      type: 'box',
      style: { display: 'flex', 'flex-direction': 'column', gap: '8px', 'align-items': 'center' },
      children: [
        {
          type: 'box',
          role: 'status',
          style: { display: 'flex', 'flex-direction': 'row', gap: '10px', 'align-items': 'center' },
          children: [
            spinner(16, { when: [unset('quick.error')] }),
            {
              type: 'text',
              when: [unset('quick.error')],
              text: '{s:waitingForApproval}',
              style: { color: '$ink-dim', 'font-size': '14px' },
            },
            {
              type: 'text',
              when: [set('quick.error')],
              text: '{quick.error}',
              style: { color: '$amber', 'font-size': '14px' },
            },
          ],
        },
        { type: 'text', text: '{s:codeExpires}', style: { color: '$ink-faint', 'font-size': '13px' } },
      ],
    },
    {
      type: 'box',
      press: { action: 'cancelQuick' },
      label: '{s:cancel}',
      ...secondary(42, '0px 26px'),
      children: [{ type: 'text', text: '{s:cancel}', style: { 'font-size': '14px' } }],
    },
  ],
};
export const authRoute: Node = {
  type: 'box',
  style: {
    position: 'relative',
    display: 'flex',
    'flex-direction': 'column',
    'min-height': '100dvh',
    width: '100%',
    'box-sizing': 'border-box',
    'align-items': 'center',
    'justify-content': 'center',
    padding: 'max(32px, 8vh) 16px',
    gap: '28px',
    'background-color': '$chrome',
    'background-image': 'radial-gradient(ellipse 80% 60% at 50% 0%, $raised 0%, $chrome 70%)',
    color: '$ink',
    'color-scheme': 'dark',
  },
  children: [
    wordmark(44),
    {
      type: 'box',
      motion: 'arrive',
      style: {
        display: 'flex',
        'flex-direction': 'column',
        width: '100%',
        'max-width': '420px',
        'box-sizing': 'border-box',
        'font-family': sans,
        padding: 'clamp(24px, 5vw, 36px)',
        'border-radius': '8px',
        'background-color': '$page',
        'box-shadow': '0px 24px 60px $shadow, 0px 0px 0px 1px $line',
      },
      children: [...authNotice, ...signIn, quickConnect],
    },
  ],
};

// The signed-out stage: the night sky with petals, Mochi peeking over the card, and the sign-in steps.
import type { Action, Node, Style } from '../../../skin';
import {
  Candy,
  Label,
  Pixel,
  Puffy,
  Title,
  asset,
  candy,
  col,
  fredoka,
  icon,
  inset0,
  is,
  mascot,
  moving,
  not,
  pixelFace,
  puffy,
  row,
  set,
  sz,
} from './look';

// A night sky (look.contract NightSky): a gradient, a field of twinkling pixel stars and,
// unless still, sakura petals drifting down. It fills its positioned parent, behind.
export const STARS = Array.from({ length: 20 }, (_, i) => i);
export const PETALS = Array.from({ length: 6 }, (_, i) => i);
export const nightSky = (petals: boolean): Node => ({
  type: 'box',
  style: {
    ...inset0,
    'overflow-x': 'hidden',
    'overflow-y': 'hidden',
    'pointer-events': 'none',
    'background-image': [
      'radial-gradient(ellipse 80% 60% at 85% -10%, $night-3 0%, $night-clear 70%)',
      'radial-gradient(ellipse 70% 50% at 0% 100%, $night-2 0%, $night-clear 70%)',
      'linear-gradient(180deg, $night 0%, $night-2 100%)',
    ].join(', '),
  },
  children: [
    ...STARS.map(
      i =>
        ({
          type: 'box',
          style: { position: 'absolute', left: `${(i * 37 + 6) % 97}%`, top: `${(i * 53 + 11) % 91}%` },
          children: [
            icon('sparkle', i % 4 === 0 ? 10 : i % 3 === 0 ? 7 : 5, i % 5 === 0 ? 'sakura' : 'star', {
              motion: `star${i}`,
            }),
          ],
        }) as Node,
    ),
    ...(petals
      ? PETALS.map(
          i =>
            ({
              type: 'box',
              when: [moving],
              motion: `petal${i}`,
              style: { position: 'absolute', left: `${8 + i * 17}%`, top: '0px' },
              children: [
                { type: 'image', src: asset('petal.svg'), alt: '', style: sz(i % 2 === 0 ? 14 : 10) },
              ],
            }) as Node,
        )
      : []),
  ],
});

// Three pixel hearts that hop in turn: the skin's small indeterminate progress (auth.contract Dots).
export const dots: Node = {
  type: 'box',
  style: { ...row, gap: '8px' },
  children: (['pink', 'lavender', 'mint'] as const).map((c, i) =>
    icon('heart', 14, c, { motion: `dot${i}` }),
  ),
};

// Mochi's field (look.contract Field) around the bare input.
export const Field: Style = {
  'box-sizing': 'border-box',
  height: '52px',
  padding: '0px 20px',
  border: '3px solid $ink',
  'border-radius': '18px',
  'background-color': '$card',
  color: '$ink',
  'font-family': fredoka,
  'font-size': '17px',
  outline: 'none',
  'box-shadow': 'inset 0px 3px 0px $page-deep',
};
export const textField = (field: 'username' | 'password', label: string): Node => ({
  type: 'box',
  style: { ...col, gap: '6px' },
  children: [
    { type: 'text', text: label, style: { ...Label, 'font-size': '11px', color: '$ink-soft' } },
    {
      type: 'widget',
      widget: 'textInput',
      params: { field, label },
      style: Field,
      focus: {
        'border-color': '$lavender-deep',
        'box-shadow': '0px 0px 0px 4px $lavender-soft',
        outline: 'none',
      },
    } as Node,
  ],
});

export const welcome = (title: string, line: string, extra: Style = {}): Node => ({
  type: 'box',
  style: { ...col, gap: '8px', 'align-items': 'center', 'text-align': 'center' },
  children: [
    { type: 'text', text: title, role: 'heading', level: 1, style: { ...Title, 'font-size': '34px' } },
    {
      type: 'text',
      text: line,
      style: { color: '$ink-soft', 'font-size': '16px', 'line-height': '1.5', ...extra },
    },
  ],
});
export const dashed: Node = {
  type: 'box',
  style: {
    flex: '1',
    height: '0px',
    'border-style': 'dashed',
    'border-width': '0px',
    'border-top-width': '2.5px',
    'border-top-color': '$line-strong',
  },
};

// Connecting, redeeming a web code, or offline (auth.contract AuthNotice).
export const authNotice: Node[] = [
  {
    type: 'box',
    when: [is('env.auth', 'offline')],
    role: 'alert',
    motion: 'hop0',
    exit: 'stepOut',
    style: { ...col, gap: '14px', 'align-items': 'center', 'text-align': 'center', padding: '8px 0px' },
    children: [
      {
        type: 'box',
        style: {
          ...row,
          ...sz(46),
          'border-radius': '23px',
          'align-items': 'center',
          'justify-content': 'center',
          'background-color': '$alert',
          border: '2.5px solid $ink',
          'box-sizing': 'border-box',
          color: '$pink-deep',
        },
        children: [icon('alert', 20)],
      },
      {
        type: 'text',
        text: '{s:serverUnreachable}',
        role: 'heading',
        level: 1,
        style: { ...Title, 'font-size': '30px' },
      },
      {
        type: 'text',
        text: '{s:serverUnreachableHint}',
        style: { color: '$ink-soft', 'font-size': '15px', 'line-height': '1.55' },
      },
    ],
  },
  ...(['connecting', 'redeeming'] as const).map(
    k =>
      ({
        type: 'box',
        when: [is('env.auth', k)],
        role: 'status',
        motion: 'hop0',
        exit: 'stepOut',
        style: { ...col, gap: '14px', 'align-items': 'center', 'text-align': 'center', padding: '8px 0px' },
        children: [
          dots,
          {
            type: 'text',
            text: k === 'redeeming' ? '{s:signingYouIn}' : '{s:connecting}',
            style: { ...Pixel, color: '$ink-soft', 'font-size': '16px' },
          },
        ],
      }) as Node,
  ),
];

// Sign in (auth.contract SignIn). Sign in waits for both fields (signin.ready: not busy, a
// username and a password).
export const signInButton: Style = { ...Candy, height: '54px', 'margin-top': '8px', gap: '10px' };
export const signIn: Node = {
  type: 'box',
  when: [is('env.auth', 'signin')],
  motion: 'hop60',
  exit: 'stepOut',
  style: { ...col, gap: '22px' },
  children: [
    welcome('{s:welcome}', '{s:signInHint}'),
    {
      type: 'box',
      when: [set('signin.error')],
      role: 'alert',
      motion: 'pop0',
      style: {
        ...row,
        gap: '10px',
        'align-items': 'flex-start',
        padding: '12px 14px',
        'border-radius': '18px',
        'background-color': '$alert',
        border: '2.5px solid $pink-deep',
        color: '$ink',
      },
      children: [
        icon('alert', 16, 'pink-deep', { style: { 'margin-top': '2px' } }),
        { type: 'text', text: '{signin.error}', style: { 'font-size': '14px', 'line-height': '1.45' } },
      ],
    },
    {
      type: 'box',
      when: [set('signin.canPassword')],
      style: { ...col, gap: '14px' },
      children: [
        textField('username', '{s:username}'),
        textField('password', '{s:password}'),
        {
          type: 'box',
          press: { action: 'signIn' as Action },
          label: '{s:signIn}',
          testId: 'sign-in',
          disabled: [not('signin.ready')],
          style: signInButton,
          ...candy,
          disabledStyle: { 'background-color': '$pink-soft', color: '$ink-soft', 'box-shadow': 'none' },
          children: [
            { ...dots, when: [set('signin.busy')] } as Node,
            icon('heart', 14, undefined, { when: [not('signin.busy')] }),
            { type: 'text', text: '{s:signIn}', when: [not('signin.busy')], style: { 'font-size': '17px' } },
            {
              type: 'text',
              text: '{s:signingIn}',
              when: [set('signin.busy')],
              style: { 'font-size': '17px' },
            },
          ],
        } as Node,
      ],
    },
    {
      type: 'box',
      when: [set('signin.canPassword'), set('signin.canQuick')],
      style: { ...row, gap: '12px', 'align-items': 'center' },
      children: [
        dashed,
        { type: 'text', text: '{s:or}', style: { ...Pixel, 'font-size': '13px', color: '$ink-quiet' } },
        dashed,
      ],
    },
    {
      type: 'box',
      when: [set('signin.canQuick')],
      press: { action: 'startQuick' as Action },
      label: '{s:connectWithCode}',
      testId: 'quick-connect',
      disabled: [set('signin.busy')],
      disabledStyle: { opacity: '0.5', 'box-shadow': 'none' },
      style: { ...Puffy, height: '52px', gap: '10px' },
      ...puffy,
      children: [
        icon('phone', 16),
        { type: 'text', text: '{s:connectWithCode}', style: { 'font-size': '16px' } },
      ],
    } as Node,
    {
      type: 'box',
      when: [not('signin.canPassword'), not('signin.canQuick')],
      role: 'status',
      style: { ...col, gap: '10px', 'align-items': 'center', 'text-align': 'center' },
      children: [
        mascot('sleepy', 56),
        {
          type: 'text',
          text: '{s:noSignIn}',
          style: { color: '$ink-soft', 'font-size': '14px', 'line-height': '1.55' },
        },
      ],
    },
  ],
};

// Quick connect: the code in candy tiles that pop in one by one (auth.contract QuickConnect).
export const codeTile = (i: number): Node => ({
  type: 'text',
  text: '{char.text}',
  when: [{ test: 'index', is: 'mod', value: `3:${i}` }],
  motion: 'codePop',
  stagger: { step: 50, cap: 12 },
  style: {
    flex: '1',
    'max-width': '46px',
    height: '58px',
    display: 'flex',
    'align-items': 'center',
    'justify-content': 'center',
    'border-radius': '14px',
    'background-color': ['$pink-soft', '$lavender-soft', '$mint-soft'][i],
    border: '2.5px solid $ink',
    'box-shadow': '0px 4px 0px $ink',
    'font-family': fredoka,
    'font-size': '27px',
    'font-weight': '650',
    color: '$ink',
  },
});
export const quick: Node = {
  type: 'box',
  when: [is('env.auth', 'quick')],
  motion: 'hop60',
  exit: 'stepOut',
  style: { ...col, gap: '22px', 'align-items': 'center', 'text-align': 'center' },
  children: [
    welcome('{s:easierWayIn}', '{s:approveCode}', { 'font-size': '15px', 'max-width': '300px' }),
    {
      type: 'box',
      testId: 'connect-code',
      label: '{quick.code}',
      role: 'text',
      style: { ...row, width: '100%', gap: '6px', 'justify-content': 'center' },
      children: [
        {
          type: 'repeat',
          over: 'quick.chars',
          item: { type: 'box', style: { display: 'contents' }, children: [0, 1, 2].map(codeTile) },
        },
      ],
    },
    {
      type: 'box',
      style: { ...col, gap: '8px', 'align-items': 'center' },
      children: [
        {
          type: 'box',
          role: 'status',
          style: { ...row, gap: '10px', 'align-items': 'center' },
          children: [
            { ...dots, when: [not('quick.error')] } as Node,
            {
              type: 'text',
              when: [not('quick.error')],
              text: '{s:waitingForApproval}',
              style: { color: '$ink-soft', 'font-size': '15px' },
            },
            {
              type: 'text',
              when: [set('quick.error')],
              text: '{quick.error}',
              style: { color: '$pink-deep', 'font-size': '15px' },
            },
          ],
        },
        {
          type: 'text',
          text: '{s:codeExpires} {quick.expires}.',
          style: { color: '$ink-quiet', 'font-size': '13px' },
        },
      ],
    },
    {
      type: 'box',
      press: { action: 'cancelQuick' as Action },
      label: '{s:cancel}',
      style: { ...Puffy, height: '46px', padding: '0px 28px' },
      ...puffy,
      children: [{ type: 'text', text: '{s:cancel}', style: { 'font-size': '15px' } }],
    },
  ],
};

// The stage every signed-out state stands on: the night sky with drifting petals, the
// wordmark, and a white sticker card with Mochi peeking over its edge (auth.contract AuthStage).
export const auth: Node = {
  type: 'box',
  exit: 'stageOut',
  style: {
    ...col,
    position: 'relative',
    'z-index': '0',
    'min-height': '100dvh',
    width: '100%',
    'box-sizing': 'border-box',
    'overflow-x': 'hidden',
    'overflow-y': 'hidden',
    'align-items': 'center',
    'justify-content': 'center',
    padding: 'max(28px, 6vh) 16px',
    'background-color': '$night',
    color: '$ink',
    'font-family': fredoka,
  },
  children: [
    { ...nightSky(true), style: { ...(nightSky(true) as { style: Style }).style, 'z-index': '-1' } } as Node,
    {
      type: 'box',
      motion: 'pop0',
      style: {
        ...col,
        position: 'relative',
        width: '100%',
        'max-width': '440px',
        gap: '26px',
        'align-items': 'center',
      },
      children: [
        {
          type: 'box',
          style: { ...row, 'align-items': 'center', gap: `${44 * 0.24}px` },
          children: [
            { type: 'image', src: asset('vela-mark.svg'), alt: '', style: sz(44 * 1.05) },
            {
              type: 'text',
              text: '{s:vela}',
              style: {
                'font-family': pixelFace,
                'font-weight': '700',
                'font-size': '44px',
                'line-height': '1',
                'letter-spacing': '0.04em',
                color: '$night-ink',
                'text-shadow': '3px 3px 0px $lavender-deep',
              },
            },
          ],
        },
        {
          type: 'box',
          style: { ...col, position: 'relative', width: '100%', 'padding-top': '34px' },
          children: [
            mascot('happy', 76, {
              motion: 'float36',
              style: {
                position: 'absolute',
                top: '0px',
                left: '50%',
                'margin-left': '-38px',
                'z-index': '2',
              },
            }),
            {
              type: 'box',
              layoutTransition: '480ms ease-out',
              style: {
                ...col,
                width: '100%',
                'box-sizing': 'border-box',
                padding: 'clamp(40px, 6vw, 52px) clamp(22px, 5vw, 38px) clamp(26px, 5vw, 36px)',
                'border-radius': '32px',
                'background-color': '$card',
                border: '3px solid $ink',
                'box-shadow': '8px 9px 0px $pink',
              },
              children: [...authNotice, signIn, quick],
            },
          ],
        },
      ],
    },
  ],
};

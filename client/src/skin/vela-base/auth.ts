import type { Condition, Node, Style } from '../../../wire/v0/skin';
import { display, enter, eyebrow, focusRing, is, pill, pulse, veil } from './look';

// The signed-out page (compiled cinematic's AuthStage with its notices, SignIn and
// QuickConnect): drifting light behind a centred glass card that resizes with its content.
export const authIs = (v: string): Condition => is('env.auth', v);
export const aurora = (name: string, style: Style): Node => ({
  type: 'box',
  motion: name,
  style: { position: 'absolute', 'border-radius': '50%', ...style } as Style,
});
export const authLeave = 'velaAuthOut';
export const authNotice: Node[] = [
  {
    type: 'box',
    when: [authIs('offline')],
    role: 'alert',
    motion: enter(0),
    exit: authLeave,
    style: {
      display: 'flex',
      'flex-direction': 'column',
      gap: '18px',
      'align-items': 'center',
      'text-align': 'center',
      padding: '12px 0px',
    },
    children: [
      { type: 'icon', symbol: 'alert', style: { width: '28px', height: '28px', color: '$ui.accent' } },
      {
        type: 'text',
        text: '{t:ui.serverUnreachable}',
        role: 'heading',
        level: 1,
        style: { ...display, 'font-size': '34px' },
      },
      {
        type: 'text',
        text: '{t:ui.yourServerCouldNotBeReachedReopenVelaWhenTheConnectionIsRestored}',
        style: { color: '$ui.inkSecondary', 'font-size': '15px', 'line-height': '1.55' },
      },
    ],
  },
  ...(['connecting', 'redeeming'] as const).map((kind): Node => ({
    type: 'box',
    when: [authIs(kind)],
    role: 'status',
    motion: enter(0),
    exit: authLeave,
    style: {
      display: 'flex',
      'flex-direction': 'column',
      gap: '18px',
      'align-items': 'center',
      'text-align': 'center',
      padding: '12px 0px',
    },
    children: [
      pulse,
      {
        type: 'text',
        text: kind === 'redeeming' ? '{t:ui.signingYouIn}' : '{t:ui.connectingToYourLibrary}',
        style: { color: '$ui.inkSecondary', 'font-size': '15px' },
      },
    ],
  })),
];
export const field: Style = {
  'box-sizing': 'border-box',
  height: '52px',
  padding: '0px 18px',
  'border-radius': '14px',
  border: '1px solid $ui.glassEdge',
  'background-color': '$ui.control',
  color: '$ui.ink',
  'font-size': '16px',
  outline: 'none',
  transition: 'border-color 180ms linear, box-shadow 360ms cubic-bezier(0.16, 1, 0.3, 1)',
} as Style;
export const fieldBlock = (name: 'username' | 'password', label: string): Node => ({
  type: 'box',
  style: { display: 'flex', 'flex-direction': 'column', gap: '8px' },
  children: [
    { type: 'text', text: label, style: { ...eyebrow, 'font-size': '10px', color: '$ui.inkQuiet' } as Style },
    {
      type: 'widget',
      widget: 'textInput',
      params: { field: name, label },
      style: field,
      hover: { 'border-color': '$ui.glassEdgeStrong' },
      focus: { 'border-color': '$ui.accent', 'box-shadow': '0px 0px 0px 4px $ui.focusHalo', outline: 'none' },
    },
  ],
});
export const signIn: Node = {
  type: 'box',
  when: [authIs('signin')],
  motion: enter(60),
  exit: authLeave,
  style: { display: 'flex', 'flex-direction': 'column', gap: '26px' },
  children: [
    {
      type: 'box',
      style: { display: 'flex', 'flex-direction': 'column', gap: '10px' },
      children: [
        {
          type: 'text',
          text: '{t:ui.welcomeToYourEvening}',
          role: 'heading',
          level: 1,
          style: { ...display, 'font-size': '42px' },
        },
        {
          type: 'text',
          text: '{t:ui.signInToYourLibrary}',
          style: { color: '$ui.inkSecondary', 'font-size': '15px', 'line-height': '1.5' },
        },
      ],
    },
    // The server also answers at an HTTPS address: offer it before a password is typed here.
    {
      type: 'box',
      when: [{ test: 'signin.secureOrigin' }],
      motion: enter(120),
      style: {
        display: 'flex',
        'flex-direction': 'column',
        gap: '12px',
        padding: '16px',
        'border-radius': '16px',
        'background-color': 'color-mix(in srgb, $ui.accent 7%, transparent)',
        border: '1px solid color-mix(in srgb, $ui.accent 25%, transparent)',
      },
      children: [
        {
          type: 'box',
          style: { display: 'flex', 'flex-direction': 'row', gap: '10px', 'align-items': 'center' },
          children: [
            { type: 'icon', symbol: 'lock', style: { width: '16px', height: '16px', color: '$ui.accent' } },
            { type: 'text', text: '{t:secure.title}', style: { 'font-size': '14px', 'font-weight': '650' } },
          ],
        },
        {
          type: 'text',
          text: '{t:secure.body|origin=signin.secureOrigin}',
          style: { 'font-size': '13px', 'line-height': '1.5', color: '$ui.inkSecondary' },
        },
        {
          type: 'box',
          press: { action: 'goSecure' },
          label: '{t:secure.action}',
          testId: 'secure-switch',
          disabled: [{ test: 'signin.secureBusy' }],
          disabledStyle: { opacity: '0.42' },
          style: {
            ...pill(false, 42),
            position: 'relative',
            'padding-left': '18px',
            'padding-right': '18px',
            'align-self': 'flex-start',
          } as Style,
          hover: { 'background-color': '$ui.controlHover', 'border-color': '$ui.glassEdgeStrong' },
          focus: { 'box-shadow': focusRing },
          children: [
            {
              type: 'box',
              style: { display: 'flex', 'flex-direction': 'row', gap: '10px', 'align-items': 'center' },
              children: [
                { ...pulse, when: [{ test: 'signin.secureBusy' }] } as Node,
                { type: 'text', text: '{t:secure.action}', style: { 'font-size': '14px' } },
              ],
            },
          ],
        },
        {
          type: 'text',
          when: [{ test: 'signin.secureError' }],
          role: 'alert',
          text: '{signin.secureError}',
          style: { 'font-size': '12px', color: '$ui.accent' },
        },
      ],
    },
    {
      type: 'box',
      when: [{ test: 'signin.error' }],
      role: 'alert',
      motion: enter(0),
      style: {
        display: 'flex',
        'flex-direction': 'row',
        gap: '10px',
        'align-items': 'flex-start',
        padding: '12px 14px',
        'border-radius': '14px',
        'background-color': '$ui.alert',
        border: '1px solid color-mix(in srgb, $ui.live 30%, transparent)',
      },
      children: [
        {
          type: 'icon',
          symbol: 'alert',
          style: { width: '18px', height: '18px', color: '$ui.accent', 'flex-shrink': '0' },
        },
        {
          type: 'text',
          text: '{signin.error}',
          style: { color: '$ui.ink', 'font-size': '14px', 'line-height': '1.45' },
        },
      ],
    },
    {
      type: 'box',
      when: [{ test: 'signin.canPassword' }],
      style: { display: 'flex', 'flex-direction': 'column', gap: '16px' },
      children: [
        fieldBlock('username', '{t:ui.username}'),
        fieldBlock('password', '{t:ui.password}'),
        {
          type: 'box',
          press: { action: 'signIn' },
          label: '{t:ui.signIn}',
          testId: 'sign-in',
          disabled: [{ test: 'signin.ready', not: true }],
          disabledStyle: { 'background-color': '$ui.controlHover', color: '$ui.inkQuiet' },
          style: {
            ...pill(true),
            position: 'relative',
            height: '52px',
            'padding-left': '0px',
            'padding-right': '0px',
            'margin-top': '6px',
            transition:
              'background-color 180ms linear, opacity 180ms linear, scale 360ms cubic-bezier(0.16, 1, 0.3, 1)',
          } as Style,
          hover: { 'background-color': '$ui.inkHover' },
          focus: { 'box-shadow': focusRing },
          children: [
            {
              type: 'box',
              style: {
                display: 'flex',
                'flex-direction': 'row',
                gap: '10px',
                'align-items': 'center',
                'justify-content': 'center',
              },
              children: [
                { ...pulse, when: [{ test: 'signin.busy' }] } as Node,
                {
                  type: 'text',
                  when: [{ test: 'signin.busy' }],
                  text: '{t:ui.signingIn}',
                  style: { 'font-size': '15px', 'font-weight': '650', color: '$ui.inkQuiet' },
                },
                // The label takes the disabled ink itself (text resolves its own colour).
                {
                  type: 'text',
                  when: [{ test: 'signin.busy', not: true }],
                  text: '{t:ui.signIn}',
                  style: { 'font-size': '15px', 'font-weight': '650' },
                  states: [
                    {
                      when: [{ test: 'signin.ready', not: true }],
                      style: { 'font-size': '15px', 'font-weight': '650', color: '$ui.inkQuiet' },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: 'box',
      when: [{ test: 'signin.canPassword' }, { test: 'signin.canQuick' }],
      a11y: { hidden: true },
      style: { display: 'flex', 'flex-direction': 'row', gap: '14px', 'align-items': 'center' },
      children: [
        { type: 'box', style: { flex: '1', height: '1px', 'background-color': '$ui.glassEdge' } },
        { type: 'text', text: '{t:ui.or}', style: { 'font-size': '12px', color: '$ui.inkQuiet' } },
        { type: 'box', style: { flex: '1', height: '1px', 'background-color': '$ui.glassEdge' } },
      ],
    },
    {
      type: 'box',
      when: [{ test: 'signin.canQuick' }],
      press: { action: 'startQuick' },
      label: '{t:ui.connectWithACode}',
      testId: 'quick-connect',
      disabled: [{ test: 'signin.busy' }],
      disabledStyle: { opacity: '0.42' },
      style: {
        ...pill(false, 52),
        position: 'relative',
        'padding-left': '0px',
        'padding-right': '0px',
        transition:
          'background-color 180ms linear, border-color 180ms linear, scale 360ms cubic-bezier(0.16, 1, 0.3, 1)',
      } as Style,
      hover: { 'background-color': '$ui.controlHover', 'border-color': '$ui.glassEdgeStrong' },
      focus: { 'box-shadow': focusRing },
      children: [
        {
          type: 'box',
          style: {
            display: 'flex',
            'flex-direction': 'row',
            gap: '10px',
            'align-items': 'center',
            'justify-content': 'center',
          },
          children: [
            { type: 'icon', symbol: 'smartphone', style: { width: '18px', height: '18px' } },
            { type: 'text', text: '{t:ui.connectWithACode}', style: { 'font-size': '15px' } },
          ],
        },
      ],
    },
    {
      type: 'text',
      when: [
        { test: 'signin.canPassword', not: true },
        { test: 'signin.canQuick', not: true },
      ],
      role: 'status',
      text: '{t:ui.noSignInMethodsOffered}',
      style: { color: '$ui.inkSecondary', 'font-size': '14px', 'line-height': '1.55' },
    },
  ],
};
export const quickConnect: Node = {
  type: 'box',
  when: [authIs('quick')],
  motion: enter(60),
  exit: authLeave,
  style: {
    display: 'flex',
    'flex-direction': 'column',
    gap: '26px',
    'align-items': 'center',
    'text-align': 'center',
  },
  children: [
    {
      type: 'box',
      style: { display: 'flex', 'flex-direction': 'column', gap: '10px', 'align-items': 'center' },
      children: [
        {
          type: 'text',
          text: '{t:ui.anEasierWayIn}',
          role: 'heading',
          level: 1,
          style: { ...display, 'font-size': '42px' },
        },
        {
          type: 'text',
          text: '{t:ui.approveThisCodeFromASignedInEtherDevice}',
          style: {
            color: '$ui.inkSecondary',
            'font-size': '15px',
            'line-height': '1.5',
            'max-width': '300px',
          },
        },
      ],
    },
    {
      type: 'box',
      label: '{quick.code}',
      role: 'text',
      testId: 'connect-code',
      style: {
        display: 'flex',
        'flex-direction': 'row',
        width: '100%',
        gap: '6px',
        'justify-content': 'center',
      },
      children: [
        {
          type: 'repeat',
          over: 'quick.chars',
          item: {
            type: 'text',
            text: '{char.text}',
            a11y: { hidden: true },
            motion: 'velaCodeIn',
            stagger: { step: 45, cap: 12 },
            style: {
              flex: '1',
              'max-width': '44px',
              height: '54px',
              display: 'flex',
              'align-items': 'center',
              'justify-content': 'center',
              'border-radius': '12px',
              'background-color': '$ui.popover',
              border: '1px solid $ui.glassEdge',
              'box-shadow': 'inset 0px 1px 0px $ui.glassEdgeStrong',
              'font-family': 'ui-monospace, "SF Mono", Menlo, monospace',
              'font-size': '24px',
              'font-weight': '600',
              color: '$ui.accent',
            } as Style,
          },
        },
      ],
    },
    {
      type: 'box',
      style: { display: 'flex', 'flex-direction': 'column', gap: '10px', 'align-items': 'center' },
      children: [
        {
          type: 'box',
          role: 'status',
          style: { display: 'flex', 'flex-direction': 'row', gap: '10px', 'align-items': 'center' },
          children: [
            { ...pulse, when: [{ test: 'quick.error', not: true }] } as Node,
            {
              type: 'text',
              when: [{ test: 'quick.error', not: true }],
              text: '{t:ui.waitingForApproval}',
              style: { color: '$ui.inkSecondary', 'font-size': '14px' },
            },
            {
              type: 'text',
              when: [{ test: 'quick.error' }],
              text: '{quick.error}',
              style: { color: '$ui.accent', 'font-size': '14px' },
            },
          ],
        },
        {
          type: 'text',
          text: '{t:ui.codeExpires|expiry=quick.expires}',
          style: { color: '$ui.inkQuiet', 'font-size': '12px' },
        },
      ],
    },
    {
      type: 'box',
      press: { action: 'cancelQuick' },
      label: '{t:ui.cancel}',
      style: {
        ...pill(false, 46),
        position: 'relative',
        'padding-left': '28px',
        'padding-right': '28px',
        transition: 'background-color 180ms linear, scale 360ms cubic-bezier(0.16, 1, 0.3, 1)',
      } as Style,
      hover: { 'background-color': '$ui.controlHover', 'border-color': '$ui.glassEdgeStrong' },
      focus: { 'box-shadow': focusRing },
      children: [{ type: 'text', text: '{t:ui.cancel}', style: { 'font-size': '14px' } }],
    },
  ],
};
export const auth: Node = {
  type: 'box',
  exit: authLeave,
  style: {
    position: 'relative',
    display: 'flex',
    'flex-direction': 'column',
    'align-items': 'center',
    'justify-content': 'center',
    'min-height': '100dvh',
    width: '100%',
    'box-sizing': 'border-box',
    'overflow-x': 'hidden',
    'overflow-y': 'hidden',
    padding: 'max(28px, 7vh) 16px',
    'background-color': '$ui.page',
    color: '$ui.ink',
  } as Style,
  children: [
    {
      type: 'box',
      a11y: { hidden: true },
      style: { position: 'absolute', inset: '0px', 'pointer-events': 'none' },
      children: [
        {
          type: 'image',
          when: [{ test: 'env.authBackdrop' }],
          src: '{env.authBackdrop}',
          alt: '',
          style: { position: 'absolute', inset: '0px', width: '100%', height: '100%', 'object-fit': 'cover' },
        },
        aurora('velaAuroraA', {
          width: '72vmax',
          height: '72vmax',
          left: '-22vmax',
          top: '-30vmax',
          opacity: '0.5',
          'background-image': 'radial-gradient(circle, #c0703f 0%, #c0703f00 68%)',
        }),
        aurora('velaAuroraB', {
          width: '80vmax',
          height: '80vmax',
          right: '-30vmax',
          bottom: '-42vmax',
          opacity: '0.55',
          'background-image': 'radial-gradient(circle, #1f5a6b 0%, #1f5a6b00 66%)',
        }),
        aurora('velaAuroraC', {
          width: '54vmax',
          height: '54vmax',
          left: '34%',
          top: '18%',
          opacity: '0.35',
          'background-image': 'radial-gradient(circle, #5b2a4a 0%, #5b2a4a00 70%)',
        }),
        {
          type: 'box',
          style: {
            position: 'absolute',
            inset: '0px',
            'background-image': `radial-gradient(ellipse 110% 85% at 50% 42%, ${veil(0)} 35%, ${veil(70)} 100%)`,
          },
        },
        {
          type: 'image',
          src: 'assets/grain.svg',
          alt: '',
          style: {
            position: 'absolute',
            inset: '0px',
            width: '100%',
            height: '100%',
            'object-fit': 'fill',
            opacity: '0.06',
          },
        },
      ],
    },
    {
      type: 'box',
      motion: enter(0),
      style: {
        position: 'relative',
        display: 'flex',
        'flex-direction': 'column',
        width: '100%',
        'max-width': '448px',
        gap: '32px',
        'align-items': 'center',
      },
      children: [
        {
          type: 'image',
          when: [{ test: 'env.authWordmark' }],
          src: '{env.authWordmark}',
          alt: '',
          a11y: { hidden: true },
          style: { height: '56px', width: 'auto', 'max-width': '100%' },
        },
        {
          type: 'image',
          when: [{ test: 'env.authWordmark', not: true }],
          src: 'assets/brand/vela-stacked.svg',
          alt: '',
          a11y: { hidden: true },
          style: { width: '60px', height: '104px' },
        },
        {
          type: 'box',
          layoutTransition: '560ms ease-out',
          style: {
            display: 'flex',
            'flex-direction': 'column',
            width: '100%',
            'box-sizing': 'border-box',
            padding: 'clamp(28px, 5vw, 44px) clamp(22px, 4.5vw, 40px)',
            'border-radius': '$ui.radiusPanel',
            'background-color': '$ui.glass',
            'backdrop-filter': 'blur(28px) saturate(1.4)',
            border: '1px solid $ui.glassEdge',
            'box-shadow': '0px 40px 120px $ui.shadow, inset 0px 1px 0px $ui.glassEdgeStrong',
          },
          children: [...authNotice, signIn, quickConnect],
        },
      ],
    },
  ],
};

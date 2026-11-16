import type { Node, Style } from '../../../skin';
import { gutter, gutterSmall, lift, sans, side } from './look';

export const tab = (
  label: string,
  press: { action: 'home' | 'library'; arg?: string },
  on: Node['when'],
  testId: string,
): Node => ({
  type: 'box',
  press,
  controlStates: false,
  label,
  testId,
  a11y: { current: on },
  style: {
    position: 'relative',
    display: 'flex',
    'flex-direction': 'row',
    'align-items': 'center',
    gap: '10px',
    height: 'clamp(44px, 3.4vw, 62px)',
    'box-sizing': 'border-box',
    padding: '0px clamp(18px, 1.5vw, 28px)',
    'border-radius': '999px',
    color: '$ink-dim',
    'font-size': 'clamp(16px, 1.25vw, 24px)',
    'font-weight': '600',
    'white-space': 'nowrap',
    'flex-shrink': '0',
    transition: lift,
  },
  focus: {
    'background-color': '$ink',
    color: '$ground',
    scale: '1.08',
    'box-shadow': '0px 14px 34px -10px rgba(0, 0, 0, 0.7)',
  },
  hover: { color: '$ink', 'background-color': 'rgba(255, 255, 255, 0.12)' },
  small: { height: '40px', padding: '0px 14px', 'font-size': '15px' },
  children: [
    // The current section: a filled capsule behind its name.
    {
      type: 'box',
      when: on,
      style: {
        position: 'absolute',
        inset: '0px',
        'border-radius': '999px',
        'background-color': 'rgba(255, 255, 255, 0.16)',
        'box-shadow': 'inset 0px 0px 0px 1px rgba(255, 255, 255, 0.14)',
      },
    },
    { type: 'text', text: label, style: { position: 'relative' } },
  ],
});

export const libraryTab: Node = {
  ...tab('{dest.name}', { action: 'library', arg: '{dest.id}' }, [{ test: 'dest.on' }], 'nav-{dest.id}'),
};

export const shell: Node = {
  type: 'box',
  style: {
    display: 'flex',
    'flex-direction': 'column',
    height: '100%',
    'min-height': '0px',
    'background-color': '$ground',
    color: '$ink',
    'font-family': sans,
  },
  children: [
    {
      type: 'box',
      role: 'navigation',
      label: '{s:mainNav}',
      when: [{ test: 'env.viewer' }],
      motion: 'navIn',
      style: { position: 'absolute', top: '0px', left: '0px', right: '0px', 'z-index': '20' },
      small: { 'background-color': '$ground' },
      children: [
        // A soft fall of shade, so the bar reads over any backdrop and the rows that scroll under it.
        {
          type: 'box',
          style: {
            position: 'absolute',
            top: '0px',
            left: '0px',
            right: '0px',
            height: '150%',
            'pointer-events': 'none',
            'background-image':
              'linear-gradient(180deg, rgba(5, 6, 9, 0.9) 0%, rgba(5, 6, 9, 0.72) 55%, rgba(5, 6, 9, 0) 100%)',
            'backdrop-filter': 'blur(22px) saturate(1.2)',
            'mask-image': 'linear-gradient(180deg, black 0%, black 58%, transparent 100%)',
          },
        },
        {
          type: 'box',
          style: {
            position: 'relative',
            display: 'flex',
            'flex-direction': 'row',
            'align-items': 'center',
            gap: '18px',
            'box-sizing': 'border-box',
            height: 'calc(clamp(84px, 7vw, 132px) + max(0px, env(safe-area-inset-top)))',
            'padding-top': 'max(14px, 2.4vh)',
            ...gutter,
          },
          small: { height: '64px', 'padding-top': '0px', gap: '10px', ...gutterSmall },
          states: [{
            when: [{ test: 'env.section', is: 'eq', value: 'live' }, { test: 'env.small', not: true }],
            style: { height: '64px', 'padding-top': '0px' },
          }],
          children: [
            {
              type: 'box',
              press: { action: 'home' },
              controlStates: false,
              label: '{s:velaHome}',
              testId: 'nav-brand',
              style: {
                position: 'relative',
                display: 'flex',
                'align-items': 'center',
                padding: '10px 14px',
                margin: '0px -14px',
                'border-radius': '18px',
                'flex-shrink': '0',
                transition: lift,
              },
              focus: { 'background-color': 'rgba(255, 255, 255, 0.14)', scale: '1.06' },
              small: { padding: '4px', margin: '0px' },
              children: [
                {
                  type: 'image',
                  src: 'assets/brand/vela-lockup.svg',
                  alt: '',
                  style: { width: 'clamp(92px, 7.4vw, 142px)', height: 'clamp(35px, 2.8vw, 54px)' },
                  small: { width: '74px', height: '28px' },
                },
              ],
            },
            // The tabs float in one glass capsule, centred like a TV's top bar.
            {
              type: 'box',
              style: {
                flex: '1',
                display: 'flex',
                'flex-direction': 'row',
                'justify-content': 'center',
                'min-width': '0px',
              },
              small: { 'justify-content': 'flex-start' },
              children: [
                {
                  type: 'box',
                  style: {
                    display: 'flex',
                    'flex-direction': 'row',
                    'align-items': 'center',
                    gap: '4px',
                    padding: '6px',
                    'border-radius': '999px',
                    'background-color': 'rgba(18, 20, 26, 0.55)',
                    'backdrop-filter': 'blur(30px) saturate(1.5)',
                    'box-shadow': '0px 0px 0px 1px rgba(255, 255, 255, 0.08), 0px 20px 50px -20px rgba(0, 0, 0, 0.8)',
                    'max-width': '100%',
                    'overflow-x': 'auto',
                    'overflow-y': 'hidden',
                    'scrollbar-width': 'none',
                  },
                  small: { padding: '4px' },
                  children: [
                    tab('{s:home}', { action: 'home' }, [{ test: 'env.section', is: 'eq', value: 'home' }], 'nav-home'),
                    { type: 'repeat', over: 'nav.destinations', item: libraryTab },
                    {
                      type: 'box',
                      press: { action: 'search', focus: 'vela-search' },
                      controlStates: false,
                      label: '{s:search}',
                      testId: 'nav-search',
                      style: {
                        position: 'relative',
                        display: 'flex',
                        'flex-direction': 'row',
                        'align-items': 'center',
                        gap: '10px',
                        height: 'clamp(44px, 3.4vw, 62px)',
                        'box-sizing': 'border-box',
                        padding: '0px clamp(18px, 1.5vw, 28px)',
                        'border-radius': '999px',
                        color: '$ink-dim',
                        'font-size': 'clamp(16px, 1.25vw, 24px)',
                        'font-weight': '600',
                        'flex-shrink': '0',
                        transition: lift,
                      },
                      focus: {
                        'background-color': '$ink',
                        color: '$ground',
                        scale: '1.08',
                        'box-shadow': '0px 14px 34px -10px rgba(0, 0, 0, 0.7)',
                      },
                      hover: { color: '$ink', 'background-color': 'rgba(255, 255, 255, 0.12)' },
                      small: { height: '40px', padding: '0px 12px' },
                      children: [
                        {
                          type: 'icon',
                          symbol: 'search',
                          style: { width: 'clamp(18px, 1.3vw, 26px)', height: 'clamp(18px, 1.3vw, 26px)' },
                        },
                        { type: 'text', text: '{s:search}', small: { display: 'none' } },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              type: 'box',
              id: 'lounge-profile',
              press: { action: 'toggle', arg: 'menu' },
              controlStates: false,
              label: '{s:profile}',
              testId: 'profile-menu',
              a11y: { expanded: [{ test: 'flag:menu' }], haspopup: 'dialog' },
              style: {
                position: 'relative',
                display: 'flex',
                'flex-shrink': '0',
                'border-radius': '999px',
                transition: lift,
              },
              focus: {
                scale: '1.12',
                'box-shadow': '0px 0px 0px 4px rgba(255, 255, 255, 0.94), 0px 0px 40px 4px rgba(220, 185, 152, 0.4)',
              },
              hover: { scale: '1.06' },
              children: [
                {
                  type: 'text',
                  text: '{env.viewerInitial}',
                  style: {
                    display: 'flex',
                    'align-items': 'center',
                    'justify-content': 'center',
                    width: 'clamp(44px, 3.4vw, 62px)',
                    height: 'clamp(44px, 3.4vw, 62px)',
                    'border-radius': '999px',
                    'font-size': 'clamp(18px, 1.35vw, 26px)',
                    'font-weight': '700',
                    color: '$ground',
                    'background-image': 'linear-gradient(140deg, #f5f1e9 0%, #dcb998 100%)',
                  },
                  small: { width: '40px', height: '40px', 'font-size': '16px' },
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: 'slot',
      slot: 'children',
      style: { display: 'flex', 'flex-direction': 'column', flex: '1', 'min-height': '0px' },
      inner: {
        display: 'flex',
        'flex-direction': 'column',
        'flex-grow': '1',
        'min-height': '0px',
        height: '100%',
        width: '100%',
      } as Style,
    },
    // The profile sheet: large rows a remote can step through.
    {
      type: 'box',
      when: [{ test: 'env.viewer' }, { test: 'flag:menu' }],
      motion: 'sheet',
      role: 'dialog',
      label: '{s:profile}',
      escape: 'menu',
      returnFocus: 'lounge-profile',
      style: {
        position: 'absolute',
        top: 'calc(clamp(84px, 7vw, 132px) + 8px)',
        right: side,
        'z-index': '30',
        width: 'clamp(300px, 24vw, 440px)',
        'box-sizing': 'border-box',
        padding: 'clamp(18px, 1.4vw, 26px)',
        display: 'flex',
        'flex-direction': 'column',
        gap: '2px',
        'border-radius': '30px',
        'background-color': 'rgba(24, 26, 32, 0.86)',
        'backdrop-filter': 'blur(40px) saturate(1.5)',
        'box-shadow': '0px 0px 0px 1px rgba(255, 255, 255, 0.10), 0px 40px 90px -20px rgba(0, 0, 0, 0.9)',
        'font-size': 'clamp(16px, 1.2vw, 22px)',
      },
      small: { top: '68px', right: '12px', left: '12px', width: 'auto' },
      children: [
        {
          type: 'box',
          style: {
            display: 'flex',
            'flex-direction': 'row',
            gap: '16px',
            'align-items': 'center',
            padding: '6px 10px 14px',
          },
          children: [
            {
              type: 'text',
              text: '{env.viewerInitial}',
              style: {
                display: 'flex',
                'align-items': 'center',
                'justify-content': 'center',
                width: '56px',
                height: '56px',
                'border-radius': '28px',
                'font-size': '24px',
                'font-weight': '700',
                color: '$ground',
                'background-image': 'linear-gradient(140deg, #f5f1e9 0%, #dcb998 100%)',
                'flex-shrink': '0',
              },
            },
            {
              type: 'box',
              style: { display: 'flex', 'flex-direction': 'column', gap: '2px', 'min-width': '0px' },
              children: [
                {
                  type: 'text',
                  text: '{env.viewer}',
                  style: { 'font-size': 'clamp(19px, 1.45vw, 27px)', 'font-weight': '700', 'line-clamp': '1' },
                },
                {
                  type: 'text',
                  text: '{s:watchingAs}',
                  style: { 'font-size': 'clamp(14px, 1vw, 18px)', color: '$ink-quiet' },
                },
              ],
            },
          ],
        },
        {
          type: 'box',
          press: { action: 'openPicker' },
          controlStates: false,
          label: '{s:appearance}',
          testId: 'skin-picker',
          style: { ...sheetRow() },
          focus: sheetFocus(),
          hover: { 'background-color': 'rgba(255, 255, 255, 0.10)' },
          children: [
            { type: 'icon', symbol: 'layers', style: { width: '24px', height: '24px' } },
            {
              type: 'box',
              style: { display: 'flex', 'flex-direction': 'column', gap: '2px', flex: '1' },
              children: [
                { type: 'text', text: '{s:appearance}', style: { 'font-weight': '650' } },
                { type: 'text', text: '{s:skinName}', style: { 'font-size': '0.8em', opacity: '0.7' } },
              ],
            },
            { type: 'icon', symbol: 'forward-chevron', style: { width: '16px', height: '16px', opacity: '0.6' } },
          ],
        },
        { type: 'widget', widget: 'install', params: { action: 'install', label: '{s:install}' } },
        { type: 'widget', widget: 'install', params: { action: 'update', label: '{s:update}' } },
        {
          type: 'box',
          press: { action: 'signOut' },
          controlStates: false,
          label: '{s:signOut}',
          style: { ...sheetRow() },
          focus: sheetFocus(),
          hover: { 'background-color': 'rgba(255, 255, 255, 0.10)' },
          children: [
            { type: 'icon', symbol: 'sign-out', style: { width: '24px', height: '24px' } },
            { type: 'text', text: '{s:signOut}', style: { 'font-weight': '650' } },
          ],
        },
      ],
    },
  ],
};

export function sheetRow(): Style {
  return {
    position: 'relative',
    display: 'flex',
    'flex-direction': 'row',
    gap: '16px',
    'align-items': 'center',
    'min-height': 'clamp(58px, 4.2vw, 76px)',
    'box-sizing': 'border-box',
    padding: '10px 18px',
    'border-radius': '20px',
    color: '$ink',
    transition: lift,
  } as Style;
}

export function sheetFocus(): Style {
  return {
    'background-color': '$ink',
    color: '$ground',
    scale: '1.04',
    'box-shadow': '0px 16px 36px -12px rgba(0, 0, 0, 0.8)',
  } as Style;
}

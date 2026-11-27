import type { BoxNode, Node, Style } from '../../../skin';
import { gutter, gutterSmall, lift, sans, side } from './look';

export const tab = (
  label: string,
  press: BoxNode['press'],
  on: Node['when'],
  testId: string,
): BoxNode => ({
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

// A library's tab, while the bar has room for it (else it waits in More).
export const libraryTab: Node = {
  ...tab('{dest.name}', { action: 'library', arg: '{dest.id}' }, [{ test: 'dest.on' }], 'nav-{dest.id}'),
  when: [{ test: 'dest.more', not: true }],
};

// Live TV, when the navigation has it (nav.showLive) and no library already stands for it.
const showLive: Node['when'] = [{ test: 'nav.showLive' }, { test: 'env.hasLiveLibrary', not: true }];
const onHome: Node['when'] = [{ test: 'env.section', is: 'eq', value: 'home' }];
const onLive: Node['when'] = [{ test: 'env.section', is: 'eq', value: 'live' }];

// More: the bar keeps as many tabs as its capsule has room for (the renderer measures them) and
// the rest wait behind this tab, which wears the current mark while the section is one of them.
const moreTabBase = tab('{s:more}', { action: 'only', arg: 'more', focus: 'lounge-more-menu' }, [{ test: 'nav.moreOn' }], 'nav-more');
const moreTab: Node = {
  ...moreTabBase,
  id: 'lounge-more',
  when: [{ test: 'nav.more' }],
  label: '{s:moreSections}',
  a11y: { current: [{ test: 'nav.moreOn' }], expanded: [{ test: 'flag:more' }], haspopup: 'menu' },
  children: [...moreTabBase.children!, {
    type: 'icon',
    paths: ['M6.7 9.3a1 1 0 0 1 1.4 0L12 13.2l3.9-3.9a1 1 0 1 1 1.4 1.4l-4.6 4.6a1 1 0 0 1-1.4 0l-4.6-4.6a1 1 0 0 1 0-1.4z'],
    viewBox: '0 0 24 24',
    style: { position: 'relative', width: 'clamp(16px, 1.1vw, 22px)', height: 'clamp(16px, 1.1vw, 22px)', 'flex-shrink': '0', opacity: '0.8' },
  }],
};

const moreRow = (
  label: string,
  press: { action: 'home' | 'library' | 'live'; arg?: string },
  on: Node['when'],
  testId: string,
): Node => ({
  type: 'box',
  press,
  controlStates: false,
  label,
  testId,
  a11y: { current: on },
  style: { ...sheetRow(), 'font-size': 'clamp(17px, 1.25vw, 24px)', 'font-weight': '650' },
  focus: sheetFocus(),
  hover: { 'background-color': 'rgba(255, 255, 255, 0.10)' },
  children: [
    { type: 'text', text: label, style: { flex: '1', 'line-clamp': '1' } },
    { type: 'box', when: on, style: { width: '10px', height: '10px', 'border-radius': '5px', 'background-color': '$amber', 'flex-shrink': '0' } },
  ],
});

// The tabs the bar had no room for, under the end of the capsule: large rows a remote steps through.
const moreMenu: Node = {
  type: 'box',
  id: 'lounge-more-menu',
  when: [{ test: 'nav.more' }, { test: 'flag:more' }],
  motion: 'sheet',
  role: 'navigation',
  label: '{s:moreSections}',
  escape: 'more',
  returnFocus: 'lounge-more',
  style: {
    position: 'absolute',
    top: '100%',
    right: '0px',
    'margin-top': '14px',
    'z-index': '30',
    width: 'clamp(280px, 22vw, 420px)',
    'max-height': '70vh',
    'overflow-y': 'auto',
    'box-sizing': 'border-box',
    padding: 'clamp(10px, 0.8vw, 16px)',
    display: 'flex',
    'flex-direction': 'column',
    gap: '2px',
    'border-radius': '30px',
    'background-color': 'rgba(24, 26, 32, 0.92)',
    'backdrop-filter': 'blur(40px) saturate(1.5)',
    'box-shadow': '0px 0px 0px 1px rgba(255, 255, 255, 0.10), 0px 40px 90px -20px rgba(0, 0, 0, 0.9)',
  },
  children: [
    { type: 'repeat', over: 'nav.destinations', when: [{ test: 'dest.more' }], item: moreRow('{dest.name}', { action: 'library', arg: '{dest.id}' }, [{ test: 'dest.on' }], 'nav-more-{dest.id}') },
    { ...moreRow('{s:liveTv}', { action: 'live' }, onLive, 'nav-more-live'), when: [...showLive!, { test: 'nav.liveMore' }] },
  ],
};

// Phones have no room for the capsule of tabs: one capsule names the current section and
// opens every destination in a sheet, the way the shared phone shell does.
const sectionName = (text: string, when: Node['when']): Node => ({
  type: 'text', when, text, style: { 'font-size': '15px', 'font-weight': '650', 'line-clamp': '1' },
});
const navigationTrigger: Node = {
  type: 'box',
  id: 'lounge-navigation',
  press: { action: 'only', arg: 'navigation' },
  controlStates: false,
  label: '{s:openNavigation}',
  testId: 'mobile-navigation',
  a11y: { expanded: [{ test: 'flag:navigation' }], haspopup: 'dialog' },
  style: { display: 'none' },
  small: {
    position: 'relative',
    display: 'flex',
    'flex-direction': 'row',
    'align-items': 'center',
    gap: '8px',
    flex: '0 1 auto',
    'min-width': '0px',
    height: '44px',
    'box-sizing': 'border-box',
    padding: '0px 16px 0px 14px',
    'border-radius': '999px',
    color: '$ink',
    'background-color': 'rgba(18, 20, 26, 0.55)',
    'backdrop-filter': 'blur(30px) saturate(1.5)',
    'box-shadow': '0px 0px 0px 1px rgba(255, 255, 255, 0.08), 0px 20px 50px -20px rgba(0, 0, 0, 0.8)',
    transition: lift,
  },
  focus: { 'background-color': '$ink', color: '$ground' },
  hover: { 'background-color': 'rgba(255, 255, 255, 0.12)' },
  children: [
    { type: 'icon', symbol: 'menu', style: { width: '18px', height: '18px', 'flex-shrink': '0' } },
    sectionName('{s:home}', onHome),
    { type: 'repeat', over: 'nav.destinations', item: sectionName('{dest.name}', [{ test: 'dest.on' }]) },
    sectionName('{s:liveTv}', onLive),
  ],
};

const destination = (
  label: string,
  press: { action: 'home' | 'library' | 'live'; arg?: string },
  on: Node['when'],
  testId: string,
): Node => ({
  type: 'box',
  press,
  controlStates: false,
  label,
  testId,
  a11y: { current: on },
  style: { ...sheetRow(), 'min-height': '52px', 'font-size': '17px', 'font-weight': '650' },
  focus: sheetFocus(),
  hover: { 'background-color': 'rgba(255, 255, 255, 0.10)' },
  children: [
    { type: 'text', text: label, style: { flex: '1', 'line-clamp': '1' } },
    // The current section keeps Lounge's amber mark.
    { type: 'box', when: on, style: { width: '8px', height: '8px', 'border-radius': '4px', 'background-color': '$amber', 'flex-shrink': '0' } },
  ],
});

const navigationSheet: Node = {
  type: 'box',
  when: [{ test: 'env.viewer' }, { test: 'env.small' }, { test: 'flag:navigation' }],
  escape: 'navigation',
  returnFocus: 'lounge-navigation',
  style: { position: 'absolute', top: '0px', left: '0px', right: '0px', bottom: '0px', 'z-index': '30' },
  children: [
    {
      type: 'box',
      press: { action: 'close', arg: 'navigation' },
      controlStates: false,
      label: '{s:closeNavigation}',
      style: {
        position: 'absolute',
        top: '0px',
        left: '0px',
        right: '0px',
        bottom: '0px',
        'background-color': 'rgba(5, 6, 9, 0.6)',
        'backdrop-filter': 'blur(6px)',
      },
    },
    {
      type: 'box',
      role: 'navigation',
      label: '{s:mainNav}',
      motion: 'sheet',
      style: {
        position: 'absolute',
        top: '68px',
        left: '12px',
        right: '12px',
        'max-height': 'calc(100% - 92px)',
        'overflow-y': 'auto',
        'box-sizing': 'border-box',
        padding: '12px',
        display: 'flex',
        'flex-direction': 'column',
        gap: '2px',
        'border-radius': '30px',
        'background-color': 'rgba(24, 26, 32, 0.92)',
        'backdrop-filter': 'blur(40px) saturate(1.5)',
        'box-shadow': '0px 0px 0px 1px rgba(255, 255, 255, 0.10), 0px 40px 90px -20px rgba(0, 0, 0, 0.9)',
      },
      children: [
        destination('{s:home}', { action: 'home' }, onHome, 'nav-sheet-home'),
        { type: 'repeat', over: 'nav.destinations', item: destination('{dest.name}', { action: 'library', arg: '{dest.id}' }, [{ test: 'dest.on' }], 'nav-sheet-{dest.id}') },
        { ...destination('{s:liveTv}', { action: 'live' }, onLive, 'nav-sheet-live'), when: showLive },
      ],
    },
  ],
};

// Search stays one press away on phones, beside the profile.
const phoneSearch: Node = {
  type: 'box',
  press: { action: 'search', focus: 'vela-search' },
  controlStates: false,
  label: '{s:search}',
  testId: 'nav-search-phone',
  style: { display: 'none' },
  small: {
    position: 'relative',
    display: 'flex',
    'align-items': 'center',
    'justify-content': 'center',
    width: '44px',
    height: '44px',
    'flex-shrink': '0',
    'border-radius': '999px',
    color: '$ink',
    transition: lift,
  },
  focus: { 'background-color': '$ink', color: '$ground' },
  hover: { 'background-color': 'rgba(255, 255, 255, 0.12)' },
  children: [{ type: 'icon', symbol: 'search', style: { width: '20px', height: '20px' } }],
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
            height: '100%',
            'pointer-events': 'none',
            'background-color': 'rgba(5, 6, 9, 0.72)',
            'backdrop-filter': 'blur(22px) saturate(1.2)',
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
            'padding-top': '0px',
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
            // The tabs float in one glass capsule, centred like a TV's top bar. This box is the
            // room the capsule fits its tabs to; More's menu hangs from its end.
            {
              type: 'box',
              style: {
                position: 'relative',
                flex: '1',
                display: 'flex',
                'flex-direction': 'row',
                'justify-content': 'center',
                'min-width': '0px',
              },
              small: { display: 'none' },
              children: [
                {
                  type: 'box',
                  fit: 'nav',
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
                  },
                  small: { padding: '4px' },
                  children: [
                    tab('{s:home}', { action: 'home' }, onHome, 'nav-home'),
                    { type: 'repeat', over: 'nav.destinations', item: libraryTab },
                    { ...tab('{s:liveTv}', { action: 'live' }, onLive, 'nav-live'), when: [...showLive!, { test: 'nav.liveMore', not: true }] },
                    moreTab,
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
                moreMenu,
              ],
            },
            navigationTrigger,
            { type: 'box', style: { display: 'none' }, small: { display: 'flex', flex: '1', 'min-width': '0px' } },
            phoneSearch,
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
                  small: { width: '44px', height: '44px', 'font-size': '17px' },
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
    navigationSheet,
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
        {
          type: 'box',
          when: [{ test: 'env.canManageLibraries' }],
          press: { action: 'manageLibraries' },
          controlStates: false,
          label: '{s:manageLibraries}',
          testId: 'manage-libraries',
          style: { ...sheetRow() },
          focus: sheetFocus(),
          hover: { 'background-color': 'rgba(255, 255, 255, 0.10)' },
          children: [
            { type: 'icon', symbol: 'library', style: { width: '24px', height: '24px' } },
            { type: 'text', text: '{s:manageLibraries}', style: { 'font-weight': '650' } },
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
        // Which Vela this is, where it runs and the server: quiet, selectable, and on TV a stop the remote reaches.
        {
          type: 'box',
          when: [{ test: 'env.aboutLine' }],
          readingStop: true,
          label: '{env.aboutLabel}',
          testId: 'about-line',
          style: { padding: '12px 18px 4px', 'border-radius': '14px' },
          children: [{ type: 'text', text: '{env.aboutLine}', style: { 'font-size': 'clamp(12px, 0.85vw, 16px)', 'line-height': '1.35', color: '$ink-quiet' } }],
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

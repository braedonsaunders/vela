import type { BoxNode, Condition, Node, Style } from '../../../../protocol/skin';
import { display, focusRing, gutter, gutterSmall, is, navFocus, sans, small, veil, wordmark } from './look';

// A primary destination: the current one in full ink and weight, with the underline that
// glides between destinations (a shared element).
export const navBase: Style = {
  position: 'relative',
  display: 'flex',
  'flex-direction': 'row',
  'align-items': 'center',
  height: '44px',
  padding: '0px 14px',
  'border-radius': '$ui.radiusControl',
  color: '$ui.inkSecondary',
  'font-weight': '550',
  'font-size': '14px',
  'white-space': 'nowrap',
};
export const navUnderline = (when: Condition[]): Node => ({
  type: 'box',
  when,
  sharedElement: 'nav-underline',
  layoutTransition: '460ms ease-out',
  style: {
    position: 'absolute',
    left: '14px',
    right: '14px',
    bottom: '4px',
    height: '2px',
    'border-radius': '1px',
    'background-color': '$ui.accent',
  },
});
export const navItem = (on: Condition[], press: BoxNode['press'], label: string): Node => ({
  type: 'box',
  group: true,
  press,
  label,
  testId: `nav-${label}`,
  style: navBase,
  states: [{ when: on, style: { ...navBase, color: '$ui.ink', 'font-weight': '650' } }],
  a11y: { current: on },
  hover: { 'background-color': '$ui.control', color: '$ui.ink' },
  focus: navFocus,
  // The weight sits on the label: the renderer resolves an inherited weight into the text.
  children: [
    {
      type: 'text',
      text: label,
      style: { 'font-weight': '550' },
      states: [{ when: on, style: { 'font-weight': '650' } }],
    },
    navUnderline(on),
  ],
});

// The chevron a More control wears: the document's own glyph, painted in its ink.
export const moreChevron = (size: string): Node => ({
  type: 'icon',
  paths: ['M6.7 9.3a1 1 0 0 1 1.4 0L12 13.2l3.9-3.9a1 1 0 1 1 1.4 1.4l-4.6 4.6a1 1 0 0 1-1.4 0l-4.6-4.6a1 1 0 0 1 0-1.4z'],
  viewBox: '0 0 24 24',
  style: { position: 'relative', width: size, height: size, 'flex-shrink': '0' },
});

// More: the bar keeps the destinations it has room for (the renderer measures them, `fit`) and the
// rest wait in a menu behind this control, which shows as current while the section is one of them.
const moreNavButton: Node = {
  type: 'box',
  group: true,
  press: { action: 'only', arg: 'more', focus: 'vela-more-menu' },
  label: '{t:ui.moreNavLabel}',
  testId: 'nav-more',
  id: 'vela-more-trigger',
  style: { ...navBase, gap: '4px' },
  states: [{ when: [{ test: 'nav.moreOn' }], style: { ...navBase, gap: '4px', color: '$ui.ink', 'font-weight': '650' } }],
  a11y: { current: [{ test: 'nav.moreOn' }], expanded: [{ test: 'flag:more' }], haspopup: 'menu' },
  hover: { 'background-color': '$ui.control', color: '$ui.ink' },
  focus: navFocus,
  children: [
    { type: 'text', text: '{t:ui.moreNav}', style: { 'font-weight': '550' }, states: [{ when: [{ test: 'nav.moreOn' }], style: { 'font-weight': '650' } }] },
    moreChevron('16px'),
    navUnderline([{ test: 'nav.moreOn' }]),
  ],
};

const moreDestination = (on: Condition[], press: BoxNode['press'], label: string, testId: string): Node => ({
  type: 'box', press, label, testId, a11y: { current: on },
  style: { position: 'relative', display: 'flex', 'flex-direction': 'row', 'align-items': 'center', gap: '10px',
    'min-height': '44px', padding: '0px 12px', 'border-radius': '$ui.radiusControl', color: '$ui.ink', 'font-size': '14px' },
  states: [{ when: on, style: { 'background-color': '$ui.control', 'font-weight': '700' } }],
  hover: { 'background-color': '$ui.control' }, focus: navFocus,
  children: [
    { type: 'text', text: label, style: { flex: '1', 'line-clamp': '1' } },
    { type: 'box', when: on, style: { width: '6px', height: '6px', 'border-radius': '3px', 'background-color': '$ui.accent', 'flex-shrink': '0' } },
  ],
});

// The destinations the bar had no room for, hanging from the More control.
const moreMenu: Node = {
  type: 'box',
  when: [{ test: 'flag:more' }],
  id: 'vela-more-menu',
  role: 'navigation',
  label: '{t:ui.moreNavLabel}',
  escape: 'more',
  returnFocus: 'vela-more-trigger',
  motion: 'velaPop',
  style: {
    position: 'absolute', top: '100%', right: '0px', 'margin-top': '6px', 'z-index': '30',
    width: '240px', 'max-height': '70vh', 'overflow-y': 'auto', 'box-sizing': 'border-box', padding: '8px',
    display: 'flex', 'flex-direction': 'column', gap: '2px',
    border: '1px solid $ui.glassEdge', 'border-radius': '16px', 'background-color': '$ui.popover',
    'backdrop-filter': 'blur(24px)', 'box-shadow': '0px 24px 70px $ui.shadow',
  },
  children: [
    { type: 'repeat', over: 'nav.destinations', when: [{ test: 'dest.more' }],
      item: moreDestination([{ test: 'dest.on' }], { action: 'library', arg: '{dest.id}' }, '{dest.name}', 'nav-more-{dest.id}') },
    { ...moreDestination([is('env.section', 'live')], { action: 'live' }, '{t:ui.live}', 'nav-more-live'),
      when: [{ test: 'env.canLive' }, { test: 'env.hasLiveLibrary', not: true }, { test: 'nav.liveMore' }] },
  ],
};

const moreNavItem: Node = {
  type: 'box',
  when: [{ test: 'nav.more' }],
  style: { position: 'relative', display: 'flex', 'flex-direction': 'row', 'flex-shrink': '0' },
  children: [moreNavButton, moreMenu],
};

// On phones one labelled control opens every destination in a modal menu. Keeping library view
// tabs in their page toolbar leaves the library name and selected view visible together.
const compactNavigation: Node = {
  type: 'box',
  style: { display: 'none' },
  small: {
    position: 'relative', display: 'flex', 'flex-direction': 'row', flex: '1', 'min-width': '0px',
    height: '44px', 'box-sizing': 'border-box', padding: '0px 12px', gap: '8px', 'align-items': 'center',
    'border-radius': '$ui.radiusControl', border: '1px solid $ui.glassEdge',
    'background-color': '$ui.control', color: '$ui.ink',
  },
  press: { action: 'toggle', arg: 'navigation' },
  label: 'Open navigation',
  testId: 'mobile-navigation',
  id: 'mobile-navigation-trigger',
  a11y: { expanded: [{ test: 'flag:navigation' }], haspopup: 'menu' },
  hover: { 'background-color': '$ui.controlHover' },
  focus: { 'box-shadow': focusRing },
  children: [
    { type: 'icon', symbol: 'menu', style: { width: '18px', height: '18px', 'flex-shrink': '0' } },
    { type: 'text', when: [is('env.section', 'home')], text: '{t:ui.home}', style: { 'font-size': '13px', 'font-weight': '650', 'line-clamp': '1' } },
    // Live TV is named once, below, whether or not the server lists it as a library.
    { type: 'repeat', over: 'nav.destinations', item: { type: 'text', when: [{ test: 'dest.on' }, { test: 'dest.kind', is: 'ne', value: 'live' }], text: '{dest.name}', style: { 'font-size': '13px', 'font-weight': '650', 'line-clamp': '1' } } },
    { type: 'text', when: [is('env.section', 'live')], text: '{t:ui.live}', style: { 'font-size': '13px', 'font-weight': '650', 'line-clamp': '1' } },
  ],
};

const compactDestination = (on: Condition[], press: BoxNode['press'], label: string): Node => ({
  type: 'box', press, label, a11y: { current: on },
  style: { position: 'relative', display: 'flex', 'flex-direction': 'row', 'align-items': 'center',
    height: '48px', padding: '0px 14px', 'border-radius': '$ui.radiusControl', color: '$ui.ink', 'font-size': '15px' },
  states: [{ when: on, style: { 'background-color': '$ui.controlHover', 'font-weight': '700' } }],
  hover: { 'background-color': '$ui.control' }, focus: navFocus,
  children: [{ type: 'text', text: label, style: { 'line-clamp': '1' } }],
});

const compactMenu: Node = {
  type: 'box',
  when: [{ test: 'env.viewer' }, { test: 'flag:navigation' }],
  escape: 'navigation',
  returnFocus: 'mobile-navigation-trigger',
  style: { display: 'none' },
  small: { position: 'absolute', top: 'calc(56px + env(safe-area-inset-top))', left: '0px', right: '0px', bottom: '0px',
    display: 'flex', 'align-items': 'stretch', 'z-index': '29' },
  children: [
    { type: 'box', press: { action: 'close', arg: 'navigation' }, label: 'Close navigation',
      style: { position: 'absolute', top: '0px', left: '0px', right: '0px', bottom: '0px',
        'background-color': '$ui.scrim', 'backdrop-filter': 'blur(4px)' } },
    { type: 'box', role: 'navigation', label: 'Main navigation', motion: 'velaPop',
      style: { position: 'relative', display: 'flex', 'flex-direction': 'column', gap: '4px',
        margin: '10px 12px auto 12px', padding: '12px', 'border-radius': '20px', border: '1px solid $ui.glassEdge',
        'background-color': '$ui.popover', 'box-shadow': '0px 24px 70px $ui.shadow' },
      children: [
        compactDestination([is('env.section', 'home')], { action: 'home' }, '{t:ui.home}'),
        { type: 'repeat', over: 'nav.destinations', item: compactDestination([{ test: 'dest.on' }], { action: 'library', arg: '{dest.id}' }, '{dest.name}') },
        { ...compactDestination([is('env.section', 'live')], { action: 'live' }, '{t:ui.live}'),
          when: [{ test: 'env.canLive' }, { test: 'env.hasLiveLibrary', not: true }] },
      ] },
  ],
};

// The viewer's badge: their initial on a warm disc. The renderer draws their avatar over it where
// the server gives one (viewer-avatar.ts), so a missing or failed picture leaves the initial showing.
export const viewerBadge = (size: number, fontSize: string): Node => ({
  type: 'text',
  text: '{env.viewerInitial}',
  style: {
    width: `${size}px`,
    height: `${size}px`,
    'border-radius': `${size / 2}px`,
    'flex-shrink': '0',
    display: 'flex',
    'align-items': 'center',
    'justify-content': 'center',
    'font-size': fontSize,
    'font-weight': '650',
    color: '$ui.ink',
    'background-image': 'linear-gradient(135deg, #c0703f 0%, #5b2a4a 100%)',
  },
});

// The menu ends quietly with which Vela this is, where it runs and the server it is connected to,
// for a viewer asked what they run. Selectable on the web; on TV the remote reaches it and a
// screen reader reads it whole.
export const aboutLine: Node = {
  type: 'box',
  when: [{ test: 'env.aboutLine' }],
  readingStop: true,
  label: '{env.aboutLabel}',
  testId: 'about-line',
  style: { 'padding-top': '14px', 'margin-top': '-4px',
    'border-style': 'solid', 'border-width': '0px', 'border-top-width': '1px', 'border-top-color': '$ui.glassEdge' },
  children: [{ type: 'text', text: '{env.aboutLine}', style: { 'font-size': '12px', 'line-height': '16px', color: '$ui.inkQuiet' } }],
};

export const shell: Node = {
  type: 'box',
  style: {
    display: 'flex',
    'flex-direction': 'column',
    height: '100%',
    'min-height': '0px',
    'background-color': '$ui.page',
    color: '$ui.ink',
    'font-family': sans,
  },
  children: [
    {
      type: 'box',
      role: 'navigation',
      when: [{ test: 'env.viewer' }],
      motion: 'velaNavIn',
      // Below the status bar and any notch; its veil reaches up behind them.
      style: { position: 'absolute', top: '0px', left: '0px', right: '0px', 'z-index': '20', 'padding-top': 'env(safe-area-inset-top)' },
      children: [
        {
          type: 'box',
          style: {
            position: 'absolute',
            top: '0px',
            left: '0px',
            right: '0px',
            bottom: '0px',
            'pointer-events': 'none',
            // One even band behind both control rows; fading inside it visually shifts its centre.
            'background-color': veil(70),
            'backdrop-filter': 'blur(16px) saturate(1.2)',
            transition: 'background-color 240ms linear',
          },
          // Once the page scrolls under it the band is all but solid, so rows never read through
          // the navigation; over the hero at rest the art still shows behind it.
          states: [{ when: [{ test: 'flag:keep-page-scrolled' }], style: {
            position: 'absolute', top: '0px', left: '0px', right: '0px', bottom: '0px', 'pointer-events': 'none',
            'background-color': veil(94), 'backdrop-filter': 'blur(24px) saturate(1.2)', transition: 'background-color 240ms linear',
          } }],
        },
        {
          type: 'box',
          style: {
            position: 'relative',
            display: 'flex',
            'flex-direction': 'row',
            height: '56px',
            'box-sizing': 'border-box',
            ...gutter,
            'align-items': 'center',
            gap: '10px',
          },
          small: { height: '56px', ...gutterSmall, gap: '8px' },
          states: [{ when: [is('env.section', 'live'), { ...small, not: true }], style: { height: '56px' } }],
          children: [
            {
              type: 'box',
              press: { action: 'home' },
              label: '{t:ui.velaHome}',
              controlStates: false,
              style: { position: 'relative', 'margin-right': '22px', 'min-height': '44px', 'min-width': '44px', display: 'flex', 'align-items': 'center', 'justify-content': 'center' } as Style,
              small: { 'margin-right': '0px' } as Style,
              children: [wordmark(24, 24)],
            },
            // The room the destinations fit to (`fit`): the row keeps what fits, More the rest.
            {
              type: 'box',
              style: {
                position: 'relative',
                display: 'flex',
                'flex-direction': 'row',
                flex: '1',
                'min-width': '0px',
                'align-items': 'center',
              },
              small: { display: 'none' },
              children: [
                {
                  type: 'box',
                  fit: 'nav',
                  style: { display: 'flex', 'flex-direction': 'row', gap: '2px', 'align-items': 'center', 'max-width': '100%' },
                  children: [
                    navItem(
                      [{ test: 'env.section', is: 'eq', value: 'home' }],
                      { action: 'home' },
                      '{t:ui.home}',
                    ),
                    {
                      type: 'repeat',
                      over: 'nav.destinations',
                      item: {
                        ...navItem(
                          [{ test: 'dest.on' }],
                          { action: 'library', arg: '{dest.id}' },
                          '{dest.name}',
                        ),
                        when: [{ test: 'dest.more', not: true }],
                      },
                    },
                    {
                      ...navItem([is('env.section', 'live')], { action: 'live' }, '{t:ui.live}'),
                      when: [{ test: 'env.canLive' }, { test: 'env.hasLiveLibrary', not: true }, { test: 'nav.liveMore', not: true }],
                    },
                    moreNavItem,
                  ],
                },
              ],
            },
            compactNavigation,
            {
              type: 'box',
              press: { action: 'search' },
              label: '{t:ui.search}',
              style: {
                position: 'relative',
                width: '44px',
                height: '44px',
                'box-sizing': 'border-box',
                // The icon sits in the middle of the circle: the padding alone left it 2px up and left.
                display: 'flex',
                'align-items': 'center',
                'justify-content': 'center',
                'border-radius': '$ui.radiusControl',
                border: '1px solid $ui.glassEdge',
                'background-color': '$ui.control',
                'backdrop-filter': 'blur(20px) saturate(1.3)',
                'flex-shrink': '0',
              },
              hover: { 'background-color': '$ui.controlHover' },
              focus: { 'box-shadow': focusRing },
              children: [{ type: 'icon', symbol: 'search', style: { width: '18px', height: '18px' } }],
            },
            {
              type: 'box',
              press: { action: 'toggle', arg: 'menu' },
              label: '{t:ui.profileAndAppearance}',
              testId: 'profile-menu',
              id: 'profile-menu-trigger',
              style: {
                position: 'relative',
                display: 'flex',
                'flex-direction': 'row',
                gap: '10px',
                'align-items': 'center',
                height: '48px',
                'box-sizing': 'border-box',
                padding: '4px 14px 4px 4px',
                'border-radius': '$ui.radiusControl',
                'flex-shrink': '0',
                color: '$ui.inkSecondary',
                'font-weight': '550',
              },
              hover: { 'background-color': '$ui.control', color: '$ui.ink' },
              focus: navFocus,
              small: { padding: '4px', 'min-width': '44px' },
              children: [
                viewerBadge(32, '14px'),
                {
                  type: 'text',
                  text: '{env.viewer}',
                  style: { 'font-size': '14px', 'font-weight': '550' },
                  small: { display: 'none' },
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
    compactMenu,
    // Under the bar (whose More menu stays above it), a transparent layer owns the first press
    // outside More's menu and closes it.
    {
      type: 'box',
      when: [{ test: 'env.viewer' }, { test: 'flag:more' }],
      press: { action: 'close', arg: 'more' },
      label: '{t:ui.closeMoreNav}',
      testId: 'nav-more-dismiss',
      style: { position: 'absolute', top: '0px', right: '0px', bottom: '0px', left: '0px', 'z-index': '19', 'background-color': 'transparent' },
    },
    // A transparent modal layer owns the first press outside the profile menu. Besides closing
    // the menu, this keeps that press from selecting a card or navigation control underneath it.
    {
      type: 'box',
      when: [{ test: 'env.viewer' }, { test: 'flag:menu' }],
      press: { action: 'close', arg: 'menu' },
      label: 'Close profile menu',
      testId: 'profile-menu-dismiss',
      style: {
        position: 'absolute',
        top: '0px',
        right: '0px',
        bottom: '0px',
        left: '0px',
        'z-index': '29',
        'background-color': 'transparent',
      },
    },
    // Escape closes the menu and returns to its trigger, as compiled's menuKey does.
    {
      type: 'box',
      when: [{ test: 'env.viewer' }, { test: 'flag:menu' }],
      escape: 'menu',
      returnFocus: 'profile-menu-trigger',
      motion: 'velaPop',
      style: {
        position: 'absolute',
        top: 'calc(56px + env(safe-area-inset-top))',
        'max-height': 'calc(100vh - 68px - env(safe-area-inset-top) - env(safe-area-inset-bottom))',
        'overflow-y': 'auto',
        right: 'max(28px, 4vw)',
        'z-index': '30',
        width: '260px',
        'box-sizing': 'border-box',
        padding: '20px',
        display: 'flex',
        'flex-direction': 'column',
        gap: '16px',
        border: '1px solid $ui.glassEdge',
        'border-radius': '20px',
        'background-color': '$ui.popover',
        'backdrop-filter': 'blur(24px)',
        'box-shadow': '0px 24px 70px $ui.shadow',
      },
      small: { top: 'calc(56px + env(safe-area-inset-top))', right: '12px' },
      children: [
        {
          type: 'box',
          style: { display: 'flex', 'flex-direction': 'row', gap: '12px', 'align-items': 'center' },
          children: [
            viewerBadge(40, '17px'),
            {
              type: 'text',
              text: '{env.viewer}',
              style: { 'font-size': '16px', 'font-weight': '600', flex: '1', 'line-clamp': '1' },
            },
          ],
        },
        { type: 'box', style: { height: '1px', 'background-color': '$ui.glassEdge' } },
        {
          type: 'box', when: [{ test: 'env.canSwitchProfile' }], press: { action: 'switchProfile' }, label: '{t:ui.switchProfile}', testId: 'switch-profile',
          style: { position: 'relative', display: 'flex', 'flex-direction': 'row', gap: '10px', 'align-items': 'center', height: '48px',
            'box-sizing': 'border-box', padding: '8px 10px', margin: '0px -10px', 'border-radius': '12px', 'font-size': '14px', color: '$ui.ink' },
          hover: { 'background-color': '$ui.control' }, focus: navFocus,
          children: [{ type: 'icon', symbol: 'person', style: { width: '16px', height: '16px' } }, { type: 'text', text: '{t:ui.switchProfile}' }],
        },
        {
          type: 'box', when: [{ test: 'env.canPlaylists' }], press: { action: 'playlists' }, label: 'Playlists', testId: 'profile-playlists',
          style: { position: 'relative', display: 'flex', 'flex-direction': 'row', gap: '10px', 'align-items': 'center', height: '48px',
            'box-sizing': 'border-box', padding: '8px 10px', margin: '0px -10px', 'border-radius': '12px', 'font-size': '14px', color: '$ui.ink' },
          hover: { 'background-color': '$ui.control' }, focus: navFocus,
          children: [{ type: 'icon', symbol: 'layers', style: { width: '16px', height: '16px' } }, { type: 'text', text: 'Playlists' }],
        },
        {
          type: 'box',
          press: { action: 'openPicker' },
          label: '{t:ui.appearance}',
          testId: 'skin-picker',
          style: {
            position: 'relative',
            display: 'flex',
            'flex-direction': 'row',
            'justify-content': 'space-between',
            'align-items': 'center',
            height: '56px',
            'box-sizing': 'border-box',
            padding: '8px 10px',
            margin: '0px -10px',
            'border-radius': '12px',
            color: '$ui.ink',
          },
          hover: { 'background-color': '$ui.control', color: '$ui.ink' },
          focus: navFocus,
          children: [
            {
              type: 'box',
              style: { display: 'flex', 'flex-direction': 'column', gap: '2px' },
              children: [
                {
                  type: 'text',
                  text: '{t:ui.appearance}',
                  style: {
                    'font-size': '12px',
                    'font-weight': '600',
                    'letter-spacing': '0.18em',
                    'text-transform': 'uppercase',
                    color: '$ui.inkQuiet',
                  },
                },
                { type: 'text', text: '{env.skinName}', style: { 'font-size': '14px' } },
              ],
            },
            {
              type: 'icon',
              symbol: 'forward-chevron',
              style: { width: '12px', height: '12px', color: '$ui.inkQuiet' },
            },
          ],
        },
        { type: 'widget', widget: 'install', params: { action: 'install', label: '{t:pwa.install}' } },
        { type: 'widget', widget: 'install', params: { action: 'update', label: '{t:pwa.update}' } },
        // Your servers: the current one checked; choosing another switches, and Connect adds one.
        { type: 'widget', widget: 'serverSwitcher' },
        {
          type: 'box',
          press: { action: 'signOut' },
          label: '{t:ui.signOut}',
          style: {
            position: 'relative',
            display: 'flex',
            'flex-direction': 'row',
            gap: '10px',
            'align-items': 'center',
            height: '56px',
            'box-sizing': 'border-box',
            padding: '8px 10px',
            margin: '0px -10px',
            'border-radius': '12px',
            'font-size': '14px',
          },
          hover: { 'background-color': '$ui.control', color: '$ui.ink' },
          focus: navFocus,
          children: [
            { type: 'icon', symbol: 'sign-out', style: { width: '16px', height: '16px' } },
            { type: 'text', text: '{t:ui.signOut}' },
          ],
        },
        aboutLine,
      ],
    },
  ],
};

// Lounge: the living-room skin, a skin document (protocol/v0/skin.ts). Ten-foot type,
// TV overscan margins and a remote-first focus language: the focused poster lifts,
// grows and glows, and the full-screen backdrop behind the rows belongs to the title
// on the top shelf. Every affordance is a pressable box, so focus reaches it.
import type { Node, SkinDocument, Style } from '../../../skin';

// Ten-foot geometry: sizes scale with the screen between a 1280 laptop and a 1920 TV,
// and the gutters keep the TV's 5% overscan margin (Apple TV's 90 px at 1080p).
const side = 'max(48px, 5vw)';
const gutter = { 'padding-left': side, 'padding-right': side } as Style;
const gutterSmall = { 'padding-left': '20px', 'padding-right': '20px' } as Style;
const sans = 'system-ui, -apple-system, "SF Pro Display", "Segoe UI Variable Display", "Segoe UI", Roboto, sans-serif';
const ease = 'cubic-bezier(0.2, 0.9, 0.25, 1)';
const lift = `scale 420ms ${ease}, translate 420ms ${ease}, box-shadow 420ms ${ease}, background-color 200ms linear, color 200ms linear`;

// The focus language, one recipe everywhere: white light on the edge, a warm halo, a deep shadow.
const ring = '0px 0px 0px 4px rgba(255, 255, 255, 0.94), 0px 30px 60px -14px rgba(0, 0, 0, 0.85), 0px 0px 60px 6px rgba(220, 185, 152, 0.30)';
const rest = '0px 0px 0px 1px rgba(255, 255, 255, 0.08), 0px 14px 30px -16px rgba(0, 0, 0, 0.8)';

// A capsule button: glass at rest, white with dark ink when focused (the tvOS idiom).
const capsule = (height: string): Style => ({
  position: 'relative', display: 'flex', 'flex-direction': 'row', 'align-items': 'center', 'justify-content': 'center', gap: '14px', 'box-sizing': 'border-box',
  height, 'padding-left': 'clamp(26px, 2vw, 40px)', 'padding-right': 'clamp(28px, 2.2vw, 44px)', 'border-radius': '999px', 'flex-shrink': '0',
  'background-color': 'rgba(255, 255, 255, 0.14)', 'backdrop-filter': 'blur(28px) saturate(1.4)', color: '$ink', 'box-shadow': '0px 0px 0px 1px rgba(255, 255, 255, 0.10)',
  'font-size': 'clamp(17px, 1.3vw, 25px)', 'font-weight': '650', transition: lift,
} as Style);
const capsuleFocus: Style = { 'background-color': '$ink', color: '$ground', scale: '1.08', 'box-shadow': '0px 18px 44px -10px rgba(0, 0, 0, 0.7), 0px 0px 44px 4px rgba(220, 185, 152, 0.35)' } as Style;

// ---------------------------------------------------------------- shell: the top bar

const tab = (label: string, press: { action: 'home' | 'library'; arg?: string }, on: Node['when'], testId: string): Node => ({
  type: 'box', press, label, testId, a11y: { current: on },
  style: { position: 'relative', display: 'flex', 'flex-direction': 'row', 'align-items': 'center', gap: '10px', height: 'clamp(44px, 3.4vw, 62px)', 'box-sizing': 'border-box', padding: '0px clamp(18px, 1.5vw, 28px)', 'border-radius': '999px', color: '$ink-dim', 'font-size': 'clamp(16px, 1.25vw, 24px)', 'font-weight': '600', 'white-space': 'nowrap', 'flex-shrink': '0', transition: lift },
  focus: { 'background-color': '$ink', color: '$ground', scale: '1.08', 'box-shadow': '0px 14px 34px -10px rgba(0, 0, 0, 0.7)' },
  hover: { color: '$ink', 'background-color': 'rgba(255, 255, 255, 0.12)' },
  small: { height: '40px', padding: '0px 14px', 'font-size': '15px' },
  children: [
    // The current section: a filled capsule behind its name.
    { type: 'box', when: on, style: { position: 'absolute', inset: '0px', 'border-radius': '999px', 'background-color': 'rgba(255, 255, 255, 0.16)', 'box-shadow': 'inset 0px 0px 0px 1px rgba(255, 255, 255, 0.14)' } },
    { type: 'text', text: label, style: { position: 'relative' } },
  ],
});
const libraryTab: Node = { ...tab('{dest.name}', { action: 'library', arg: '{dest.id}' }, [{ test: 'dest.on' }], 'nav-{dest.id}') };

const shell: Node = { type: 'box', style: { display: 'flex', 'flex-direction': 'column', height: '100%', 'min-height': '0px', 'background-color': '$ground', color: '$ink', 'font-family': sans }, children: [
  { type: 'slot', slot: 'children', style: { display: 'flex', 'flex-direction': 'column', flex: '1', 'min-height': '0px' }, inner: { display: 'flex', 'flex-direction': 'column', 'flex-grow': '1', 'min-height': '0px', height: '100%', width: '100%' } as Style },
  { type: 'box', role: 'navigation', label: '{s:mainNav}', when: [{ test: 'env.viewer' }], motion: 'navIn', style: { position: 'absolute', top: '0px', left: '0px', right: '0px', 'z-index': '20' }, children: [
    // A soft fall of shade, so the bar reads over any backdrop and the rows that scroll under it.
    { type: 'box', style: { position: 'absolute', top: '0px', left: '0px', right: '0px', height: '150%', 'pointer-events': 'none', 'background-image': 'linear-gradient(180deg, rgba(5, 6, 9, 0.9) 0%, rgba(5, 6, 9, 0.72) 55%, rgba(5, 6, 9, 0) 100%)', 'backdrop-filter': 'blur(22px) saturate(1.2)', 'mask-image': 'linear-gradient(180deg, black 0%, black 58%, transparent 100%)' } },
    { type: 'box', style: { position: 'relative', display: 'flex', 'flex-direction': 'row', 'align-items': 'center', gap: '18px', 'box-sizing': 'border-box', height: 'calc(clamp(84px, 7vw, 132px) + max(0px, env(safe-area-inset-top)))', 'padding-top': 'max(14px, 2.4vh)', ...gutter },
      small: { height: '64px', 'padding-top': '0px', gap: '10px', ...gutterSmall }, children: [
        { type: 'box', press: { action: 'home' }, label: '{s:velaHome}', testId: 'nav-brand', style: { position: 'relative', display: 'flex', 'align-items': 'center', padding: '10px 14px', margin: '0px -14px', 'border-radius': '18px', 'flex-shrink': '0', transition: lift },
          focus: { 'background-color': 'rgba(255, 255, 255, 0.14)', scale: '1.06' }, children: [
            { type: 'image', src: 'assets/brand/vela-lockup.svg', alt: '', style: { width: 'clamp(92px, 7.4vw, 142px)', height: 'clamp(35px, 2.8vw, 54px)' }, small: { width: '74px', height: '28px' } },
          ] },
        // The tabs float in one glass capsule, centred like a TV's top bar.
        { type: 'box', style: { flex: '1', display: 'flex', 'flex-direction': 'row', 'justify-content': 'center', 'min-width': '0px' }, small: { 'justify-content': 'flex-start' }, children: [
          { type: 'box', style: { display: 'flex', 'flex-direction': 'row', 'align-items': 'center', gap: '4px', padding: '6px', 'border-radius': '999px', 'background-color': 'rgba(18, 20, 26, 0.55)', 'backdrop-filter': 'blur(30px) saturate(1.5)', 'box-shadow': '0px 0px 0px 1px rgba(255, 255, 255, 0.08), 0px 20px 50px -20px rgba(0, 0, 0, 0.8)', 'max-width': '100%', 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none' },
            small: { padding: '4px' }, children: [
              tab('{s:home}', { action: 'home' }, [{ test: 'env.section', is: 'eq', value: 'home' }], 'nav-home'),
              { type: 'repeat', over: 'nav.destinations', item: libraryTab },
              { type: 'box', press: { action: 'search' }, label: '{s:search}', testId: 'nav-search',
                style: { position: 'relative', display: 'flex', 'flex-direction': 'row', 'align-items': 'center', gap: '10px', height: 'clamp(44px, 3.4vw, 62px)', 'box-sizing': 'border-box', padding: '0px clamp(18px, 1.5vw, 28px)', 'border-radius': '999px', color: '$ink-dim', 'font-size': 'clamp(16px, 1.25vw, 24px)', 'font-weight': '600', 'flex-shrink': '0', transition: lift },
                focus: { 'background-color': '$ink', color: '$ground', scale: '1.08', 'box-shadow': '0px 14px 34px -10px rgba(0, 0, 0, 0.7)' }, hover: { color: '$ink', 'background-color': 'rgba(255, 255, 255, 0.12)' },
                small: { height: '40px', padding: '0px 12px' }, children: [
                  { type: 'icon', symbol: 'search', style: { width: 'clamp(18px, 1.3vw, 26px)', height: 'clamp(18px, 1.3vw, 26px)' } },
                  { type: 'text', text: '{s:search}', small: { display: 'none' } },
                ] },
            ] },
        ] },
        { type: 'box', id: 'lounge-profile', press: { action: 'toggle', arg: 'menu' }, label: '{s:profile}', testId: 'profile-menu', a11y: { expanded: [{ test: 'flag:menu' }], haspopup: 'dialog' }, style: { position: 'relative', display: 'flex', 'flex-shrink': '0', 'border-radius': '999px', transition: lift },
          focus: { scale: '1.12', 'box-shadow': '0px 0px 0px 4px rgba(255, 255, 255, 0.94), 0px 0px 40px 4px rgba(220, 185, 152, 0.4)' }, hover: { scale: '1.06' }, children: [
            { type: 'text', text: '{env.viewerInitial}', style: { display: 'flex', 'align-items': 'center', 'justify-content': 'center', width: 'clamp(44px, 3.4vw, 62px)', height: 'clamp(44px, 3.4vw, 62px)', 'border-radius': '999px', 'font-size': 'clamp(18px, 1.35vw, 26px)', 'font-weight': '700', color: '$ground', 'background-image': 'linear-gradient(140deg, #f5f1e9 0%, #dcb998 100%)' },
              small: { width: '40px', height: '40px', 'font-size': '16px' } },
          ] },
      ] },
  ] },
  // The profile sheet: large rows a remote can step through.
  { type: 'box', when: [{ test: 'env.viewer' }, { test: 'flag:menu' }], motion: 'sheet', role: 'dialog', label: '{s:profile}', escape: 'menu', returnFocus: 'lounge-profile',
    style: { position: 'absolute', top: 'calc(clamp(84px, 7vw, 132px) + 8px)', right: side, 'z-index': '30', width: 'clamp(300px, 24vw, 440px)', 'box-sizing': 'border-box', padding: 'clamp(18px, 1.4vw, 26px)', display: 'flex', 'flex-direction': 'column', gap: '10px', 'border-radius': '30px', 'background-color': 'rgba(24, 26, 32, 0.86)', 'backdrop-filter': 'blur(40px) saturate(1.5)', 'box-shadow': '0px 0px 0px 1px rgba(255, 255, 255, 0.10), 0px 40px 90px -20px rgba(0, 0, 0, 0.9)', 'font-size': 'clamp(16px, 1.2vw, 22px)' },
    small: { top: '68px', right: '12px', left: '12px', width: 'auto' }, children: [
      { type: 'box', style: { display: 'flex', 'flex-direction': 'row', gap: '16px', 'align-items': 'center', padding: '6px 10px 14px' }, children: [
        { type: 'text', text: '{env.viewerInitial}', style: { display: 'flex', 'align-items': 'center', 'justify-content': 'center', width: '56px', height: '56px', 'border-radius': '28px', 'font-size': '24px', 'font-weight': '700', color: '$ground', 'background-image': 'linear-gradient(140deg, #f5f1e9 0%, #dcb998 100%)', 'flex-shrink': '0' } },
        { type: 'box', style: { display: 'flex', 'flex-direction': 'column', gap: '2px', 'min-width': '0px' }, children: [
          { type: 'text', text: '{env.viewer}', style: { 'font-size': 'clamp(19px, 1.45vw, 27px)', 'font-weight': '700', 'line-clamp': '1' } },
          { type: 'text', text: '{s:watchingAs}', style: { 'font-size': 'clamp(14px, 1vw, 18px)', color: '$ink-quiet' } },
        ] },
      ] },
      { type: 'box', press: { action: 'openPicker' }, label: '{s:appearance}', testId: 'skin-picker', style: { ...sheetRow() }, focus: sheetFocus(), hover: { 'background-color': 'rgba(255, 255, 255, 0.10)' }, children: [
        { type: 'icon', symbol: 'layers', style: { width: '24px', height: '24px' } },
        { type: 'box', style: { display: 'flex', 'flex-direction': 'column', gap: '2px', flex: '1' }, children: [
          { type: 'text', text: '{s:appearance}', style: { 'font-weight': '650' } },
          { type: 'text', text: '{s:skinName}', style: { 'font-size': '0.8em', opacity: '0.7' } },
        ] },
        { type: 'icon', symbol: 'forward-chevron', style: { width: '16px', height: '16px', opacity: '0.6' } },
      ] },
      { type: 'widget', widget: 'install', params: { action: 'install', label: '{s:install}' } },
      { type: 'widget', widget: 'install', params: { action: 'update', label: '{s:update}' } },
      { type: 'box', press: { action: 'signOut' }, label: '{s:signOut}', style: { ...sheetRow() }, focus: sheetFocus(), hover: { 'background-color': 'rgba(255, 255, 255, 0.10)' }, children: [
        { type: 'icon', symbol: 'sign-out', style: { width: '24px', height: '24px' } },
        { type: 'text', text: '{s:signOut}', style: { 'font-weight': '650' } },
      ] },
    ] },
] };
function sheetRow(): Style {
  return { position: 'relative', display: 'flex', 'flex-direction': 'row', gap: '16px', 'align-items': 'center', 'min-height': 'clamp(58px, 4.2vw, 76px)', 'box-sizing': 'border-box', padding: '10px 18px', 'border-radius': '20px', color: '$ink', transition: lift } as Style;
}
function sheetFocus(): Style { return { 'background-color': '$ink', color: '$ground', scale: '1.04', 'box-shadow': '0px 16px 36px -12px rgba(0, 0, 0, 0.8)' } as Style; }

// ---------------------------------------------------------------- home

// The backdrop: full-screen, pinned behind everything while the rows scroll over it.
// Each featured title mounts its own layer, which dissolves in over the last.
const backdrop: Node = { type: 'box', style: { position: 'sticky', top: '0px', height: '100vh', 'margin-bottom': '-100vh', 'z-index': '0', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'pointer-events': 'none', 'background-color': '$ground' }, children: [
  { type: 'repeat', over: 'home.hero', item: { type: 'box', motion: 'backdropIn', style: { position: 'absolute', inset: '0px' }, children: [
    { type: 'box', when: [{ test: 'hero.backdrop' }], motion: 'drift', style: { position: 'absolute', inset: '0px', 'transform-origin': '70% 30%' }, children: [
      { type: 'image', src: '{hero.backdrop}', alt: '', fade: true, style: { position: 'absolute', inset: '0px', width: '100%', height: '100%', 'object-fit': 'cover' } },
    ] },
    { type: 'image', when: [{ test: 'hero.backdrop', not: true }, { test: 'hero.poster' }], src: '{hero.poster}', alt: '', style: { position: 'absolute', top: '-20%', left: '-20%', width: '140%', height: '140%', 'object-fit': 'cover', filter: 'blur(80px) saturate(1.5)', opacity: '0.6' } },
    // The title's own colour glows up from the floor where the backdrop has one.
    { type: 'box', when: [{ test: 'hero.accent' }], style: { position: 'absolute', left: '-10%', right: '-10%', bottom: '-30%', height: '70%', 'background-color': '{hero.accent}', opacity: '0.28', 'mask-image': 'radial-gradient(closest-side, black 0%, transparent 100%)' } },
  ] } },
  // Shade: the copy's side, the floor the rows sit on, and a vignette.
  { type: 'box', style: { position: 'absolute', inset: '0px', 'background-image': 'linear-gradient(90deg, rgba(5, 6, 9, 0.88) 0%, rgba(5, 6, 9, 0.55) 30%, rgba(5, 6, 9, 0) 62%), linear-gradient(0deg, rgba(5, 6, 9, 0.96) 0%, rgba(5, 6, 9, 0.72) 30%, rgba(5, 6, 9, 0) 62%), radial-gradient(ellipse 120% 90% at 65% 30%, rgba(5, 6, 9, 0) 55%, rgba(5, 6, 9, 0.6) 100%)' } },
  // While searching the backdrop sinks into the ground.
  { type: 'box', when: [{ test: 'env.searching' }], motion: 'fadeIn', style: { position: 'absolute', inset: '0px', 'background-color': 'rgba(5, 6, 9, 0.84)', 'backdrop-filter': 'blur(40px)' } },
] };

const heroPlay: Node = { type: 'box', press: { action: 'play', arg: '{hero.id}' }, label: '{heroAct.actionLabel}', testId: 'hero-primary', when: [{ test: 'heroAct.playable' }],
  style: { ...capsule('clamp(58px, 4.4vw, 84px)'), 'background-color': 'rgba(245, 241, 233, 0.92)', color: '$ground' }, focus: capsuleFocus, hover: { 'background-color': '$ink' }, small: { height: '54px' }, children: [
    { type: 'icon', symbol: 'play-fill', style: { width: 'clamp(18px, 1.3vw, 26px)', height: 'clamp(18px, 1.3vw, 26px)' } },
    { type: 'box', style: { display: 'flex', 'flex-direction': 'column', gap: '3px', 'align-items': 'flex-start' }, children: [
      { type: 'text', text: '{heroAct.actionLabel}', style: { 'line-height': '1.05', 'font-weight': '700' } },
      { type: 'text', when: [{ test: 'heroAct.actionDetail' }], text: '{heroAct.actionDetail}', style: { 'font-size': '0.62em', 'font-weight': '600', opacity: '0.62', 'line-height': '1' } },
    ] },
    { type: 'box', when: [{ test: 'heroAct.hasProgress' }], small: { display: 'none' }, style: { width: 'clamp(48px, 4vw, 76px)', height: '5px', 'border-radius': '3px', 'background-color': 'rgba(9, 11, 14, 0.22)', 'overflow-x': 'hidden', 'overflow-y': 'hidden' }, children: [
      { type: 'box', style: { height: '5px', width: '{heroAct.progressPct}%', 'background-color': '$ground' } },
    ] },
  ] };
const heroMore = (primary: boolean): Node => ({ type: 'box', press: { action: 'select', arg: '{hero.kindId}' }, label: '{s:moreInfo}', testId: 'hero-more', when: [{ test: 'heroAct.playable', not: primary }],
  style: capsule('clamp(58px, 4.4vw, 84px)'), focus: capsuleFocus, hover: { 'background-color': 'rgba(255, 255, 255, 0.24)' }, small: { height: '54px' }, children: [
    { type: 'icon', symbol: 'info', style: { width: 'clamp(18px, 1.3vw, 26px)', height: 'clamp(18px, 1.3vw, 26px)' } },
    { type: 'text', text: '{s:moreInfo}' },
  ] });

// The top shelf: the featured title's name, facts and two large actions, low on the screen.
const shelf: Node = { type: 'box', when: [{ test: 'env.searching', not: true }], style: { position: 'relative', 'z-index': '1', display: 'flex', 'flex-direction': 'column', 'justify-content': 'flex-end', 'box-sizing': 'border-box', 'min-height': 'max(500px, 64vh)', 'padding-top': 'clamp(110px, 10vw, 180px)', 'padding-bottom': 'clamp(18px, 2.4vh, 40px)', ...gutter },
  small: { 'min-height': '470px', 'padding-top': '92px', ...gutterSmall }, children: [
    { type: 'repeat', over: 'home.hero', item: { type: 'box', style: { display: 'flex', 'flex-direction': 'column', gap: 'clamp(14px, 1.3vw, 24px)', 'max-width': 'min(54rem, 58vw)' }, small: { 'max-width': 'none', gap: '12px' }, children: [
      { type: 'widget', widget: 'observe', params: { receipt: '{hero.receipt}' } },
      { type: 'text', text: '{heroAct.reasonLabel}', motion: 'copy0', style: { 'font-size': 'clamp(13px, 0.95vw, 18px)', 'font-weight': '700', 'letter-spacing': '0.16em', 'text-transform': 'uppercase', color: '$amber', 'text-shadow': '0px 1px 16px rgba(0, 0, 0, 0.6)' } },
      { type: 'image', when: [{ test: 'hero.logo' }], src: '{hero.logo}', alt: '{hero.name}', role: 'heading', level: 1, motion: 'copy1', style: { height: 'clamp(120px, 11vw, 210px)', width: 'auto', 'max-width': 'min(640px, 80%)', 'object-fit': 'contain', 'align-self': 'flex-start' } as Style, small: { height: '92px' } },
      { type: 'text', when: [{ test: 'hero.logo', not: true }], text: '{hero.name}', role: 'heading', level: 1, motion: 'copy1', style: { 'font-size': 'clamp(52px, 5.4vw, 112px)', 'font-weight': '800', 'letter-spacing': '-0.025em', 'line-height': '0.96', 'line-clamp': '2', 'text-shadow': '0px 6px 50px rgba(0, 0, 0, 0.55)' }, small: { 'font-size': '42px' } },
      { type: 'text', text: '{hero.factsLine}', motion: 'copy2', style: { 'font-size': 'clamp(16px, 1.25vw, 24px)', 'font-weight': '600', color: '$ink-dim', 'font-variant-numeric': 'tabular-nums', 'text-shadow': '0px 1px 14px rgba(0, 0, 0, 0.6)' }, small: { 'font-size': '14px' } },
      { type: 'text', when: [{ test: 'hero.summary' }], text: '{hero.summary}', motion: 'copy2', style: { 'font-size': 'clamp(17px, 1.3vw, 25px)', 'line-height': '1.45', color: '$ink-dim', 'line-clamp': '3', 'max-width': '44rem', 'text-shadow': '0px 1px 16px rgba(0, 0, 0, 0.7)' }, small: { 'font-size': '15px', 'line-clamp': '2' } },
      { type: 'box', motion: 'copy3', style: { display: 'flex', 'flex-direction': 'row', 'flex-wrap': 'wrap', gap: 'clamp(14px, 1.2vw, 24px)', 'align-items': 'center', 'margin-top': 'clamp(8px, 1vw, 18px)' } as Style, children: [heroPlay, heroMore(false), heroMore(true)] },
    ] } },
    // Featured titles: one large focusable dot each, the current one long and filling.
    { type: 'box', role: 'group', label: '{s:featured}', when: [{ test: 'env.heroCount', is: 'gt', value: '1' }], motion: 'copy3', style: { display: 'flex', 'flex-direction': 'row', gap: '6px', 'align-items': 'center', 'margin-top': 'clamp(14px, 1.6vw, 30px)', 'margin-left': '-8px' } as Style, children: [
      { type: 'repeat', over: 'home.heroes', item: { type: 'box', press: { action: 'pickHero', arg: '{index}' }, label: '{hero.name}', a11y: { current: [{ test: 'index.current' }] }, style: { position: 'relative', display: 'flex', 'align-items': 'center', padding: '10px 8px', 'border-radius': '999px', transition: lift },
        focus: { 'background-color': 'rgba(255, 255, 255, 0.16)', scale: '1.15' }, children: [
          { type: 'box', when: [{ test: 'index.current' }], style: { position: 'relative', width: 'clamp(36px, 2.6vw, 52px)', height: 'clamp(7px, 0.5vw, 10px)', 'border-radius': '999px', 'background-color': 'rgba(255, 255, 255, 0.28)', 'overflow-x': 'hidden', 'overflow-y': 'hidden' }, children: [
            { type: 'box', when: [{ test: 'env.rotating' }], motion: 'heroFill', style: { position: 'absolute', inset: '0px', 'background-color': '$ink' } },
            { type: 'box', when: [{ test: 'env.rotating', not: true }], style: { position: 'absolute', inset: '0px', 'background-color': '$ink' } },
          ] },
          { type: 'box', when: [{ test: 'index.current', not: true }], style: { width: 'clamp(7px, 0.5vw, 10px)', height: 'clamp(7px, 0.5vw, 10px)', 'border-radius': '999px', 'background-color': 'rgba(255, 255, 255, 0.34)' } },
        ] } },
    ] },
  ] };

// A poster: the focused one lifts, grows and catches the light; the art inside moves
// against the frame, which reads as depth (the remote's parallax).
const poster: Node = { type: 'box', group: true, press: { action: 'select', arg: '{card.kindId}' }, label: '{card.label}', testId: 'title-{card.id}',
  style: { position: 'relative', display: 'flex', 'flex-direction': 'column', width: 'clamp(150px, 11.2vw, 252px)', 'flex-shrink': '0', gap: 'clamp(12px, 1vw, 20px)' }, small: { width: '128px', gap: '10px' }, children: [
    { type: 'widget', widget: 'observe', params: { receipt: '{card.receipt}' } },
    { type: 'box', style: { position: 'relative', width: '100%', 'aspect-ratio': '2 / 3', 'border-radius': 'clamp(12px, 0.9vw, 18px)', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'background-color': '$raised', 'box-shadow': rest, scale: '1', translate: '0px 0px', transition: lift },
      groupHover: { scale: '1.12', translate: '0px -10px', 'box-shadow': ring }, small: { 'border-radius': '10px' }, children: [
        { type: 'box', when: [{ test: 'card.poster' }], style: { position: 'absolute', inset: '0px', scale: '1.02', translate: '0px 0px', transition: `scale 600ms ${ease}, translate 600ms ${ease}` }, groupHover: { scale: '1.08', translate: '0px 3%' }, children: [
          { type: 'image', src: '{card.poster}', alt: '', fade: true, style: { position: 'absolute', inset: '0px', width: '100%', height: '100%', 'object-fit': 'cover' } },
        ] },
        { type: 'box', when: [{ test: 'card.poster', not: true }], style: { position: 'absolute', inset: '0px', padding: 'clamp(14px, 1.1vw, 22px)', display: 'flex', 'flex-direction': 'column', 'justify-content': 'flex-end', 'background-image': 'linear-gradient(160deg, #262b34 0%, #121419 100%)' }, children: [
          { type: 'text', text: '{card.name}', style: { 'font-size': 'clamp(18px, 1.4vw, 28px)', 'font-weight': '750', 'line-height': '1.05', 'line-clamp': '4', 'letter-spacing': '-0.01em' } },
        ] },
        // The glint: a band of light crosses the poster as it takes focus.
        { type: 'box', style: { position: 'absolute', top: '-20%', bottom: '-20%', left: '-60%', width: '60%', 'pointer-events': 'none', 'background-image': 'linear-gradient(100deg, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0.22) 50%, rgba(255, 255, 255, 0) 100%)', opacity: '0', translate: '0px 0px', transition: `translate 900ms ${ease}, opacity 900ms ${ease}` },
          groupHover: { opacity: '1', translate: '330% 0px' } },
        { type: 'box', when: [{ test: 'card.played' }], style: { position: 'absolute', top: '10px', right: '10px', width: 'clamp(26px, 1.8vw, 36px)', height: 'clamp(26px, 1.8vw, 36px)', 'border-radius': '999px', display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'background-color': 'rgba(10, 12, 16, 0.6)', 'backdrop-filter': 'blur(14px)' }, children: [
          { type: 'icon', symbol: 'checkmark', style: { width: '50%', height: '50%', color: '$ink' } },
        ] },
        { type: 'box', when: [{ test: 'card.hasProgress' }], style: { position: 'absolute', left: '0px', right: '0px', bottom: '0px', height: '30%', 'background-image': 'linear-gradient(0deg, rgba(5, 6, 9, 0.85) 0%, rgba(5, 6, 9, 0) 100%)' } },
        { type: 'box', when: [{ test: 'card.hasProgress' }], style: { position: 'absolute', left: '12px', right: '12px', bottom: '12px', height: '5px', 'border-radius': '3px', 'background-color': 'rgba(255, 255, 255, 0.24)', 'overflow-x': 'hidden', 'overflow-y': 'hidden' }, children: [
          { type: 'box', style: { height: '5px', width: '{card.progressPct}%', 'background-color': '$ink' } },
        ] },
      ] },
    // The caption brightens and rises with its poster.
    { type: 'box', style: { display: 'flex', 'flex-direction': 'column', gap: '4px', padding: '0px 2px', opacity: '0.62', translate: '0px 0px', transition: `opacity 260ms linear, translate 420ms ${ease}` }, groupHover: { opacity: '1', translate: '0px 8px' }, children: [
      { type: 'text', text: '{card.name}', style: { 'font-size': 'clamp(15px, 1.1vw, 22px)', 'font-weight': '650', 'line-clamp': '1' }, small: { 'font-size': '14px' } },
      { type: 'text', text: '{card.facts}', style: { 'font-size': 'clamp(13px, 0.9vw, 18px)', color: '$ink-quiet', 'line-clamp': '1', 'font-variant-numeric': 'tabular-nums' }, small: { 'font-size': '12px' } },
    ] },
  ] };

// A row of things in progress (continue watching, next up) draws wide 16:9 stills:
// the frame you left, the time left, and the episode under it.
const wide: Node = { type: 'box', group: true, press: { action: 'select', arg: '{card.kindId}' }, label: '{card.label}', testId: 'title-{card.id}',
  style: { position: 'relative', display: 'flex', 'flex-direction': 'column', width: 'clamp(280px, 22vw, 470px)', 'flex-shrink': '0', gap: 'clamp(12px, 1vw, 20px)' }, small: { width: '240px', gap: '10px' }, children: [
    { type: 'widget', widget: 'observe', params: { receipt: '{card.receipt}' } },
    { type: 'box', style: { position: 'relative', width: '100%', 'aspect-ratio': '16 / 9', 'border-radius': 'clamp(12px, 0.9vw, 18px)', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'background-color': '$raised', 'box-shadow': rest, scale: '1', translate: '0px 0px', transition: lift },
      groupHover: { scale: '1.08', translate: '0px -8px', 'box-shadow': ring }, small: { 'border-radius': '10px' }, children: [
        { type: 'box', when: [{ test: 'card.backdrop' }], style: { position: 'absolute', inset: '0px', scale: '1.02', transition: `scale 600ms ${ease}` }, groupHover: { scale: '1.07' }, children: [
          { type: 'image', src: '{card.backdrop}', alt: '', fade: true, style: { position: 'absolute', inset: '0px', width: '100%', height: '100%', 'object-fit': 'cover' } },
        ] },
        { type: 'image', when: [{ test: 'card.backdrop', not: true }, { test: 'card.poster' }], src: '{card.poster}', alt: '', style: { position: 'absolute', top: '-30%', left: '-10%', width: '120%', height: '160%', 'object-fit': 'cover', filter: 'blur(28px) saturate(1.3)', opacity: '0.8' } },
        { type: 'box', style: { position: 'absolute', inset: '0px', 'background-image': 'linear-gradient(0deg, rgba(5, 6, 9, 0.8) 0%, rgba(5, 6, 9, 0) 55%)' } },
        { type: 'text', when: [{ test: 'card.backdrop', not: true }], text: '{card.name}', style: { position: 'absolute', left: 'clamp(14px, 1.1vw, 22px)', right: 'clamp(14px, 1.1vw, 22px)', top: 'clamp(12px, 1vw, 20px)', 'font-size': 'clamp(18px, 1.4vw, 28px)', 'font-weight': '750', 'line-height': '1.05', 'line-clamp': '2' } },
        { type: 'box', style: { position: 'absolute', top: '-20%', bottom: '-20%', left: '-60%', width: '50%', 'pointer-events': 'none', 'background-image': 'linear-gradient(100deg, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0.18) 50%, rgba(255, 255, 255, 0) 100%)', opacity: '0', translate: '0px 0px', transition: `translate 900ms ${ease}, opacity 900ms ${ease}` },
          groupHover: { opacity: '1', translate: '420% 0px' } },
        { type: 'text', when: [{ test: 'card.progressLabel' }, { test: 'card.played', not: true }], text: '{card.progressLabel}', style: { position: 'absolute', right: '12px', bottom: '20px', 'font-size': 'clamp(12px, 0.85vw, 16px)', 'font-weight': '700', 'font-variant-numeric': 'tabular-nums', color: '$ink-dim', 'text-shadow': '0px 1px 8px rgba(0, 0, 0, 0.8)' } },
        { type: 'box', when: [{ test: 'card.hasProgress' }], style: { position: 'absolute', left: '12px', right: '12px', bottom: '10px', height: '5px', 'border-radius': '3px', 'background-color': 'rgba(255, 255, 255, 0.24)', 'overflow-x': 'hidden', 'overflow-y': 'hidden' }, children: [
          { type: 'box', style: { height: '5px', width: '{card.progressPct}%', 'background-color': '$ink' } },
        ] },
      ] },
    { type: 'box', style: { display: 'flex', 'flex-direction': 'column', gap: '4px', padding: '0px 2px', opacity: '0.62', translate: '0px 0px', transition: `opacity 260ms linear, translate 420ms ${ease}` }, groupHover: { opacity: '1', translate: '0px 6px' }, children: [
      { type: 'text', text: '{card.name}', style: { 'font-size': 'clamp(15px, 1.1vw, 22px)', 'font-weight': '650', 'line-clamp': '1' }, small: { 'font-size': '14px' } },
      { type: 'text', text: '{card.facts}', style: { 'font-size': 'clamp(13px, 0.9vw, 18px)', color: '$ink-quiet', 'line-clamp': '1', 'font-variant-numeric': 'tabular-nums' }, small: { 'font-size': '12px' } },
    ] },
  ] };

// A ranked row puts a tall outlined numeral beside each poster.
const ranked: Node = { type: 'box', style: { position: 'relative', display: 'flex', 'flex-direction': 'row', 'align-items': 'flex-end' }, children: [
  { type: 'text', text: '{index.label}', style: { 'font-size': 'clamp(120px, 10vw, 220px)', 'font-weight': '800', 'line-height': '0.8', 'letter-spacing': '-0.06em', color: 'rgba(245, 241, 233, 0.2)', 'text-shadow': '0px 0px 30px rgba(0, 0, 0, 0.5)', 'margin-right': '-0.1em', 'padding-bottom': 'clamp(44px, 3.4vw, 70px)' }, small: { 'font-size': '96px' } },
  { type: 'use', template: 'poster' },
] };

const row: Node = { type: 'box', style: { position: 'relative', display: 'flex', 'flex-direction': 'column', 'padding-bottom': 'clamp(8px, 1vw, 20px)' }, children: [
  { type: 'text', text: '{row.name}', role: 'heading', level: 2, style: { 'font-size': 'clamp(21px, 1.6vw, 32px)', 'font-weight': '700', 'letter-spacing': '-0.01em', 'text-shadow': '0px 1px 12px rgba(0, 0, 0, 0.5)', ...gutter }, small: { 'font-size': '19px', ...gutterSmall } },
  // Room above and below the track lets a focused poster grow without being clipped.
  { type: 'box', style: { display: 'flex', 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none' }, children: [
    { type: 'box', style: { display: 'flex', 'flex-direction': 'row', 'align-items': 'flex-start', gap: 'clamp(20px, 1.9vw, 40px)', 'padding-top': 'clamp(26px, 2.2vw, 44px)', 'padding-bottom': 'clamp(30px, 2.6vw, 52px)', ...gutter }, small: { gap: '14px', 'padding-top': '18px', 'padding-bottom': '22px', ...gutterSmall }, children: [
      { type: 'repeat', over: 'row.items', when: [{ test: 'row.presentation', is: 'ne', value: 'ranked' }, { test: 'row.landscape', not: true }], item: { type: 'use', template: 'poster', motion: 'cardIn', stagger: { step: 40, cap: 8 } } },
      { type: 'repeat', over: 'row.items', when: [{ test: 'row.presentation', is: 'ne', value: 'ranked' }, { test: 'row.landscape' }], item: { type: 'use', template: 'wide', motion: 'cardIn', stagger: { step: 40, cap: 8 } } },
      { type: 'repeat', over: 'row.items', limit: 10, when: [{ test: 'row.presentation', is: 'eq', value: 'ranked' }], item: { type: 'use', template: 'ranked', motion: 'cardIn', stagger: { step: 40, cap: 8 } } },
    ] },
  ] },
] };

const home: Node = { type: 'box', style: { position: 'relative', display: 'flex', 'flex-direction': 'column', 'min-height': '100%', 'padding-bottom': 'max(48px, 6vh)', color: '$ink', 'font-family': sans }, children: [
  backdrop,
  shelf,
  // Search: a wide field between the shelf and the rows; it rises to the top while a query is open.
  { type: 'slot', slot: 'searchField', style: { position: 'relative', 'z-index': '1', display: 'flex', 'flex-direction': 'column', 'align-items': 'center', 'padding-top': '0px', 'padding-bottom': 'clamp(4px, 0.6vw, 12px)', ...gutter } as Style,
    small: { ...gutterSmall, 'padding-top': '8px' } as Style, inner: { width: '100%', 'max-width': '960px' } },
  { type: 'box', when: [{ test: 'env.searching', not: true }], style: { position: 'relative', 'z-index': '1', display: 'flex', 'flex-direction': 'column' }, children: [
    { type: 'repeat', over: 'home.rows', item: { type: 'use', template: 'row', motion: 'rowIn', stagger: { step: 80, cap: 4 } } },
  ] },
] };

// ---------------------------------------------------------------- the title page

const section = (heading: string, when: Node['when'], children: Node[]): Node => ({ type: 'box', when, style: { position: 'relative', display: 'flex', 'flex-direction': 'column', 'padding-bottom': 'clamp(10px, 1.2vw, 24px)' }, children: [
  { type: 'text', text: heading, role: 'heading', level: 2, style: { 'font-size': 'clamp(21px, 1.6vw, 32px)', 'font-weight': '700', 'letter-spacing': '-0.01em', ...gutter }, small: { 'font-size': '19px', ...gutterSmall } },
  ...children,
] });
// A horizontal track with room for a focused item to grow.
const track = (items: Node, gap = 'clamp(20px, 1.9vw, 40px)'): Node => ({ type: 'box', style: { display: 'flex', 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none' }, children: [
  { type: 'box', style: { display: 'flex', 'flex-direction': 'row', 'align-items': 'flex-start', gap, 'padding-top': 'clamp(22px, 2vw, 40px)', 'padding-bottom': 'clamp(26px, 2.4vw, 48px)', ...gutter }, small: { gap: '14px', 'padding-top': '16px', 'padding-bottom': '20px', ...gutterSmall }, children: [items] },
] });

// An episode: a 16:9 still, its number and name, and the time left.
const episode: Node = { type: 'box', group: true, press: { action: 'play', arg: '{card.id}' }, label: '{episode.playLabel}: {card.label}', testId: 'episode-{card.id}',
  style: { position: 'relative', display: 'flex', 'flex-direction': 'column', width: 'clamp(260px, 21vw, 440px)', 'flex-shrink': '0', gap: 'clamp(12px, 1vw, 20px)' }, small: { width: '240px', gap: '10px' }, children: [
    { type: 'box', style: { position: 'relative', width: '100%', 'aspect-ratio': '16 / 9', 'border-radius': 'clamp(12px, 0.9vw, 18px)', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'background-color': '$raised', 'box-shadow': rest, scale: '1', translate: '0px 0px', transition: lift },
      groupHover: { scale: '1.08', translate: '0px -8px', 'box-shadow': ring }, children: [
        { type: 'image', when: [{ test: 'card.backdrop' }], src: '{card.backdrop}', alt: '', fade: true, style: { position: 'absolute', inset: '0px', width: '100%', height: '100%', 'object-fit': 'cover' } },
        { type: 'image', when: [{ test: 'card.backdrop', not: true }, { test: 'card.poster' }], src: '{card.poster}', alt: '', fade: true, style: { position: 'absolute', inset: '0px', width: '100%', height: '100%', 'object-fit': 'cover' } },
        { type: 'box', style: { position: 'absolute', inset: '0px', 'background-image': 'linear-gradient(0deg, rgba(5, 6, 9, 0.7) 0%, rgba(5, 6, 9, 0) 55%)' } },
        // A play glyph appears on the focused still.
        { type: 'box', style: { position: 'absolute', inset: '0px', display: 'flex', 'align-items': 'center', 'justify-content': 'center', opacity: '0', transition: 'opacity 260ms linear' }, groupHover: { opacity: '1' }, children: [
          { type: 'box', style: { display: 'flex', 'align-items': 'center', 'justify-content': 'center', width: 'clamp(52px, 3.8vw, 76px)', height: 'clamp(52px, 3.8vw, 76px)', 'border-radius': '999px', 'background-color': 'rgba(245, 241, 233, 0.92)', color: '$ground' }, children: [
            { type: 'icon', symbol: 'play-fill', style: { width: '40%', height: '40%' } },
          ] },
        ] },
        { type: 'box', when: [{ test: 'card.played' }], style: { position: 'absolute', top: '10px', right: '10px', width: 'clamp(26px, 1.8vw, 36px)', height: 'clamp(26px, 1.8vw, 36px)', 'border-radius': '999px', display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'background-color': 'rgba(10, 12, 16, 0.6)', 'backdrop-filter': 'blur(14px)' }, children: [
          { type: 'icon', symbol: 'checkmark', style: { width: '50%', height: '50%' } },
        ] },
        { type: 'text', when: [{ test: 'card.durationLabel' }], text: '{card.durationLabel}', style: { position: 'absolute', right: '12px', bottom: '14px', 'font-size': 'clamp(13px, 0.9vw, 18px)', 'font-weight': '650', 'font-variant-numeric': 'tabular-nums', 'text-shadow': '0px 1px 8px rgba(0, 0, 0, 0.8)' } },
        { type: 'box', when: [{ test: 'card.hasProgress' }], style: { position: 'absolute', left: '12px', right: '12px', bottom: '10px', height: '5px', 'border-radius': '3px', 'background-color': 'rgba(255, 255, 255, 0.24)', 'overflow-x': 'hidden', 'overflow-y': 'hidden' }, children: [
          { type: 'box', style: { height: '5px', width: '{card.progressPct}%', 'background-color': '$ink' } },
        ] },
      ] },
    { type: 'box', style: { display: 'flex', 'flex-direction': 'column', gap: '6px', padding: '0px 2px', opacity: '0.7', translate: '0px 0px', transition: `opacity 260ms linear, translate 420ms ${ease}` }, groupHover: { opacity: '1', translate: '0px 6px' }, children: [
      { type: 'text', text: '{episode.numberTitle}', style: { 'font-size': 'clamp(15px, 1.1vw, 22px)', 'font-weight': '650', 'line-clamp': '1' } },
      { type: 'text', when: [{ test: 'card.summary' }], text: '{card.summary}', style: { 'font-size': 'clamp(13px, 0.9vw, 18px)', 'line-height': '1.4', color: '$ink-quiet', 'line-clamp': '2' } },
    ] },
  ] };

// The season picker: capsules, the selected one filled.
const season: Node = { type: 'box', press: { action: 'select', arg: '{season.pick}' }, label: '{card.name}', testId: 'season-{card.id}', a11y: { selected: [{ test: 'season.on' }] },
  style: { ...capsule('clamp(46px, 3.4vw, 64px)'), 'background-color': 'rgba(255, 255, 255, 0.08)', color: '$ink-dim', 'font-size': 'clamp(15px, 1.15vw, 22px)' }, focus: capsuleFocus, hover: { 'background-color': 'rgba(255, 255, 255, 0.18)' }, children: [
    // The chosen season, or the first while none is chosen yet.
    { type: 'box', when: [{ test: 'season.on' }], style: { position: 'absolute', inset: '0px', 'border-radius': '999px', 'background-color': 'rgba(255, 255, 255, 0.2)', 'box-shadow': 'inset 0px 0px 0px 2px rgba(255, 255, 255, 0.5)' } },
    { type: 'box', when: [{ test: 'detail.selectedSeason', not: true }, { test: 'index', is: 'eq', value: '0' }], style: { position: 'absolute', inset: '0px', 'border-radius': '999px', 'background-color': 'rgba(255, 255, 255, 0.2)', 'box-shadow': 'inset 0px 0px 0px 2px rgba(255, 255, 255, 0.5)' } },
    { type: 'text', text: '{card.name}', style: { position: 'relative', 'white-space': 'nowrap' } },
  ] };

const person: Node = { type: 'box', style: { display: 'flex', 'flex-direction': 'column', 'align-items': 'center', gap: '10px', width: 'clamp(116px, 8.6vw, 170px)', 'flex-shrink': '0', 'text-align': 'center' }, small: { width: '96px' }, children: [
  { type: 'box', style: { position: 'relative', width: '100%', 'aspect-ratio': '1 / 1', 'border-radius': '999px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'background-image': 'linear-gradient(140deg, #2a2f39 0%, #15181e 100%)', 'box-shadow': rest, display: 'flex', 'align-items': 'center', 'justify-content': 'center' }, children: [
    { type: 'text', when: [{ test: 'person.portrait', not: true }], text: '{person.initials}', style: { 'font-size': 'clamp(26px, 2vw, 40px)', 'font-weight': '700', color: '$ink-dim' } },
    { type: 'image', when: [{ test: 'person.portrait' }], src: '{person.portrait}', alt: '', fade: true, style: { position: 'absolute', inset: '0px', width: '100%', height: '100%', 'object-fit': 'cover' } },
  ] },
  { type: 'text', text: '{person.name}', style: { 'font-size': 'clamp(14px, 1vw, 20px)', 'font-weight': '650', 'line-clamp': '2', 'line-height': '1.2' } },
  { type: 'text', when: [{ test: 'person.role' }], text: '{person.role}', style: { 'font-size': 'clamp(12px, 0.85vw, 17px)', color: '$ink-quiet', 'line-clamp': '1' } },
] };

const extra: Node = { type: 'box', when: [{ test: 'extra.ready' }], press: { action: 'playExtra', arg: '{extra.id}' }, label: '{s:playExtra}: {extra.name}', testId: 'extra-{extra.id}',
  style: { ...capsule('clamp(54px, 4vw, 76px)'), 'justify-content': 'flex-start', 'max-width': 'clamp(260px, 24vw, 460px)' }, focus: capsuleFocus, hover: { 'background-color': 'rgba(255, 255, 255, 0.24)' }, children: [
    { type: 'icon', symbol: 'play-fill', style: { width: 'clamp(16px, 1.1vw, 22px)', height: 'clamp(16px, 1.1vw, 22px)', 'flex-shrink': '0' } },
    { type: 'text', text: '{extra.name}', style: { 'line-clamp': '1' } },
  ] };

const titleCopy: Node = { type: 'box', style: { display: 'flex', 'flex-direction': 'column', 'justify-content': 'flex-end', 'box-sizing': 'border-box', 'min-height': 'max(560px, 82vh)', gap: 'clamp(14px, 1.3vw, 24px)', 'padding-top': 'clamp(110px, 10vw, 180px)', 'padding-bottom': 'clamp(20px, 2.6vh, 44px)', ...gutter },
  small: { 'min-height': '520px', 'padding-top': '120px', gap: '12px', ...gutterSmall }, children: [
    { type: 'widget', widget: 'observe', params: { receipt: '{detail.receipt}' } },
    { type: 'text', text: '{detail.kindLabel}', motion: 'copy0', style: { 'font-size': 'clamp(13px, 0.95vw, 18px)', 'font-weight': '700', 'letter-spacing': '0.16em', 'text-transform': 'uppercase', color: '$amber' } },
    { type: 'image', when: [{ test: 'detail.logo' }], src: '{detail.logo}', alt: '{detail.name}', role: 'heading', level: 1, motion: 'copy1', style: { height: 'clamp(120px, 11vw, 210px)', width: 'auto', 'max-width': 'min(640px, 80%)', 'object-fit': 'contain', 'align-self': 'flex-start' }, small: { height: '92px' } },
    { type: 'text', when: [{ test: 'detail.logo', not: true }], text: '{detail.name}', role: 'heading', level: 1, motion: 'copy1', style: { 'font-size': 'clamp(52px, 5.4vw, 112px)', 'font-weight': '800', 'letter-spacing': '-0.025em', 'line-height': '0.96', 'max-width': 'min(60rem, 70vw)', 'text-shadow': '0px 6px 50px rgba(0, 0, 0, 0.55)' }, small: { 'font-size': '40px', 'max-width': 'none' } },
    { type: 'text', text: '{detail.factsLine}', motion: 'copy2', style: { 'font-size': 'clamp(16px, 1.25vw, 24px)', 'font-weight': '600', color: '$ink-dim', 'font-variant-numeric': 'tabular-nums' }, small: { 'font-size': '14px' } },
    { type: 'text', when: [{ test: 'detail.summary' }], text: '{detail.summary}', motion: 'copy2', style: { 'font-size': 'clamp(17px, 1.3vw, 25px)', 'line-height': '1.45', color: '$ink-dim', 'line-clamp': '4', 'max-width': '46rem', 'text-shadow': '0px 1px 16px rgba(0, 0, 0, 0.7)' }, small: { 'font-size': '15px' } },
    { type: 'text', when: [{ test: 'detail.crewLine' }], text: '{detail.crewLine}', motion: 'copy2', style: { 'font-size': 'clamp(14px, 1vw, 19px)', color: '$ink-quiet', 'max-width': '46rem', 'line-clamp': '2' } },
    { type: 'box', motion: 'copy3', style: { display: 'flex', 'flex-direction': 'row', 'flex-wrap': 'wrap', gap: 'clamp(14px, 1.2vw, 24px)', 'align-items': 'center', 'margin-top': 'clamp(8px, 1vw, 18px)' } as Style, children: [
      { type: 'box', when: [{ test: 'detail.canPlay' }], press: { action: 'play', arg: '{detail.id}' }, label: '{detail.playLabel}', testId: 'detail-play',
        style: { ...capsule('clamp(58px, 4.4vw, 84px)'), 'background-color': 'rgba(245, 241, 233, 0.92)', color: '$ground' }, focus: capsuleFocus, hover: { 'background-color': '$ink' }, small: { height: '54px' }, children: [
          { type: 'icon', symbol: 'play-fill', style: { width: 'clamp(18px, 1.3vw, 26px)', height: 'clamp(18px, 1.3vw, 26px)' } },
          { type: 'text', text: '{detail.playLabel}', style: { 'font-weight': '700' } },
          { type: 'box', when: [{ test: 'detail.hasResume' }], style: { width: 'clamp(48px, 4vw, 76px)', height: '5px', 'border-radius': '3px', 'background-color': 'rgba(9, 11, 14, 0.22)', 'overflow-x': 'hidden', 'overflow-y': 'hidden' }, children: [
            { type: 'box', style: { height: '5px', width: '{detail.resumePct}%', 'background-color': '$ground' } },
          ] },
        ] },
      { type: 'repeat', over: 'detail.upNext', when: [{ test: 'detail.canPlay', not: true }], item: { type: 'box', press: { action: 'play', arg: '{card.id}' }, label: '{episode.playLabel}: {card.label}', testId: 'detail-up-next',
        style: { ...capsule('clamp(58px, 4.4vw, 84px)'), 'background-color': 'rgba(245, 241, 233, 0.92)', color: '$ground', 'max-width': 'min(640px, 80vw)' }, focus: capsuleFocus, hover: { 'background-color': '$ink' }, small: { height: '54px' }, children: [
          { type: 'icon', symbol: 'play-fill', style: { width: 'clamp(18px, 1.3vw, 26px)', height: 'clamp(18px, 1.3vw, 26px)', 'flex-shrink': '0' } },
          { type: 'box', style: { display: 'flex', 'flex-direction': 'column', gap: '3px', 'align-items': 'flex-start', 'min-width': '0px' }, children: [
            { type: 'text', text: '{episode.numberTitle}', style: { 'line-height': '1.05', 'font-weight': '700', 'line-clamp': '1' } },
            { type: 'text', text: '{episode.upNextLabel}', style: { 'font-size': '0.62em', 'font-weight': '600', opacity: '0.62', 'line-height': '1' } },
          ] },
          { type: 'box', when: [{ test: 'card.hasProgress' }], small: { display: 'none' }, style: { width: 'clamp(48px, 4vw, 76px)', height: '5px', 'flex-shrink': '0', 'border-radius': '3px', 'background-color': 'rgba(9, 11, 14, 0.22)', 'overflow-x': 'hidden', 'overflow-y': 'hidden' }, children: [
            { type: 'box', style: { height: '5px', width: '{card.progressPct}%', 'background-color': '$ground' } },
          ] },
        ] } },
      { type: 'box', press: { action: 'back' }, label: '{s:back}', testId: 'detail-back', style: capsule('clamp(58px, 4.4vw, 84px)'), focus: capsuleFocus, hover: { 'background-color': 'rgba(255, 255, 255, 0.24)' }, small: { height: '54px' }, children: [
        { type: 'icon', symbol: 'back', style: { width: 'clamp(16px, 1.2vw, 24px)', height: 'clamp(16px, 1.2vw, 24px)' } },
        { type: 'text', text: '{s:back}' },
      ] },
    ] },
    { type: 'box', when: [{ test: 'detail.hasMediaFacts' }], style: { display: 'flex', 'flex-direction': 'row', 'flex-wrap': 'wrap', gap: '10px' } as Style, children: [
      { type: 'repeat', over: 'detail.mediaFacts', item: { type: 'text', text: '{fact.text}', style: { padding: '6px 12px', 'border-radius': '8px', 'font-size': 'clamp(12px, 0.85vw, 16px)', 'font-weight': '700', 'letter-spacing': '0.04em', color: '$ink-dim', 'box-shadow': 'inset 0px 0px 0px 1.5px rgba(245, 241, 233, 0.35)' } } },
    ] },
  ] };

const title: Node = { type: 'box', style: { position: 'absolute', inset: '0px', width: '100%', height: '100%', display: 'flex', 'flex-direction': 'column', 'background-color': '$ground', color: '$ink', 'font-family': sans }, children: [
  // The title's backdrop fills the screen and stays while the page scrolls over it.
  { type: 'box', when: [{ test: 'env.load', is: 'eq', value: 'ready' }], motion: 'backdropIn', style: { position: 'absolute', inset: '0px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'pointer-events': 'none' }, children: [
    { type: 'image', when: [{ test: 'detail.backdrop' }], src: '{detail.backdrop}', alt: '', fade: true, style: { position: 'absolute', inset: '0px', width: '100%', height: '100%', 'object-fit': 'cover' } },
    { type: 'image', when: [{ test: 'detail.backdrop', not: true }, { test: 'detail.poster' }], src: '{detail.poster}', alt: '', style: { position: 'absolute', top: '-20%', left: '-20%', width: '140%', height: '140%', 'object-fit': 'cover', filter: 'blur(80px) saturate(1.5)', opacity: '0.6' } },
    { type: 'box', style: { position: 'absolute', inset: '0px', 'background-image': 'linear-gradient(90deg, rgba(5, 6, 9, 0.9) 0%, rgba(5, 6, 9, 0.6) 34%, rgba(5, 6, 9, 0) 66%), linear-gradient(0deg, rgba(5, 6, 9, 0.97) 0%, rgba(5, 6, 9, 0.7) 32%, rgba(5, 6, 9, 0) 64%)' } },
  ] },
  { type: 'box', id: '{env.route}-scroll-{env.entry}', role: 'region', label: '{detail.name}', style: { position: 'relative', flex: '1', 'min-height': '0px', 'overflow-y': 'auto', 'overflow-x': 'hidden', 'padding-bottom': 'max(48px, 6vh)' }, children: [
    { type: 'text', when: [{ test: 'env.load', is: 'eq', value: 'loading' }], text: '{s:opening}', role: 'status', motion: 'fadeIn', style: { padding: `clamp(140px, 14vw, 240px) ${side}`, 'font-size': 'clamp(18px, 1.4vw, 28px)', color: '$ink-quiet' } },
    { type: 'box', when: [{ test: 'env.load', is: 'eq', value: 'failed' }], role: 'alert', style: { display: 'flex', 'flex-direction': 'column', 'align-items': 'flex-start', gap: '28px', padding: `clamp(140px, 14vw, 240px) ${side}` }, children: [
      { type: 'text', text: '{s:failed}', style: { 'font-size': 'clamp(22px, 1.8vw, 36px)', 'font-weight': '700' } },
      { type: 'box', press: { action: 'back' }, label: '{s:back}', style: capsule('clamp(58px, 4.4vw, 84px)'), focus: capsuleFocus, children: [{ type: 'icon', symbol: 'back', style: { width: '22px', height: '22px' } }, { type: 'text', text: '{s:back}' }] },
    ] },
    { type: 'box', when: [{ test: 'env.load', is: 'eq', value: 'ready' }], style: { display: 'flex', 'flex-direction': 'column' }, children: [
      titleCopy,
      section('{s:episodes}', [{ test: 'detail.hasEpisodes' }], [
        { type: 'box', when: [{ test: 'detail.hasSeasons' }], style: { display: 'flex', 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none' }, children: [
          { type: 'box', role: 'group', label: '{s:seasons}', style: { display: 'flex', 'flex-direction': 'row', gap: '12px', 'padding-top': 'clamp(14px, 1.2vw, 24px)', 'padding-bottom': '4px', ...gutter }, small: { ...gutterSmall }, children: [
            { type: 'repeat', over: 'detail.seasons', item: season },
          ] },
        ] },
        track({ type: 'repeat', over: 'detail.episodes', item: { ...episode, motion: 'cardIn', stagger: { step: 40, cap: 8 } } }),
      ]),
      section('{s:extras}', [{ test: 'detail.hasExtras' }], [track({ type: 'repeat', over: 'detail.extras', item: extra }, 'clamp(14px, 1.2vw, 24px)')]),
      section('{s:cast}', [{ test: 'detail.hasCast' }], [track({ type: 'repeat', over: 'detail.cast', item: person }, 'clamp(18px, 1.6vw, 32px)')]),
      { type: 'repeat', over: 'detail.related', item: { type: 'use', template: 'row' } },
    ] },
  ] },
] };

const rise = (delay: number) => ({ keyframes: 'rise', duration: 760, delay, easing: ease, fill: 'both' as const, still: { keyframes: 'dissolve', duration: 220 } });

const lounge: SkinDocument = {
  schema: 1, renderer: 4, id: 'lounge', name: 'Lounge', version: '1.0.0', tagline: 'Made for the couch: big type, a remote and the backdrop behind it all.',
  preview: '/vela/v0/appearance/skins/lounge/1.0.0/preview.jpg', swatches: ['#05060a', '#f5f1e9', '#dcb998', '#f2c27e', '#262b34'],
  tokens: { ground: '#05060a', raised: '#1a1d24', ink: '#f5f1e9', 'ink-dim': 'rgba(245, 241, 233, 0.78)', 'ink-quiet': 'rgba(245, 241, 233, 0.52)', amber: '#f2c27e' },
  strings: { en: { mainNav: 'Main', velaHome: 'Vela home', home: 'Home', search: 'Search', profile: 'Profile and appearance', watchingAs: 'Watching on this screen', appearance: 'Appearance', skinName: 'Lounge', install: 'Install Vela', update: 'Update ready, reload', signOut: 'Sign out', moreInfo: 'More info', featured: 'Featured titles', back: 'Back', opening: 'Opening…', failed: 'This title couldn’t be opened.', seasons: 'Seasons', episodes: 'Episodes', extras: 'Trailers and extras', playExtra: 'Play', cast: 'Cast and crew' } },
  motion: {
    navIn: { keyframes: 'dissolve', duration: 700, easing: 'ease-out', still: { keyframes: 'dissolve', duration: 200 } },
    sheet: { keyframes: 'pop', duration: 380, easing: ease, still: { keyframes: 'dissolve', duration: 160 } },
    fadeIn: { keyframes: 'dissolve', duration: 420, easing: 'ease-out', still: { keyframes: 'dissolve', duration: 160 } },
    backdropIn: { keyframes: 'dissolve', duration: 1200, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', still: { keyframes: 'dissolve', duration: 300 } },
    drift: { keyframes: 'drift', duration: 40000, easing: 'cubic-bezier(0.45, 0, 0.55, 1)', iterations: 'infinite', direction: 'alternate', fill: 'none', still: { keyframes: 'none', duration: 0 } },
    heroFill: { keyframes: 'fill', duration: 9000, easing: 'linear', still: { keyframes: 'none', duration: 0 } },
    copy0: rise(120), copy1: rise(200), copy2: rise(280), copy3: rise(360),
    cardIn: { keyframes: 'rise', duration: 700, easing: ease, still: { keyframes: 'dissolve', duration: 220 } },
    rowIn: { keyframes: 'rise', duration: 760, delay: 380, easing: ease, still: { keyframes: 'dissolve', duration: 220 } },
  },
  templates: { poster, wide, ranked, row },
  slots: { shell, home },
  routes: { title },
  detail: { wide: 'fullscreen', small: 'fullscreen' },
};

export default lounge;

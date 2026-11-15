// Cinematic, written as a skin document (protocol/v0/skin.ts): the fidelity proof for
// the doc engine. The compiled original is client/skins/cinematic; this file follows
// its Shell, Home, Row and TitleCard (look.contract tokens, motion and geometry).
import type { Node, SkinDocument, Style } from '../../skin';

const gutter: Style = { 'padding-left': 'max(28px, 4vw)', 'padding-right': 'max(28px, 4vw)' } as Style;
const gutterSmall = { 'padding-left': '18px', 'padding-right': '18px' } as Style;
const sans = 'system-ui, -apple-system, "Segoe UI Variable", "Segoe UI", Roboto, sans-serif';
const enter = (delay: number) => `enter${delay}`;
const enterPresets = Object.fromEntries([0, 220, 300, 380, 420, 440, 500, 520, 560].map(d => [enter(d), { keyframes: 'rise', duration: 640, delay: d, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'both' as const, still: { keyframes: 'dissolve', duration: 240 } }]));

const pill = (primary: boolean): Style => ({
  display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'box-sizing': 'border-box', height: '56px', 'border-radius': '999px',
  'padding-left': primary ? '28px' : '24px', 'padding-right': primary ? '32px' : '26px', border: primary ? 'none' : '1px solid cinematic.glass-edge',
  'background-color': primary ? 'ink.primary' : 'cinematic.control', color: primary ? 'ink.inverse' : 'ink.primary', 'backdrop-filter': primary ? 'none' : 'blur(20px) saturate(1.3)',
  'font-weight': primary ? '650' : '600', transition: 'background-color 180ms linear, scale 360ms cubic-bezier(0.16, 1, 0.3, 1)',
} as Style);

// The brand lockup (client/assets/brand, two-tone), one image node.
const wordmark = (size: number): Node => ({ type: 'image', src: 'assets/brand/vela-lockup.svg', alt: '', style: { width: `${Math.round(size * 2.629)}px`, height: `${size}px` } });

const navItem: Node = { type: 'box', group: true, press: { action: 'library', arg: '{dest.id}' }, label: '{dest.name}',
  style: { position: 'relative', display: 'flex', 'align-items': 'center', height: '40px', padding: '0px 14px', 'border-radius': '999px', color: 'ink.secondary', 'font-weight': '550', 'font-size': '15px', 'white-space': 'nowrap' },
  hover: { 'background-color': 'cinematic.control', color: 'ink.primary' },
  children: [
    { type: 'text', text: '{dest.name}' },
    { type: 'box', when: [{ test: 'dest.on' }], style: { position: 'absolute', left: '14px', right: '14px', bottom: '4px', height: '2px', 'border-radius': '1px', 'background-color': 'brand.warm' } },
  ] };

const shell: Node = { type: 'box', style: { display: 'flex', 'flex-direction': 'column', height: '100%', 'min-height': '0px', 'background-color': 'surface.page', color: 'ink.primary', 'font-family': sans }, children: [
  { type: 'slot', slot: 'children', style: { display: 'flex', 'flex-direction': 'column', flex: '1', 'min-height': '0px' }, inner: { display: 'flex', 'flex-direction': 'column', 'flex-grow': '1', 'min-height': '0px', height: '100%', width: '100%' } as Style },
  { type: 'box', role: 'navigation', when: [{ test: 'env.viewer' }], motion: 'navIn', style: { position: 'absolute', top: '0px', left: '0px', right: '0px', 'z-index': '20' }, children: [
    { type: 'box', style: { position: 'absolute', top: '0px', left: '0px', right: '0px', bottom: '0px', 'pointer-events': 'none', 'background-image': 'linear-gradient(180deg, var(--cinematic.nav-scrim) 0%, var(--cinematic.scrim-clear) 100%)', 'backdrop-filter': 'blur(16px)' }, small: { bottom: '-18px' } },
    { type: 'box', style: { position: 'relative', display: 'flex', 'flex-direction': 'row', height: '84px', 'box-sizing': 'border-box', ...gutter, 'align-items': 'center', gap: '10px' }, small: { height: '56px', ...gutterSmall, gap: '8px' }, children: [
      { type: 'box', press: { action: 'home' }, label: '{s:velaHome}', style: { position: 'relative', 'margin-right': '22px' } as Style, small: { 'margin-right': '0px' } as Style, children: [wordmark(28)] },
      { type: 'box', style: { display: 'flex', 'flex-direction': 'row', flex: '1', 'min-width': '0px', 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none', gap: '2px', 'align-items': 'center', 'mask-image': 'linear-gradient(90deg, black 0%, black 90%, transparent 100%)' },
        small: { display: 'none' }, children: [
          { ...navItem, press: { action: 'home' }, label: '{s:home}', children: [{ type: 'text', text: '{s:home}' }, { type: 'box', when: [{ test: 'env.section', is: 'eq', value: 'home' }], style: { position: 'absolute', left: '14px', right: '14px', bottom: '4px', height: '2px', 'border-radius': '1px', 'background-color': 'brand.warm' } }] },
          { type: 'repeat', over: 'nav.destinations', item: navItem },
        ] },
      { type: 'box', small: { flex: '1' } },
      { type: 'box', press: { action: 'search' }, label: '{s:search}', style: { position: 'relative', width: '40px', height: '40px', 'box-sizing': 'border-box', padding: '10px', 'border-radius': '999px', border: '1px solid cinematic.glass-edge', 'background-color': 'cinematic.control', 'flex-shrink': '0' }, hover: { 'background-color': 'cinematic.control-hover' },
        children: [{ type: 'icon', symbol: 'search', style: { width: '18px', height: '18px' } }] },
      { type: 'box', press: { action: 'toggle', arg: 'menu' }, label: '{s:profile}', testId: 'profile-menu', style: { position: 'relative', display: 'flex', 'flex-direction': 'row', gap: '10px', 'align-items': 'center', padding: '4px 14px 4px 4px', 'border-radius': '999px', 'flex-shrink': '0', color: 'ink.secondary', 'font-weight': '550' },
        hover: { 'background-color': 'cinematic.control', color: 'ink.primary' }, small: { padding: '4px' }, children: [
          { type: 'text', text: '{env.viewerInitial}', style: { width: '32px', height: '32px', 'border-radius': '16px', display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'font-size': '14px', 'font-weight': '650', color: 'ink.primary', 'background-image': 'linear-gradient(135deg, var(--cinematic.ember) 0%, var(--cinematic.dusk) 100%)' } },
          { type: 'text', text: '{env.viewer}', style: { 'font-size': '14px', 'font-weight': '550' }, small: { display: 'none' } },
        ] },
    ] },
  ] },
  { type: 'box', when: [{ test: 'env.viewer' }, { test: 'flag:menu' }], motion: 'pop', style: { position: 'absolute', top: '78px', right: 'max(28px, 4vw)', 'z-index': '30', width: '260px', 'box-sizing': 'border-box', padding: '20px', display: 'flex', 'flex-direction': 'column', gap: '16px', border: '1px solid cinematic.glass-edge', 'border-radius': '20px', 'background-color': 'cinematic.popover', 'backdrop-filter': 'blur(24px)', 'box-shadow': '0px 24px 70px var(--cinematic.shadow)' },
    small: { top: '104px', right: '12px' }, children: [
      { type: 'box', style: { display: 'flex', 'flex-direction': 'row', gap: '12px', 'align-items': 'center' }, children: [
        { type: 'text', text: '{env.viewerInitial}', style: { width: '40px', height: '40px', 'border-radius': '20px', display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'font-size': '17px', 'font-weight': '650', 'background-image': 'linear-gradient(135deg, var(--cinematic.ember) 0%, var(--cinematic.dusk) 100%)' } },
        { type: 'text', text: '{env.viewer}', style: { 'font-size': '16px', 'font-weight': '600', flex: '1', 'line-clamp': '1' } },
      ] },
      { type: 'box', style: { height: '1px', 'background-color': 'cinematic.glass-edge' } },
      { type: 'box', press: { action: 'openPicker' }, label: '{s:appearance}', testId: 'skin-picker', style: { position: 'relative', display: 'flex', 'flex-direction': 'row', 'justify-content': 'space-between', 'align-items': 'center', padding: '8px 10px', margin: '0px -10px', 'border-radius': '12px', color: 'ink.primary' }, hover: { 'background-color': 'cinematic.control' }, children: [
        { type: 'box', style: { display: 'flex', 'flex-direction': 'column', gap: '2px' }, children: [
          { type: 'text', text: '{s:appearance}', style: { 'font-size': '10px', 'font-weight': '600', 'letter-spacing': '0.18em', 'text-transform': 'uppercase', color: 'ink.quiet' } },
          { type: 'text', text: '{s:skinName}', style: { 'font-size': '14px' } },
        ] },
        { type: 'icon', symbol: 'forward-chevron', style: { width: '12px', height: '12px', color: 'ink.quiet' } },
      ] },
      { type: 'widget', widget: 'install', params: { action: 'install', label: '{s:install}' } },
      { type: 'widget', widget: 'install', params: { action: 'update', label: '{s:update}' } },
      { type: 'box', press: { action: 'signOut' }, label: '{s:signOut}', style: { position: 'relative', display: 'flex', 'flex-direction': 'row', gap: '10px', 'align-items': 'center', padding: '8px 10px', margin: '0px -10px', 'border-radius': '12px', 'font-size': '14px' }, hover: { 'background-color': 'cinematic.control' }, children: [
        { type: 'icon', symbol: 'sign-out', style: { width: '16px', height: '16px' } },
        { type: 'text', text: '{s:signOut}' },
      ] },
    ] },
] };

// The artwork stage behind the hero and the first rows.
const stage: Node = { type: 'repeat', over: 'home.hero', item: { type: 'box', motion: 'expose', style: { position: 'absolute', top: '0px', left: '0px', right: '0px', height: 'max(680px, 92vh)', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'pointer-events': 'none', 'mask-image': 'linear-gradient(180deg, black 0%, black 70%, transparent 100%)' },
  small: { height: '640px' }, children: [
    { type: 'box', when: [{ test: 'env.searching', not: true }], style: { position: 'absolute', inset: '0px' }, children: [
      { type: 'box', when: [{ test: 'hero.backdrop' }], motion: 'drift', style: { position: 'absolute', inset: '0px', 'transform-origin': '62% 38%' }, children: [
        { type: 'image', src: '{hero.backdrop}', alt: '', fade: true, style: { position: 'absolute', inset: '0px', width: '100%', height: '100%', 'object-fit': 'cover', transition: 'opacity 420ms cubic-bezier(0.16, 1, 0.3, 1)' } },
      ] },
      { type: 'image', when: [{ test: 'hero.backdrop', not: true }, { test: 'hero.poster' }], src: '{hero.poster}', alt: '', motion: 'drift', style: { position: 'absolute', top: '-20%', left: '-20%', width: '140%', height: '140%', 'object-fit': 'cover', filter: 'blur(90px) saturate(1.6)', opacity: '0.7' } },
    ] },
    { type: 'image', when: [{ test: 'env.searching' }, { test: 'hero.backdrop' }], src: '{hero.backdrop}', alt: '', style: { position: 'absolute', top: '-12%', left: '-12%', width: '124%', height: '124%', 'object-fit': 'cover', filter: 'blur(70px) saturate(1.5)', opacity: '0.5' } },
    { type: 'box', style: { position: 'absolute', left: '-10%', bottom: '8%', width: '75%', height: '70%', 'background-color': '{hero.accent}', opacity: '0.2', 'mask-image': 'radial-gradient(closest-side, black 0%, transparent 100%)' }, when: [{ test: 'hero.accent' }] },
    { type: 'box', style: { position: 'absolute', left: '-10%', bottom: '8%', width: '75%', height: '70%', 'background-color': 'brand.warm', opacity: '0.2', 'mask-image': 'radial-gradient(closest-side, black 0%, transparent 100%)' }, when: [{ test: 'hero.accent', not: true }] },
    { type: 'box', style: { position: 'absolute', inset: '0px', 'background-image': 'linear-gradient(90deg, var(--cinematic.scrim-deep) 0%, var(--cinematic.scrim-mid) 32%, var(--cinematic.scrim-clear) 68%), linear-gradient(0deg, var(--surface.page) 0%, var(--cinematic.scrim-strong) 22%, var(--cinematic.scrim-clear) 58%), linear-gradient(180deg, var(--cinematic.nav-scrim) 0%, var(--cinematic.scrim-clear) 20%), radial-gradient(ellipse 120% 100% at 60% 35%, var(--cinematic.scrim-clear) 50%, var(--cinematic.vignette) 100%)' } },
    { type: 'image', src: 'assets/grain.svg', alt: '', style: { position: 'absolute', inset: '0px', width: '100%', height: '100%', 'object-fit': 'fill', opacity: '0.05' } },
  ] } };

const heroPrimary: Node = { type: 'box', press: { action: 'play', arg: '{hero.id}' }, label: '{heroAct.actionLabel}', testId: 'hero-primary', when: [{ test: 'heroAct.playable' }],
  style: { ...pill(true), position: 'relative', 'box-shadow': '0px 14px 44px var(--cinematic.focus-halo), 0px 0px 0px 1px var(--cinematic.ring)' }, small: { height: '50px', 'padding-left': '22px', 'padding-right': '26px' }, hover: { 'background-color': 'cinematic.primary-hover' }, children: [
    { type: 'box', style: { display: 'flex', 'flex-direction': 'row', gap: '12px', 'align-items': 'center' }, children: [
      { type: 'icon', symbol: 'play-fill', style: { width: '18px', height: '18px' } },
      { type: 'box', style: { display: 'flex', 'flex-direction': 'column', gap: '3px', 'align-items': 'flex-start' }, children: [
        { type: 'text', text: '{heroAct.actionLabel}', style: { 'font-size': '16px', 'font-weight': '700', 'line-height': '1.1' } },
        { type: 'text', when: [{ test: 'heroAct.actionDetail' }], text: '{heroAct.actionDetail}', style: { 'font-size': '11px', 'font-weight': '600', opacity: '0.62', 'line-height': '1' } },
      ] },
      { type: 'box', when: [{ test: 'heroAct.hasProgress' }], style: { width: '44px', height: '3px', 'border-radius': '2px', 'background-color': 'cinematic.ink-track', 'overflow-x': 'hidden', 'overflow-y': 'hidden' }, children: [
        { type: 'box', style: { height: '3px', width: '{heroAct.progressPct}%', 'background-color': 'ink.inverse' } },
      ] },
    ] },
  ] };
const heroMore = (primary: boolean): Node => ({ type: 'box', press: { action: 'select', arg: '{hero.kindId}' }, label: '{s:moreInfo}', testId: 'hero-more', when: [{ test: 'heroAct.playable', not: primary }],
  style: { ...pill(primary), position: 'relative' }, small: { height: '50px', 'padding-left': '20px', 'padding-right': '22px' }, hover: { 'background-color': primary ? 'cinematic.primary-hover' : 'cinematic.control-hover' }, children: [
    { type: 'box', style: { display: 'flex', 'flex-direction': 'row', gap: '10px', 'align-items': 'center' }, children: [
      { type: 'icon', symbol: 'info', style: { width: '17px', height: '17px' } },
      { type: 'text', text: '{s:moreInfo}', style: { 'font-size': '15px' } },
    ] },
  ] });

const heroCopy: Node = { type: 'repeat', over: 'home.hero', when: [{ test: 'env.searching', not: true }], item: { type: 'box', style: { display: 'flex', 'flex-direction': 'column', ...gutter, gap: '16px', 'max-width': '46rem' }, small: { ...gutterSmall, gap: '12px', 'max-width': 'none' }, children: [
  { type: 'widget', widget: 'observe', params: { receipt: '{hero.receipt}' } },
  { type: 'box', motion: enter(220), style: { display: 'flex', 'flex-direction': 'row', gap: '8px', 'align-items': 'center', 'align-self': 'flex-start', padding: '6px 12px 6px 10px', 'border-radius': '999px', 'background-color': 'cinematic.glass', 'backdrop-filter': 'blur(14px)', border: '1px solid cinematic.glass-edge' }, children: [
    { type: 'box', style: { width: '6px', height: '6px', 'border-radius': '3px', 'background-color': 'brand.warm' } },
    { type: 'text', text: '{heroAct.reasonLabel}', style: { 'font-size': '11px', 'font-weight': '650', 'letter-spacing': '0.08em', 'text-transform': 'uppercase', color: 'ink.primary' } },
  ] },
  { type: 'image', when: [{ test: 'hero.logo' }], src: '{hero.logo}', alt: '{hero.name}', role: 'heading', level: 1, motion: enter(300), style: { height: '150px', width: 'auto', 'max-width': 'min(520px, 70%)', 'object-fit': 'contain', 'align-self': 'flex-start' }, small: { height: '96px', 'max-width': '78%' } },
  { type: 'text', when: [{ test: 'hero.logo', not: true }], text: '{hero.name}', role: 'heading', level: 1, motion: enter(300), style: { 'font-family': 'cinematic.display', 'font-weight': '400', 'letter-spacing': '-0.01em', 'line-height': '0.98', 'font-size': '84px', 'text-shadow': '0px 4px 40px var(--cinematic.shadow)' }, small: { 'font-size': '48px' } },
  { type: 'text', text: '{hero.factsLine}', motion: enter(380), style: { 'font-size': '14px', color: 'ink.secondary', 'text-shadow': '0px 1px 12px var(--cinematic.shadow)', 'font-variant-numeric': 'tabular-nums' }, small: { 'font-size': '13px' } },
  { type: 'text', when: [{ test: 'hero.summary' }], text: '{hero.summary}', motion: enter(440), style: { 'font-size': '16px', color: 'ink.secondary', 'text-shadow': '0px 1px 14px var(--cinematic.shadow)', 'line-clamp': '3', 'line-height': '1.55', 'max-width': '36rem' }, small: { 'font-size': '14px', 'line-clamp': '2' } },
  { type: 'box', motion: enter(500), style: { display: 'flex', 'flex-direction': 'row', gap: '12px', 'align-items': 'center', 'flex-wrap': 'wrap', 'margin-top': '8px' } as Style, small: { 'margin-top': '4px' } as Style, children: [heroPrimary, heroMore(false), heroMore(true)] },
] } };

// One dot per featured title; the current one widens and fills over the rotation interval.
const dot = (current: boolean): Node => ({ type: 'box', press: { action: 'pickHero', arg: '{index}' }, label: '{hero.name}', when: [{ test: 'index.current', not: !current }],
  style: { position: 'relative', width: current ? '34px' : '8px', height: '8px', 'border-radius': '4px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'background-color': current ? 'cinematic.track-strong' : 'cinematic.glass-edge-strong' },
  hover: { 'background-color': 'cinematic.control-hover' },
  children: current ? [{ type: 'box', when: [{ test: 'env.rotating' }], motion: 'heroFill', style: { position: 'absolute', inset: '0px', 'border-radius': '4px', 'background-color': 'ink.primary' } }] : [] });
const dots: Node = { type: 'box', role: 'group', label: '{s:featured}', motion: enter(560), when: [{ test: 'env.searching', not: true }, { test: 'env.heroCount', is: 'gt', value: '1' }],
  style: { display: 'flex', 'flex-direction': 'row', gap: '8px', 'align-items': 'center', ...gutter, 'padding-top': '22px' } as Style, small: { ...gutterSmall, 'padding-top': '16px' } as Style, children: [
    { type: 'repeat', over: 'home.heroes', item: { type: 'box', style: { display: 'flex' }, children: [dot(true), dot(false)] } },
  ] };
const copyColumn: Node = { type: 'box', style: { position: 'relative', display: 'flex', 'flex-direction': 'column', 'justify-content': 'flex-end', 'box-sizing': 'border-box', 'min-height': 'calc(clamp(500px, 62vh, 700px) - 104px)', 'padding-top': 'calc(84px + 32px + env(safe-area-inset-top))' },
  small: { 'min-height': '416px', 'padding-top': 'calc(104px + 22px + env(safe-area-inset-top))' }, children: [heroCopy, dots] };

const card: Node = { type: 'box', group: true, press: { action: 'select', arg: '{card.kindId}' }, label: '{card.label}', testId: 'title-{card.id}',
  style: { position: 'relative', display: 'flex', 'flex-direction': 'column', width: 'clamp(150px, 12.4vw, 232px)', 'flex-shrink': '0', gap: '12px' }, small: { width: '132px' }, children: [
    { type: 'widget', widget: 'observe', params: { receipt: '{card.receipt}' } },
    { type: 'box', style: { position: 'relative', width: '100%', 'aspect-ratio': '2 / 3', 'background-color': 'surface.raised', 'border-radius': '12px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', scale: '1', translate: '0px 0px',
      'box-shadow': '0px 10px 24px -12px var(--cinematic.card-shadow), 0px 0px 0px 1px var(--cinematic.hairline)', transition: 'scale 360ms cubic-bezier(0.16, 1, 0.3, 1), translate 360ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 360ms cubic-bezier(0.16, 1, 0.3, 1)' },
      small: { 'border-radius': '10px' },
      groupHover: { scale: '1.045', translate: '0px -6px', 'box-shadow': '0px 28px 50px -14px var(--cinematic.card-shadow), 0px 0px 0px 1px var(--cinematic.ring)' }, children: [
        { type: 'image', when: [{ test: 'card.poster' }], src: '{card.poster}', alt: '', fade: true, style: { position: 'absolute', inset: '0px', width: '100%', height: '100%', 'object-fit': 'cover', transition: 'opacity 420ms cubic-bezier(0.16, 1, 0.3, 1)' } },
        { type: 'box', when: [{ test: 'card.poster', not: true }], style: { position: 'absolute', inset: '0px', padding: '16px', display: 'flex', 'flex-direction': 'column', 'justify-content': 'flex-end', 'background-image': 'linear-gradient(160deg, var(--cinematic.placeholder-top) 0%, var(--cinematic.placeholder-bottom) 100%)' }, children: [
          { type: 'text', text: '{card.name}', style: { 'font-family': 'cinematic.display', 'font-size': '24px', 'line-clamp': '4', 'line-height': '0.98' }, small: { 'font-size': '20px' } },
        ] },
        { type: 'box', style: { position: 'absolute', inset: '0px', 'pointer-events': 'none', 'background-image': 'linear-gradient(145deg, var(--cinematic.sheen) 0%, var(--cinematic.scrim-clear) 42%)', opacity: '0', transition: 'opacity 360ms cubic-bezier(0.16, 1, 0.3, 1)' }, groupHover: { opacity: '1' } },
        { type: 'box', when: [{ test: 'card.played' }], style: { position: 'absolute', top: '8px', right: '8px', width: '24px', height: '24px', 'border-radius': '12px', display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'background-color': 'cinematic.glass', 'backdrop-filter': 'blur(12px)' }, children: [
          { type: 'icon', symbol: 'checkmark', style: { width: '12px', height: '12px', color: 'ink.primary' } },
        ] },
        { type: 'box', when: [{ test: 'card.hasProgress' }, { test: 'card.played', not: true }], style: { position: 'absolute', left: '0px', right: '0px', bottom: '0px', height: '36px', 'background-image': 'linear-gradient(0deg, var(--cinematic.scrim-strong) 0%, var(--cinematic.scrim-clear) 100%)' } },
        { type: 'box', when: [{ test: 'card.hasProgress' }, { test: 'card.played', not: true }], style: { position: 'absolute', left: '10px', right: '10px', bottom: '10px', height: '3px', 'border-radius': '2px', 'background-color': 'cinematic.track-strong', 'overflow-x': 'hidden', 'overflow-y': 'hidden' }, children: [
          { type: 'box', style: { height: '3px', width: '{card.progressPct}%', 'background-color': 'brand.warm' } },
        ] },
      ] },
    { type: 'box', style: { display: 'flex', 'flex-direction': 'column', gap: '4px', padding: '0px 2px', opacity: '0.86', transition: 'opacity 180ms linear' }, groupHover: { opacity: '1' }, children: [
      { type: 'text', text: '{card.name}', style: { 'font-size': '14px', 'font-weight': '600', 'line-clamp': '1', color: 'ink.primary' }, small: { 'font-size': '13px' } },
      { type: 'text', text: '{card.facts}', style: { 'font-size': '12px', color: 'ink.quiet', 'line-clamp': '1', 'font-variant-numeric': 'tabular-nums' } },
    ] },
  ] };

const row: Node = { type: 'box', style: { position: 'relative', display: 'flex', 'flex-direction': 'column', gap: '4px', 'padding-bottom': '28px' }, small: { gap: '2px', 'padding-bottom': '18px' }, children: [
  { type: 'text', text: '{row.name}', role: 'heading', level: 2, style: { 'font-size': '21px', 'font-weight': '650', 'letter-spacing': '-0.012em', ...gutter }, small: { 'font-size': '18px', ...gutterSmall } },
  { type: 'box', style: { display: 'flex', 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none', 'mask-image': 'linear-gradient(90deg, black 0%, black 94%, transparent 100%)' }, children: [
    { type: 'box', style: { display: 'flex', 'flex-direction': 'row', gap: '18px', 'align-items': 'flex-start', 'padding-top': '16px', 'padding-bottom': '22px', ...gutter }, small: { gap: '12px', 'padding-top': '14px', 'padding-bottom': '18px', ...gutterSmall }, children: [
      { type: 'repeat', over: 'row.items', item: { type: 'box', motion: 'card', stagger: { step: 45, cap: 8 }, style: { position: 'relative' }, children: [{ type: 'use', template: 'card' }] } },
    ] },
  ] },
] };

const home: Node = { type: 'box', style: { position: 'relative', display: 'flex', 'flex-direction': 'column' }, children: [
  stage,
  copyColumn,
  { type: 'slot', slot: 'searchField', style: { display: 'flex', 'flex-direction': 'column', 'padding-top': '34px', 'padding-bottom': '14px', 'padding-left': 'max(28px, 4vw)', 'padding-right': 'max(28px, 4vw)', 'align-items': 'center' } as Style,
    small: { 'padding-top': '26px', 'padding-bottom': '10px', 'padding-left': '16px', 'padding-right': '16px' } as Style, inner: { width: '100%', 'max-width': '720px', animation: 'vr-rise 640ms cubic-bezier(0.16, 1, 0.3, 1) 420ms both' } },
  { type: 'box', when: [{ test: 'env.searching', not: true }], style: { position: 'relative', display: 'flex', 'flex-direction': 'column', 'padding-top': '22px' }, small: { 'padding-top': '14px' }, children: [
    { type: 'repeat', over: 'home.rows', item: { type: 'box', motion: 'rowIn', stagger: { step: 90, cap: 4 }, children: [{ type: 'use', template: 'row' }] } },
  ] },
] };

export const cinematicDoc: SkinDocument = {
  schema: 1, renderer: 1, id: 'cinematic-doc', name: 'Cinematic (data)', version: '1.0.0', tagline: 'The official skin, drawn from a skin document.',
  preview: '/vela/v0/appearance/skins/cinematic-doc/1.0.0/preview.jpg', swatches: ['#090b0e', '#f5f1e9', '#dcb998', '#c0703f', '#1f5a6b'],
  strings: { en: { velaHome: 'Vela home', home: 'Home', search: 'Search', profile: 'Profile and appearance', appearance: 'Appearance', skinName: 'Cinematic (data)', install: 'Install Vela', update: 'Update ready, reload', signOut: 'Sign out', moreInfo: 'More info', featured: 'Featured titles' } },
  motion: {
    ...enterPresets,
    navIn: { keyframes: 'dissolve', duration: 900, easing: 'ease-out', still: { keyframes: 'dissolve', duration: 240 } },
    pop: { keyframes: 'pop', duration: 360, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', still: { keyframes: 'dissolve', duration: 160 } },
    expose: { keyframes: 'expose', duration: 1100, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', still: { keyframes: 'dissolve', duration: 400 } },
    drift: { keyframes: 'drift', duration: 32000, easing: 'cubic-bezier(0.45, 0, 0.55, 1)', iterations: 'infinite', direction: 'alternate', fill: 'none', still: { keyframes: 'none', duration: 0 } },
    heroFill: { keyframes: 'fill', duration: 9000, easing: 'linear', still: { keyframes: 'none', duration: 0 } },
    card: { keyframes: 'rise', duration: 640, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', still: { keyframes: 'dissolve', duration: 240 } },
    rowIn: { keyframes: 'rise', duration: 640, delay: 520, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', still: { keyframes: 'dissolve', duration: 240 } },
  },
  templates: { card, row },
  slots: { shell, home },
  detail: { wide: 'fullscreen', small: 'fullscreen' },
};

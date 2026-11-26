import { episodePage } from '../../../episode-page';
// Late Night: the home as an old television set, as a skin document (protocol/v0/skin.ts).
// The retro lives in the frame and the transitions: a bezel with a curved, vignetted
// screen, faint scanlines, an on-screen display (channel bug, preset buttons, tape
// counter) and a burst of static when a channel (section, row, featured title) tunes in.
// Posters and text stay crisp. Under reduced motion every flicker, roll and burst is gone.
import type { Node, SkinDocument, Style } from '../../../skin';

const id = 'latenight', version = '1.0.17';
const asset = (file: string) => `/vela/v0/appearance/skins/${id}/${version}/${file}`;

// Fonts (licences in ./licences): VT323 for the on-screen display, Michroma for the
// printed tape-box type, Permanent Marker for hand-written tape labels. System sans
// carries summaries so long text reads cleanly.
const osd = '"Late Night OSD", "VT323", ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const print = '"Late Night Print", "Michroma", "Eurostile", "Microgramma", system-ui, sans-serif';
const marker = '"Late Night Marker", "Permanent Marker", "Marker Felt", "Comic Sans MS", cursive';
const sans = 'system-ui, -apple-system, "Segoe UI Variable", "Segoe UI", Roboto, sans-serif';

// The screen sits inside the bezel; the route is padded by the same amount.
const bezel = { normal: '12px', wide: '18px', small: '0px' };
const radius = { normal: '30px', wide: '38px', small: '0px' };
const inset = (b: string): Style => ({ top: b, right: b, bottom: b, left: b });
const gutter: Style = { 'padding-left': 'max(30px, 3.6vw)', 'padding-right': 'max(30px, 3.6vw)' };
const gutterSmall: Style = { 'padding-left': '16px', 'padding-right': '16px' };

// The OSD look: phosphor text with a hard black drop so it reads over any picture.
const osdText = (size: string, colour = '$osd'): Style => ({ 'font-family': osd, 'font-size': size, 'line-height': '1', color: colour, 'text-transform': 'uppercase', 'letter-spacing': '0.04em', 'text-shadow': '2px 2px 0px $shadow' });
// RGB misregistration, the one glitch content is allowed: only on hover/focus rings and big titles.
const split = (px: number) => `${-px}px 0px 0px $chroma-red, ${px}px 0px 0px $chroma-cyan`;

// One burst of snow: drawn only when motion is allowed, gone (opacity 0) once it has played.
const snow = (motion: string, extra: Partial<Node> = {}): Node => ({ type: 'box', motion, when: [{ test: 'env.still', not: true }], ...extra,
  style: { position: 'absolute', ...inset('0px'), 'pointer-events': 'none', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'background-color': '$snow-ground', ...(extra.style ?? {}) } as Style,
  children: [{ type: 'image', src: asset('static.svg'), alt: '', style: { position: 'absolute', ...inset('0px'), width: '100%', height: '100%', 'object-fit': 'cover', opacity: '0.9' } }] } as Node);

// ---------------------------------------------------------------- shell
// The brand lockup (two-tone, as an asset), one image node.
const wordmark = (h: number): Node => ({ type: 'image', src: 'assets/brand/vela-lockup.svg', alt: '', style: { width: `${Math.round(h * 2.629)}px`, height: `${h}px` } });

// A channel on the dial: number, then name. The current one is lit like a VCR menu row.
// `tall`: a 44px target (More and its menu's rows).
const channel = (num: string, name: string, on: Node['when'], press: { action: 'home' | 'library' | 'live'; arg?: string }, testId?: string, tall = false): Node => ({
  type: 'box', group: true, press, label: name, testId, a11y: { current: on },
  style: { position: 'relative', display: 'flex', 'flex-direction': 'row', 'align-items': 'baseline', gap: '7px 7px', height: tall ? '44px' : '36px', 'box-sizing': 'border-box', padding: tall ? '13px 12px 0px 10px' : '9px 12px 0px 10px', 'border-radius': '3px', color: '$ink-dim', 'white-space': 'nowrap', 'flex-shrink': '0', transition: 'background-color 120ms linear, color 120ms linear' },
  hover: { color: '$ink', 'background-color': '$glass' }, focus: { color: '$ink', 'background-color': '$vcr-blue' },
  children: [
    { type: 'text', text: num, style: { ...osdText('17px', 'inherit'), 'text-shadow': 'none', opacity: '0.6', 'font-variant-numeric': 'tabular-nums' } },
    { type: 'text', text: name, style: { ...osdText('21px', 'inherit'), 'text-shadow': 'none', 'letter-spacing': '0.06em' } },
    { type: 'box', when: on, style: { position: 'absolute', left: '10px', right: '12px', bottom: '3px', height: '2px', 'background-color': '$osd', 'box-shadow': '0px 0px 8px $osd-glow' } },
  ] });

// Live TV on the dial, when the server has it and no library already stands for it.
const liveChannel: Node = { ...channel('04', '{s:liveTv}', [{ test: 'env.section', is: 'eq', value: 'live' }], { action: 'live' }, 'channel-live'),
  when: [{ test: 'env.canLive' }, { test: 'env.hasLiveLibrary', not: true }] };

// More: the dial keeps the channels it has room for (the renderer measures them) and the rest wait
// in a setup menu under this button, which is lit while the channel on show is one of them.
const moreOn: Node['when'] = [{ test: 'nav.moreOn' }];
const moreChannels: Node = { type: 'box', when: [{ test: 'nav.more' }], style: { position: 'relative', display: 'flex', 'flex-direction': 'row', 'flex-shrink': '0' }, children: [
  { ...channel('▾', '{s:more}', moreOn, { action: 'home' }, 'nav-more', true), id: 'latenight-more', press: { action: 'only', arg: 'more', focus: 'latenight-more-menu' }, label: '{s:moreChannels}',
    a11y: { current: moreOn, expanded: [{ test: 'flag:more' }], haspopup: 'menu' } } as Node,
  { type: 'box', id: 'latenight-more-menu', when: [{ test: 'flag:more' }], motion: 'pop', role: 'navigation', label: '{s:moreChannels}', escape: 'more', returnFocus: 'latenight-more',
    style: { position: 'absolute', top: '100%', right: '0px', 'margin-top': '19px', 'z-index': '30', width: '380px', 'max-width': 'calc(100vw - 80px)', 'max-height': '70vh', 'overflow-y': 'auto', 'box-sizing': 'border-box', padding: '14px 12px 12px', display: 'flex', 'flex-direction': 'column', gap: '2px 2px',
      'border-radius': '4px', border: '2px solid $ink', 'background-color': '$vcr-menu', 'box-shadow': '8px 8px 0px $shadow, 0px 30px 80px $shadow' },
    children: [
      { type: 'text', text: '{s:moreTitle}', style: { ...osdText('18px', '$ink'), 'text-shadow': 'none', 'letter-spacing': '0.16em', opacity: '0.75', padding: '0px 10px 8px' } },
      { type: 'repeat', over: 'nav.destinations', when: [{ test: 'dest.more' }], item: channel('1{index.label}', '{dest.name}', [{ test: 'dest.on' }], { action: 'library', arg: '{dest.id}' }, 'nav-more-{dest.id}', true) },
      { ...channel('04', '{s:liveTv}', [{ test: 'env.section', is: 'eq', value: 'live' }], { action: 'live' }, 'nav-more-live', true),
        when: [{ test: 'env.canLive' }, { test: 'env.hasLiveLibrary', not: true }, { test: 'nav.liveMore' }] },
    ] },
] };

const nav: Node = { type: 'box', role: 'navigation', when: [{ test: 'env.viewer' }], motion: 'navIn', escape: 'menu', returnFocus: 'latenight-profile',
  style: { position: 'absolute', ...inset(bezel.normal), bottom: 'auto', 'z-index': '20', 'pointer-events': 'none' },
  wide: { ...inset(bezel.wide), bottom: 'auto' }, small: { ...inset(bezel.small), bottom: 'auto' }, children: [
    { type: 'box', style: { position: 'absolute', top: '0px', left: '0px', right: '0px', bottom: '0px', 'pointer-events': 'none', 'border-radius': `${radius.normal} ${radius.normal} 0px 0px`, 'background-color': '$scrim-top', 'backdrop-filter': 'blur(6px)' },
      wide: { 'border-radius': `${radius.wide} ${radius.wide} 0px 0px` }, small: { 'border-radius': '0px' } },
    { type: 'box', style: { position: 'relative', display: 'flex', 'flex-direction': 'row', 'align-items': 'center', gap: '8px 8px', height: '78px', 'box-sizing': 'border-box', ...gutter, 'pointer-events': 'auto' },
      small: { height: '58px', ...gutterSmall, gap: '6px 6px', 'padding-top': '0px' } as Style, children: [
        { type: 'box', press: { action: 'home' }, label: '{s:velaHome}', style: { position: 'relative', 'margin-right': '18px', 'flex-shrink': '0' }, small: { 'margin-right': '6px' }, children: [wordmark(26)] },
        // The dial keeps to the room it has (`fit`); the channels that do not fit wait behind More.
        { type: 'box', style: { position: 'relative', display: 'flex', 'flex-direction': 'row', 'align-items': 'center', flex: '1', 'min-width': '0px' },
          small: { display: 'none' }, children: [
            { type: 'box', fit: 'nav', style: { display: 'flex', 'flex-direction': 'row', 'align-items': 'center', gap: '2px 2px', 'max-width': '100%' }, children: [
              channel('03', '{s:home}', [{ test: 'env.section', is: 'eq', value: 'home' }], { action: 'home' }, 'channel-home'),
              { ...liveChannel, when: [...liveChannel.when!, { test: 'nav.liveMore', not: true }] },
              { type: 'repeat', over: 'nav.destinations', item: { ...channel('1{index.label}', '{dest.name}', [{ test: 'dest.on' }], { action: 'library', arg: '{dest.id}' }), when: [{ test: 'dest.more', not: true }] } },
              moreChannels,
            ] },
          ] },
        { type: 'box', style: { display: 'none' }, small: { display: 'flex', flex: '1' } },
        // The channel bug: always on, the way a set shows what it is tuned to.
        { type: 'box', role: 'status', label: '{s:tunedTo}', style: { display: 'flex', 'flex-direction': 'row', 'align-items': 'baseline', gap: '6px 6px', 'margin-right': '10px', 'flex-shrink': '0' }, small: { 'margin-right': '2px' }, children: [
          { type: 'text', text: 'CH', style: osdText('18px') },
          { type: 'text', when: [{ test: 'env.section', is: 'eq', value: 'home' }], text: '03', style: { ...osdText('32px'), 'font-variant-numeric': 'tabular-nums' } },
          { type: 'text', when: [{ test: 'env.section', is: 'eq', value: 'live' }], text: '{s:live}', style: osdText('32px', '$rec') },
          { type: 'repeat', over: 'nav.destinations', item: { type: 'text', when: [{ test: 'dest.on' }, { test: 'dest.kind', is: 'ne', value: 'live' }], text: '1{index.label}', style: { ...osdText('32px'), 'font-variant-numeric': 'tabular-nums' } } },
          // The set's clock, when the server's guide gives one.
          { type: 'text', when: [{ test: 'env.clock' }], text: '{env.clock}', role: 'timer', label: '{env.clock}', style: { ...osdText('22px', '$ink-dim'), 'margin-left': '10px', 'font-variant-numeric': 'tabular-nums' }, small: { display: 'none' } },
        ] },
        { type: 'box', press: { action: 'search' }, label: '{s:search}', style: { position: 'relative', display: 'flex', 'align-items': 'center', 'justify-content': 'center', width: '40px', height: '40px', 'box-sizing': 'border-box', 'border-radius': '4px', border: '1px solid $edge', 'background-color': '$glass', color: '$ink', 'flex-shrink': '0' },
          hover: { 'background-color': '$glass-hi' }, focus: { 'background-color': '$vcr-blue', 'border-color': '$ink' },
          children: [{ type: 'icon', symbol: 'search', style: { width: '18px', height: '18px' } }] },
        { type: 'box', id: 'latenight-profile', press: { action: 'toggle', arg: 'menu' }, label: '{s:profile}', testId: 'profile-menu', a11y: { expanded: [{ test: 'flag:menu' }], haspopup: 'dialog' }, style: { position: 'relative', display: 'flex', 'flex-direction': 'row', 'align-items': 'center', gap: '9px 9px', height: '40px', 'box-sizing': 'border-box', padding: '0px 12px 0px 4px', 'border-radius': '4px', border: '1px solid $edge', 'background-color': '$glass', color: '$ink-dim', 'flex-shrink': '0' },
          hover: { 'background-color': '$glass-hi', color: '$ink' }, focus: { 'background-color': '$vcr-blue', color: '$ink' }, small: { padding: '0px 4px' }, children: [
            { type: 'text', text: '{env.viewerInitial}', style: { width: '30px', height: '30px', 'border-radius': '2px', display: 'flex', 'align-items': 'center', 'justify-content': 'center', ...osdText('22px', '$ink-on-label'), 'text-shadow': 'none', 'background-image': 'linear-gradient(180deg, $tape-red 0%, $tape-red 33%, $tape-orange 33%, $tape-orange 66%, $tape-yellow 66%, $tape-yellow 100%)' } },
            { type: 'text', text: '{env.viewer}', style: { 'font-family': print, 'font-size': '11px', 'letter-spacing': '0.12em', 'text-transform': 'uppercase' }, small: { display: 'none' } },
          ] },
      ] },
    // Phones: the dial is a strip of channel buttons under the bar.
    { type: 'box', style: { display: 'none' }, small: { position: 'relative', display: 'flex', 'flex-direction': 'row', gap: '2px 2px', 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none', ...gutterSmall, 'padding-left': '8px', 'pointer-events': 'auto', 'mask-image': 'linear-gradient(90deg, black 0%, black 88%, transparent 100%)' } as Style, children: [
      channel('03', '{s:home}', [{ test: 'env.section', is: 'eq', value: 'home' }], { action: 'home' }),
      liveChannel,
      { type: 'repeat', over: 'nav.destinations', item: channel('1{index.label}', '{dest.name}', [{ test: 'dest.on' }], { action: 'library', arg: '{dest.id}' }) },
    ] },
  ] };

const menuRow = (label: string, icon: string, press: { action: 'openPicker' | 'signOut' }, testId?: string): Node & { type: 'box' } => ({ type: 'box', press, label, testId,
  style: { position: 'relative', display: 'flex', 'flex-direction': 'row', gap: '12px 12px', 'align-items': 'center', padding: '10px 12px', margin: '0px -12px', 'border-radius': '3px', color: '$ink', ...osdText('22px', '$ink'), 'text-shadow': 'none' },
  hover: { 'background-color': '$glass-hi' }, focus: { 'background-color': '$vcr-blue' }, children: [
    { type: 'icon', symbol: icon, style: { width: '16px', height: '16px', color: '$osd' } },
    { type: 'text', text: label, style: { flex: '1' } },
  ] });

// The profile menu, drawn as a VCR setup menu on the classic blue.
const menu: Node = { type: 'box', when: [{ test: 'env.viewer' }, { test: 'flag:menu' }], motion: 'pop', role: 'dialog', label: '{s:menu}', escape: 'menu', returnFocus: 'latenight-profile',
  style: { position: 'absolute', top: 'calc(12px + 74px)', right: 'calc(12px + max(30px, 3.6vw))',
    'max-height': 'calc(100vh - 106px - env(safe-area-inset-bottom))', 'overflow-y': 'auto',
    'z-index': '30', width: '290px', 'box-sizing': 'border-box', padding: '18px 22px 16px', display: 'flex', 'flex-direction': 'column', gap: '10px 10px', 'border-radius': '4px', border: '2px solid $ink', 'background-color': '$vcr-menu', 'box-shadow': '8px 8px 0px $shadow, 0px 30px 80px $shadow' },
  wide: { top: 'calc(18px + 74px)', right: 'calc(18px + max(30px, 3.6vw))', 'max-height': 'calc(100vh - 118px - env(safe-area-inset-bottom))' },
  small: { top: '62px', right: '10px', width: 'calc(100% - 20px)', 'max-width': '320px', 'max-height': 'calc(100vh - 70px - env(safe-area-inset-bottom))' }, children: [
    { type: 'text', text: '{s:menuTitle}', style: { ...osdText('20px', '$ink'), 'text-shadow': 'none', 'letter-spacing': '0.16em', opacity: '0.75' } },
    { type: 'box', style: { display: 'flex', 'flex-direction': 'row', gap: '12px 12px', 'align-items': 'center' }, children: [
      { type: 'text', text: '{env.viewerInitial}', style: { width: '40px', height: '40px', 'border-radius': '3px', display: 'flex', 'align-items': 'center', 'justify-content': 'center', ...osdText('28px', '$ink-on-label'), 'text-shadow': 'none', 'background-image': 'linear-gradient(180deg, $tape-red 0%, $tape-red 33%, $tape-orange 33%, $tape-orange 66%, $tape-yellow 66%, $tape-yellow 100%)' } },
      { type: 'text', text: '{env.viewer}', style: { 'font-family': print, 'font-size': '13px', 'letter-spacing': '0.1em', 'text-transform': 'uppercase', flex: '1', 'line-clamp': '1' } },
    ] },
    { type: 'box', style: { height: '0px', border: '1px dashed $edge', 'margin-top': '4px' } },
    { ...menuRow('{s:appearance}', 'forward-chevron', { action: 'openPicker' }, 'skin-picker'), children: [
      { type: 'icon', symbol: 'play-fill', style: { width: '12px', height: '12px', color: '$osd' } },
      { type: 'box', style: { display: 'flex', 'flex-direction': 'column', gap: '3px 3px', flex: '1' }, children: [
        { type: 'text', text: '{s:appearance}' },
        { type: 'text', text: '{s:skinName}', style: { 'font-family': print, 'font-size': '10px', 'letter-spacing': '0.14em', opacity: '0.7' } },
      ] },
      { type: 'icon', symbol: 'forward-chevron', style: { width: '12px', height: '12px' } },
    ] },
    { type: 'widget', widget: 'install', params: { action: 'install', label: '{s:install}' } },
    { type: 'widget', widget: 'install', params: { action: 'update', label: '{s:update}' } },
    menuRow('{s:signOut}', 'sign-out', { action: 'signOut' }),
    // Which Vela this is, where it runs and the server, typed small on the label: selectable, and on TV a stop the remote reaches.
    { type: 'box', when: [{ test: 'env.aboutLine' }], readingStop: true, label: '{env.aboutLabel}', testId: 'about-line', style: { 'padding-top': '4px' }, children: [
      // Not upper-cased: a copied build hash or version must read as the server states it.
      { type: 'text', text: '{env.aboutLine}', style: { 'font-family': print, 'font-size': '10px', 'line-height': '14px', 'letter-spacing': '0.08em', opacity: '0.7' } }] },
  ] };

// The glass: bezel and curved corners, vignette, faint scanlines, a sheen, and now and
// then a tracking band rolling down. Nothing here takes pointer input.
const glass: Node = { type: 'box', style: { position: 'absolute', ...inset('0px'), 'z-index': '40', 'pointer-events': 'none', 'overflow-x': 'hidden', 'overflow-y': 'hidden' }, children: [
  { type: 'box', style: { position: 'absolute', ...inset(bezel.normal), 'border-radius': radius.normal, 'overflow-x': 'hidden', 'overflow-y': 'hidden',
      'box-shadow': '0px 0px 0px 80px $bezel, inset 0px 0px 0px 1px $bezel-lip, inset 0px 0px 140px $vignette, inset 0px 0px 40px $vignette-edge' },
    wide: { ...inset(bezel.wide), 'border-radius': radius.wide }, small: { ...inset(bezel.small), 'border-radius': radius.small, 'box-shadow': 'inset 0px 0px 90px $vignette' }, children: [
      // Scanlines, at device pixels, light enough that posters stay sharp.
      { type: 'box', style: { position: 'absolute', ...inset('0px'), 'background-image': 'repeating-linear-gradient(180deg, $scanline 0px, $scanline 1px, transparent 1px, transparent 3px)', opacity: '0.55' } },
      // The tube's curvature: a soft hot spot and darker corners.
      { type: 'box', style: { position: 'absolute', ...inset('0px'), 'background-image': 'radial-gradient(ellipse 85% 75% at 50% 45%, $scrim-clear 55%, $corner-shade 100%)' } },
      { type: 'box', style: { position: 'absolute', top: '-30%', left: '-10%', width: '70%', height: '70%', 'background-image': 'radial-gradient(closest-side, $sheen 0%, $scrim-clear 100%)', opacity: '0.7' }, small: { display: 'none' } },
      // Power on: a flash opens from the middle of the tube, then clears (once, when the set comes on).
      { type: 'box', when: [{ test: 'env.still', not: true }, { test: 'env.route', is: 'ne', value: 'library' }], motion: 'warmUp', style: { position: 'absolute', ...inset('0px') }, children: [
        { type: 'box', motion: 'tvOn', style: { position: 'absolute', ...inset('0px'), 'background-image': 'radial-gradient(ellipse 60% 50% at 50% 50%, $flash 0%, $flash-edge 60%, $scrim-clear 100%)' } },
      ] },
      // A tracking band, now and then (the easing holds it off screen most of the cycle).
      { type: 'box', when: [{ test: 'env.still', not: true }], motion: 'tracking', style: { position: 'absolute', left: '0px', right: '0px', top: '0px', height: '100%' }, children: [
        { type: 'box', style: { position: 'absolute', left: '0px', right: '0px', bottom: '0px', height: '64px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'mask-image': 'linear-gradient(180deg, transparent 0%, black 35%, black 65%, transparent 100%)', 'background-image': 'linear-gradient(180deg, $scrim-clear 0%, $band 50%, $scrim-clear 100%)' }, children: [
          { type: 'image', src: asset('static.svg'), alt: '', style: { position: 'absolute', ...inset('0px'), width: '100%', height: '100%', 'object-fit': 'cover', opacity: '0.18' } },
        ] },
      ] },
    ] },
] };

// Changing channel: snow across the screen, then the bug says where you are. One per
// section, so each mounts (and plays) when that section comes on.
const flipLayer = (when: Node['when'], extra: Node[] = [], withSnow = true): Node => ({ type: 'box', when, style: { position: 'absolute', ...inset(bezel.normal), 'z-index': '35', 'pointer-events': 'none', 'border-radius': radius.normal, 'overflow-x': 'hidden', 'overflow-y': 'hidden' },
  wide: { ...inset(bezel.wide), 'border-radius': radius.wide }, small: { ...inset(bezel.small), 'border-radius': radius.small }, children: [...(withSnow ? [snow('flip')] : []), ...extra] });
const bigBug = (text: string, name: string): Node => ({ type: 'box', when: [{ test: 'env.still', not: true }], motion: 'bugOut',
  style: { position: 'absolute', top: '108px', right: 'max(34px, 4vw)', display: 'flex', 'flex-direction': 'column', 'align-items': 'flex-end', gap: '4px 4px' }, small: { top: '112px', right: '18px' }, children: [
    { type: 'text', text, style: { ...osdText('84px'), 'font-variant-numeric': 'tabular-nums' }, small: { 'font-size': '60px' } },
    { type: 'text', text: name, style: osdText('26px') },
  ] });
const flips: Node[] = [
  flipLayer([{ test: 'env.viewer' }, { test: 'env.section', is: 'eq', value: 'home' }], [bigBug('CH 03', '{s:home}')]),
  flipLayer([{ test: 'env.viewer' }, { test: 'env.section', is: 'eq', value: 'live' }], [bigBug('{s:live}', '{s:liveTv}')]),
  // A live library is the live section (its own layer above), not a numbered channel.
  // Keep library controls visible while the channel identifier appears.
  { type: 'repeat', over: 'nav.destinations', item: flipLayer([{ test: 'dest.on' }, { test: 'dest.kind', is: 'ne', value: 'live' }], [bigBug('CH 1{index.label}', '{dest.name}')], false) },
];

const shell: Node = { type: 'box', style: { display: 'flex', 'flex-direction': 'column', height: '100%', 'min-height': '0px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'background-color': '$page', color: '$ink', 'font-family': sans }, children: [
  nav,
  { type: 'slot', slot: 'children', style: { display: 'flex', 'flex-direction': 'column', flex: '1', 'min-height': '0px', ...inset('0px'), 'padding-top': bezel.normal, 'padding-right': bezel.normal, 'padding-bottom': bezel.normal, 'padding-left': bezel.normal, 'box-sizing': 'border-box' } as Style,
    wide: { 'padding-top': bezel.wide, 'padding-right': bezel.wide, 'padding-bottom': bezel.wide, 'padding-left': bezel.wide } as Style,
    small: { 'padding-top': bezel.small, 'padding-right': bezel.small, 'padding-bottom': bezel.small, 'padding-left': bezel.small } as Style,
    inner: { display: 'flex', 'flex-direction': 'column', 'flex-grow': '1', 'min-height': '0px', height: '100%', width: '100%' } as Style },
  ...flips,
  menu,
  glass,
] };

// ---------------------------------------------------------------- home
// The broadcast: the featured title's picture, crisp, behind the first rows.
const stage: Node = { type: 'repeat', over: 'home.hero', item: { type: 'box', motion: 'tuneIn', style: { position: 'absolute', top: '0px', left: '0px', right: '0px', height: 'max(640px, 88vh)', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'pointer-events': 'none', 'mask-image': 'linear-gradient(180deg, black 0%, black 66%, transparent 100%)' },
  small: { height: '600px' }, children: [
    { type: 'box', when: [{ test: 'env.searching', not: true }], style: { position: 'absolute', ...inset('0px') }, children: [
      { type: 'image', when: [{ test: 'hero.backdrop' }], src: '{hero.backdrop}', alt: '', fade: true, motion: 'judder', style: { position: 'absolute', ...inset('0px'), width: '100%', height: '100%', 'object-fit': 'cover', transition: 'opacity 300ms linear' } },
      { type: 'image', when: [{ test: 'hero.backdrop', not: true }, { test: 'hero.poster' }], src: '{hero.poster}', alt: '', style: { position: 'absolute', top: '-20%', left: '-20%', width: '140%', height: '140%', 'object-fit': 'cover', filter: 'blur(80px) saturate(1.4)', opacity: '0.6' } },
    ] },
    { type: 'image', when: [{ test: 'env.searching' }, { test: 'hero.backdrop' }], src: '{hero.backdrop}', alt: '', style: { position: 'absolute', top: '-12%', left: '-12%', width: '124%', height: '124%', 'object-fit': 'cover', filter: 'blur(60px) saturate(1.3)', opacity: '0.35' } },
    { type: 'box', style: { position: 'absolute', ...inset('0px'), 'background-image': 'linear-gradient(90deg, $scrim-deep 0%, $scrim-mid 34%, $scrim-clear 70%), linear-gradient(0deg, $page 0%, $scrim-strong 22%, $scrim-clear 56%), linear-gradient(180deg, $scrim-top 0%, $scrim-clear 24%)' } },
    // The picture tunes in: one burst of snow every time the featured title changes.
    snow('tune'),
  ] } };

const vcrButton = (primary: boolean): Style => ({ position: 'relative', display: 'flex', 'flex-direction': 'row', 'align-items': 'center', gap: '12px 12px', height: '54px', 'box-sizing': 'border-box', padding: primary ? '0px 26px 0px 20px' : '0px 22px 0px 18px', 'border-radius': '4px',
  border: primary ? '2px solid $ink' : '2px solid $edge-strong', 'background-color': primary ? '$ink' : '$osd-plate', color: primary ? '$ink-on-label' : '$ink', 'box-shadow': '4px 4px 0px $shadow', transition: 'translate 120ms steps(2), box-shadow 120ms steps(2), background-color 120ms linear' });
const pressed: Style = { translate: '2px 2px', 'box-shadow': `2px 2px 0px $shadow, ${split(2)}` };

const heroPlay: Node = { type: 'box', press: { action: 'play', arg: '{hero.id}' }, label: '{heroAct.actionLabel}', testId: 'hero-primary', when: [{ test: 'heroAct.playable' }],
  style: vcrButton(true), hover: { ...pressed, 'background-color': '$ink-bright' }, focus: { ...pressed, 'background-color': '$ink-bright' }, small: { height: '50px' }, children: [
    { type: 'icon', symbol: 'play-fill', style: { width: '18px', height: '18px' } },
    { type: 'box', style: { display: 'flex', 'flex-direction': 'column', gap: '2px 2px' }, children: [
      { type: 'text', text: '{heroAct.actionLabel}', style: { ...osdText('28px', 'inherit'), 'text-shadow': 'none' } },
      { type: 'text', when: [{ test: 'heroAct.actionDetail' }], text: '{heroAct.actionDetail}', style: { 'font-family': print, 'font-size': '9.5px', 'letter-spacing': '0.12em', 'text-transform': 'uppercase', opacity: '0.7' } },
    ] },
    // The tape counter: how much of it you have already watched.
    { type: 'box', when: [{ test: 'heroAct.hasProgress' }], style: { width: '54px', height: '8px', 'box-sizing': 'border-box', border: '1px solid $ink-on-label', padding: '1px' }, children: [
      { type: 'box', style: { height: '4px', width: '{heroAct.progressPct}%', 'min-width': '4px', 'background-image': 'repeating-linear-gradient(90deg, $ink-on-label 0px, $ink-on-label 4px, transparent 4px, transparent 6px)' } },
    ] },
  ] };
const heroInfo = (primary: boolean): Node => ({ type: 'box', press: { action: 'select', arg: '{hero.kindId}' }, label: '{s:moreInfo}', testId: 'hero-more', when: [{ test: 'heroAct.playable', not: primary }],
  style: vcrButton(primary), hover: pressed, focus: { ...pressed, 'background-color': '$vcr-blue', 'border-color': '$ink', color: '$ink' }, small: { height: '50px' }, children: [
    { type: 'icon', symbol: 'info', style: { width: '17px', height: '17px' } },
    { type: 'text', text: '{s:moreInfo}', style: { ...osdText('26px', 'inherit'), 'text-shadow': 'none' } },
  ] });

const heroCopy: Node = { type: 'repeat', over: 'home.hero', when: [{ test: 'env.searching', not: true }], item: { type: 'box', style: { display: 'flex', 'flex-direction': 'column', ...gutter, gap: '14px 14px', 'max-width': '50rem' }, small: { ...gutterSmall, gap: '12px 12px', 'max-width': 'none' }, children: [
  { type: 'widget', widget: 'observe', params: { receipt: '{hero.receipt}' } },
  { type: 'box', motion: 'osd1', style: { display: 'flex', 'flex-direction': 'row', gap: '10px 10px', 'align-items': 'center' }, children: [
    { type: 'text', text: '▶ {s:play}', style: { ...osdText('22px'), padding: '3px 8px 1px', 'background-color': '$osd-plate', 'text-shadow': 'none', 'white-space': 'nowrap', 'flex-shrink': '0' }, small: { 'font-size': '18px' } },
    { type: 'text', text: '{heroAct.reasonLabel}', style: { ...osdText('22px', '$ink'), padding: '3px 8px 1px', 'background-color': '$osd-plate', 'text-shadow': 'none', 'white-space': 'nowrap', 'line-clamp': '1', 'min-width': '0px' }, small: { 'font-size': '18px' } },
  ] },
  { type: 'image', when: [{ test: 'hero.logo' }], src: '{hero.logo}', alt: '{hero.name}', role: 'heading', level: 1, motion: 'osd2', style: { height: '140px', width: 'min(520px, 72%)', 'max-width': 'min(520px, 72%)', 'object-fit': 'contain', 'align-self': 'flex-start', filter: 'drop-shadow(-2px 0px 0px $chroma-red) drop-shadow(2px 0px 0px $chroma-cyan)' }, small: { height: '92px', 'max-width': '80%' } },
  { type: 'text', when: [{ test: 'hero.logo', not: true }], text: '{hero.name}', role: 'heading', level: 1, motion: 'osd2', style: { 'font-family': print, 'font-size': '58px', 'line-height': '1.04', 'letter-spacing': '0.01em', 'text-transform': 'uppercase', 'line-clamp': '3', 'text-shadow': '2px 0px 0px $chroma-cyan' }, wide: { 'font-size': '66px' }, small: { 'font-size': '32px' } },
  { type: 'text', text: '{hero.factsLine}', motion: 'osd3', style: { ...osdText('24px', '$ink-dim'), 'text-transform': 'none', 'letter-spacing': '0.02em', 'font-variant-numeric': 'tabular-nums' }, small: { 'font-size': '20px' } },
  { type: 'text', when: [{ test: 'hero.summary' }], text: '{hero.summary}', motion: 'osd3', style: { 'font-size': '16px', color: '$ink-dim', 'line-height': '1.55', 'line-clamp': '3', 'max-width': '36rem', 'text-shadow': '0px 1px 14px $shadow' }, small: { 'font-size': '14px', 'line-clamp': '2' } },
  { type: 'box', motion: 'osd4', style: { display: 'flex', 'flex-direction': 'row', gap: '14px 14px', 'align-items': 'center', 'flex-wrap': 'wrap', 'margin-top': '10px' } as Style, small: { 'margin-top': '4px', gap: '10px 10px' } as Style, children: [heroPlay, heroInfo(false), heroInfo(true)] },
] } };

// The featured titles are preset buttons: 01, 02, 03... The tuned one is lit, and its
// timer fills while the set rotates to the next.
const preset = (current: boolean): Node => ({ type: 'box', press: { action: 'pickHero', arg: '{index}' }, label: '{hero.name}', when: [{ test: 'index.current', not: !current }],
  style: { position: 'relative', display: 'flex', 'flex-direction': 'column', 'align-items': 'center', gap: '4px 4px', width: '44px', 'box-sizing': 'border-box', 'padding-top': '5px', 'padding-bottom': '6px', 'border-radius': '3px', border: current ? '2px solid $osd' : '2px solid $edge',
    'background-color': current ? '$osd-plate' : '$glass', color: current ? '$osd' : '$ink-dim', transition: 'background-color 120ms linear, color 120ms linear' },
  hover: { color: '$ink', 'border-color': '$ink' }, focus: { color: '$ink', 'border-color': '$ink', 'background-color': '$vcr-blue' }, children: [
    { type: 'text', text: '0{index.label}', style: { ...osdText('22px', 'inherit'), 'text-shadow': 'none', 'font-variant-numeric': 'tabular-nums' } },
    { type: 'box', style: { position: 'relative', width: '28px', height: '3px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'background-color': '$edge' }, children: current ? [
      { type: 'box', when: [{ test: 'env.rotating' }], motion: 'presetFill', style: { position: 'absolute', ...inset('0px'), 'background-color': '$osd' } },
      { type: 'box', when: [{ test: 'env.rotating', not: true }], style: { position: 'absolute', ...inset('0px'), 'background-color': '$osd' } },
    ] : [] },
  ] });
const presets: Node = { type: 'box', role: 'group', label: '{s:featured}', motion: 'osd4', when: [{ test: 'env.searching', not: true }, { test: 'env.heroCount', is: 'gt', value: '1' }],
  style: { display: 'flex', 'flex-direction': 'row', gap: '8px 8px', 'align-items': 'center', ...gutter, 'padding-top': '26px' } as Style, small: { ...gutterSmall, 'padding-top': '18px', gap: '6px 6px' } as Style, children: [
    { type: 'text', text: '{s:presets}', style: { ...osdText('18px', '$ink-quiet'), 'text-shadow': 'none', 'margin-right': '6px' }, small: { display: 'none' } },
    { type: 'repeat', over: 'home.heroes', item: { type: 'box', style: { display: 'flex' }, children: [preset(true), preset(false)] } },
  ] };

const copyColumn: Node = { type: 'box', when: [{ test: 'env.heroCount', is: 'gt', value: '0' }, { test: 'env.searching', not: true }], style: { position: 'relative', display: 'flex', 'flex-direction': 'column', 'justify-content': 'flex-end', 'box-sizing': 'border-box', 'min-height': 'calc(clamp(500px, 62vh, 700px) - 90px)', 'padding-top': 'calc(78px + 40px)' },
  small: { 'min-height': '420px', 'padding-top': 'calc(98px + 30px + env(safe-area-inset-top))' }, children: [heroCopy, presets] };

// A title on the shelf: the poster, crisp. Hover or focus lights an OSD frame with a hint
// of RGB misregistration; progress is a segmented tape counter.
const card: Node = { type: 'box', group: true, press: { action: 'select', arg: '{card.kindId}' }, label: '{card.label}', testId: 'title-{card.id}',
  style: { position: 'relative', display: 'flex', 'flex-direction': 'column', width: 'clamp(148px, 12vw, 224px)', 'flex-shrink': '0', gap: '10px 10px' }, small: { width: '128px' }, children: [
    { type: 'widget', widget: 'observe', params: { receipt: '{card.receipt}' } },
    { type: 'box', style: { position: 'relative', width: '100%', 'aspect-ratio': '2 / 3', 'background-color': '$raised', 'border-radius': '4px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', translate: '0px 0px',
        'box-shadow': '0px 0px 0px 1px $hairline, 0px 14px 28px -16px $shadow', transition: 'translate 160ms steps(3), box-shadow 160ms steps(3)' },
      groupHover: { translate: '0px -5px', 'box-shadow': `0px 0px 0px 2px $ink, ${split(4)}, 0px 22px 40px -14px $shadow` },
      groupFocus: { translate: '0px -5px', 'box-shadow': `0px 0px 0px 3px $osd, ${split(4)}, 0px 22px 40px -14px $shadow` }, children: [
        { type: 'image', when: [{ test: 'card.poster' }], src: '{card.poster}', alt: '', fade: true, style: { position: 'absolute', ...inset('0px'), width: '100%', height: '100%', 'object-fit': 'cover', transition: 'opacity 260ms linear' } },
        // No poster: the landscape art (an episode's still) cropped to the portrait frame.
        { type: 'image', when: [{ test: 'card.poster', not: true }, { test: 'card.backdrop' }], src: '{card.backdrop}', alt: '', fade: true, style: { position: 'absolute', ...inset('0px'), width: '100%', height: '100%', 'object-fit': 'cover', transition: 'opacity 260ms linear' } },
        // No art at all: a hand-labelled tape.
        { type: 'box', when: [{ test: 'card.poster', not: true }, { test: 'card.backdrop', not: true }], style: { position: 'absolute', ...inset('0px'), display: 'flex', 'flex-direction': 'column', 'justify-content': 'center', padding: '12px', 'background-image': 'linear-gradient(180deg, $tape-shell 0%, $tape-shell-deep 100%)' }, children: [
          { type: 'text', text: '{card.name}', style: { padding: '22px 10px 12px', 'background-color': '$label', 'border-radius': '2px', 'box-shadow': 'inset 0px 6px 0px $tape-red, inset 0px 10px 0px $tape-orange, inset 0px 14px 0px $tape-yellow', 'font-family': marker, 'font-size': '20px', 'line-height': '1.05', color: '$ink-on-label', 'line-clamp': '4' }, small: { 'font-size': '17px' } },
        ] },
        { type: 'box', when: [{ test: 'card.played' }], style: { position: 'absolute', top: '7px', left: '7px', padding: '2px 6px 0px', 'background-color': '$osd-plate', ...osdText('17px'), 'text-shadow': 'none' }, children: [
          { type: 'text', text: '✓ {s:watched}' },
        ] },
        { type: 'box', when: [{ test: 'card.hasProgress' }], style: { position: 'absolute', left: '0px', right: '0px', bottom: '0px', height: '30px', 'background-image': 'linear-gradient(0deg, $scrim-strong 0%, $scrim-clear 100%)' } },
        { type: 'box', when: [{ test: 'card.hasProgress' }], style: { position: 'absolute', left: '8px', right: '8px', bottom: '8px', height: '7px', 'box-sizing': 'border-box', border: '1px solid $osd', padding: '1px', 'background-color': '$osd-plate' }, children: [
          { type: 'box', style: { height: '3px', width: '{card.progressPct}%', 'min-width': '4px', 'background-image': 'repeating-linear-gradient(90deg, $osd 0px, $osd 4px, transparent 4px, transparent 6px)' } },
        ] },
      ] },
    { type: 'box', style: { display: 'flex', 'flex-direction': 'column', gap: '3px 3px', padding: '0px 1px' }, children: [
      { type: 'text', text: '{card.name}', style: { 'font-size': '14px', 'font-weight': '600', 'line-clamp': '1', color: '$ink' }, groupHover: { color: '$ink-bright' }, groupFocus: { color: '$osd' }, small: { 'font-size': '13px' } },
      { type: 'text', text: '{card.facts}', style: { ...osdText('17px', '$ink-quiet'), 'text-transform': 'none', 'text-shadow': 'none', 'letter-spacing': '0.02em', 'line-clamp': '1', 'font-variant-numeric': 'tabular-nums' } },
    ] },
  ] };

// Ranked rows get a big outlined OSD number beside each poster.
const rankedCard: Node = { type: 'box', style: { display: 'flex', 'flex-direction': 'row', 'align-items': 'flex-end', gap: '2px 2px' }, children: [
  { type: 'text', text: '{index.label}', style: { 'font-family': osd, 'font-size': '150px', 'line-height': '0.74', color: '$osd', opacity: '0.92', 'text-shadow': '4px 4px 0px $shadow', 'margin-right': '4px', 'font-variant-numeric': 'tabular-nums' }, small: { 'font-size': '100px' } },
  { type: 'use', template: 'card' },
] };

// A row is a tape on the shelf: its label, hand-written, with the tape's stripes.
const row: Node = { type: 'box', style: { position: 'relative', display: 'flex', 'flex-direction': 'column', gap: '2px 2px', 'padding-bottom': '22px' }, small: { 'padding-bottom': '14px' }, children: [
  { type: 'box', style: { display: 'flex', 'flex-direction': 'row', 'align-items': 'center', gap: '12px 12px', ...gutter }, small: gutterSmall, children: [
    { type: 'text', text: 'CH {index.label}', style: { ...osdText('22px'), 'font-variant-numeric': 'tabular-nums', 'flex-shrink': '0' }, small: { 'font-size': '19px' } },
    { type: 'box', style: { display: 'flex', 'flex-direction': 'row', 'align-items': 'center', 'min-width': '0px', 'max-width': '100%', height: '38px', 'box-sizing': 'border-box', 'padding-left': '22px', 'padding-right': '16px', 'background-color': '$label', 'border-radius': '2px',
        'background-image': 'linear-gradient(90deg, $tape-red 0px, $tape-red 5px, $tape-orange 5px, $tape-orange 10px, $tape-yellow 10px, $tape-yellow 15px, transparent 15px)', 'box-shadow': '3px 3px 0px $shadow', rotate: '-0.6' } as Style,
      small: { height: '32px', 'padding-left': '20px', 'padding-right': '12px' }, children: [
        { type: 'text', text: '{row.name}', role: 'heading', level: 2, style: { 'font-family': marker, 'font-size': '21px', 'line-height': '1', color: '$ink-on-label', 'white-space': 'nowrap', 'line-clamp': '1', 'padding-top': '3px' }, small: { 'font-size': '17px' } },
      ] },
  ] },
  { type: 'box', style: { position: 'relative', display: 'flex', 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none' }, children: [
    { type: 'box', style: { display: 'flex', 'flex-direction': 'row', gap: '16px 16px', 'align-items': 'flex-start', 'padding-top': '16px', 'padding-bottom': '18px', ...gutter }, small: { gap: '12px 12px', 'padding-top': '12px', 'padding-bottom': '14px', ...gutterSmall }, children: [
      { type: 'repeat', over: 'row.items', when: [{ test: 'row.presentation', is: 'ne', value: 'ranked' }], item: { type: 'use', template: 'card' } },
      { type: 'repeat', over: 'row.items', when: [{ test: 'row.presentation', is: 'eq', value: 'ranked' }], limit: 10, item: { type: 'use', template: 'rankedCard' } },
    ] },
    // The row tunes in with a burst of snow, rows one after another down the page.
    snow('rowFlip', { stagger: { step: 120, cap: 5 } }),
  ] },
] };

const home: Node = { type: 'box', style: { position: 'relative', display: 'flex', 'flex-direction': 'column', 'background-color': '$page', 'min-height': '100%' }, children: [
  stage,
  copyColumn,
  { type: 'slot', slot: 'searchField', states: [
    { when: [{ test: 'env.heroCount', is: 'eq', value: '0' }], style: { 'padding-top': '112px' } },
    { when: [{ test: 'env.searching' }], style: { 'padding-top': '112px' } },
  ], style: { display: 'flex', 'flex-direction': 'column', 'padding-top': '34px', 'padding-bottom': '14px', 'padding-left': 'max(30px, 3.6vw)', 'padding-right': 'max(30px, 3.6vw)', 'align-items': 'center' } as Style,
    small: { 'padding-top': '24px', 'padding-bottom': '8px', 'padding-left': '16px', 'padding-right': '16px' } as Style, inner: { width: '100%', 'max-width': '720px', animation: 'vr-dissolve 300ms steps(3) 360ms both' } },
  // Rows sit in one container: a repeat's own style (and so its flex order) belongs to its item.
  { type: 'box', when: [{ test: 'env.searching', not: true }], style: { position: 'relative', display: 'flex', 'flex-direction': 'column', 'padding-top': '26px', 'padding-bottom': '40px' }, small: { 'padding-top': '16px' }, children: [
    { type: 'repeat', over: 'home.rows', item: { type: 'use', template: 'row' } },
  ] },
] };

// ---------------------------------------------------------------- title
// A title is a tape pulled off the shelf: its sleeve beside the picture, the details in
// the on-screen display, episodes as the tape's index, the cast as hand-labelled photos.
const sectionHead = (text: string): Node => ({ type: 'box', style: { display: 'flex', 'flex-direction': 'row', 'align-items': 'baseline', gap: '10px 10px', 'margin-bottom': '14px' }, children: [
  { type: 'text', text: '▶', style: osdText('20px') },
  { type: 'text', text, role: 'heading', level: 2, style: { ...osdText('26px', '$ink'), 'text-shadow': 'none', 'letter-spacing': '0.08em' } },
] });
const block: Style = { position: 'relative', display: 'flex', 'flex-direction': 'column', ...gutter, 'padding-bottom': '40px' };

const titlePlay: Node = { type: 'box', when: [{ test: 'detail.canPlay' }], press: { action: 'play', arg: '{detail.id}' }, label: '{detail.playLabel}', testId: 'detail-play',
  style: vcrButton(true), hover: { ...pressed, 'background-color': '$ink-bright' }, focus: { ...pressed, 'background-color': '$ink-bright' }, small: { height: '50px' }, children: [
    { type: 'icon', symbol: 'play-fill', style: { width: '18px', height: '18px' } },
    { type: 'text', text: '{detail.playLabel}', style: { ...osdText('28px', 'inherit'), 'text-shadow': 'none' } },
    { type: 'box', when: [{ test: 'detail.hasResume' }], style: { width: '64px', height: '8px', 'box-sizing': 'border-box', border: '1px solid $ink-on-label', padding: '1px' }, children: [
      { type: 'box', style: { height: '4px', width: '{detail.resumePct}%', 'min-width': '4px', 'background-image': 'repeating-linear-gradient(90deg, $ink-on-label 0px, $ink-on-label 4px, transparent 4px, transparent 6px)' } },
    ] },
  ] };

const sleeve: Node = { type: 'box', when: [{ test: 'detail.poster' }], style: { position: 'relative', width: 'clamp(180px, 17vw, 280px)', 'aspect-ratio': '2 / 3', 'flex-shrink': '0', 'border-radius': '4px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'background-color': '$raised', rotate: '-1.2',
    'box-shadow': '0px 0px 0px 1px $hairline, 10px 14px 0px $shadow, 0px 30px 60px -20px $shadow' }, small: { display: 'none' }, children: [
    { type: 'image', src: '{detail.poster}', alt: '', fade: true, style: { position: 'absolute', ...inset('0px'), width: '100%', height: '100%', 'object-fit': 'cover' } },
    // The rental sticker.
    { type: 'text', text: '{detail.kindLabel}', style: { position: 'absolute', top: '10px', right: '-30px', width: '120px', 'text-align': 'center', rotate: '35', padding: '3px 0px 2px', 'background-color': '$tape-yellow', color: '$ink-on-label', 'font-family': print, 'font-size': '9px', 'letter-spacing': '0.16em', 'text-transform': 'uppercase', 'box-shadow': '0px 2px 0px $shadow' } },
  ] };

const episode: Node = { type: 'box', group: true, press: { action: 'play', arg: '{card.id}' }, label: '{episode.playLabel}', testId: 'episode-{card.id}',
  style: { position: 'relative', display: 'flex', 'flex-direction': 'row', gap: '18px 18px', 'align-items': 'center', padding: '10px', margin: '0px -10px', 'border-radius': '4px', transition: 'background-color 120ms linear' },
  hover: { 'background-color': '$glass' }, focus: { 'background-color': '$vcr-blue' }, small: { gap: '12px 12px' }, children: [
    { type: 'box', style: { position: 'relative', width: '200px', 'aspect-ratio': '16 / 9', 'flex-shrink': '0', 'border-radius': '3px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'background-color': '$raised', 'box-shadow': '0px 0px 0px 1px $hairline' },
      groupHover: { 'box-shadow': `0px 0px 0px 2px $ink, ${split(3)}` }, groupFocus: { 'box-shadow': `0px 0px 0px 3px $osd, ${split(3)}` }, small: { width: '128px' }, children: [
        { type: 'image', when: [{ test: 'card.backdrop' }], src: '{card.backdrop}', alt: '', fade: true, style: { position: 'absolute', ...inset('0px'), width: '100%', height: '100%', 'object-fit': 'cover' } },
        { type: 'image', when: [{ test: 'card.backdrop', not: true }, { test: 'card.poster' }], src: '{card.poster}', alt: '', fade: true, style: { position: 'absolute', ...inset('0px'), width: '100%', height: '100%', 'object-fit': 'cover' } },
        { type: 'text', when: [{ test: 'card.durationLabel' }], text: '{card.durationLabel}', style: { position: 'absolute', right: '6px', top: '6px', padding: '2px 5px 0px', 'background-color': '$osd-plate', ...osdText('16px', '$ink'), 'text-shadow': 'none', 'text-transform': 'none' } },
        { type: 'box', when: [{ test: 'card.hasProgress' }], style: { position: 'absolute', left: '6px', right: '6px', bottom: '6px', height: '6px', 'box-sizing': 'border-box', border: '1px solid $osd', padding: '1px', 'background-color': '$osd-plate' }, children: [
          { type: 'box', style: { height: '2px', width: '{card.progressPct}%', 'min-width': '4px', 'background-color': '$osd' } },
        ] },
        { type: 'text', when: [{ test: 'card.played' }], text: '✓', style: { position: 'absolute', top: '5px', left: '5px', padding: '1px 5px 0px', 'background-color': '$osd-plate', ...osdText('16px'), 'text-shadow': 'none' } },
      ] },
    { type: 'box', style: { display: 'flex', 'flex-direction': 'column', gap: '5px 5px', flex: '1', 'min-width': '0px' }, children: [
      { type: 'text', when: [{ test: 'episode.upNextLabel' }, { test: 'card.hasProgress' }], text: '▶ {episode.upNextLabel}', style: { ...osdText('17px'), 'text-shadow': 'none' } },
      { type: 'text', text: '{episode.numberTitle}', style: { 'font-size': '16px', 'font-weight': '600', 'line-clamp': '1' }, small: { 'font-size': '14px' } },
      { type: 'text', when: [{ test: 'card.summary' }], text: '{card.summary}', style: { 'font-size': '13.5px', 'line-height': '1.45', color: '$ink-dim', 'line-clamp': '2' }, small: { display: 'none' } },
      { type: 'text', text: '{card.facts}', style: { ...osdText('17px', '$ink-quiet'), 'text-shadow': 'none', 'text-transform': 'none', 'line-clamp': '1' } },
    ] },
  ] };

// The route's root box fills the view (its padding adds to the height: the root is content-box).
const title: Node = { type: 'box', style: { display: 'flex', 'flex-direction': 'column', 'min-height': '100%', padding: bezel.normal, 'box-sizing': 'border-box', 'background-color': '$page', color: '$ink', 'font-family': sans },
  wide: { padding: bezel.wide }, small: { padding: bezel.small }, children: [
  { type: 'box', id: '{env.route}-scroll-{env.entry}', role: 'region', label: '{detail.name}', style: { position: 'relative', display: 'flex', 'flex-direction': 'column' }, children: [
    // Seeking, and the blue screen when nothing comes in.
    { type: 'box', when: [{ test: 'env.load', is: 'eq', value: 'loading' }], style: { display: 'flex', 'flex-direction': 'row', gap: '12px 12px', padding: '140px max(30px, 3.6vw)' }, children: [
      { type: 'text', text: '▶▶', motion: 'blink', style: osdText('34px') },
      { type: 'text', text: '{s:opening}', style: osdText('34px') },
    ] },
    { type: 'box', when: [{ test: 'env.load', is: 'eq', value: 'failed' }], role: 'alert', style: { position: 'absolute', ...inset('0px'), display: 'flex', 'flex-direction': 'column', 'align-items': 'center', 'justify-content': 'center', gap: '16px 16px', 'background-color': '$vcr-blue' }, children: [
      { type: 'text', text: '{s:noSignal}', style: { ...osdText('56px', '$ink'), 'text-shadow': '3px 3px 0px $shadow' } },
      { type: 'text', text: '{env.loadMessage}', style: { ...osdText('24px', '$ink'), 'text-shadow': 'none', 'text-transform': 'none', 'text-align': 'center', 'max-width': '30rem' } },
      { type: 'box', when: [{ test: 'env.canRetry' }], press: { action: 'retry' }, label: '{s:retry}', testId: 'detail-retry', style: { ...vcrButton(true), 'margin-top': '10px' }, hover: pressed, focus: pressed, children: [
        { type: 'text', text: '▶ {s:retry}', style: { ...osdText('26px', 'inherit'), 'text-shadow': 'none' } },
      ] },
    ] },
    { type: 'box', when: [{ test: 'env.load', is: 'eq', value: 'ready' }], style: { position: 'relative', display: 'flex', 'flex-direction': 'column', 'min-height': '100%' }, children: [
      { type: 'widget', widget: 'observe', params: { receipt: '{detail.receipt}' } },
      { type: 'box', style: { position: 'absolute', top: '0px', left: '0px', right: '0px', height: 'max(560px, 78vh)', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'pointer-events': 'none' }, children: [
        { type: 'image', when: [{ test: 'detail.backdrop' }], src: '{detail.backdrop}', alt: '', fade: true, style: { position: 'absolute', ...inset('0px'), width: '100%', height: '100%', 'object-fit': 'cover' } },
        { type: 'image', when: [{ test: 'detail.backdrop', not: true }, { test: 'detail.poster' }], src: '{detail.poster}', alt: '', style: { position: 'absolute', top: '-20%', left: '-20%', width: '140%', height: '140%', 'object-fit': 'cover', filter: 'blur(80px) saturate(1.4)', opacity: '0.55' } },
        { type: 'box', style: { position: 'absolute', ...inset('0px'), 'background-image': 'linear-gradient(90deg, $scrim-deep 0%, $scrim-mid 45%, $scrim-clear 80%), linear-gradient(0deg, $page 0%, $scrim-strong 30%, $scrim-clear 70%), linear-gradient(180deg, $scrim-top 0%, $scrim-clear 30%)' } },
        snow('tune'),
      ] },
      { type: 'box', style: { position: 'relative', display: 'flex', 'flex-direction': 'row', 'align-items': 'flex-end', gap: '44px 44px', ...gutter, 'padding-top': 'max(150px, 24vh)', 'padding-bottom': '44px' }, small: { ...gutterSmall, 'padding-top': '40vh', gap: '0px 0px', 'padding-bottom': '28px' }, children: [
        sleeve,
        { type: 'box', style: { display: 'flex', 'flex-direction': 'column', gap: '14px 14px', 'max-width': '44rem', 'min-width': '0px' }, small: { gap: '12px 12px' }, children: [
          { type: 'box', motion: 'osd1', style: { display: 'flex', 'flex-direction': 'row', gap: '10px 10px' }, children: [
            { type: 'text', text: '▶ {detail.kindLabel}', style: { ...osdText('22px'), padding: '3px 8px 1px', 'background-color': '$osd-plate', 'text-shadow': 'none', 'white-space': 'nowrap' }, small: { 'font-size': '18px' } },
          ] },
          { type: 'image', when: [{ test: 'detail.logo' }], src: '{detail.logo}', alt: '{detail.name}', role: 'heading', level: 1, motion: 'osd2', style: { height: '130px', width: '80%', 'max-width': 'min(500px, 90%)', 'object-fit': 'contain', 'align-self': 'flex-start', filter: 'drop-shadow(-2px 0px 0px $chroma-red) drop-shadow(2px 0px 0px $chroma-cyan)' }, small: { height: '84px' } },
          { type: 'text', when: [{ test: 'detail.logo', not: true }], text: '{detail.name}', role: 'heading', level: 1, motion: 'osd2', style: { 'font-family': print, 'font-size': '52px', 'line-height': '1.06', 'text-transform': 'uppercase', 'line-clamp': '3', 'text-shadow': '2px 0px 0px $chroma-cyan' }, small: { 'font-size': '30px' } },
          { type: 'use', template: 'velaEpisodeContext' },
          { type: 'text', text: '{detail.factsLine}', motion: 'osd3', style: { ...osdText('24px', '$ink-dim'), 'text-transform': 'none', 'letter-spacing': '0.02em' }, small: { 'font-size': '20px' } },
          { type: 'use', template: 'velaSummary', when: [{ test: 'detail.summary' }], motion: 'osd3', style: { 'font-size': '16px', 'line-height': '1.6', color: '$ink-dim', 'max-width': '40rem', 'text-shadow': '0px 1px 14px $shadow' }, small: { 'font-size': '14.5px' } },
          { type: 'text', when: [{ test: 'detail.crewLine' }], text: '{detail.crewLine}', motion: 'osd3', style: { 'font-family': print, 'font-size': '10.5px', 'letter-spacing': '0.12em', 'text-transform': 'uppercase', 'line-height': '1.7', color: '$ink-quiet' } },
          { type: 'box', motion: 'osd4', style: { display: 'flex', 'flex-direction': 'row', 'align-items': 'center', gap: '14px 14px', 'flex-wrap': 'wrap', 'margin-top': '8px' } as Style, children: [titlePlay, { type: 'widget', widget: 'titleActions' }] },
        ] },
      ] },
      // Seasons are channel buttons; the selected one is lit.
      { type: 'box', when: [{ test: 'detail.hasSeasons' }], role: 'tablist', label: '{s:seasons}', style: { position: 'relative', display: 'flex', 'flex-direction': 'row', gap: '6px 6px', 'flex-wrap': 'wrap', ...gutter, 'padding-bottom': '22px' } as Style, small: gutterSmall, children: [
        { type: 'repeat', over: 'detail.seasons', item: { type: 'box', press: { action: 'select', arg: '{season.pick}' }, label: '{card.name}', a11y: { role: 'tab', selected: [{ test: 'season.on' }] },
          style: { position: 'relative', display: 'flex', 'align-items': 'center', height: '38px', 'box-sizing': 'border-box', padding: '4px 14px 0px', 'border-radius': '3px', border: '2px solid $edge', 'background-color': '$glass', color: '$ink-dim', ...osdText('22px', '$ink-dim'), 'text-shadow': 'none', 'white-space': 'nowrap' },
          hover: { color: '$ink', 'border-color': '$ink' }, focus: { color: '$ink', 'border-color': '$ink', 'background-color': '$vcr-blue' }, children: [
            { type: 'text', text: '{card.name}' },
            { type: 'box', when: [{ test: 'season.on' }], style: { position: 'absolute', ...inset('-2px'), 'border-radius': '3px', border: '2px solid $osd', 'background-color': '$osd-plate', 'box-shadow': '0px 0px 12px $osd-glow' } },
            { type: 'text', when: [{ test: 'season.on' }], text: '{card.name}', style: { position: 'absolute', ...inset('0px'), display: 'flex', 'align-items': 'center', 'padding-left': '14px', 'padding-top': '4px', color: '$osd' } },
          ] } },
      ] },
      { type: 'box', when: [{ test: 'detail.hasEpisodes' }], style: { ...block, 'max-width': '64rem' } as Style, small: { ...gutterSmall, 'padding-bottom': '28px' }, children: [
        { type: 'repeat', over: 'detail.episodes', item: episode },
      ] },
      { type: 'box', when: [{ test: 'detail.hasExtras' }], style: block, small: gutterSmall, children: [
        sectionHead('{s:extras}'),
        { type: 'box', style: { display: 'flex', 'flex-direction': 'row', gap: '10px 10px', 'flex-wrap': 'wrap' } as Style, children: [
          { type: 'repeat', over: 'detail.extras', item: { type: 'box', when: [{ test: 'extra.ready' }], press: { action: 'playExtra', arg: '{extra.id}' }, label: '{extra.name}',
            style: { position: 'relative', display: 'flex', 'flex-direction': 'row', gap: '10px 10px', 'align-items': 'center', padding: '8px 14px 8px 10px', 'border-radius': '3px', 'background-color': '$label', color: '$ink-on-label', 'box-shadow': 'inset 6px 0px 0px $tape-red, 3px 3px 0px $shadow' },
            hover: { translate: '0px -2px' }, focus: { 'box-shadow': `inset 6px 0px 0px $tape-red, 0px 0px 0px 2px $ink, ${split(3)}` }, children: [
              { type: 'icon', symbol: 'play-fill', style: { width: '12px', height: '12px', 'margin-left': '6px' } },
              { type: 'text', text: '{extra.name}', style: { 'font-family': marker, 'font-size': '17px', 'line-height': '1.1' } },
            ] } },
        ] },
      ] },
      { type: 'box', when: [{ test: 'detail.hasCast' }], style: block, small: gutterSmall, children: [
        sectionHead('{s:cast}'),
        { type: 'box', style: { display: 'flex', 'flex-direction': 'row', gap: '18px 18px', 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none', padding: '8px 6px' }, children: [
          { type: 'repeat', over: 'detail.cast', limit: 24, item: { type: 'box', press: { action: 'person', arg: '{person.name}' }, label: '{person.name}', focus: { 'box-shadow': '0px 0px 0px 4px $ui.accent' },  style: { display: 'flex', 'flex-direction': 'column', gap: '8px 8px', width: '112px', 'flex-shrink': '0', padding: '6px 6px 10px', 'background-color': '$label', 'border-radius': '2px', rotate: '-1', 'box-shadow': '3px 4px 0px $shadow' }, children: [
            { type: 'box', style: { position: 'relative', width: '100%', 'aspect-ratio': '1 / 1', 'background-color': '$tape-shell', 'overflow-x': 'hidden', 'overflow-y': 'hidden' }, children: [
              { type: 'image', when: [{ test: 'person.portrait' }], src: '{person.portrait}', alt: '', fade: true, style: { position: 'absolute', ...inset('0px'), width: '100%', height: '100%', 'object-fit': 'cover' } },
              { type: 'text', when: [{ test: 'person.portrait', not: true }], text: '{person.initials}', style: { position: 'absolute', ...inset('0px'), display: 'flex', 'align-items': 'center', 'justify-content': 'center', ...osdText('34px', '$ink-dim'), 'text-shadow': 'none' } },
            ] },
            { type: 'text', text: '{person.name}', style: { 'font-family': marker, 'font-size': '14px', 'line-height': '1.1', color: '$ink-on-label', 'line-clamp': '2' } },
            { type: 'text', when: [{ test: 'person.role' }], text: '{person.role}', style: { 'font-size': '11px', color: '$ink-on-label', opacity: '0.7', 'line-clamp': '1' } },
          ] } },
        ] },
      ] },
      { type: 'repeat', over: 'detail.related', item: { type: 'use', template: 'row' } },
      { type: 'box', when: [{ test: 'detail.kind' }], style: { ...block, 'flex-direction': 'row', 'flex-wrap': 'wrap', gap: '8px 8px', 'padding-top': '10px', 'padding-bottom': '60px' } as Style, small: { ...gutterSmall, 'padding-bottom': '40px' }, children: [
        { type: 'repeat', over: 'detail.mediaFacts', item: { type: 'text', text: '{fact.text}', style: { ...osdText('17px', '$ink-quiet'), 'text-shadow': 'none', padding: '3px 8px 1px', border: '1px solid $edge', 'border-radius': '2px' } } },
      ] },
    ] },
  ] },
  // A band behind the back button, so scrolled content passes under it cleanly.
  { type: 'box', style: { position: 'absolute', top: bezel.normal, left: bezel.normal, right: bezel.normal, height: '110px', 'pointer-events': 'none', 'border-radius': `${radius.normal} ${radius.normal} 0px 0px`, 'background-image': 'linear-gradient(180deg, $scrim-solid 0%, $scrim-top 45%, $scrim-clear 100%)' },
    wide: { top: bezel.wide, left: bezel.wide, right: bezel.wide, 'border-radius': `${radius.wide} ${radius.wide} 0px 0px` }, small: { top: '0px', left: '0px', right: '0px', 'border-radius': '0px', height: '80px' } },
  // The same glass as the shell: the title is on the same set.
  glass,
  // Back: rewind out of the tape.
  { type: 'box', press: { action: 'back' }, label: '{s:back}', testId: 'detail-close', style: { position: 'absolute', top: 'calc(30px + env(safe-area-inset-top))', left: 'calc(12px + max(30px, 3.6vw))', 'z-index': '10', display: 'flex', 'flex-direction': 'row', gap: '8px 8px', 'align-items': 'center', height: '42px', 'box-sizing': 'border-box', padding: '4px 14px 0px 12px', 'border-radius': '4px', border: '2px solid $edge-strong', 'background-color': '$osd-plate', ...osdText('24px', '$ink'), 'text-shadow': 'none', 'box-shadow': '3px 3px 0px $shadow' },
    hover: { 'border-color': '$ink' }, focus: { 'border-color': '$ink', 'background-color': '$vcr-blue' }, wide: { top: 'calc(36px + env(safe-area-inset-top))', left: 'calc(18px + max(30px, 3.6vw))' }, small: { left: '14px', top: 'calc(12px + env(safe-area-inset-top))' }, children: [
      { type: 'text', text: '◀◀', style: { color: '$osd' } },
      { type: 'text', text: '{s:back}' },
    ] },
] };

// Motion. `still` is what plays under reduced motion: a plain fade, or nothing.
const fadeStill = { keyframes: 'dissolve', duration: 200 };
const osdIn = (delay: number) => ({ keyframes: 'dissolve', duration: 240, delay, easing: 'steps(3, jump-end)', fill: 'both' as const, still: fadeStill });

export default {
  schema: 1, renderer: 18, id, name: 'Late Night', version,
  tagline: 'Your library on an old TV set: channel flips, tape labels and a glowing on-screen display.',
  preview: asset('preview.svg'), swatches: ['#07080b', '#f3eee0', '#7dffa1', '#e8452c', '#f4cf3a'],
  // Late Night's dark set, OSD green and the VCR's blue menus, for the routes it inherits (search, library, collection, sign-in).
  ui: {
    page: '#07080b', raised: '#16171b', ink: '#f3eee0', inkSecondary: 'rgba(243, 238, 224, 0.72)',
    inkQuiet: 'rgba(243, 238, 224, 0.5)', inkInverse: '#15120d', inkHover: '#ffffff', accent: '#7dffa1',
    onAccent: '#07080b', control: 'rgba(255, 255, 255, 0.06)', controlHover: 'rgba(255, 255, 255, 0.13)',
    glass: 'rgba(4, 6, 8, 0.82)', glassEdge: 'rgba(243, 238, 224, 0.22)',
    glassEdgeStrong: 'rgba(243, 238, 224, 0.55)', popover: 'rgba(18, 36, 168, 0.96)',
    scrim: 'rgba(7, 8, 11, 0.78)', track: 'rgba(243, 238, 224, 0.22)',
    trackStrong: 'rgba(243, 238, 224, 0.55)', focusHalo: 'rgba(125, 255, 161, 0.35)',
    shadow: 'rgba(0, 0, 0, 0.75)', skeleton: 'rgba(255, 255, 255, 0.06)',
    skeletonLight: 'rgba(255, 255, 255, 0.13)', alert: 'rgba(232, 69, 44, 0.16)', live: '#ff4b3e',
    font: 'system-ui, -apple-system, "Segoe UI Variable", "Segoe UI", Roboto, sans-serif',
    fontDisplay: '"Late Night Print", "Michroma", "Eurostile", "Microgramma", system-ui, sans-serif',
    radiusControl: 3, radiusCard: 4, radiusPanel: 4,
  },
  tokens: {
    page: '#07080b', raised: '#16171b', bezel: '#0d0d0f', 'bezel-lip': 'rgba(255, 255, 255, 0.06)',
    ink: '#f3eee0', 'ink-bright': '#ffffff', 'ink-dim': 'rgba(243, 238, 224, 0.72)', 'ink-quiet': 'rgba(243, 238, 224, 0.5)', 'ink-on-label': '#15120d',
    osd: '#7dffa1', 'osd-glow': 'rgba(125, 255, 161, 0.35)', 'osd-plate': 'rgba(4, 6, 8, 0.82)', rec: '#ff4b3e',
    'vcr-blue': '#1d33c9', 'vcr-menu': 'rgba(18, 36, 168, 0.96)',
    'tape-red': '#e8452c', 'tape-orange': '#f59a23', 'tape-yellow': '#f4cf3a', label: '#efe7d2', 'tape-shell': '#1b1b1f', 'tape-shell-deep': '#0b0b0d',
    'chroma-red': 'rgba(255, 46, 99, 0.75)', 'chroma-cyan': 'rgba(34, 225, 238, 0.75)',
    glass: 'rgba(255, 255, 255, 0.06)', 'glass-hi': 'rgba(255, 255, 255, 0.13)', edge: 'rgba(243, 238, 224, 0.22)', 'edge-strong': 'rgba(243, 238, 224, 0.55)', hairline: 'rgba(255, 255, 255, 0.08)',
    shadow: 'rgba(0, 0, 0, 0.75)', scanline: 'rgba(0, 0, 0, 0.32)', vignette: 'rgba(0, 0, 0, 0.62)', 'vignette-edge': 'rgba(0, 0, 0, 0.5)', 'corner-shade': 'rgba(0, 0, 0, 0.38)', sheen: 'rgba(255, 255, 255, 0.05)', band: 'rgba(230, 240, 255, 0.10)',
    'snow-ground': '#2a2c30', flash: 'rgba(235, 245, 255, 0.95)', 'flash-edge': 'rgba(200, 220, 255, 0.35)',
    'scrim-solid': 'rgba(7, 8, 11, 0.97)', 'scrim-top': 'rgba(7, 8, 11, 0.86)', 'scrim-deep': 'rgba(7, 8, 11, 0.9)', 'scrim-mid': 'rgba(7, 8, 11, 0.55)', 'scrim-strong': 'rgba(7, 8, 11, 0.78)', 'scrim-clear': 'rgba(7, 8, 11, 0)',
  },
  strings: { en: {
    velaHome: 'Vela home', home: 'Home', search: 'Search', profile: 'Profile and appearance', menu: 'Profile menu', menuTitle: 'Setup menu', more: 'More', moreChannels: 'More channels', moreTitle: 'More channels',
    appearance: 'Appearance', skinName: 'Late Night', install: 'Install Vela', update: 'Update ready, reload', signOut: 'Sign out',
    moreInfo: 'Info', play: 'Play', featured: 'Featured titles', presets: 'Preset', watched: 'Watched', live: 'Live', liveTv: 'Live TV', tunedTo: 'Tuned channel',
    back: 'Back', opening: 'Searching', noSignal: 'No signal', failed: 'This title could not be opened. Try again in a moment.', seasons: 'Seasons', extras: 'Extras', cast: 'Cast', retry: 'Try again',
  } },
  fonts: {
    osd: { family: 'Late Night OSD', sizeAdjust: 112, files: [{ url: asset('vt323.ttf'), weight: 400, style: 'normal' }] },
    print: { family: 'Late Night Print', sizeAdjust: 92, files: [{ url: asset('michroma.ttf'), weight: 400, style: 'normal' }] },
    marker: { family: 'Late Night Marker', files: [{ url: asset('permanent-marker.ttf'), weight: 400, style: 'normal' }] },
  },
  motion: {
    navIn: { keyframes: 'dissolve', duration: 420, delay: 380, easing: 'steps(4, jump-end)', fill: 'both', still: fadeStill },
    pop: { keyframes: 'dissolve', duration: 160, easing: 'steps(2, jump-end)', still: { keyframes: 'dissolve', duration: 120 } },
    // Section change: snow for a moment, then the channel number shows and fades.
    flip: { keyframes: 'vanish', duration: 420, easing: 'steps(5, jump-end)', fill: 'both' },
    bugOut: { keyframes: 'vanish', duration: 2600, easing: 'linear(0, 0 72%, 1)', fill: 'both' },
    // The featured picture tunes in (and its snow clears) whenever the title changes.
    tuneIn: { keyframes: 'dissolve', duration: 300, easing: 'steps(3, jump-end)', fill: 'both', still: { keyframes: 'dissolve', duration: 300 } },
    tune: { keyframes: 'vanish', duration: 340, easing: 'steps(4, jump-end)', fill: 'both' },
    osd1: osdIn(260), osd2: osdIn(330), osd3: osdIn(400), osd4: osdIn(470),
    blink: { keyframes: 'breathe', duration: 900, easing: 'steps(2, jump-none)', iterations: 'infinite', still: { keyframes: 'none', duration: 0 } },
    presetFill: { keyframes: 'fill', duration: 9000, easing: 'linear', still: { keyframes: 'none', duration: 0 } },
    rowFlip: { keyframes: 'vanish', duration: 300, delay: 480, easing: 'steps(4, jump-end)', fill: 'both' },
    // Power on, once: a flash opens from the centre, then the screen clears.
    tvOn: { keyframes: 'tvOn', duration: 360, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'both' },
    warmUp: { keyframes: 'vanish', duration: 420, delay: 300, easing: 'steps(4, jump-end)', fill: 'both' },
    // The picture judders for half a second about every 23 s, like a worn tape.
    judder: { keyframes: 'jitter', duration: 23000, delay: 9000, easing: 'linear(0, 0 97.8%, 1)', iterations: 'infinite', fill: 'both', still: { keyframes: 'none', duration: 0 } },
    // A tracking band rolls down about every 19 s, for under two seconds.
    tracking: { keyframes: 'scan', duration: 19000, delay: 6000, easing: 'linear(0, 0 91%, 1)', iterations: 'infinite', fill: 'both' },
  },
  templates: { card, rankedCard, row },
  slots: { shell, home },
  routes: { title: episodePage(title) },
  detail: { wide: 'fullscreen', small: 'fullscreen' },
} satisfies SkinDocument;

// Broadcast: a live-first skin document (protocol/v0/skin.ts). Home IS live TV: an always-on
// monitor of the current or last channel (the foundation's one preview tile), what is on now
// across the lineup, favourites beside the monitor, the full guide one step away, and movies
// and shows below. The look is a broadcast graphics package: live bug, channel ident,
// two-tier lower-thirds and a station clock, on a studio-black ground.
import type { BoxNode, Node, SkinDocument, Style } from '../../../skin';

type Press = NonNullable<BoxNode['press']>;

const ASSETS = '/vela/v0/appearance/skins/broadcast/1.0.1';
const display = '"Barlow Condensed", "Avenir Next Condensed", "Roboto Condensed", "Arial Narrow", sans-serif';
const sans = 'system-ui, -apple-system, "Segoe UI Variable", "Segoe UI", Roboto, sans-serif';
const gutter = { 'padding-left': 'clamp(20px, 2.4vw, 48px)', 'padding-right': 'clamp(20px, 2.4vw, 48px)' } as Style;
const gutterSmall = { 'padding-left': '16px', 'padding-right': '16px' } as Style;
const clip = { 'overflow-x': 'hidden', 'overflow-y': 'hidden' } as Style;
const row = (gap: string, extra: Style = {}): Style => ({ display: 'flex', 'flex-direction': 'row', 'align-items': 'center', gap, ...extra } as Style);
const col = (gap: string, extra: Style = {}): Style => ({ display: 'flex', 'flex-direction': 'column', gap, ...extra } as Style);
/** Condensed caps, the package's label voice. */
/** The package's selection: an amber ring, for keyboards and remotes (focus-visible only). */
const ring: Style = { 'box-shadow': '0px 0px 0px 2px $cue' } as Style;
const caps = (size: string, extra: Style = {}): Style => ({ 'font-family': display, 'font-size': size, 'font-weight': '650', 'letter-spacing': '0.08em', 'text-transform': 'uppercase', 'line-height': '1', ...extra } as Style);

// ---------------------------------------------------------------- shell

const tab = (label: string, press: Press, on: Node['when']): Node => ({
  type: 'box', group: true, press, label, style: { position: 'relative', ...row('8px'), height: '64px', padding: '0px 14px', color: '$ink2', ...caps('16px', { 'letter-spacing': '0.06em' }), 'white-space': 'nowrap', transition: 'color 160ms linear' },
  hover: { color: '$ink' }, focus: { color: '$ink', 'background-color': '$panel' }, small: { height: '44px', padding: '0px 12px', 'font-size': '15px' },
  children: [
    { type: 'text', text: label },
    { type: 'box', when: on, style: { position: 'absolute', left: '14px', right: '14px', bottom: '0px', height: '3px', 'background-color': '$signal' }, small: { left: '12px', right: '12px' } },
  ],
});
const homeTab = tab('{s:live}', { action: 'home' }, [{ test: 'env.section', is: 'eq', value: 'home' }]);
const guideTab: Node = { ...tab('{s:guide}', { action: 'live' }, [{ test: 'env.section', is: 'eq', value: 'live' }]), when: [{ test: 'env.canLive' }] };
const destTab: Node = { type: 'repeat', over: 'nav.destinations', when: [{ test: 'dest.kind', is: 'ne', value: 'live' }], item: tab('{dest.name}', { action: 'library', arg: '{dest.id}' }, [{ test: 'dest.on' }]) };

/** The station clock: the guide's minute clock, tabular, with an on-air lamp. */
const clock: Node = { type: 'box', when: [{ test: 'env.clock' }], role: 'timer', label: '{s:clockLabel}', style: { ...row('10px'), height: '36px', padding: '0px 14px', 'background-color': '$panel', 'border-radius': '3px', 'flex-shrink': '0' } as Style,
  small: { display: 'none' }, children: [
    { type: 'box', motion: 'lamp', style: { width: '7px', height: '7px', 'border-radius': '4px', 'background-color': '$signal', 'box-shadow': '0px 0px 10px $signal' } },
    { type: 'text', text: '{env.clock}', style: { 'font-family': display, 'font-size': '20px', 'font-weight': '600', 'font-variant-numeric': 'tabular-nums', 'letter-spacing': '0.02em', color: '$ink' } },
  ] };

const iconButton = (action: 'search', label: string, symbol: string): Node => ({ type: 'box', press: { action }, label, style: { position: 'relative', width: '40px', height: '40px', 'box-sizing': 'border-box', padding: '11px', 'border-radius': '3px', 'background-color': '$panel', color: '$ink', 'flex-shrink': '0' },
  hover: { 'background-color': '$panel-hi' }, focus: ring, children: [{ type: 'icon', symbol, style: { width: '18px', height: '18px' } }] });

const menuItem = (press: Press, label: string, kids: Node[]): Node => ({ type: 'box', press, label, style: { position: 'relative', ...row('12px'), padding: '10px 12px', margin: '0px -12px', 'border-radius': '3px', 'font-size': '14px', color: '$ink' }, hover: { 'background-color': '$panel-hi' }, focus: { 'background-color': '$panel-hi', ...ring }, children: kids });

const shell: Node = { type: 'box', style: { display: 'flex', 'flex-direction': 'column', height: '100%', 'min-height': '0px', 'background-color': '$ground', color: '$ink', 'font-family': sans }, children: [
  { type: 'box', role: 'navigation', when: [{ test: 'env.viewer' }], style: { position: 'relative', 'z-index': '20', ...col('0px'), 'background-color': '$ground', 'box-shadow': '0px 1px 0px $line' }, children: [
    { type: 'box', style: { ...row('6px'), height: '64px', ...gutter }, small: { height: '52px', ...gutterSmall, gap: '8px' }, children: [
      { type: 'box', press: { action: 'home' }, label: '{s:velaHome}', style: { position: 'relative', ...row('0px'), 'margin-right': '26px', 'flex-shrink': '0' }, small: { 'margin-right': '0px' }, children: [
        { type: 'image', src: 'assets/brand/vela-lockup.svg', alt: '', style: { width: '74px', height: '28px' }, small: { width: '58px', height: '22px' } },
      ] },
      { type: 'box', style: { ...row('0px'), flex: '1', 'min-width': '0px', 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none' }, small: { display: 'none' }, children: [homeTab, guideTab, destTab] },
      { type: 'box', style: { display: 'none' }, small: { display: 'flex', flex: '1' } },
      clock,
      iconButton('search', '{s:search}', 'search'),
      { type: 'box', press: { action: 'toggle', arg: 'menu' }, label: '{s:profile}', testId: 'profile-menu', style: { position: 'relative', width: '40px', height: '40px', 'border-radius': '3px', 'background-color': '$panel', display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'flex-shrink': '0' },
        hover: { 'background-color': '$panel-hi' }, focus: ring, children: [
          // The viewer's badge fills the button, so their avatar (where there is one) is the button's face.
          { type: 'text', text: '{env.viewerInitial}', style: { width: '40px', height: '40px', 'border-radius': '3px', display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'font-family': display, 'font-size': '18px', 'font-weight': '700', color: '$ink' } },
        ] },
    ] },
    // Phones: the sections as a scrolling strip under the bar.
    { type: 'box', style: { display: 'none' }, small: { ...row('0px'), 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none', 'padding-left': '4px', 'padding-right': '4px', 'box-shadow': '0px -1px 0px $line' }, children: [homeTab, guideTab, destTab] },
  ] },
  { type: 'slot', slot: 'children', style: { display: 'flex', 'flex-direction': 'column', flex: '1', 'min-height': '0px' }, inner: { display: 'flex', 'flex-direction': 'column', 'flex-grow': '1', 'min-height': '0px', height: '100%', width: '100%' } as Style },
  { type: 'box', when: [{ test: 'env.viewer' }, { test: 'flag:menu' }], motion: 'drop', style: { position: 'absolute', top: '70px', right: 'clamp(20px, 2.4vw, 48px)', 'z-index': '30', width: '272px', 'box-sizing': 'border-box', padding: '18px 22px', ...col('6px'), 'border-radius': '4px', 'background-color': '$panel', 'box-shadow': '0px 24px 60px rgba(0, 0, 0, 0.6), inset 0px 3px 0px $signal' } as Style,
    small: { top: '102px', right: '12px' }, children: [
      { type: 'box', style: { ...row('12px'), 'padding-bottom': '10px' }, children: [
        { type: 'text', text: '{env.viewerInitial}', style: { width: '36px', height: '36px', 'border-radius': '3px', display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'font-family': display, 'font-size': '18px', 'font-weight': '700', 'background-color': '$signal', color: '$ink' } },
        { type: 'text', text: '{env.viewer}', style: { 'font-size': '15px', 'font-weight': '600', flex: '1', 'line-clamp': '1' } },
      ] },
      menuItem({ action: 'openPicker' }, '{s:appearance}', [
        { type: 'box', style: col('3px', { flex: '1' }), children: [
          { type: 'text', text: '{s:appearance}', style: { ...caps('11px', { 'letter-spacing': '0.18em' }), color: '$ink3' } },
          { type: 'text', text: '{s:skinName}', style: { 'font-size': '14px' } },
        ] },
        { type: 'icon', symbol: 'forward-chevron', style: { width: '12px', height: '12px', color: '$ink3' } },
      ]),
      { type: 'widget', widget: 'install', params: { action: 'install', label: '{s:install}' } },
      { type: 'widget', widget: 'install', params: { action: 'update', label: '{s:update}' } },
      menuItem({ action: 'signOut' }, '{s:signOut}', [
        { type: 'icon', symbol: 'sign-out', style: { width: '16px', height: '16px' } },
        { type: 'text', text: '{s:signOut}' },
      ]),
    ] },
] };

// ---------------------------------------------------------------- the monitor

const lamp = (size: number): Node => ({ type: 'box', motion: 'lamp', style: { width: `${size}px`, height: `${size}px`, 'border-radius': `${size}px`, 'background-color': '$ink', 'flex-shrink': '0' } });
/** The live bug, top left of the picture. */
const liveBug: Node = { type: 'box', style: { ...row('7px'), height: '26px', padding: '0px 10px 0px 9px', 'border-radius': '2px', 'background-color': '$signal', color: '$ink', 'box-shadow': '0px 2px 12px rgba(0, 0, 0, 0.35)' },
  children: [lamp(7), { type: 'text', text: '{s:liveBug}', style: caps('15px', { 'letter-spacing': '0.12em', 'font-weight': '700' }) }] };
/** The channel ident, top right: the logo on a smoked plate, or the number. */
const ident: Node = { type: 'box', style: { ...row('8px'), height: '34px', padding: '0px 10px', 'border-radius': '2px', 'background-color': 'rgba(7, 9, 13, 0.55)', 'backdrop-filter': 'blur(8px)', opacity: '0.92' }, small: { height: '28px' }, children: [
  { type: 'text', text: '{tile.channelNumber}', style: { 'font-family': display, 'font-size': '18px', 'font-weight': '700', 'font-variant-numeric': 'tabular-nums', color: '$ink' } },
  { type: 'image', when: [{ test: 'tile.logo' }], src: '{tile.logo}', alt: '', style: { height: '22px', width: '64px', 'object-fit': 'contain' }, small: { height: '18px', width: '52px' } },
] };

/** The two-tier lower-third: number tab and programme on the white bar, time and next on the dark one. */
const lowerThird: Node = { type: 'box', when: [{ test: 'tile.channelId' }, { test: 'tile.zapping', not: true }], motion: 'wipe', style: { position: 'absolute', left: '24px', right: '24px', bottom: '22px', ...col('0px'), 'align-items': 'flex-start', 'pointer-events': 'none', 'max-width': '760px' } as Style,
  small: { left: '10px', right: '10px', bottom: '10px' }, children: [
    { type: 'box', style: { ...row('0px', { 'align-items': 'stretch' }), 'max-width': '100%', 'box-shadow': '0px 10px 30px rgba(0, 0, 0, 0.4)' }, children: [
      { type: 'box', style: { ...row('0px'), 'justify-content': 'center', 'min-width': '64px', padding: '0px 12px', 'background-color': '$signal' }, small: { 'min-width': '48px', padding: '0px 8px' }, children: [
        { type: 'text', text: '{tile.channelNumber}', style: { 'font-family': display, 'font-size': '30px', 'font-weight': '700', 'font-variant-numeric': 'tabular-nums', color: '$ink', 'line-height': '1' }, small: { 'font-size': '20px' } },
      ] },
      { type: 'box', style: { ...col('2px'), 'min-width': '0px', padding: '9px 18px 8px 16px', 'background-color': '$paper', color: '$paper-ink' }, small: { padding: '6px 10px 5px 10px' }, children: [
        { type: 'text', when: [{ test: 'tile.now', not: true }], text: '{tile.channelName}', role: 'heading', level: 2, style: { 'font-family': display, 'font-size': '30px', 'font-weight': '700', 'line-height': '1.05', 'line-clamp': '1', 'letter-spacing': '0.005em' }, small: { 'font-size': '19px' } },
        { type: 'text', when: [{ test: 'tile.now' }], text: '{tile.now}', role: 'heading', level: 2, style: { 'font-family': display, 'font-size': '30px', 'font-weight': '700', 'line-height': '1.05', 'line-clamp': '1', 'letter-spacing': '0.005em' }, small: { 'font-size': '19px' } },
        { type: 'text', when: [{ test: 'tile.nowEpisode' }], text: '{tile.nowEpisode}', style: { 'font-size': '14px', 'font-weight': '600', 'line-clamp': '1', color: '$paper-ink2' }, small: { display: 'none' } },
      ] },
    ] },
    { type: 'box', style: { ...row('14px'), 'max-width': '100%', 'box-sizing': 'border-box', padding: '0px 16px 0px 14px', height: '32px', 'background-color': 'rgba(10, 13, 19, 0.88)', 'backdrop-filter': 'blur(10px)', color: '$ink2', 'font-size': '13px', 'font-variant-numeric': 'tabular-nums', 'white-space': 'nowrap' },
      small: { height: '26px', gap: '10px', padding: '0px 10px', 'font-size': '12px' }, children: [
        { type: 'text', when: [{ test: 'tile.now' }], text: '{tile.channelName}', style: { ...caps('14px'), color: '$ink', 'line-clamp': '1' }, small: { display: 'none' } },
        { type: 'text', when: [{ test: 'tile.now', not: true }], text: '{s:noListing}', style: { color: '$ink2' } },
        { type: 'box', when: [{ test: 'tile.now' }], style: { width: '96px', height: '3px', 'background-color': 'rgba(255, 255, 255, 0.18)', 'flex-shrink': '0', ...clip }, small: { width: '56px' }, children: [
          { type: 'box', style: { height: '3px', width: '{tile.nowProgress}%', 'background-color': '$signal' } },
        ] },
        { type: 'text', when: [{ test: 'tile.nowRemaining' }], text: '{tile.nowRemaining}', style: { color: '$ink2' } },
        { type: 'box', when: [{ test: 'tile.next' }], style: { ...row('8px'), 'min-width': '0px' }, children: [
          { type: 'text', text: '{s:next}', style: { ...caps('12px', { 'letter-spacing': '0.14em' }), color: '$cue' } },
          { type: 'text', text: '{tile.next}', style: { color: '$ink', 'line-clamp': '1' } },
        ] },
      ] },
  ] };

/** Honest tile states over the standby card: waiting for the viewer, tuning, or no picture. */
const tuneIn: Node = { type: 'box', when: [{ test: 'tile.state', is: 'eq', value: 'tune-in' }], press: { action: 'tuneIn' }, label: '{s:tuneInTo}', testId: 'broadcast-tune-in',
  style: { position: 'absolute', inset: '0px', ...col('14px'), 'align-items': 'center', 'justify-content': 'center', color: '$ink' }, small: { 'justify-content': 'flex-start', 'padding-top': '44px' }, focus: { 'box-shadow': 'inset 0px 0px 0px 3px $cue' }, children: [
    { type: 'box', style: { width: '72px', height: '72px', 'border-radius': '36px', 'background-color': '$signal', display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'box-shadow': '0px 12px 40px rgba(255, 61, 46, 0.35)' }, small: { width: '56px', height: '56px' }, children: [
      { type: 'icon', symbol: 'play-fill', style: { width: '26px', height: '26px', color: '$ink', 'margin-left': '4px' } },
    ] },
    { type: 'text', text: '{s:tuneInTo}', style: caps('20px'), small: { display: 'none' } },
  ] };
const tuning: Node = { type: 'box', when: [{ test: 'tile.state', is: 'eq', value: 'connecting' }], role: 'status', label: '{s:tuning}', style: { position: 'absolute', top: '0px', left: '0px', right: '0px', bottom: '0px', ...col('12px'), 'align-items': 'center', 'justify-content': 'center', 'pointer-events': 'none' }, children: [
  { type: 'box', style: { width: '160px', height: '3px', 'background-color': 'rgba(255, 255, 255, 0.12)', ...clip }, children: [
    { type: 'box', motion: 'sweep', style: { width: '40%', height: '3px', 'background-color': '$signal' } },
  ] },
  { type: 'text', text: '{s:tuning}', style: { ...caps('15px', { 'letter-spacing': '0.16em' }), color: '$ink2' } },
] };
const noPicture: Node = { type: 'box', when: [{ test: 'tile.state', is: 'eq', value: 'unavailable' }], role: 'status', label: '{s:noPicture}', style: { position: 'absolute', inset: '0px', ...col('8px'), 'align-items': 'center', 'justify-content': 'center', 'pointer-events': 'none', 'text-align': 'center', padding: '24px' }, children: [
  { type: 'text', text: '{s:noPicture}', style: { ...caps('22px'), color: '$ink' } },
  { type: 'text', text: '{s:noPictureHint}', style: { 'font-size': '14px', color: '$ink2' } },
] };

const monitor: Node = { type: 'box', role: 'region', label: '{s:monitor}', testId: 'broadcast-monitor', style: { position: 'relative', width: '100%', 'aspect-ratio': '16 / 9', 'background-color': '#000000', 'border-radius': '4px', ...clip, 'box-shadow': '0px 0px 0px 1px $line, 0px 30px 80px -30px rgba(0, 0, 0, 0.9)' },
  small: { 'border-radius': '0px' }, children: [
    { type: 'widget', widget: 'liveTile', style: { position: 'absolute', inset: '0px' } },
    { type: 'image', when: [{ test: 'tile.state', is: 'ne', value: 'playing' }, { test: 'tile.nowArt' }], src: '{tile.nowArt}', alt: '', fade: true, style: { position: 'absolute', inset: '0px', width: '100%', height: '100%', 'object-fit': 'cover', opacity: '0.35', filter: 'saturate(0.6)' } },
    { type: 'image', when: [{ test: 'tile.state', is: 'ne', value: 'playing' }, { test: 'tile.nowArt', not: true }], src: `${ASSETS}/standby.svg`, alt: '', style: { position: 'absolute', inset: '0px', width: '100%', height: '100%', 'object-fit': 'cover' } },
    // Over the picture: the whole frame opens full-screen watch once there is a picture.
    { type: 'box', when: [{ test: 'tile.state', is: 'eq', value: 'playing' }], press: { action: 'watch', arg: '{tile.channelId}' }, label: '{s:watchTuned}', testId: 'broadcast-monitor-watch', style: { position: 'absolute', inset: '0px', cursor: 'pointer' }, focus: { 'box-shadow': 'inset 0px 0px 0px 3px $cue' } },
    { type: 'box', style: { position: 'absolute', left: '0px', right: '0px', bottom: '0px', height: '42%', 'pointer-events': 'none', 'background-image': 'linear-gradient(0deg, rgba(0, 0, 0, 0.62) 0%, rgba(0, 0, 0, 0) 100%)' } },
    tuneIn, tuning, noPicture,
    { type: 'box', when: [{ test: 'tile.channelId' }], style: { position: 'absolute', top: '18px', left: '18px', right: '18px', ...row('12px'), 'justify-content': 'space-between', 'pointer-events': 'none' }, small: { top: '10px', left: '10px', right: '10px' }, children: [
      { type: 'box', when: [{ test: 'tile.state', is: 'eq', value: 'playing' }], style: { display: 'flex' }, children: [liveBug] },
      { type: 'box', style: { flex: '1' } },
      { type: 'box', when: [{ test: 'tile.zapping', not: true }], style: { display: 'flex' }, children: [ident] },
    ] },
    // Flicking: the number being dialled, large, until the monitor retunes.
    { type: 'text', when: [{ test: 'tile.zapping' }], text: '{tile.zapping}', role: 'status', style: { position: 'absolute', top: '14px', right: '22px', 'font-family': display, 'font-size': '72px', 'font-weight': '700', 'line-height': '1', 'font-variant-numeric': 'tabular-nums', color: '$ink', 'text-shadow': '0px 2px 18px rgba(0, 0, 0, 0.7)', 'pointer-events': 'none' }, small: { 'font-size': '44px', top: '8px', right: '12px' } },
    lowerThird,
  ] };

const control = (press: Press, label: string, kids: Node[], primary = false, when?: Node['when']): Node => ({ type: 'box', press, label, when,
  style: { position: 'relative', ...row('9px'), height: '44px', 'box-sizing': 'border-box', padding: '0px 16px', 'border-radius': '3px', 'flex-shrink': '0', 'background-color': primary ? '$ink' : '$panel', color: primary ? '$ground' : '$ink', ...caps('16px', { 'letter-spacing': '0.06em' }), transition: 'background-color 140ms linear' },
  hover: { 'background-color': primary ? '#ffffff' : '$panel-hi' }, focus: ring, small: { height: '40px', padding: '0px 12px', 'font-size': '14px' }, children: kids });
const chButton = (step: string, label: string, glyph: string): Node => control({ action: 'zap', arg: step }, label, [
  { type: 'text', text: '{s:ch}', style: { color: '$ink3' } },
  { type: 'text', text: glyph, style: { 'font-size': '13px', 'line-height': '1' } },
]);

const controls: Node = { type: 'box', role: 'toolbar', label: '{s:monitorControls}', style: { ...row('8px'), 'flex-wrap': 'wrap' }, small: { ...gutterSmall, gap: '6px' }, children: [
  chButton('-1', '{s:channelUp}', '▲'),
  chButton('1', '{s:channelDown}', '▼'),
  control({ action: 'watch', arg: '{tile.channelId}' }, '{s:watchTuned}', [
    { type: 'icon', symbol: 'play-fill', style: { width: '14px', height: '14px' } },
    { type: 'text', text: '{s:watch}' },
  ], true, [{ test: 'tile.channelId' }]),
  control({ action: 'unmute' }, '{s:unmute}', [{ type: 'icon', symbol: 'speaker-mute', style: { width: '16px', height: '16px' } }, { type: 'text', text: '{s:sound}', small: { display: 'none' } }], false, [{ test: 'tile.state', is: 'eq', value: 'playing' }, { test: 'tile.muted' }]),
  control({ action: 'unmute' }, '{s:mute}', [{ type: 'icon', symbol: 'speaker', style: { width: '16px', height: '16px' } }, { type: 'text', text: '{s:sound}', small: { display: 'none' } }], false, [{ test: 'tile.state', is: 'eq', value: 'playing' }, { test: 'tile.muted', not: true }]),
  { type: 'box', style: { flex: '1' } },
  control({ action: 'guide' }, '{s:fullGuide}', [
    { type: 'icon', symbol: 'calendar', style: { width: '15px', height: '15px' } },
    { type: 'text', text: '{s:fullGuide}' },
  ]),
] };

// ---------------------------------------------------------------- favourites beside the monitor

/** One channel in the favourites stack: pressing it puts it on the monitor. */
const stackRow: Node = { type: 'box', group: true, press: { action: 'preview', arg: '{ch.id}' }, label: '{s:previewChannel}', testId: 'broadcast-fav-{ch.id}',
  style: { position: 'relative', ...row('12px'), padding: '10px 16px 10px 14px', 'box-shadow': 'inset 0px -1px 0px $line', 'flex-shrink': '0', transition: 'background-color 120ms linear' },
  hover: { 'background-color': '$panel-hi' }, focus: { 'background-color': '$panel-hi', 'box-shadow': 'inset 0px 0px 0px 2px $cue' },
  small: { width: '232px', 'border-radius': '3px', 'background-color': '$panel', 'box-shadow': 'none', padding: '10px 12px' }, children: [
    { type: 'box', when: [{ test: 'ch.tuned' }], style: { position: 'absolute', top: '0px', bottom: '0px', left: '0px', width: '3px', 'background-color': '$signal' } },
    { type: 'text', text: '{ch.number}', style: { width: '52px', 'white-space': 'nowrap', 'flex-shrink': '0', 'font-family': display, 'font-size': '22px', 'font-weight': '700', 'font-variant-numeric': 'tabular-nums', color: '$ink2' }, small: { width: '44px', 'font-size': '19px' } },
    { type: 'box', style: { width: '52px', height: '34px', 'flex-shrink': '0', 'border-radius': '2px', 'background-color': '$plate', display: 'flex', 'align-items': 'center', 'justify-content': 'center', ...clip }, children: [
      { type: 'image', when: [{ test: 'ch.logo' }], src: '{ch.logo}', alt: '', style: { width: '44px', height: '26px', 'object-fit': 'contain' } },
      { type: 'text', when: [{ test: 'ch.logo', not: true }], text: '{ch.name}', style: { ...caps('10px'), color: '$ink3', 'line-clamp': '2', 'text-align': 'center', padding: '0px 4px' } },
    ] },
    { type: 'box', style: col('5px', { flex: '1', 'min-width': '0px' }), children: [
      { type: 'text', when: [{ test: 'ch.now' }], text: '{ch.now}', style: { 'font-size': '14px', 'font-weight': '600', 'line-clamp': '1', color: '$ink' } },
      { type: 'text', when: [{ test: 'ch.now', not: true }], text: '{ch.name}', style: { 'font-size': '14px', 'font-weight': '600', 'line-clamp': '1', color: '$ink2' } },
      { type: 'box', style: { height: '2px', 'background-color': 'rgba(255, 255, 255, 0.12)', ...clip }, children: [
        { type: 'box', style: { height: '2px', width: '{ch.nowProgress}%', 'background-color': '$ink2' }, groupHover: { 'background-color': '$signal' } },
      ] },
      { type: 'text', text: '{ch.nowRemaining}', style: { 'font-size': '12px', color: '$ink3', 'line-clamp': '1', 'font-variant-numeric': 'tabular-nums' } },
    ] },
  ] };

const stackHeader = (title: string, count: string): Node => ({ type: 'box', style: { ...row('10px'), padding: '14px 16px 12px 16px', 'box-shadow': 'inset 0px -1px 0px $line' }, small: { padding: '18px 16px 10px 16px', 'box-shadow': 'none' }, children: [
  { type: 'icon', symbol: 'star-fill', style: { width: '14px', height: '14px', color: '$cue' } },
  { type: 'text', text: title, role: 'heading', level: 2, style: { ...caps('17px'), flex: '1', color: '$ink' } },
  { type: 'text', text: count, style: { 'font-family': display, 'font-size': '15px', 'font-weight': '600', 'font-variant-numeric': 'tabular-nums', color: '$ink3' } },
] });

const panelWidth = 'clamp(320px, 26vw, 520px)';
const gutterWidth = 'clamp(20px, 2.4vw, 48px)';
const channelList = (over: 'live.favorites' | 'live.channels', limit?: number): Node => ({ type: 'box', style: { ...col('0px'), flex: '1', 'min-height': '0px', 'overflow-y': 'auto', 'overflow-x': 'hidden', 'scrollbar-width': 'thin' },
  small: { 'flex-direction': 'row', gap: '8px', 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none', ...gutterSmall, 'padding-bottom': '4px' }, children: [
    { type: 'repeat', over, limit, item: stackRow },
  ] });
/** Beside the monitor and as tall as it with its controls: absolutely placed, so the list's length never sets the stage's height. */
const favourites: Node = { type: 'box', when: [{ test: 'env.liveReady' }], role: 'region', label: '{s:favourites}',
  style: { position: 'absolute', top: '4px', bottom: '0px', right: gutterWidth, width: panelWidth, ...col('0px'), 'background-color': '$panel', 'border-radius': '4px', ...clip, 'box-shadow': 'inset 0px 3px 0px $cue' },
  small: { position: 'relative', top: 'auto', bottom: 'auto', right: 'auto', width: 'auto', 'background-color': 'transparent', 'border-radius': '0px', 'box-shadow': 'none' }, children: [
    { type: 'box', when: [{ test: 'env.favoriteCount', is: 'gt', value: '0' }], style: col('0px', { flex: '1', 'min-height': '0px' }), children: [
      stackHeader('{s:favourites}', '{env.favoriteCount}'),
      channelList('live.favorites'),
    ] },
    // No favourites yet: the first channels of the lineup in their place, and how to add some.
    { type: 'box', when: [{ test: 'env.favoriteCount', is: 'gt', value: '0', not: true }], style: col('0px', { flex: '1', 'min-height': '0px' }), children: [
      stackHeader('{s:channels}', '{env.channelCount}'),
      { type: 'text', text: '{s:noFavourites}', style: { padding: '10px 16px', 'font-size': '13px', color: '$ink3', 'line-height': '1.4', 'box-shadow': 'inset 0px -1px 0px $line' }, small: { ...gutterSmall, 'box-shadow': 'none', 'padding-top': '0px' } },
      channelList('live.channels', 40),
    ] },
  ] };

// The monitor and its controls, with favourites to their right.
const stage: Node = { type: 'box', when: [{ test: 'env.searching', not: true }, { test: 'env.canLive' }],
  style: { position: 'relative', ...col('12px'), 'padding-top': '4px', 'padding-left': gutterWidth, 'padding-right': `calc(${gutterWidth} + ${panelWidth} + 20px)` },
  small: { 'padding-left': '0px', 'padding-right': '0px', 'padding-top': '0px' }, children: [monitor, controls, favourites] };

// ---------------------------------------------------------------- on now

const sectionHead = (title: string, kids: Node[], lead?: Node): Node => ({ type: 'box', style: { ...row('12px'), ...gutter, 'padding-bottom': '14px' }, small: { ...gutterSmall, 'padding-bottom': '10px' }, children: [
  ...(lead ? [lead] : []),
  { type: 'text', text: title, role: 'heading', level: 2, style: { ...caps('24px', { 'letter-spacing': '0.05em' }), color: '$ink' }, small: { 'font-size': '20px' } },
  ...kids,
] });

/** What is airing on one channel: picture, ident, progress, then title and next. */
const nowCard: Node = { type: 'box', group: true, press: { action: 'watch', arg: '{ch.id}' }, label: '{s:watchChannel}', testId: 'broadcast-now-{ch.id}',
  style: { position: 'relative', ...col('10px'), width: 'clamp(248px, 18vw, 340px)', 'flex-shrink': '0' }, small: { width: '236px' }, children: [
    { type: 'box', style: { position: 'relative', width: '100%', 'aspect-ratio': '16 / 9', 'border-radius': '3px', 'background-color': '$panel', ...clip, 'box-shadow': '0px 0px 0px 1px $line', translate: '0px 0px', transition: 'translate 260ms cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 200ms linear' },
      groupHover: { translate: '0px -4px', 'box-shadow': '0px 0px 0px 2px $ink, 0px 18px 40px -16px rgba(0, 0, 0, 0.9)' },
      groupFocus: { translate: '0px -4px', 'box-shadow': '0px 0px 0px 3px $cue, 0px 18px 40px -16px rgba(0, 0, 0, 0.9)' }, children: [
        { type: 'image', when: [{ test: 'ch.nowArt' }], src: '{ch.nowArt}', alt: '', fade: true, style: { position: 'absolute', inset: '0px', width: '100%', height: '100%', 'object-fit': 'cover' } },
        { type: 'box', when: [{ test: 'ch.nowArt', not: true }], style: { position: 'absolute', inset: '0px', display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'background-image': 'radial-gradient(ellipse 80% 90% at 50% 40%, #1a2230 0%, #0c1016 100%)' }, children: [
          { type: 'image', when: [{ test: 'ch.logo' }], src: '{ch.logo}', alt: '', style: { width: '46%', height: '42%', 'object-fit': 'contain', opacity: '0.9' } },
          { type: 'text', when: [{ test: 'ch.logo', not: true }], text: '{ch.name}', style: { ...caps('22px'), color: '$ink2', 'text-align': 'center', padding: '0px 16px', 'line-clamp': '2' } },
        ] },
        { type: 'box', style: { position: 'absolute', left: '0px', right: '0px', bottom: '0px', height: '55%', 'background-image': 'linear-gradient(0deg, rgba(0, 0, 0, 0.7) 0%, rgba(0, 0, 0, 0) 100%)' } },
        { type: 'box', style: { position: 'absolute', top: '8px', left: '8px', ...row('0px', { 'align-items': 'stretch' }), height: '24px', 'border-radius': '2px', ...clip }, children: [
          { type: 'text', text: '{ch.number}', style: { display: 'flex', 'align-items': 'center', padding: '0px 7px', 'background-color': '$signal', 'font-family': display, 'font-size': '16px', 'font-weight': '700', 'font-variant-numeric': 'tabular-nums', color: '$ink' } },
          { type: 'text', when: [{ test: 'ch.nowArt' }], text: '{ch.name}', style: { display: 'flex', 'align-items': 'center', padding: '0px 8px', 'background-color': 'rgba(7, 9, 13, 0.7)', ...caps('12px'), color: '$ink', 'max-width': '150px', 'line-clamp': '1' } },
        ] },
        { type: 'box', when: [{ test: 'ch.favorite' }], style: { position: 'absolute', top: '10px', right: '10px', width: '14px', height: '14px', color: '$cue' }, children: [{ type: 'icon', symbol: 'star-fill', style: { width: '14px', height: '14px' } }] },
        { type: 'text', when: [{ test: 'ch.nowRemaining' }], text: '{ch.nowRemaining}', style: { position: 'absolute', right: '10px', bottom: '12px', 'font-size': '12px', 'font-weight': '600', color: '$ink', 'font-variant-numeric': 'tabular-nums', 'text-shadow': '0px 1px 6px rgba(0, 0, 0, 0.8)' } },
        { type: 'box', style: { position: 'absolute', left: '0px', right: '0px', bottom: '0px', height: '3px', 'background-color': 'rgba(255, 255, 255, 0.16)' }, children: [
          { type: 'box', style: { height: '3px', width: '{ch.nowProgress}%', 'background-color': '$signal' } },
        ] },
      ] },
    { type: 'box', style: col('3px', { padding: '0px 1px' }), children: [
      { type: 'text', when: [{ test: 'ch.now' }], text: '{ch.now}', style: { 'font-size': '15px', 'font-weight': '600', 'line-clamp': '1', color: '$ink' } },
      { type: 'text', when: [{ test: 'ch.now', not: true }], text: '{s:noListing}', style: { 'font-size': '15px', 'font-weight': '600', 'line-clamp': '1', color: '$ink3' } },
      { type: 'text', when: [{ test: 'ch.next' }], text: '{s:nextIs}', style: { 'font-size': '13px', color: '$ink3', 'line-clamp': '1' } },
    ] },
  ] };

const guideCard: Node = { type: 'box', group: true, press: { action: 'guide' }, label: '{s:fullGuide}', style: { position: 'relative', width: 'clamp(200px, 13vw, 260px)', 'flex-shrink': '0', 'aspect-ratio': '4 / 3', 'align-self': 'flex-start', ...col('8px'), 'justify-content': 'center', 'align-items': 'center', 'border-radius': '3px', 'background-color': '$panel', color: '$ink', 'box-shadow': 'inset 0px 0px 0px 1px $line2' },
  hover: { 'background-color': '$panel-hi' }, focus: { 'background-color': '$panel-hi', ...ring }, small: { width: '160px' }, children: [
    { type: 'icon', symbol: 'calendar', style: { width: '26px', height: '26px', color: '$cue' } },
    { type: 'text', text: '{s:fullGuide}', style: caps('18px') },
    { type: 'text', text: '{s:allChannels}', style: { 'font-size': '13px', color: '$ink3' } },
  ] };

const onNow: Node = { type: 'box', when: [{ test: 'env.searching', not: true }, { test: 'env.liveReady' }], role: 'region', label: '{s:onNow}', style: { ...col('0px'), 'padding-top': '40px' }, small: { 'padding-top': '26px' }, children: [
  sectionHead('{s:onNow}', [
    { type: 'text', text: '{s:acrossChannels}', style: { 'font-size': '14px', color: '$ink3', 'font-variant-numeric': 'tabular-nums' }, small: { display: 'none' } },
    { type: 'box', style: { flex: '1' } },
    { type: 'box', press: { action: 'guide' }, label: '{s:fullGuide}', style: { position: 'relative', ...row('6px'), ...caps('15px'), color: '$ink2', padding: '6px 0px' }, hover: { color: '$ink' }, focus: { color: '$cue' }, children: [
      { type: 'text', text: '{s:fullGuide}' },
      { type: 'icon', symbol: 'forward-chevron', style: { width: '11px', height: '11px' } },
    ] },
  ], { type: 'box', motion: 'lamp', style: { width: '10px', height: '10px', 'border-radius': '5px', 'background-color': '$signal', 'box-shadow': '0px 0px 12px $signal', 'flex-shrink': '0' } }),
  { type: 'box', style: { display: 'flex', 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none' }, children: [
    { type: 'box', style: { ...row('16px', { 'align-items': 'flex-start' }), ...gutter, 'padding-bottom': '6px' }, small: { ...gutterSmall, gap: '12px' }, children: [
      { type: 'repeat', over: 'live.channels', limit: 48, item: { type: 'box', motion: 'card', stagger: { step: 30, cap: 10 }, children: [nowCard] } },
      guideCard,
    ] },
  ] },
] };

// ---------------------------------------------------------------- on demand (movies and shows)

const titleCard: Node = { type: 'box', group: true, press: { action: 'select', arg: '{card.kindId}' }, label: '{card.label}', testId: 'title-{card.id}',
  style: { position: 'relative', ...col('9px'), width: 'clamp(132px, 9.6vw, 190px)', 'flex-shrink': '0' }, small: { width: '112px' }, children: [
    { type: 'widget', widget: 'observe', params: { receipt: '{card.receipt}' } },
    { type: 'box', style: { position: 'relative', width: '100%', 'aspect-ratio': '2 / 3', 'border-radius': '3px', 'background-color': '$panel', ...clip, 'box-shadow': '0px 0px 0px 1px $line', translate: '0px 0px', transition: 'translate 260ms cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 200ms linear' },
      groupHover: { translate: '0px -4px', 'box-shadow': '0px 0px 0px 2px $ink, 0px 18px 40px -16px rgba(0, 0, 0, 0.9)' },
      groupFocus: { translate: '0px -4px', 'box-shadow': '0px 0px 0px 3px $cue, 0px 18px 40px -16px rgba(0, 0, 0, 0.9)' }, children: [
        { type: 'image', when: [{ test: 'card.poster' }], src: '{card.poster}', alt: '', fade: true, style: { position: 'absolute', inset: '0px', width: '100%', height: '100%', 'object-fit': 'cover' } },
        // No poster: the landscape art (an episode's still) cropped to the portrait frame.
        { type: 'image', when: [{ test: 'card.poster', not: true }, { test: 'card.backdrop' }], src: '{card.backdrop}', alt: '', fade: true, style: { position: 'absolute', inset: '0px', width: '100%', height: '100%', 'object-fit': 'cover' } },
        { type: 'box', when: [{ test: 'card.poster', not: true }, { test: 'card.backdrop', not: true }], style: { position: 'absolute', inset: '0px', padding: '12px', display: 'flex', 'flex-direction': 'column', 'justify-content': 'flex-end', 'background-image': 'linear-gradient(160deg, #1a2230 0%, #0c1016 100%)' }, children: [
          { type: 'text', text: '{card.name}', style: { ...caps('20px', { 'letter-spacing': '0.02em' }), 'line-clamp': '4', 'line-height': '1.02' } },
        ] },
        { type: 'box', when: [{ test: 'card.played' }], style: { position: 'absolute', top: '6px', right: '6px', width: '22px', height: '22px', 'border-radius': '2px', display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'background-color': 'rgba(7, 9, 13, 0.75)' }, children: [
          { type: 'icon', symbol: 'checkmark', style: { width: '11px', height: '11px', color: '$ink' } },
        ] },
        { type: 'box', when: [{ test: 'card.hasProgress' }, { test: 'card.played', not: true }], style: { position: 'absolute', left: '0px', right: '0px', bottom: '0px', height: '3px', 'background-color': 'rgba(255, 255, 255, 0.18)' }, children: [
          { type: 'box', style: { height: '3px', width: '{card.progressPct}%', 'background-color': '$cue' } },
        ] },
      ] },
    { type: 'box', style: col('2px', { padding: '0px 1px' }), children: [
      { type: 'text', text: '{card.name}', style: { 'font-size': '13px', 'font-weight': '600', 'line-clamp': '1', color: '$ink' } },
      { type: 'text', text: '{card.facts}', style: { 'font-size': '12px', color: '$ink3', 'line-clamp': '1', 'font-variant-numeric': 'tabular-nums' } },
    ] },
  ] };

const shelf: Node = { type: 'box', style: { ...col('0px'), 'padding-bottom': '26px' }, small: { 'padding-bottom': '18px' }, children: [
  { type: 'text', text: '{row.name}', role: 'heading', level: 3, style: { ...caps('18px', { 'letter-spacing': '0.05em' }), color: '$ink2', ...gutter, 'padding-bottom': '12px' }, small: { 'font-size': '16px', ...gutterSmall, 'padding-bottom': '10px' } },
  { type: 'box', style: { display: 'flex', 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none' }, children: [
    { type: 'box', style: { ...row('14px', { 'align-items': 'flex-start' }), ...gutter, 'padding-top': '4px', 'padding-bottom': '6px' }, small: { ...gutterSmall, gap: '10px' }, children: [
      { type: 'repeat', over: 'row.items', item: { type: 'box', motion: 'card', stagger: { step: 30, cap: 8 }, children: [{ type: 'use', template: 'titleCard' }] } },
    ] },
  ] },
] };

const onDemand: Node = { type: 'box', when: [{ test: 'env.searching', not: true }, { test: 'env.rowCount', is: 'gt', value: '0' }], role: 'region', label: '{s:onDemand}', style: { ...col('0px'), 'padding-top': '44px' }, small: { 'padding-top': '30px' }, children: [
  { type: 'box', style: { ...row('14px'), ...gutter, 'padding-bottom': '20px' }, small: { ...gutterSmall, 'padding-bottom': '14px' }, children: [
    { type: 'text', text: '{s:onDemand}', role: 'heading', level: 2, style: { ...caps('24px', { 'letter-spacing': '0.05em' }), color: '$ink' }, small: { 'font-size': '20px' } },
    { type: 'box', style: { flex: '1', height: '1px', 'background-color': '$line2' } },
  ] },
  { type: 'repeat', over: 'home.rows', item: { type: 'use', template: 'shelf' } },
] };

const home: Node = { type: 'box', style: { position: 'relative', display: 'flex', 'flex-direction': 'column', 'padding-bottom': '56px', 'background-color': '$ground', color: '$ink', 'font-family': sans }, small: { 'padding-bottom': '36px' }, children: [
  { type: 'slot', slot: 'searchField', style: { display: 'flex', 'flex-direction': 'column', 'align-items': 'flex-end', 'padding-top': '16px', 'padding-bottom': '16px', 'padding-left': 'clamp(20px, 2.4vw, 48px)', 'padding-right': 'clamp(20px, 2.4vw, 48px)' } as Style,
    small: { 'align-items': 'stretch', 'padding-top': '12px', 'padding-bottom': '12px', 'padding-left': '16px', 'padding-right': '16px' } as Style, inner: { width: '100%', 'max-width': '460px' } },
  // The station ident beside the search field: what this screen is.
  { type: 'box', when: [{ test: 'env.searching', not: true }, { test: 'env.canLive' }], style: { position: 'absolute', top: '16px', left: 'clamp(20px, 2.4vw, 48px)', height: '48px', ...row('12px') }, small: { display: 'none' }, children: [
    { type: 'box', style: { ...row('7px'), height: '24px', padding: '0px 9px', 'border-radius': '2px', 'background-color': '$signal' }, children: [lamp(6), { type: 'text', text: '{s:onAir}', style: caps('13px', { 'letter-spacing': '0.16em', 'font-weight': '700' }) }] },
    { type: 'text', when: [{ test: 'env.liveReady' }], text: '{s:lineup}', style: { 'font-size': '14px', color: '$ink3', 'font-variant-numeric': 'tabular-nums' } },
  ] },
  stage,
  onNow,
  onDemand,
] };

const broadcastDoc: SkinDocument = {
  schema: 1, renderer: 15, id: 'broadcast', name: 'Broadcast', version: '1.0.3', tagline: 'Live TV first: on now, your channels and the guide, with films below.',
  preview: `${ASSETS}/preview.jpg`, swatches: ['#07090d', '#f2f4f7', '#ff3d2e', '#ffc23d', '#141b24'],
  live: { home: true },
  fonts: { display: { family: 'Barlow Condensed', files: [500, 600, 700].map(weight => ({ url: `${ASSETS}/barlow-condensed-${weight}.ttf`, weight, style: 'normal' as const })) } },
  // Broadcast's night ground, signal red and cue yellow, for the routes it inherits (search, title, library, collection, sign-in).
  ui: {
    page: '#07090d', raised: '#121821', ink: '#f2f4f7', inkSecondary: '#b4bdca', inkQuiet: '#7d8898',
    inkInverse: '#0b0e13', inkHover: '#ffffff', accent: '#ffc23d', onAccent: '#0b0e13',
    control: 'rgba(255, 255, 255, 0.06)', controlHover: 'rgba(255, 255, 255, 0.12)', glass: '#121821d9',
    glassEdge: 'rgba(255, 255, 255, 0.14)', glassEdgeStrong: 'rgba(255, 255, 255, 0.24)',
    popover: '#121821f7', scrim: '#000000bf', track: 'rgba(255, 255, 255, 0.14)',
    trackStrong: 'rgba(255, 255, 255, 0.28)', focusHalo: '#ffc23d33', shadow: '#00000099',
    skeleton: 'rgba(255, 255, 255, 0.06)', skeletonLight: 'rgba(255, 255, 255, 0.1)', alert: '#ff3d2e1f',
    live: '#ff3d2e', font: 'system-ui, -apple-system, "Segoe UI Variable", "Segoe UI", Roboto, sans-serif',
    fontDisplay: '"Barlow Condensed", "Avenir Next Condensed", "Roboto Condensed", "Arial Narrow", sans-serif',
    radiusControl: 3, radiusCard: 4, radiusPanel: 4,
  },
  tokens: {
    ground: '#07090d', panel: '#121821', 'panel-hi': '#1b2330', plate: 'rgba(255, 255, 255, 0.06)', line: 'rgba(255, 255, 255, 0.07)', line2: 'rgba(255, 255, 255, 0.14)',
    ink: '#f2f4f7', ink2: '#b4bdca', ink3: '#7d8898', paper: '#f4f5f7', 'paper-ink': '#0b0e13', 'paper-ink2': '#4a5361',
    signal: '#ff3d2e', cue: '#ffc23d',
  },
  strings: { en: {
    velaHome: 'Vela home', live: 'Live', guide: 'Guide', search: 'Search', profile: 'Profile and appearance', appearance: 'Appearance', skinName: 'Broadcast',
    install: 'Install Vela', update: 'Update ready, reload', signOut: 'Sign out', clockLabel: 'Time now, {env.clock}',
    onAir: 'On air', lineup: '{env.channelCount} channels', liveBug: 'Live', monitor: 'Now playing on {tile.channelName}', monitorControls: 'Monitor controls',
    tuneInTo: 'Tune in to {tile.channelName}', tuning: 'Tuning {tile.channelNumber}', noPicture: 'No picture on {tile.channelNumber}', noPictureHint: 'Pick another channel, or try again from the guide.',
    next: 'Next', ch: 'CH', channelUp: 'Channel up', channelDown: 'Channel down', watch: 'Watch', watchTuned: 'Watch {tile.channelName} full screen',
    sound: 'Sound', unmute: 'Turn sound on', mute: 'Turn sound off', fullGuide: 'Full guide', allChannels: 'Every channel, 7 days',
    favourites: 'Favourites', channels: 'Channels', noFavourites: 'Star channels in the guide to keep them here.', previewChannel: 'Show {ch.number} {ch.name} on the monitor: {ch.now}',
    onNow: 'On now', acrossChannels: 'across {env.channelCount} channels', watchChannel: 'Watch {ch.number} {ch.name}: {ch.now}', nextIs: 'Next: {ch.next}',
    onDemand: 'On demand', noListing: 'No listing',
  } },
  motion: {
    lamp: { keyframes: 'breathe', duration: 1600, easing: 'steps(2, jump-none)', iterations: 'infinite', fill: 'none', still: { keyframes: 'none', duration: 0 } },
    sweep: { keyframes: 'shimmer', duration: 1100, easing: 'cubic-bezier(0.45, 0, 0.55, 1)', iterations: 'infinite', fill: 'none', still: { keyframes: 'none', duration: 0 } },
    wipe: { keyframes: 'slideIn', duration: 420, delay: 120, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', still: { keyframes: 'dissolve', duration: 160 } },
    drop: { keyframes: 'pop', duration: 260, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', still: { keyframes: 'dissolve', duration: 120 } },
    card: { keyframes: 'rise', duration: 480, delay: 160, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', still: { keyframes: 'dissolve', duration: 160 } },
  },
  templates: { titleCard, shelf },
  slots: { shell, home },
  detail: { wide: 'fullscreen', small: 'fullscreen' },
};
export default broadcastDoc;

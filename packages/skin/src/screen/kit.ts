// The kit: `vela:*` templates a screen document uses by name (docs/plugin-screens.md: Building
// blocks), written in the document language and drawn in the active skin's look ($ui), so a plugin
// does not hand-roll controls. Each reads its `with` arguments as {arg.*}. Their measures follow
// the hard-coded Sports parts they replace (widgets/sports/parts.tsx: Pill, Chip, Heading, Panel,
// Crest, LiveBadge, ScoresSwitch, Placeholder, Failure) and the library toolbar's tab pill
// (widgets/library/toolbar-controls.tsx Button), for pixel parity.
import { msg } from '@vela/core';
import type { MotionPreset, Node, Style } from '../../../protocol/skin';
import type { UiTokens } from '../resolve/ui-defaults';
import { luminance, parseColour, hexColour } from './colour';

export const KIT_NAMES = ['vela:pill', 'vela:chip', 'vela:tab', 'vela:heading', 'vela:panel', 'vela:crest', 'vela:liveBadge',
  'vela:switch', 'vela:placeholder', 'vela:failure'] as const;

/** The kit's own motion presets (`kit:*`), with their keyframes inline. */
export const KIT_MOTION: Record<string, MotionPreset & { frames: Record<string, { opacity?: number; transform?: Record<string, number | string>[] }> }> = {
  // The LIVE dot's ripple: it runs out from the dot and fades (parts.tsx LiveDot).
  'kit:ripple': { keyframes: 'kit:ripple', duration: 1400, easing: 'ease-out', iterations: 'infinite', fill: 'none',
    still: { keyframes: 'none', duration: 0 }, frames: { from: { opacity: 0.8, transform: [{ scale: 1 }] }, to: { opacity: 0, transform: [{ scale: 2.4 }] } } },
  // A placeholder breathes while its section loads (parts.tsx Placeholder).
  'kit:breathe': { keyframes: 'kit:breathe', duration: 1100, easing: 'ease-in-out', iterations: 'infinite', direction: 'alternate', fill: 'none',
    still: { keyframes: 'none', duration: 0 }, frames: { from: { opacity: 0.5 }, to: { opacity: 1 } } },
};

const on = (arg: string) => [{ test: `arg.${arg}` }];
const off = (arg: string) => [{ test: `arg.${arg}`, not: true }];

/** Ink that reads on a colour: white or near-black (guide/contrast.ts readableInk). */
function readableInk(background: string): string {
  const c = parseColour(background);
  const bg = luminance(c ? hexColour({ ...c, a: 1 }) : background);
  const ratio = (ink: number) => (Math.max(bg, ink) + 0.05) / (Math.min(bg, ink) + 0.05);
  return ratio(luminance('#ffffff')) >= ratio(luminance('#111111')) ? '#ffffff' : '#111111';
}

const text = (size: number, weight: number, color: string, extra: Style = {}): Style =>
  ({ 'font-size': `${size}px`, 'line-height': '1.25', 'font-weight': String(weight), color, ...extra });

/** The kit for a skin's look and the viewer's locale. */
export function kitTemplates(ui: UiTokens): Record<string, Node> {
  const liveInk = readableInk(String(ui.live));
  const card = 'color-mix(in srgb, $ui.page 8%, $ui.raised 92%)';
  const cardHover = 'color-mix(in srgb, $ui.raised 94%, $ui.ink 6%)';
  const radiusCard = 'min($ui.radiusCard, 18px)';
  type Tone = 'quiet' | 'primary' | 'onColor';
  const fills: Record<Tone, [string, string]> = {
    quiet: ['color-mix(in srgb, $ui.ink 12%, transparent)', 'color-mix(in srgb, $ui.ink 22%, transparent)'],
    primary: ['$ui.ink', '$ui.accent'],
    onColor: ['#ffffff24', '#ffffff4d'],
  };
  const inks: Record<Tone, string> = { quiet: '$ui.ink', primary: '$ui.inkInverse', onColor: '#ffffff' };
  const pill = (tone: Tone, small: boolean): Style => ({
    'flex-direction': 'row', 'align-items': 'center', gap: '8px', height: small ? '34px' : '42px', padding: small ? '0 14px' : '0 18px',
    'border-radius': small ? '17px' : '21px', 'background-color': fills[tone][0], transition: 'scale 160ms, background-color 160ms',
  });
  const pillFocus = (tone: Tone): Style => ({ scale: '1.06', 'background-color': fills[tone][1] });
  const glyph = (tone: Tone, small: boolean): Style => {
    const size = small ? '14px' : tone === 'onColor' ? '15px' : '16px';
    return { width: size, height: size, color: inks[tone] };
  };
  const pillLabel = (tone: Tone, small: boolean): Style => text(small ? 13 : 14.5, 650, inks[tone], { 'line-clamp': '1' });
  // The first state that holds draws: the combinations, most specific first.
  const pillStates: [Tone, boolean][] = [['primary', true], ['primary', false], ['onColor', true], ['onColor', false], ['quiet', true]];
  const pillWhen = (tone: Tone, small: boolean) => [
    ...(tone === 'primary' ? on('primary') : tone === 'onColor' ? [{ test: 'arg.tone', is: 'eq' as const, value: 'onColor' }] : []),
    ...(small ? on('small') : []),
  ];
  const chip = (lit: boolean, small: boolean): Style => ({
    'flex-direction': 'row', 'align-items': 'center', gap: '8px', height: small ? '32px' : '40px', padding: small ? '0 13px' : '0 16px',
    'border-radius': small ? '16px' : '20px', 'background-color': lit ? '$ui.accent' : '$ui.control',
    border: lit ? '0px solid transparent' : '1px solid $ui.glassEdge', transition: 'scale 160ms, background-color 160ms',
  });
  const chipLabel = (lit: boolean, small: boolean): Style =>
    text(small ? 12.5 : 14, lit ? 700 : 500, lit ? '$ui.onAccent' : small ? '$ui.inkSecondary' : '$ui.ink', { 'line-clamp': '1' });
  const tab = (lit: boolean): Style => ({
    height: '$ui.controlHeight', padding: '0px 12px', 'border-radius': '$ui.radiusControl', 'background-color': lit ? '$ui.accent' : '$ui.control',
    border: '1px solid $ui.glassEdge', 'justify-content': 'center', 'flex-shrink': '0',
  });
  const switchBox = (lit: boolean): Style => ({
    'flex-direction': 'row', 'align-items': 'center', gap: '9px', height: '36px', 'padding-left': '14px', 'padding-right': '10px', 'margin-left': '10px',
    'border-radius': '18px', 'background-color': lit ? 'color-mix(in srgb, $ui.accent 18%, transparent)' : 'color-mix(in srgb, $ui.ink 8%, transparent)',
    transition: 'scale 160ms, background-color 160ms',
  });
  return {
    'vela:pill': {
      // Quiet (translucent ink), primary (ink fill), or onColor (white on a data colour, the hero's
      // buttons); `small` is the compact size.
      type: 'box', role: 'button', label: '{arg.label}', style: pill('quiet', false), focus: pillFocus('quiet'), hover: pillFocus('quiet'),
      states: pillStates.map(([tone, small]) => ({ when: pillWhen(tone, small), style: pill(tone, small), focus: pillFocus(tone), hover: pillFocus(tone) })),
      children: [
        { type: 'icon', symbol: '{arg.glyph}', when: [...on('glyph'), ...off('glyphSize')], style: glyph('quiet', false),
          states: pillStates.map(([tone, small]) => ({ when: pillWhen(tone, small), style: glyph(tone, small) })) },
        // `glyphSize` draws the glyph at its own size (Sports' GridMark is 15px beside 16px glyphs).
        { type: 'icon', symbol: '{arg.glyph}', when: [...on('glyph'), ...on('glyphSize')], style: { ...glyph('quiet', false), width: '{arg.glyphSize}', height: '{arg.glyphSize}' },
          states: pillStates.map(([tone, small]) => ({ when: pillWhen(tone, small), style: { ...glyph(tone, small), width: '{arg.glyphSize}', height: '{arg.glyphSize}' } })) },
        { type: 'text', text: '{arg.label}', style: pillLabel('quiet', false),
          states: pillStates.map(([tone, small]) => ({ when: pillWhen(tone, small), style: pillLabel(tone, small) })) },
      ],
    },
    'vela:chip': {
      type: 'box', role: 'button', label: '{arg.label}', a11y: { selected: on('on') },
      style: chip(false, false), focus: { scale: '1.04', 'background-color': '$ui.controlHover' },
      states: [
        { when: [...on('on'), ...on('small')], style: chip(true, true), focus: { scale: '1.04' } },
        { when: on('on'), style: chip(true, false), focus: { scale: '1.04' } },
        { when: on('small'), style: chip(false, true), focus: { scale: '1.04', 'background-color': '$ui.controlHover' } },
      ],
      children: [
        { type: 'text', text: '{arg.count}', when: on('count'), style: text(11, 800, '$ui.inkQuiet', { 'font-variant-numeric': 'tabular-nums' }),
          states: [{ when: on('on'), style: text(11, 800, '$ui.inkInverse', { 'font-variant-numeric': 'tabular-nums' }) }] },
        { type: 'text', text: '{arg.label}', style: chipLabel(false, false),
          states: [
            { when: [...on('on'), ...on('small')], style: chipLabel(true, true) },
            { when: on('on'), style: chipLabel(true, false) },
            { when: on('small'), style: chipLabel(false, true) },
          ] },
      ],
    },
    'vela:tab': {
      type: 'box', role: 'button', label: '{arg.label}', a11y: { selected: on('on') }, style: { ...tab(false), position: 'relative' },
      focus: { 'background-color': '$ui.controlHover', 'border-color': '$ui.accent' }, hover: { 'background-color': '$ui.controlHover' },
      states: [{ when: on('on'), style: { ...tab(true), position: 'relative' }, focus: { 'border-color': '$ui.ink' }, hover: {} }],
      children: [
        // A bold copy sizes the pill, so the chosen tab's bold label never resizes the strip.
        { type: 'text', text: '{arg.label}', a11y: { hidden: true },
          style: { color: '$ui.ink', 'font-size': '$ui.controlFontSize', 'font-weight': '700', 'text-align': 'center', opacity: '0', 'white-space': 'nowrap' } },
        { type: 'box', a11y: { hidden: true }, style: { position: 'absolute', inset: '0px', padding: '0px 12px', 'justify-content': 'center', 'pointer-events': 'none' }, children: [
          { type: 'text', text: '{arg.label}', style: { color: '$ui.ink', 'font-size': '$ui.controlFontSize', 'font-weight': '500', 'text-align': 'center', 'white-space': 'nowrap' },
            states: [{ when: on('on'), style: { color: '$ui.onAccent', 'font-size': '$ui.controlFontSize', 'font-weight': '700', 'text-align': 'center', 'white-space': 'nowrap' } }] },
        ] },
      ],
    },
    'vela:heading': {
      type: 'box', style: { 'flex-direction': 'row', 'align-items': 'baseline', 'justify-content': 'space-between', 'margin-bottom': '12px' },
      children: [
        // A TV, or a window as wide as one (Sports' look.tv), reads the larger heading.
        { type: 'text', text: '{arg.text}', role: 'heading', level: 2, style: text(17, 700, '$ui.ink'), above: { 1600: { 'font-size': '19px' } }, tv: { 'font-size': '19px' } },
        { type: 'text', text: '{arg.aside}', when: on('aside'), style: text(13, 600, '$ui.inkQuiet') },
      ],
    },
    'vela:panel': {
      type: 'box', readingStop: true,
      style: { padding: '18px', 'border-radius': radiusCard, border: '1px solid color-mix(in srgb, $ui.ink 8%, transparent)', 'background-color': card },
      focus: { scale: '1.01', 'background-color': cardHover },
      children: [{ type: 'slot', slot: 'children' }],
    },
    'vela:crest': {
      // The logo sits on a light disc ringed in the side's colour; the colour fills the disc with
      // the abbreviation until the logo loads, or when there is none (the image's fallback).
      type: 'box', a11y: { hidden: true },
      style: { width: '{arg.size}', height: '{arg.size}', 'border-radius': '999px', 'background-color': '#f4f5f7', 'align-items': 'center', 'justify-content': 'center',
        overflow: 'hidden', border: 'max(1.5px, calc({arg.size} * 0.05)) solid {arg.color}' },
      children: [
        // The logo is centred at 0.7 of the crest's size over the border, as Crest drew it.
        { type: 'image', src: '{arg.logo}', alt: '', fade: true, style: { position: 'absolute', width: 'calc({arg.size} * 0.7)', height: 'calc({arg.size} * 0.7)', 'object-fit': 'contain' },
          fallback: {
            type: 'box', style: { position: 'absolute', inset: 'calc(max(1.5px, calc({arg.size} * 0.05)) * -1)', 'border-radius': '999px', 'background-color': '{arg.color}',
              'align-items': 'center', 'justify-content': 'center', border: '0px solid transparent' },
            states: [{ when: on('ring'), style: { position: 'absolute', inset: 'calc(max(1.5px, calc({arg.size} * 0.05)) * -1)', 'border-radius': '999px', 'background-color': '{arg.color}',
              'align-items': 'center', 'justify-content': 'center', border: 'max(1px, calc({arg.size} * 0.04)) solid #ffffff59' } }],
            children: [{ type: 'text', text: '{arg.abbr}', style: { color: '#ffffff', 'font-weight': '800', 'font-size': 'calc({arg.size} * 0.32)', 'letter-spacing': '0.3px', 'line-clamp': '1' } }],
          } },
      ],
    },
    'vela:liveBadge': {
      type: 'box', label: msg('live.liveBadge'),
      style: { 'flex-direction': 'row', 'align-items': 'center', gap: '6px', 'background-color': '$ui.live', 'border-radius': '5px', padding: '2.5px 7px' },
      states: [{ when: on('small'), style: { 'flex-direction': 'row', 'align-items': 'center', gap: '4px', 'background-color': '$ui.live', 'border-radius': '5px', padding: '1.5px 5px' } }],
      children: [
        { type: 'box', style: { width: '6px', height: '6px' }, states: [{ when: on('small'), style: { width: '5px', height: '5px' } }], children: [
          { type: 'box', motion: 'kit:ripple', when: [{ test: 'env.still', not: true }], style: { position: 'absolute', inset: '0px', 'border-radius': '3px', 'background-color': liveInk } },
          { type: 'box', style: { position: 'absolute', inset: '0px', 'border-radius': '3px', 'background-color': liveInk } },
        ] },
        { type: 'text', text: msg('live.liveBadge'), a11y: { hidden: true }, style: text(11, 800, liveInk, { 'letter-spacing': '0.8px' }),
          states: [{ when: on('small'), style: text(9.5, 800, liveInk, { 'letter-spacing': '0.8px' }) }] },
      ],
    },
    'vela:switch': {
      type: 'box', role: 'button', label: '{arg.label}', a11y: { pressed: on('on') }, style: switchBox(false),
      focus: { scale: '1.06', 'background-color': 'color-mix(in srgb, $ui.ink 18%, transparent)' },
      states: [{ when: on('on'), style: switchBox(true), focus: { scale: '1.06', 'background-color': 'color-mix(in srgb, $ui.accent 30%, transparent)' } }],
      children: [
        { type: 'icon', symbol: '{arg.glyph}', when: on('glyph'), style: { width: '16px', height: '16px', color: '$ui.inkSecondary' },
          states: [{ when: on('on'), style: { width: '16px', height: '16px', color: '$ui.accent' } }] },
        { type: 'text', text: '{arg.label}', style: text(14, 560, '$ui.ink', { 'line-clamp': '1' }), states: [{ when: on('on'), style: text(14, 700, '$ui.ink', { 'line-clamp': '1' }) }] },
        { type: 'box', a11y: { hidden: true }, style: { width: '30px', height: '18px', 'border-radius': '9px', padding: '2px', 'background-color': 'color-mix(in srgb, $ui.ink 22%, transparent)' },
          states: [{ when: on('on'), style: { width: '30px', height: '18px', 'border-radius': '9px', padding: '2px', 'background-color': '$ui.accent' } }],
          children: [{ type: 'box', style: { width: '14px', height: '14px', 'border-radius': '7px', 'background-color': '$ui.ink', translate: '0px 0px', transition: 'translate 220ms' },
            states: [{ when: on('on'), style: { width: '14px', height: '14px', 'border-radius': '7px', 'background-color': '$ui.onAccent', translate: '12px 0px', transition: 'translate 220ms' } }] }] },
      ],
    },
    'vela:placeholder': {
      type: 'box', motion: 'kit:breathe', a11y: { hidden: true },
      style: { width: '{arg.width}', height: '{arg.height}', 'border-radius': radiusCard, 'background-color': 'color-mix(in srgb, $ui.ink 7%, transparent)' },
      states: [{ when: on('radius'), style: { width: '{arg.width}', height: '{arg.height}', 'border-radius': '{arg.radius}', 'background-color': 'color-mix(in srgb, $ui.ink 7%, transparent)' } }],
    },
    'vela:failure': {
      type: 'box', style: { flex: '1', 'align-items': 'center', 'justify-content': 'center', gap: '16px', padding: 'max(28px, 4vw)' },
      small: { padding: '18px' },
      children: [
        { type: 'text', text: '{arg.text}', when: on('text'), style: text(18, 700, '$ui.ink', { 'text-align': 'center' }) },
        { type: 'text', text: msg('ui.tryAgain'), when: off('text'), style: text(18, 700, '$ui.ink', { 'text-align': 'center' }) },
        { type: 'text', text: '{arg.message}', when: on('message'), style: text(14, 500, '$ui.inkQuiet', { 'text-align': 'center' }) },
        // Without a message of its own, the failed read's (Failure showed the error text).
        { type: 'text', text: '{env.error}', when: [...off('message'), { test: 'env.error' }], style: text(14, 500, '$ui.inkQuiet', { 'text-align': 'center' }) },
        { type: 'use', template: 'vela:pill', when: [{ test: 'env.canRetry' }], with: { label: '{arg.retry}', glyph: 'restart', primary: 'true' }, press: { action: 'retry' } },
      ],
    },
  };
}

/** The kit's strings that need an argument default (failure's Retry). */
export function kitDefaults(name: string): Record<string, string> {
  return name === 'vela:failure' ? { retry: msg('home.retry') } : {};
}

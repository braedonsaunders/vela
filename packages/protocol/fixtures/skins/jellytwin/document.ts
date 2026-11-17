// Jelly Twin as a skin document (protocol/v0/skin.ts): a familiar home-media client,
// near-black with cyan accents and card rows. It reproduces the compiled skin it replaces
// node for node: the header with section tabs and a slide-in drawer, the featured banner,
// My Media tiles, poster and wide-thumbnail rows, and the flat title page.
import type { SkinDocument } from '../../../skin';
import { id, asset, version } from './look';
import { wideW, card } from './cards';
import { shell } from './shell';
import { home } from './home';
import { library } from './library';
import { collection } from './collection';
import { auth } from './auth';
import { title } from './title';
import { strings } from './strings';

export default {
  schema: 1,
  renderer: 16,
  id,
  name: 'Jelly Twin',
  version,
  tagline: 'A familiar home-media client: near-black, cyan accents, card rows.',
  preview: asset('preview.jpg'),
  swatches: ['#101010', '#ffffff', '#00a4dc', '#aa5cc3', '#292929'],
  // Jelly Twin's near-black and cyan, for the routes it inherits (search).
  ui: {
    page: '#101010', raised: '#292929', ink: '#ffffffde', inkSecondary: '#ffffff99', inkQuiet: '#ffffff66',
    inkInverse: '#101010', inkHover: '#ffffff', accent: '#00a4dc', onAccent: '#ffffff', control: '#ffffff14',
    controlHover: '#ffffff24', glass: '#202020d9', glassEdge: '#ffffff1f', glassEdgeStrong: '#ffffff33',
    popover: '#202020f7', scrim: '#000000b3', track: '#ffffff40', trackStrong: '#ffffff66',
    focusHalo: '#00a4dc33', shadow: '#000000a6', skeleton: '#ffffff0d', skeletonLight: '#ffffff14',
    alert: '#cb272a26', live: '#cb272a',
    font: '"Noto Sans", system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    fontDisplay: '"Noto Sans", system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    radiusControl: 4, radiusCard: 4, radiusPanel: 6,
  },
  tokens: {
    page: '#101010',
    header: '#101010f2',
    drawer: '#1c1c1c',
    raised: '#292929',
    'raised-hover': '#383838',
    card: '#242424',
    field: '#292929',
    line: '#ffffff1f',
    ink: '#ffffffde',
    'ink-strong': '#ffffff',
    secondary: '#ffffff99',
    quiet: '#ffffff66',
    accent: '#00a4dc',
    'accent-soft': '#00a4dc33',
    violet: '#aa5cc3',
    hover: '#ffffff14',
    overlay: '#00000099',
    scrim: '#000000b3',
    'scrim-clear': '#10101000',
    'scrim-page': '#101010d9',
    track: '#ffffff40',
    popup: '#202020f7',
    shadow: '#000000a6',
    danger: '#cb272a',
    // The title page's close button: the house glass control the compiled skin used.
    'close-ground': '#1b2028dd',
    'close-line': '#ffffff24',
    'close-ink': '#f5f1e9',
    'tile-1': '#00455c',
    'tile-2': '#44007e',
    'tile-3': '#1e5631',
    'tile-4': '#6b2c1f',
    'tile-5': '#234a7a',
  },
  strings: { en: strings },
  keyframes: {
    drawerIn: { '0%': { translate: '-100% 0px' } },
    drawerOut: { '100%': { translate: '-100% 0px' } },
    popIn: { '0%': { opacity: 0, scale: 0.96 } },
    rise: { '0%': { opacity: 0, translate: '0px 12px' } },
  },
  motion: {
    fadeIn: { keyframes: 'dissolve', duration: 260, easing: 'ease-out', fill: 'both' },
    statusIn: { keyframes: 'dissolve', duration: 300, delay: 200, easing: 'ease-out', fill: 'both' },
    riseIn: {
      keyframes: 'doc:rise',
      duration: 360,
      easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      fill: 'both',
      still: { keyframes: 'dissolve', duration: 200 },
    },
    spin: { keyframes: 'spin', duration: 900, easing: 'linear', iterations: 'infinite', fill: 'none' },
    menuIn: {
      keyframes: 'doc:popIn',
      duration: 200,
      easing: 'ease-out',
      fill: 'both',
      still: { keyframes: 'dissolve', duration: 160 },
    },
    menuOut: {
      keyframes: 'vanish',
      duration: 140,
      easing: 'ease-in',
      fill: 'both',
      still: { keyframes: 'vanish', duration: 100 },
    },
    scrimIn: { keyframes: 'dissolve', duration: 220, easing: 'ease-out', fill: 'both' },
    scrimOut: {
      keyframes: 'vanish',
      duration: 200,
      easing: 'ease-in',
      fill: 'both',
      still: { keyframes: 'vanish', duration: 100 },
    },
    drawerIn: {
      keyframes: 'doc:drawerIn',
      duration: 260,
      easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      fill: 'both',
      still: { keyframes: 'dissolve', duration: 160 },
    },
    drawerOut: {
      keyframes: 'doc:drawerOut',
      duration: 200,
      easing: 'ease-in',
      fill: 'both',
      still: { keyframes: 'vanish', duration: 100 },
    },
  },
  templates: {
    poster: card(false),
    wide: card(true),
    gridPoster: card(false, { style: '100%', small: '100%' }),
    upNext: card(true, { style: wideW.style, small: '58vw' }),
  },
  status: true,
  traits: { barMask: false, panSections: true, page: '#101010', ink: '#ffffffde' },
  slots: { shell, home },
  routes: { title, library, auth, collection },
  detail: { wide: 'fullscreen', small: 'fullscreen', frame: { flat: true } },
} satisfies SkinDocument;

// The Vela base: the built-in document every skin document inherits route by route (decision 7).
// Its look is compiled Cinematic's, written on the document's ui tokens ($ui.*), so each skin
// wears it in its own colours until it draws a route of its own. Its parts live in vela-base/.
import type { BoxNode, Node, SkinDocument } from '../../../protocol/skin';
import { auth } from './vela-base/auth';
import { card, gridCard, relatedRow, row } from './vela-base/cards';
import { collection } from './vela-base/collection';
import { home } from './vela-base/home';
import { library, libraryViews, libraryFilters, libraryAlternative } from './vela-base/library';
import { enterPresets, small } from './vela-base/look';
import { search, searchMotion } from './vela-base/search';
import { shell } from './vela-base/shell';
import { title, episodeContext, cardContext } from './vela-base/title';
import { personRoute } from './vela-base/person';
import { castPerson } from './vela-base/person-tile';
import { compiledControl } from './vela-base/controls';

export const velaBase: SkinDocument = {
  schema: 1,
  renderer: 15,
  id: 'vela-base',
  name: 'Vela',
  version: '1.0.0',
  tagline: 'The look every skin inherits.',
  // Never offered in the picker, so it has no preview; swatches name its default look.
  swatches: ['#090b0e', '#f5f1e9', '#dcb998'],
  motion: {
    ...enterPresets,
    ...searchMotion,
    velaPulse0: {
      keyframes: 'breathe',
      duration: 1400,
      easing: 'cubic-bezier(0.45, 0, 0.55, 1)',
      iterations: 'infinite',
      fill: 'none',
    },
    velaPulse180: {
      keyframes: 'breathe',
      duration: 1400,
      delay: 180,
      easing: 'cubic-bezier(0.45, 0, 0.55, 1)',
      iterations: 'infinite',
      fill: 'none',
    },
    velaPulse360: {
      keyframes: 'breathe',
      duration: 1400,
      delay: 360,
      easing: 'cubic-bezier(0.45, 0, 0.55, 1)',
      iterations: 'infinite',
      fill: 'none',
    },
    velaShimmer: {
      keyframes: 'shimmer',
      duration: 1800,
      easing: 'cubic-bezier(0.45, 0, 0.55, 1)',
      iterations: 'infinite',
      fill: 'none',
    },
    velaEpisode: {
      keyframes: 'rise',
      duration: 640,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      fill: 'both',
      still: { keyframes: 'dissolve', duration: 240 },
    },
    velaNavIn: {
      keyframes: 'dissolve',
      duration: 900,
      easing: 'ease-out',
      still: { keyframes: 'dissolve', duration: 240 },
    },
    velaOpen: {
      keyframes: 'open',
      duration: 640,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      still: { keyframes: 'dissolve', duration: 240 },
    },
    velaPop: {
      keyframes: 'pop',
      duration: 360,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      still: { keyframes: 'dissolve', duration: 160 },
    },
    velaExpose: {
      keyframes: 'expose',
      duration: 1100,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      still: { keyframes: 'dissolve', duration: 400 },
    },
    velaDrift: {
      keyframes: 'drift',
      duration: 32000,
      easing: 'cubic-bezier(0.45, 0, 0.55, 1)',
      iterations: 'infinite',
      direction: 'alternate',
      fill: 'none',
      still: { keyframes: 'none', duration: 0 },
    },
    velaHeroFill: {
      keyframes: 'fill',
      duration: 9000,
      easing: 'linear',
      still: { keyframes: 'none', duration: 0 },
    },
    velaCard: {
      keyframes: 'rise',
      duration: 640,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      still: { keyframes: 'dissolve', duration: 240 },
    },
    velaStatusIn: {
      keyframes: 'dissolve',
      duration: 500,
      easing: 'ease-out',
      fill: 'both',
      still: { keyframes: 'dissolve', duration: 240 },
    },
    velaStatusOpen: {
      keyframes: 'dissolve',
      duration: 400,
      easing: 'ease-out',
      fill: 'both',
      still: { keyframes: 'dissolve', duration: 240 },
    },
    velaAuroraA: {
      keyframes: 'auroraA',
      duration: 34000,
      easing: 'cubic-bezier(0.45, 0, 0.55, 1)',
      iterations: 'infinite',
      direction: 'alternate',
      fill: 'none',
      still: { keyframes: 'none', duration: 0 },
    },
    velaAuroraB: {
      keyframes: 'auroraB',
      duration: 41000,
      easing: 'cubic-bezier(0.45, 0, 0.55, 1)',
      iterations: 'infinite',
      direction: 'alternate',
      fill: 'none',
      still: { keyframes: 'none', duration: 0 },
    },
    velaAuroraC: {
      keyframes: 'auroraC',
      duration: 47000,
      easing: 'cubic-bezier(0.45, 0, 0.55, 1)',
      iterations: 'infinite',
      direction: 'alternate',
      fill: 'none',
      still: { keyframes: 'none', duration: 0 },
    },
    velaAuthOut: {
      keyframes: 'vanish',
      duration: 320,
      easing: 'ease-in',
      fill: 'both',
      still: { keyframes: 'vanish', duration: 160 },
    },
    velaCodeIn: {
      keyframes: 'rise',
      duration: 640,
      delay: 120,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      fill: 'both',
      still: { keyframes: 'dissolve', duration: 240 },
    },
    velaRowIn: {
      keyframes: 'rise',
      duration: 640,
      delay: 520,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      still: { keyframes: 'dissolve', duration: 240 },
    },
  },
  templates: { velaCastPerson: castPerson, velaPersonCard: gridCard, velaPersonClose: (((title as BoxNode).children![0] as BoxNode).children![0] as BoxNode).children![0]!, velaEpisodeContext: episodeContext, velaCardContext: cardContext, velaCard: card, velaRow: row, velaRelatedRow: relatedRow, velaLibraryViews: libraryViews, velaLibraryFilters: libraryFilters, velaLibraryAlternative: libraryAlternative },
  slots: { shell, home },
  routes: { title, person: personRoute, library, auth, collection, search },
  // Home and the title page draw their own loading and failure; home fades under the floating bar.
  status: true,
  traits: { barMask: true },
  detail: { wide: 'fullscreen', small: 'fullscreen' },
};

// Every press node in the base takes compiled Cinematic's focus ring and press scale.
[
  ...Object.values(velaBase.slots ?? {}),
  ...Object.values(velaBase.routes ?? {}),
  ...Object.values(velaBase.templates ?? {}),
].forEach(node => node && compiledControl(node as Node));

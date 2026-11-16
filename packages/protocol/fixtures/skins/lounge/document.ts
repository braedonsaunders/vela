// Lounge: the living-room skin, a skin document (protocol/v0/skin.ts). Ten-foot type,
// TV overscan margins and a remote-first focus language: the focused poster lifts,
// grows and glows, and the full-screen backdrop behind the rows belongs to the title
// on the top shelf. Every affordance is a pressable box, so focus reaches it.
//
// The parts live beside this file: look (geometry, type, focus), shell (the top bar),
// cards, rows and skeletons (what home and the grids are made of), and one module per
// page: home, title, library, collection and auth (signing in).
import type { SkinDocument } from '../../../skin';
import { auth } from './auth';
import { gridPoster, poster, ranked, wide } from './cards';
import { collection } from './collection';
import { home } from './home';
import { library } from './library';
import { ease } from './look';
import { relatedRow, row } from './rows';
import { shell } from './shell';
import { title } from './title';

const rise = (delay: number) => ({
  keyframes: 'rise',
  duration: 760,
  delay,
  easing: ease,
  fill: 'both' as const,
  still: { keyframes: 'dissolve', duration: 220 },
});

const lounge: SkinDocument = {
  schema: 1,
  renderer: 15,
  id: 'lounge',
  name: 'Lounge',
  version: '1.0.3',
  tagline: 'Made for the couch: big type, a remote and the backdrop behind it all.',
  preview: '/vela/v0/appearance/skins/lounge/1.0.3/preview.jpg',
  swatches: ['#05060a', '#f5f1e9', '#dcb998', '#f2c27e', '#262b34'],
  // Lounge's deep ground and amber, for the routes it inherits (search).
  ui: {
    page: '#05060a', raised: '#1a1d24', ink: '#f5f1e9', inkSecondary: 'rgba(245, 241, 233, 0.78)',
    inkQuiet: 'rgba(245, 241, 233, 0.52)', inkInverse: '#05060a', inkHover: '#ffffff', accent: '#f2c27e',
    onAccent: '#05060a', control: '#ffffff16', controlHover: '#ffffff26', glass: '#1a1d24b3',
    glassEdge: '#ffffff1a', glassEdgeStrong: '#ffffff33', popover: '#1a1d24f5', scrim: '#000000bf',
    track: '#ffffff25', trackStrong: '#ffffff47', focusHalo: '#f2c27e33', shadow: '#00000099',
    skeleton: '#ffffff0d', skeletonLight: '#ffffff12', alert: '#f2c27e1f', live: '#e8513f',
    font: 'system-ui, -apple-system, "SF Pro Display", "Segoe UI Variable Display", "Segoe UI", Roboto, sans-serif',
    fontDisplay: 'system-ui, -apple-system, "SF Pro Display", "Segoe UI Variable Display", "Segoe UI", Roboto, sans-serif',
    radiusControl: 999, radiusCard: 10, radiusPanel: 20,
  },
  tokens: {
    ground: '#05060a',
    raised: '#1a1d24',
    ink: '#f5f1e9',
    'ink-dim': 'rgba(245, 241, 233, 0.78)',
    'ink-quiet': 'rgba(245, 241, 233, 0.52)',
    amber: '#f2c27e',
  },
  strings: {
    en: {
      mainNav: 'Main',
      velaHome: 'Vela home',
      home: 'Home',
      search: 'Search',
      profile: 'Profile and appearance',
      watchingAs: 'Watching on this screen',
      appearance: 'Appearance',
      skinName: 'Lounge',
      install: 'Install Vela',
      update: 'Update ready, reload',
      signOut: 'Sign out',
      moreInfo: 'More info',
      featured: 'Featured titles',
      back: 'Back',
      opening: 'Opening…',
      failed: 'This title couldn’t be opened.',
      seasons: 'Seasons',
      episodes: 'Episodes',
      extras: 'Trailers and extras',
      playExtra: 'Play',
      cast: 'Cast and crew',
      loadingHome: 'Getting your library ready',
      homeFailed: 'Your library couldn’t be reached',
      homeFailedDetail: 'Vela couldn’t connect to your server. Check that it’s on and connected, then try again.',
      tryAgain: 'Try again',
      collectionKind: 'Collection',
      collectionCount: '{collection.itemCount} titles',
      collectionEmpty: 'This collection is empty.',
      loadingCollection: 'Loading this collection',
      collectionFailed: 'This collection couldn’t be opened.',
      vela: 'Vela',
      welcome: 'Welcome to the lounge',
      welcomeDetail: 'Sign in once on this screen and everything you watch picks up where you left it.',
      connecting: 'Connecting to your server…',
      redeeming: 'Signing you in…',
      offline: 'Can’t reach your server',
      offlineDetail: 'Check that it’s on and connected to the network; Vela will connect again as soon as it can.',
      useCode: 'Sign in with a code',
      or: 'or',
      username: 'Username',
      password: 'Password',
      signIn: 'Sign in',
      signingIn: 'Signing in…',
      quickHow: 'On your phone or computer, open Vela, choose Quick Connect and enter this code.',
      quickCode: 'Your sign-in code',
      quickWaiting: 'Getting a code…',
      quickExpires: 'The code works until {quick.expires}',
      secureNote: 'This server also has a secure address. Sign in there to keep your password private.',
      goSecure: 'Use the secure address',
      cancel: 'Cancel',
      libraryCount: '{library.itemCount} titles · {library.sortLabel}',
      sortBy: 'Sort by',
      reverse: 'Reverse order',
      filters: 'Filters',
      unwatched: 'Unwatched',
      favorites: 'Favourites',
      libraryEmpty: 'Nothing here with these filters',
      libraryEmptyDetail: 'Clear a filter or choose another to see more.',
      loadingLibrary: 'Loading this library',
      libraryFailed: 'This library couldn’t be opened.',
      searchPlaceholder: 'Search films, shows, people and channels',
      clear: 'Clear',
      loadingMore: 'Loading more…',
    },
  },
  motion: {
    navIn: {
      keyframes: 'dissolve',
      duration: 700,
      easing: 'ease-out',
      still: { keyframes: 'dissolve', duration: 200 },
    },
    sheet: { keyframes: 'pop', duration: 380, easing: ease, still: { keyframes: 'dissolve', duration: 160 } },
    deal: { keyframes: 'pop', duration: 420, easing: ease, still: { keyframes: 'dissolve', duration: 160 } },
    pulse: {
      keyframes: 'breathe',
      duration: 1600,
      easing: 'ease-in-out',
      iterations: 'infinite',
      fill: 'none',
      still: { keyframes: 'none', duration: 0 },
    },
    fadeIn: {
      keyframes: 'dissolve',
      duration: 420,
      easing: 'ease-out',
      still: { keyframes: 'dissolve', duration: 160 },
    },
    backdropIn: {
      keyframes: 'dissolve',
      duration: 1200,
      easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
      still: { keyframes: 'dissolve', duration: 300 },
    },
    drift: {
      keyframes: 'drift',
      duration: 40000,
      easing: 'cubic-bezier(0.45, 0, 0.55, 1)',
      iterations: 'infinite',
      direction: 'alternate',
      fill: 'none',
      still: { keyframes: 'none', duration: 0 },
    },
    heroFill: { keyframes: 'fill', duration: 9000, easing: 'linear', still: { keyframes: 'none', duration: 0 } },
    copy0: rise(120),
    copy1: rise(200),
    copy2: rise(280),
    copy3: rise(360),
    cardIn: { keyframes: 'rise', duration: 700, easing: ease, still: { keyframes: 'dissolve', duration: 220 } },
    rowIn: {
      keyframes: 'rise',
      duration: 760,
      delay: 380,
      easing: ease,
      still: { keyframes: 'dissolve', duration: 220 },
    },
  },
  templates: { poster, gridPoster, wide, ranked, row, relatedRow },
  slots: { shell, home },
  routes: { title, library, collection, auth },
  // Lounge's ground and ink behind every screen, the launch splash included.
  traits: { page: '#05060a', ink: '#f5f1e9' },
  // The title page is a full screen of its own: no frame drawn over home behind it.
  detail: { wide: 'fullscreen', small: 'fullscreen', frame: { flat: true } },
  status: true,
};

export default lounge;

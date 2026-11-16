// Search (routes.search), as compiled Cinematic's SearchSurface draws it, on the document's ui
// look: drawn in home's view under the search field while a query is open. The title matches
// (or the honest empty or failed state), live hits on now and coming up, the descriptive lane
// with its partial and failed answers, and discovery with its running, failed and empty states.
import type { Condition, Node, Style } from '../../../../protocol/skin';
import { display, emptyState, enter, gutter, gutterSmall, is, pill, placeholder, pulse, rowSkeleton } from './look';

const some = (test: string): Condition => ({ test, is: 'gt', value: '0' });
const none = (test: string): Condition => ({ test, is: 'gt', value: '0', not: true });
const isNot = (test: string, value: string): Condition => ({ test, is: 'ne', value });

/** Nothing further down answers yet: no live hits, no descriptive answer coming or found, no discovery running. */
const quiet: Condition[] = [
  none('search.onNowCount'),
  none('search.comingUpCount'),
  isNot('search.descriptiveState', 'loading'),
  none('search.descriptiveCount'),
  isNot('search.aiState', 'running'),
];

const column = (gap: string): Style => ({ display: 'flex', 'flex-direction': 'column', gap });
const secondary = (size: string): Style => ({ 'font-size': size, color: '$ui.inkSecondary' });

/** A line of help in the gutter. */
const note = (text: string, when: Condition[], size = '14px'): Node => ({
  type: 'text',
  when,
  text,
  style: { ...secondary(size), ...gutter },
  small: { ...gutterSmall },
});

/** Ask the descriptive lane again, once the server allows it. */
const retry = (height: number, padding: string, size: string): Node => ({
  type: 'box',
  when: [{ test: 'search.canRetry' }],
  press: { action: 'retryDescriptive' },
  label: '{t:ui.tryAgain}',
  style: {
    ...pill(false, height),
    position: 'relative',
    'padding-left': padding,
    'padding-right': padding,
    'font-size': size,
  },
  hover: { 'background-color': '$ui.controlHover' },
  children: [{ type: 'text', text: '{t:ui.tryAgain}' }],
});

/** Still waiting on a slower lane: the breathing dots and what is happening. */
const waiting = (text: string, when: Condition[], size: string, motion?: string): Node => ({
  type: 'box',
  when,
  role: 'status',
  ...(motion ? { motion } : {}),
  style: { display: 'flex', 'flex-direction': 'row', gap: '12px', 'align-items': 'center', ...gutter },
  small: { ...gutterSmall },
  children: [pulse, { type: 'text', text, style: secondary(size) }],
});

/** A lane's heading, in the gutter. */
const laneHeading = (name: string): Node => ({
  type: 'text',
  text: name,
  role: 'heading',
  level: 2,
  style: { 'font-size': '21px', 'font-weight': '650', 'letter-spacing': '-0.012em', ...gutter },
  small: { 'font-size': '18px', ...gutterSmall },
});

/** A sideways shelf over a search collection. */
const shelf = (over: string, item: Node): Node => ({
  type: 'box',
  style: {
    display: 'flex',
    'flex-direction': 'row',
    gap: '18px',
    'align-items': 'flex-start',
    'overflow-x': 'auto',
    'overflow-y': 'hidden',
    'scrollbar-width': 'none',
    'mask-image': 'linear-gradient(90deg, black 0%, black 94%, transparent 100%)',
    'padding-top': '16px',
    'padding-bottom': '22px',
    ...gutter,
  },
  small: { gap: '12px', 'padding-top': '14px', 'padding-bottom': '18px', ...gutterSmall },
  children: [{ type: 'repeat', over, item }],
});

/** The base's card, rising in turn. */
const cardItem: Node = {
  type: 'box',
  motion: 'velaCard',
  stagger: { step: 45, cap: 8 },
  style: { position: 'relative', display: 'flex' },
  children: [{ type: 'use', template: 'velaCard' }],
};

/** A lane of titles: a heading over a shelf of cards. */
const titleLane = (name: string, over: string, when: Condition[], motion?: string): Node => ({
  type: 'box',
  when,
  ...(motion ? { motion } : {}),
  style: { position: 'relative', ...column('4px'), 'padding-bottom': '28px' },
  small: { gap: '2px', 'padding-bottom': '18px' },
  children: [laneHeading(name), shelf(over, cardItem)],
});

// ---- Live hits ----

const sparkles = [
  'M10 2.5l1.9 5.6 5.6 1.9-5.6 1.9L10 17.5l-1.9-5.6L2.5 10l5.6-1.9z',
  'M18.5 14l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z',
];

const fill: Style = { position: 'absolute', inset: '0px', width: '100%', height: '100%' };
const glassChip: Style = {
  position: 'absolute',
  top: '10px',
  left: '10px',
  'padding-top': '3px',
  'padding-bottom': '3px',
  'padding-left': '8px',
  'padding-right': '8px',
  'border-radius': '6px',
};

/** The tile's picture: artwork, else the channel's logo on a quiet ground, else its name. */
const picture: Node[] = [
  {
    type: 'image',
    when: [{ test: 'hit.artwork' }],
    src: '{hit.artwork}',
    alt: '',
    fade: true,
    style: { ...fill, 'object-fit': 'cover' },
  },
  {
    type: 'box',
    when: [{ test: 'hit.artwork', not: true }, { test: 'hit.logo' }],
    style: { ...fill, 'padding-top': '10%', 'padding-bottom': '10%', 'padding-left': '24%', 'padding-right': '24%' },
    children: [
      { type: 'image', src: '{hit.logo}', alt: '', style: { width: '100%', height: '100%', 'object-fit': 'contain' } },
    ],
  },
  {
    type: 'box',
    when: [{ test: 'hit.artwork', not: true }, { test: 'hit.logo', not: true }],
    style: { ...fill, display: 'flex', 'align-items': 'center', 'justify-content': 'center', padding: '16px' },
    children: [
      {
        type: 'text',
        text: '{hit.channelName}',
        style: { ...display, 'font-size': '26px', 'text-align': 'center', 'line-clamp': '2' } as Style,
        small: { 'font-size': '22px' },
      },
    ],
  },
  // Artwork with a logo: the logo rides on a glass plate at the foot.
  {
    type: 'box',
    when: [{ test: 'hit.artwork' }, { test: 'hit.logo' }],
    style: {
      position: 'absolute',
      left: '10px',
      bottom: '10px',
      width: '56px',
      height: '32px',
      padding: '4px',
      'border-radius': '8px',
      'background-color': '$ui.glass',
      'backdrop-filter': 'blur(12px)',
    },
    states: [{ when: [{ test: 'hit.live' }], style: { bottom: '16px' } }],
    children: [
      { type: 'image', src: '{hit.logo}', alt: '', style: { width: '100%', height: '100%', 'object-fit': 'contain' } },
    ],
  },
];

/** Airing: a LIVE chip with a breathing dot, and how far through it is. Else when it starts. */
const airing: Node[] = [
  {
    type: 'box',
    when: [{ test: 'hit.live' }],
    style: {
      ...glassChip,
      display: 'flex',
      'flex-direction': 'row',
      gap: '6px',
      'align-items': 'center',
      'background-color': '$ui.accent',
      color: '$ui.inkInverse',
    },
    children: [
      {
        type: 'box',
        motion: 'velaLiveDot',
        style: { width: '6px', height: '6px', 'border-radius': '3px', 'background-color': '$ui.inkInverse' },
      },
      {
        type: 'text',
        text: '{t:live.liveBadge}',
        style: { 'font-size': '10px', 'font-weight': '750', 'letter-spacing': '0.12em' },
      },
    ],
  },
  {
    type: 'box',
    when: [{ test: 'hit.live' }],
    style: {
      position: 'absolute',
      left: '0px',
      right: '0px',
      bottom: '0px',
      height: '4px',
      'background-color': '$ui.trackStrong',
    },
    children: [
      { type: 'box', style: { height: '4px', width: '{hit.progressPct}%', 'background-color': '$ui.accent' } },
    ],
  },
  {
    type: 'text',
    when: [{ test: 'hit.live', not: true }, { test: 'hit.chip' }],
    text: '{hit.chip}',
    style: {
      ...glassChip,
      'background-color': '$ui.glass',
      'backdrop-filter': 'blur(12px)',
      'font-size': '11px',
      'font-weight': '600',
      'font-variant-numeric': 'tabular-nums',
    },
  },
];

/** One live hit: its picture with the live state over it, then its name and channel. */
const liveTile: Node = {
  type: 'box',
  press: { action: 'openHit', arg: '{hit.ref}' },
  label: '{hit.name}, {hit.detail}',
  testId: 'hit-{hit.kind}-{hit.id}',
  controlStates: false,
  disabled: [{ test: 'hit.navigable', not: true }],
  disabledStyle: { opacity: '0.6' },
  states: [{ when: [{ test: 'hit.chip' }], style: {}, label: '{hit.name}, {hit.detail}, {hit.chip}' }],
  style: {
    position: 'relative',
    ...column('10px'),
    width: 'clamp(240px, 19vw, 320px)',
    'flex-shrink': '0',
    'text-align': 'left',
    translate: '0px 0px',
    transition: 'translate 360ms cubic-bezier(0.16, 1, 0.3, 1)',
  },
  small: { width: '220px' },
  hover: { translate: '0px -4px' },
  focus: { 'box-shadow': '0px 0px 0px 3px $ui.accent' },
  children: [
    {
      type: 'box',
      style: {
        position: 'relative',
        width: '100%',
        'aspect-ratio': '16 / 9',
        'border-radius': '12px',
        'overflow-x': 'hidden',
        'overflow-y': 'hidden',
        'background-image': placeholder(160),
        'box-shadow': '0px 10px 24px -12px $ui.shadow, 0px 0px 0px 1px $ui.glassEdge',
      },
      children: [...picture, ...airing],
    },
    {
      type: 'box',
      style: { ...column('3px'), 'padding-left': '2px', 'padding-right': '2px' },
      children: [
        {
          type: 'text',
          text: '{hit.name}',
          style: { 'font-size': '14px', 'font-weight': '600', 'line-clamp': '1' } as Style,
        },
        {
          type: 'text',
          text: '{hit.detail}',
          style: {
            'font-size': '12px',
            color: '$ui.inkQuiet',
            'line-clamp': '1',
            'font-variant-numeric': 'tabular-nums',
          } as Style,
        },
      ],
    },
  ],
};

/** A lane of live hits: a heading over a shelf of tiles. */
const liveLane = (name: string, over: string, count: string): Node => ({
  type: 'box',
  when: [some(count)],
  motion: enter(60),
  style: column('4px'),
  small: { gap: '2px' },
  children: [laneHeading(name), shelf(over, liveTile)],
});

// ---- The fast lane's answer ----

const titles: Node[] = [
  // Finding titles: the row's skeleton, announced.
  {
    type: 'box',
    when: [is('env.search', 'loading')],
    style: { position: 'relative', display: 'flex', 'flex-direction': 'column' },
    children: [
      {
        type: 'text',
        role: 'status',
        text: '{t:ui.findingTitles}',
        style: { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', opacity: '0' },
      },
      rowSkeleton,
    ],
  },
  titleLane('{t:ui.titleMatches}', 'search.titles', [some('search.titleCount')]),
  {
    ...emptyState('alert', '{t:ui.searchUnavailable}', '{t:ui.searchIsUnavailableTryAnotherQuery}'),
    when: [is('env.search', 'failed'), ...quiet],
  },
  // No titles, and nothing further down answers: say so, about the mood when the query describes one.
  {
    type: 'box',
    when: [is('env.search', 'ready'), none('search.titleCount'), ...quiet],
    style: column('4px'),
    children: [
      {
        ...emptyState('alert', '{t:search.moodUnavailable}', '{t:search.moodUnavailableMessage}'),
        when: [{ test: 'search.describing' }, is('search.descriptiveState', 'failed')],
      },
      {
        type: 'box',
        when: [{ test: 'search.describing' }, is('search.descriptiveState', 'failed')],
        style: { display: 'flex', 'flex-direction': 'row', 'justify-content': 'center' },
        children: [retry(44, '22px', '14px')],
      },
      {
        ...emptyState('search', '{t:search.noMood}', '{t:search.noMoodMessage}'),
        when: [{ test: 'search.describing' }, isNot('search.descriptiveState', 'failed')],
      },
      {
        ...emptyState('search', '{t:ui.noMatches}', '{t:ui.noTitleMatchesTryANameAMoodOrADifferentDescription}'),
        when: [{ test: 'search.describing', not: true }],
      },
    ],
  },
];

// ---- The descriptive lane ----

/** A failed descriptive answer under what did come back, with a way to ask again. */
const partial = (text: string, when: Condition[]): Node => ({
  type: 'box',
  when: [is('search.descriptiveState', 'failed'), ...when],
  style: {
    display: 'flex',
    'flex-direction': 'row',
    gap: '14px',
    'align-items': 'center',
    'flex-wrap': 'wrap',
    ...gutter,
  },
  small: { ...gutterSmall },
  children: [{ type: 'text', text, style: secondary('14px') }, retry(36, '16px', '13px')],
});

const descriptive: Node[] = [
  waiting(
    '{t:search.lookingForVibe}',
    [is('search.descriptiveState', 'loading'), isNot('env.search', 'loading')],
    '15px',
    enter(80),
  ),
  titleLane('{t:ui.theFeelingYouReLookingFor}', 'search.descriptive', [some('search.descriptiveCount')], enter(120)),
  partial('{t:search.moodPartial}', [some('search.descriptiveCount')]),
  partial('{t:search.moodUnavailableBelowTitles}', [none('search.descriptiveCount'), some('search.titleCount')]),
];

// ---- Discovery ----

const discovery: Node = {
  type: 'box',
  when: [isNot('search.aiState', 'off')],
  motion: enter(160),
  style: column('10px'),
  children: [
    {
      type: 'box',
      style: { display: 'flex', 'flex-direction': 'row', gap: '10px', 'align-items': 'center', ...gutter },
      small: { ...gutterSmall },
      children: [
        {
          type: 'icon',
          paths: sparkles,
          viewBox: '0 0 24 24',
          a11y: { hidden: true },
          style: { width: '18px', height: '18px', color: '$ui.accent' },
        },
        {
          type: 'text',
          text: '{t:ui.aLittleFurtherAfield}',
          role: 'heading',
          level: 2,
          style: { ...display, 'font-size': '30px' },
          small: { 'font-size': '26px' },
        },
      ],
    },
    waiting('{t:ui.exploringYourDescription}', [is('search.aiState', 'running')], '14px'),
    titleLane('{t:ui.discoveredForYou}', 'search.ai', [some('search.aiCount')]),
    note(
      '{t:ui.discoveryCouldnTFinishYourTitleMatchesAreReadyAbove}',
      [is('search.aiState', 'failed'), some('search.titleCount')],
    ),
    note('{t:search.discoveryUnavailable}', [is('search.aiState', 'failed'), none('search.titleCount')]),
    note('{t:search.discoveryEmpty}', [is('search.aiState', 'complete'), none('search.aiCount')]),
  ],
};

export const search: Node = {
  type: 'box',
  motion: enter(160),
  style: { position: 'relative', ...column('26px'), 'padding-bottom': '72px' },
  small: { gap: '18px' },
  children: [
    {
      type: 'box',
      style: { ...column('6px'), ...gutter },
      small: { ...gutterSmall },
      children: [
        {
          type: 'text',
          text: '{t:ui.resultsForQuery|query=env.query}',
          role: 'heading',
          level: 1,
          style: { ...display, 'font-size': '46px', 'line-clamp': '2' } as Style,
          small: { 'font-size': '32px' },
        },
      ],
    },
    ...titles,
    liveLane('{t:live.onNow}', 'search.onNow', 'search.onNowCount'),
    liveLane('{t:search.live.comingUp}', 'search.comingUp', 'search.comingUpCount'),
    ...descriptive,
    discovery,
  ],
};

/** The breathing dot on a LIVE chip; still under reduced motion. */
export const searchMotion = {
  velaLiveDot: {
    keyframes: 'breathe',
    duration: 1600,
    easing: 'cubic-bezier(0.45, 0, 0.55, 1)',
    iterations: 'infinite' as const,
    fill: 'none' as const,
  },
};

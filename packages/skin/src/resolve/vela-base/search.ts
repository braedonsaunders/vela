import { chipGroup, libChip, glassSelect } from './library';
// Search (routes.search), on the document's ui look: drawn in home's view under the search field
// while a query is open. One list of titles (or the honest empty or failed state): matched by name,
// or by description as a fallback, with one quiet note saying so; then live hits on now and coming
// up. The list stays a skeleton until the lane it shows has answered, so a fallback never moves a
// list already shown. Titles lie in the library's multi-row grid, not a sideways shelf.
import type { BoxNode, Condition, Node, Style } from '../../../../protocol/skin';
import { gridCard, searchGridCard, titleGrid } from './cards';
import { display, emptyState, enter, gutter, gutterSmall, is, pill, placeholder, rowSkeleton } from './look';

const some = (test: string): Condition => ({ test, is: 'gt', value: '0' });
const none = (test: string): Condition => ({ test, is: 'gt', value: '0', not: true });
const isNot = (test: string, value: string): Condition => ({ test, is: 'ne', value });

/** Nothing further down answers: no live hits. */
const quiet: Condition[] = [none('search.onNowCount'), none('search.comingUpCount')];

const column = (gap: string): Style => ({ display: 'flex', 'flex-direction': 'column', gap });
const secondary = (size: string): Style => ({ 'font-size': size, color: '$ui.inkSecondary' });

/** Ask the descriptive lane again, once the server allows it. */
const retry = (height: number, padding: string, size: string): BoxNode => ({
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

/** The one list: the library's grid of cards, rising in turn. */
const titleList: Node = {
  type: 'box',
  when: [some('search.titleCount')],
  style: { position: 'relative', ...column('18px'), 'padding-bottom': '28px' },
  small: { gap: '12px', 'padding-bottom': '18px' },
  children: [
    {
      ...titleGrid,
      children: [{ type: 'repeat', over: 'search.titles', item: { ...gridCard, motion: 'velaCard', stagger: { step: 30, cap: 18 } } as Node }],
    } as Node,
  ],
};

// ---- Live hits ----

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
        style: { 'font-size': '12px', 'font-weight': '750', 'letter-spacing': '0.12em' },
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
      'font-size': '12px',
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

// ---- The one list ----

const hidden: Style = { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', opacity: '0' };

const titles: Node[] = [
  // Finding titles, or looking by description: the row's skeleton either way, announced.
  {
    type: 'box',
    when: [is('env.search', 'loading')],
    style: { position: 'relative', display: 'flex', 'flex-direction': 'column' },
    children: [
      { type: 'text', role: 'status', when: [{ test: 'search.describing', not: true }], text: '{t:ui.findingTitles}', style: hidden },
      { type: 'text', role: 'status', when: [{ test: 'search.describing' }], text: '{t:search.lookingForVibe}', style: hidden },
      rowSkeleton,
    ],
  },
  titleList,
  {
    ...emptyState('alert', '{t:ui.searchUnavailable}', '{t:ui.searchIsUnavailableTryAnotherQuery}'),
    when: [is('env.search', 'failed'), ...quiet],
  },
  // Asking again after a failed search: a centred pill, not a bar across the page.
  {
    type: 'box',
    when: [is('env.search', 'failed')],
    style: { display: 'flex', 'flex-direction': 'row', 'justify-content': 'center' },
    children: [{ ...retry(44, '22px', '14px'), when: [is('env.search', 'failed')], press: { action: 'retry' } }],
  },
  // No titles, and nothing further down answers: say so, about the mood when the query describes one.
  {
    type: 'box',
    when: [is('env.search', 'ready'), none('search.titleCount'), ...quiet],
    style: column('4px'),
    children: [
      {
        ...emptyState('search', '{t:search.noFilteredMatches}', '{t:search.noFilteredMatchesMessage}'),
        when: [{ test: 'search.filtered' }],
      },
      {
        ...emptyState('alert', '{t:search.moodUnavailable}', '{t:search.moodUnavailableMessage}'),
        when: [{ test: 'search.filtered', not: true }, { test: 'search.describing' }, is('search.descriptiveState', 'failed')],
      },
      {
        type: 'box',
        when: [{ test: 'search.filtered', not: true }, { test: 'search.describing' }, is('search.descriptiveState', 'failed')],
        style: { display: 'flex', 'flex-direction': 'row', 'justify-content': 'center' },
        children: [retry(44, '22px', '14px')],
      },
      {
        ...emptyState('search', '{t:search.noMood}', '{t:search.noMoodMessage}'),
        when: [{ test: 'search.filtered', not: true }, { test: 'search.describing' }, isNot('search.descriptiveState', 'failed')],
      },
      {
        ...emptyState('search', '{t:ui.noMatches}', '{t:ui.noTitleMatchesTryANameAMoodOrADifferentDescription}'),
        when: [{ test: 'search.filtered', not: true }, { test: 'search.describing', not: true }],
      },
    ],
  },
];

// ---- The description search's failure under what the list does show ----

/** A failed description search under the list, with a way to ask again. */
const partial = (text: string, when: Condition[]): Node => ({
  type: 'box',
  when: [is('search.descriptiveState', 'failed'), some('search.titleCount'), ...when],
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

const failedBelow: Node[] = [
  partial('{t:search.moodPartial}', [{ test: 'search.describing' }]),
  partial('{t:search.moodUnavailableBelowTitles}', [{ test: 'search.describing', not: true }]),
];

export const search: Node = {
  type: 'box',
  motion: enter(160),
  style: { position: 'relative', ...column('26px'), 'padding-bottom': '72px' },
  small: { gap: '18px' },
  children: [
    {
      type: 'text', text: '{search.announcement}', role: 'status',
      style: { position: 'absolute', width: '1px', height: '1px', opacity: '0', overflow: 'hidden' },
    },
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
        // The one quiet note when the list matches a description; it arrives with the list.
        {
          type: 'text',
          when: [is('env.search', 'ready'), { test: 'search.describing' }, some('search.titleCount')],
          text: '{t:search.matchingDescription}',
          style: secondary('15px'),
          small: { 'font-size': '14px' },
        },
      ],
    },
    ...titles,
    ...failedBelow,
    liveLane('{t:live.onNow}', 'search.onNow', 'search.onNowCount'),
    liveLane('{t:search.live.comingUp}', 'search.comingUp', 'search.comingUpCount'),
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

/** A focused search control, in the document's colours: it lifts, rings in the accent inside the
 * accent's halo and raises its fill, drawn over its neighbours. Clear across a room on a TV, where
 * focus is the only pointer, and the same under a keyboard elsewhere. */
export const searchControlFocus: Style = {
  scale: '1.06',
  'background-color': '$ui.controlHover',
  color: '$ui.ink',
  'box-shadow': '0px 0px 0px 2px $ui.accent, 0px 0px 0px 7px $ui.focusHalo',
  'z-index': '1',
};
const controlMotion: Style = {
  transition: 'background-color 180ms linear, color 180ms linear, scale 360ms cubic-bezier(0.16, 1, 0.3, 1)',
};

/** A kind chip: the chosen one keeps its ink fill when focused, and lifts and rings as the rest do. */
const kindChip = (): BoxNode => {
  const chip = libChip([{ test: 'search.kindOn' }], '{opt.id}', '{opt.label}');
  const { 'background-color': _fill, color: _ink, ...lift } = searchControlFocus;
  return {
    ...chip,
    press: { action: 'searchKind', arg: '{opt.id}' },
    style: { ...chip.style, ...controlMotion },
    children: [{ type: 'text', text: '{opt.label}', style: { 'white-space': 'nowrap' } }],
    focus: searchControlFocus,
    states: chip.states?.map(state => ({ ...state, style: { ...state.style, ...controlMotion }, focus: lift })),
  };
};

/** A drop-down over the results (library, sort, direction): the select widget reports its focus to
 * this box, which shows it. */
const searchSelect = (when: Condition[], params: Record<string, string>, style: Style): Node => ({
  type: 'widget', widget: 'select', when, params,
  style: { ...style, ...controlMotion },
  focus: { ...searchControlFocus, 'border-color': '$ui.accent' },
});

/** Shared controls are also inserted before search routes supplied by a skin. */
export const searchControls: Node = {
  type: 'box', id: 'vela-search-controls',
  style: { display: 'flex', 'flex-direction': 'row', 'flex-wrap': 'wrap', gap: '10px', ...gutter },
  small: { ...gutterSmall },
  children: [
    { ...chipGroup('Filter search', [{ type: 'repeat', over: 'search.kinds', item: kindChip() }], [{ test: 'search.kindCount', is: 'gt', value: '0' }]), style: { display: 'flex', 'flex-direction': 'row', 'flex-wrap': 'wrap', gap: '4px', padding: '4px', 'border-radius': '$ui.radiusControl', 'background-color': '$ui.control', 'max-width': '100%', 'flex-shrink': '1' }, small: { 'flex-wrap': 'nowrap', 'overflow-x': 'scroll' } },
    searchSelect([{ test: 'search.libraryCount', is: 'gt', value: '1' }],
      { options: 'search.libraries', action: 'searchLibrary', label: 'Search library', testId: 'search-library' }, { ...glassSelect, 'min-width': '140px', 'max-width': '100%', 'flex-shrink': '1' }),
    searchSelect([{ test: 'search.sortCount', is: 'gt', value: '0' }],
      { options: 'search.sorts', action: 'searchSort', label: 'Sort search', testId: 'search-sort' }, { ...glassSelect, 'min-width': '140px', 'max-width': '100%' }),
    searchSelect([{ test: 'search.directionCount', is: 'gt', value: '1' }],
      { options: 'search.directions', action: 'searchDirection', label: 'Sort direction' }, glassSelect),
  ],
};
/** The one list's next page, whichever lane it comes from. */
export const searchPaging: Node = {
  type: 'box', style: { display: 'flex', 'flex-direction': 'row', 'flex-wrap': 'wrap', gap: '10px', ...gutter },
  children: [{ type: 'box', when: [{ test: 'search.moreFast' }],
    press: { action: 'searchMore', arg: 'fast' }, label: 'Show more', style: { ...glassSelect, padding: '12px', ...controlMotion }, focus: { ...searchControlFocus, 'border-color': '$ui.accent' },
    children: [{ type: 'text', text: 'More results' }] }],
};

/** Shared scope controls and grouped title results, including for installed skins. */
const scopeButton = (all: boolean): BoxNode => ({
  ...libChip([{ test: 'search.allServers', not: !all }], all ? 'all' : 'current', all ? '{t:search.allServers}' : '{t:search.currentServer}'),
  press: { action: 'searchScope', arg: all ? 'all' : 'current' },
  testId: all ? 'search-scope-all' : 'search-scope-current',
  focus: searchControlFocus,
});

const scopes = chipGroup('{t:search.scopeLabel}', [scopeButton(false), scopeButton(true)]);
export const searchScope: Node = {
  type: 'box',
  when: [{ test: 'search.canSearchAll' }],
  style: gutter,
  small: gutterSmall,
  children: [{
    ...scopes,
    style: { ...scopes.style, 'align-self': 'center', 'flex-wrap': 'wrap', 'max-width': '100%' },
  }],
};

const serverNote = (when: Condition[], text: string): Node => ({
  type: 'text', when, text, style: { ...secondary('15px'), ...gutter }, small: gutterSmall,
});
const sectionButton = (when: Condition[], text: string): BoxNode => ({
  type: 'box', when,
  press: { action: 'searchServerPage', arg: '{search.serverId}' },
  label: text,
  style: { ...glassSelect, 'align-self': 'flex-start', padding: '12px' },
  focus: searchControlFocus,
  children: [{ type: 'text', text }],
});

export const groupedSearch: Node = {
  type: 'box',
  when: [{ test: 'search.allServers' }],
  style: { position: 'relative', ...column('26px'), 'padding-bottom': '32px' },
  children: [
    {
      type: 'text', text: '{search.announcement}', role: 'status',
      style: { position: 'absolute', width: '1px', height: '1px', opacity: '0', overflow: 'hidden' },
    },
    {
      type: 'text', text: '{t:ui.resultsForQuery|query=env.query}', role: 'heading', level: 1,
      style: { ...display, 'font-size': '46px', 'line-clamp': '2', ...gutter } as Style,
      small: { 'font-size': '32px', ...gutterSmall },
    },
    {
      type: 'repeat', over: 'search.sections', limit: 100, item: {
        type: 'box',
        style: column('12px'),
        children: [
          laneHeading('{search.serverName}'),
          serverNote([is('search.serverStatus', 'loading')], '{t:search.serverSearching}'),
          serverNote([is('search.serverStatus', 'timed-out')], '{t:search.serverTimeout}'),
          serverNote([is('search.serverStatus', 'failed')], '{t:search.serverFailed}'),
          serverNote([{ test: 'search.serverEmpty' }], '{t:search.serverEmpty}'),
          {
            ...titleGrid,
            id: 'vela-search-server-grid-{search.serverId}',
            when: [{ test: 'search.serverHasResults' }],
            style: { ...(titleGrid as BoxNode).style, 'grid-template-columns': 'repeat(auto-fill, minmax(150px, 1fr))' },
            small: { ...(titleGrid as BoxNode).small, 'grid-template-columns': 'repeat({search.phoneColumns}, minmax(0px, 1fr))' },
            children: [{ type: 'repeat', over: 'search.sectionResults', limit: 1000, item: {
              ...searchGridCard,
              id: '{search.resultId}',
              testId: 'search-result-{search.serverId}-{card.id}',
              press: { action: 'openSearchResult', arg: '{search.resultRef}' },
            } as Node }],
          } as Node,
          {
            type: 'box', style: gutter, small: gutterSmall,
            when: [{ test: 'search.serverAction' }],
            children: [
              sectionButton([{ test: 'search.serverError' }], '{t:ui.tryAgain}'),
              sectionButton([{ test: 'search.serverMore' }], '{t:search.serverMore}'),
            ],
          },
        ],
      },
    },
  ],
};

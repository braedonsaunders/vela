import type { Node, Style } from '../../../../protocol/skin';
import { card } from './cards';
import {
  bone,
  cardRadius,
  display,
  enter,
  eyebrow,
  failure,
  focusRing,
  ghost,
  is,
  placeholder,
  pulse,
  ready,
  sans,
  sectionHeading,
  side,
  sideSmall,
  small,
  veil,
} from './look';

// Partial title answers leave the page usable. Only sections the server says are queued
// and the vocabulary confirms are absent get a quiet status, never a playable placeholder.
const pendingStatus = (binding: string, label: string): Node => ({
  type: 'box',
  when: [ready, { test: binding }],
  role: 'status',
  label: `${label} · {t:ui.loadingMore}`,
  style: { display: 'flex', 'flex-direction': 'row', 'align-items': 'center', gap: '12px' },
  children: [
    pulse,
    {
      type: 'text',
      text: `${label} · {t:ui.loadingMore}`,
      style: { 'font-size': '14px', color: '$ui.inkSecondary', 'line-height': '1.55' },
    },
  ],
});

const pendingSection = (binding: string, label: string): Node => ({
  ...pendingStatus(binding, label),
  style: {
    display: 'flex',
    'flex-direction': 'row',
    'align-items': 'center',
    gap: '12px',
    ...side,
  },
  small: { ...sideSmall },
});

export const episodeContext: Node = {
  type: 'text',
  when: [{ test: 'detail.episodeContext' }],
  text: '{detail.episodeContext}',
  style: { 'font-size': '20px', 'font-weight': '600' },
  small: { 'font-size': '17px' },
};

export const band: Node = {
  type: 'box',
  when: [{ test: 'env.load', is: 'eq', value: 'ready' }],
  style: {
    position: 'relative',
    display: 'flex',
    'flex-direction': 'column',
    'justify-content': 'flex-end',
    // The frame starts below the shell's bar (title, below), so the band leaves that much of the
    // screen: on a 540px TV the actions stay above the fold, and the title block stands well up
    // the card rather than at its foot.
    'min-height': 'min(calc(60vh - 70px), 600px)',
    'overflow-x': 'hidden',
    'overflow-y': 'hidden',
  },
  small: { 'min-height': '600px' },
  children: [
    {
      type: 'box',
      motion: 'velaExpose',
      style: {
        position: 'absolute',
        inset: '0px',
        'overflow-x': 'hidden',
        'overflow-y': 'hidden',
        'mask-image': 'linear-gradient(180deg, black 0%, black 78%, transparent 100%)',
      },
      children: [
        {
          type: 'box',
          when: [{ test: 'detail.backdrop' }],
          motion: 'velaDrift',
          style: { position: 'absolute', inset: '0px', 'transform-origin': '58% 40%' },
          children: [
            {
              type: 'image',
              src: '{detail.backdrop}',
              alt: '',
              fade: true,
              style: {
                position: 'absolute',
                inset: '0px',
                width: '100%',
                height: '100%',
                'object-fit': 'cover',
                transition: 'opacity 420ms cubic-bezier(0.16, 1, 0.3, 1)',
              },
            },
          ],
        },
        {
          type: 'box',
          when: [{ test: 'detail.accent' }],
          style: {
            position: 'absolute',
            left: '-12%',
            bottom: '0%',
            width: '70%',
            height: '80%',
            'background-color': '{detail.accent}',
            opacity: '0.18',
            'mask-image': 'radial-gradient(closest-side, black 0%, transparent 100%)',
          },
        },
        {
          type: 'box',
          when: [{ test: 'detail.accent', not: true }],
          style: {
            position: 'absolute',
            left: '-12%',
            bottom: '0%',
            width: '70%',
            height: '80%',
            'background-color': '$ui.accent',
            opacity: '0.18',
            'mask-image': 'radial-gradient(closest-side, black 0%, transparent 100%)',
          },
        },
        {
          type: 'box',
          style: {
            position: 'absolute',
            inset: '0px',
            'background-image': [
              `linear-gradient(90deg, ${veil(94)} 0%, ${veil(44)} 38%, ${veil(0)} 72%)`,
              `linear-gradient(0deg, $ui.page 0%, ${veil(85)} 20%, ${veil(0)} 60%)`,
              `linear-gradient(180deg, ${veil(70)} 0%, ${veil(0)} 22%)`,
            ].join(', '),
          },
        },
        {
          type: 'image',
          src: 'assets/grain.svg',
          alt: '',
          style: {
            position: 'absolute',
            inset: '0px',
            width: '100%',
            height: '100%',
            'object-fit': 'fill',
            opacity: '0.05',
          },
        },
      ],
    },
    {
      type: 'box',
      style: {
        position: 'relative',
        display: 'flex',
        'flex-direction': 'column',
        gap: '24px',
        'padding-top': 'min(72px, 6vh)',
        'padding-bottom': '12px',
        ...side,
        'max-width': '58rem',
      },
      small: { gap: '14px', 'padding-top': '96px', 'padding-bottom': '8px', ...sideSmall },
      children: [
        {
          type: 'box',
          motion: enter(140),
          style: { display: 'flex', 'flex-direction': 'row', gap: '10px', 'align-items': 'center' },
          children: [
            {
              type: 'box',
              when: [{ test: 'detail.accent' }],
              style: {
                width: '24px',
                height: '2px',
                'border-radius': '1px',
                'background-color': '{detail.accent}',
              },
            },
            {
              type: 'box',
              when: [{ test: 'detail.accent', not: true }],
              style: {
                width: '24px',
                height: '2px',
                'border-radius': '1px',
                'background-color': '$ui.accent',
              },
            },
            {
              type: 'text',
              text: '{detail.kindLabel}',
              style: { ...eyebrow, 'font-size': '10px', color: '$ui.accent' },
            },
          ],
        },
        {
          type: 'image',
          when: [{ test: 'detail.logo' }],
          src: '{detail.logo}',
          alt: '{detail.name}',
          role: 'heading',
          level: 1,
          motion: enter(200),
          style: {
            height: '150px',
            width: '80%',
            'max-width': 'min(560px, 80%)',
            'object-fit': 'contain',
            'align-self': 'flex-start',
          },
          small: { height: '92px', 'max-width': '80%' },
        },
        {
          type: 'text',
          when: [{ test: 'detail.logo', not: true }],
          text: '{detail.name}',
          role: 'heading',
          level: 1,
          motion: enter(200),
          style: { ...display, 'font-size': '84px', 'text-shadow': '0px 4px 40px $ui.shadow' },
          small: { 'font-size': '46px' },
        },
        { type: 'use', template: 'velaEpisodeContext' },
        {
          type: 'text',
          text: '{detail.factsLine}',
          motion: enter(260),
          style: { 'font-size': '14px', color: '$ui.inkSecondary', 'font-variant-numeric': 'tabular-nums' },
        },
        {
          type: 'box',
          when: [{ test: 'detail.hasMediaFacts' }],
          motion: enter(300),
          style: { display: 'flex', 'flex-direction': 'row', gap: '8px', 'flex-wrap': 'wrap' },
          children: [
            {
              type: 'repeat',
              over: 'detail.mediaFacts',
              item: {
                type: 'text',
                text: '{fact.text}',
                style: {
                  'font-size': '11px',
                  'font-weight': '650',
                  'letter-spacing': '0.06em',
                  color: '$ui.ink',
                  padding: '5px 9px',
                  'border-radius': '6px',
                  border: '1px solid $ui.glassEdgeStrong',
                  'background-color': '$ui.control',
                  'backdrop-filter': 'blur(12px)',
                },
              },
            },
          ],
        },
        {
          type: 'text',
          when: [{ test: 'detail.summary' }],
          text: '{detail.summary}',
          motion: enter(340),
          style: {
            color: '$ui.ink',
            opacity: '0.88',
            'font-size': '17px',
            'line-height': '1.6',
            'max-width': '42rem',
          },
          // On a TV the synopsis keeps three lines, so the actions stay above the fold.
          states: [{ when: [{ test: 'env.tv' }], style: { 'line-clamp': '3' } }],
          small: { 'font-size': '15px' },
        },
        {
          type: 'box',
          motion: enter(400),
          style: {
            display: 'flex',
            'flex-direction': 'row',
            gap: '12px',
            'align-items': 'center',
            'flex-wrap': 'wrap',
            'margin-top': '10px',
          },
          small: { 'margin-top': '6px' },
          children: [
            {
              type: 'box',
              when: [{ test: 'detail.canPlay' }],
              press: { action: 'play', arg: '{detail.id}' },
              label: '{detail.playLabel}',
              testId: 'detail-play',
              style: {
                position: 'relative',
                display: 'flex',
                'flex-direction': 'row',
                'align-items': 'center',
                height: '56px',
                'box-sizing': 'border-box',
                'padding-left': '30px',
                'padding-right': '34px',
                'border-radius': '$ui.radiusControl',
                'background-color': '$ui.ink',
                color: '$ui.inkInverse',
                'font-weight': '650',
                transition: 'background-color 180ms linear',
              },
              small: { height: '50px', 'padding-left': '22px', 'padding-right': '26px' },
              hover: { 'background-color': '$ui.inkHover' },
              focus: { 'box-shadow': focusRing },
              children: [
                {
                  type: 'box',
                  style: { display: 'flex', 'flex-direction': 'row', gap: '10px', 'align-items': 'center' },
                  children: [
                    { type: 'icon', symbol: 'play-fill', style: { width: '18px', height: '18px' } },
                    { type: 'text', text: '{detail.playLabel}', style: { 'font-size': '16px' } },
                  ],
                },
              ],
            },
            {
              type: 'box',
              when: [{ test: 'detail.trailerReady' }],
              press: { action: 'playExtra', arg: '{detail.trailerId}' },
              label: '{t:ui.watchTrailer}',
              testId: 'detail-trailer',
              style: {
                ...ghost,
                position: 'relative',
                display: 'flex',
                'flex-direction': 'row',
                'align-items': 'center',
                height: '58px',
                'box-sizing': 'border-box',
                'padding-left': '22px',
                'padding-right': '26px',
              },
              small: { height: '52px' },
              hover: { 'background-color': '$ui.controlHover', 'border-color': '$ui.glassEdgeStrong' },
              focus: { 'box-shadow': focusRing },
              children: [
                {
                  type: 'box',
                  style: { display: 'flex', 'flex-direction': 'row', gap: '10px', 'align-items': 'center' },
                  children: [
                    { type: 'icon', symbol: 'play', style: { width: '16px', height: '16px' } },
                    { type: 'text', text: '{t:ui.watchTrailer}', style: { 'font-size': '15px' } },
                  ],
                },
              ],
            },
            pendingStatus('detail.trailerPending', '{t:jellytwin.trailer}'),
          ],
        },
        {
          type: 'box',
          when: [{ test: 'detail.canPlay' }, { test: 'detail.hasResume' }],
          motion: enter(440),
          style: {
            width: '260px',
            height: '3px',
            'border-radius': '2px',
            'background-color': '$ui.trackStrong',
            'overflow-x': 'hidden',
            'overflow-y': 'hidden',
          },
          small: { width: '60%' },
          children: [
            {
              type: 'box',
              style: { height: '3px', width: '{detail.resumePct}%', 'background-color': '$ui.accent' },
            },
          ],
        },
      ],
    },
  ],
};

// One episode: a still that lifts and shows a play mark on hover or focus, then its text.
export const episodeRow: Node = {
  type: 'box',
  group: true,
  motion: 'velaEpisode',
  stagger: { step: 40, cap: 8 },
  style: {
    display: 'flex',
    'flex-direction': 'row',
    gap: '24px',
    'align-items': 'center',
    padding: '18px 0px',
    'border-style': 'none none solid none',
    'border-bottom-width': '1px',
    'border-bottom-color': '$ui.glassEdge',
  },
  small: { gap: '14px', 'align-items': 'flex-start' },
  children: [
    {
      type: 'box',
      press: { action: 'select', arg: '{card.kindId}' },
      label: '{card.label}',
      testId: 'episode-{card.id}',
      style: {
        position: 'relative',
        width: '220px',
        'aspect-ratio': '16 / 9',
        'border-radius': cardRadius(4),
        'overflow-x': 'hidden',
        'overflow-y': 'hidden',
        'background-color': '$ui.raised',
        'flex-shrink': '0',
        scale: '1',
        'box-shadow': '0px 0px 0px 1px $ui.glassEdge',
        transition:
          'scale 360ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 360ms cubic-bezier(0.16, 1, 0.3, 1)',
      },
      small: { width: '128px' },
      groupHover: { scale: '1.03', 'box-shadow': '0px 20px 40px -14px $ui.shadow, 0px 0px 0px 1px $ui.glassEdgeStrong' },
      focus: { 'box-shadow': '0px 0px 0px 3px $ui.ink' },
      children: [
        {
          type: 'image',
          when: [{ test: 'card.backdrop' }],
          src: '{card.backdrop}',
          alt: '',
          fade: true,
          style: {
            position: 'absolute',
            inset: '0px',
            width: '100%',
            height: '100%',
            'object-fit': 'cover',
            transition: 'opacity 420ms cubic-bezier(0.16, 1, 0.3, 1)',
          },
        },
        {
          type: 'box',
          when: [{ test: 'card.backdrop', not: true }],
          style: {
            position: 'absolute',
            inset: '0px',
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'center',
            'background-image': placeholder(160),
          },
          children: [
            {
              type: 'text',
              text: '{card.episodeNumberLabel}',
              style: { ...display, 'font-size': '34px', color: '$ui.inkSecondary' },
              small: { 'font-size': '26px' },
            },
          ],
        },
        {
          type: 'box',
          style: {
            position: 'absolute',
            inset: '0px',
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'center',
            'background-color': veil(19),
            opacity: '0',
            transition: 'opacity 360ms cubic-bezier(0.16, 1, 0.3, 1)',
          },
          groupHover: { opacity: '1' },
          children: [
            {
              type: 'box',
              style: {
                width: '44px',
                height: '44px',
                'border-radius': '22px',
                display: 'flex',
                'align-items': 'center',
                'justify-content': 'center',
                'background-color': '$ui.glass',
                'backdrop-filter': 'blur(10px)',
                border: '1px solid $ui.glassEdgeStrong',
              },
              children: [
                {
                  type: 'icon',
                  symbol: 'play-fill',
                  style: { width: '16px', height: '16px', color: '$ui.ink' },
                },
              ],
            },
          ],
        },
        {
          type: 'box',
          when: [{ test: 'card.hasProgress' }],
          style: {
            position: 'absolute',
            left: '8px',
            right: '8px',
            bottom: '8px',
            height: '3px',
            'border-radius': '2px',
            'background-color': '$ui.trackStrong',
            'overflow-x': 'hidden',
            'overflow-y': 'hidden',
          },
          children: [
            {
              type: 'box',
              style: { height: '3px', width: '{card.progressPct}%', 'background-color': '$ui.accent' },
            },
          ],
        },
      ],
    },
    {
      type: 'box',
      style: { display: 'flex', 'flex-direction': 'column', flex: '1', 'min-width': '0px', gap: '6px' },
      children: [
        {
          type: 'text',
          text: '{episode.numberTitle}',
          role: 'heading',
          level: 3,
          style: { 'font-size': '18px', 'font-weight': '600', 'line-clamp': '2' },
          small: { 'font-size': '15px' },
        },
        {
          type: 'text',
          text: '{card.facts}',
          style: { color: '$ui.inkQuiet', 'font-size': '12px', 'font-variant-numeric': 'tabular-nums' },
        },
        {
          type: 'text',
          when: [{ test: 'card.summary' }, { test: 'env.small', not: true }],
          text: '{card.summary}',
          style: {
            color: '$ui.inkSecondary',
            'font-size': '14px',
            'line-clamp': '2',
            'line-height': '1.55',
            'max-width': '46rem',
          },
        },
      ],
    },
    {
      type: 'box',
      when: [{ test: 'env.small', not: true }],
      press: { action: 'play', arg: '{card.id}' },
      label: '{episode.playLabel}',
      style: {
        position: 'relative',
        width: '44px',
        height: '44px',
        'box-sizing': 'border-box',
        padding: '13px',
        'flex-shrink': '0',
        'border-radius': '$ui.radiusControl',
        border: '1px solid $ui.glassEdge',
        'background-color': '$ui.control',
        'backdrop-filter': 'blur(20px) saturate(1.3)',
      },
      hover: { 'background-color': '$ui.controlHover' },
      focus: { 'box-shadow': focusRing },
      children: [{ type: 'icon', symbol: 'play-fill', style: { width: '16px', height: '16px' } }],
    },
  ],
};

// The next episode to watch, as a glass card above the list.
export const upNext: Node = {
  type: 'repeat',
  over: 'detail.upNext',
  item: {
    type: 'box',
    style: {
      display: 'flex',
      'flex-direction': 'row',
      'align-items': 'center',
      gap: '24px',
      padding: '20px',
      'border-radius': '20px',
      'background-color': '$ui.glass',
      border: '1px solid $ui.glassEdge',
      'box-shadow': 'inset 0px 1px 0px $ui.glassEdgeStrong, 0px 24px 60px -20px $ui.shadow',
    },
    small: { 'flex-direction': 'column', 'align-items': 'stretch', gap: '16px', padding: '16px' },
    children: [
      {
        type: 'image',
        when: [{ test: 'card.backdrop' }],
        src: '{card.backdrop}',
        alt: '',
        style: {
          width: '220px',
          'aspect-ratio': '16 / 9',
          'object-fit': 'cover',
          'border-radius': cardRadius(2),
          'flex-shrink': '0',
        },
        small: { width: '100%' },
      },
      {
        type: 'box',
        style: { display: 'flex', 'flex-direction': 'column', gap: '8px', flex: '1', 'min-width': '0px' },
        children: [
          {
            type: 'text',
            text: '{episode.upNextLabel}',
            style: { ...eyebrow, 'font-size': '10px', color: '$ui.accent' },
          },
          {
            type: 'text',
            text: '{episode.numberTitle}',
            role: 'heading',
            level: 3,
            style: { ...display, 'font-size': '30px' },
            small: { 'font-size': '24px' },
          },
          {
            type: 'text',
            when: [{ test: 'card.facts' }],
            text: '{card.facts}',
            style: { 'font-size': '13px', color: '$ui.inkSecondary' },
          },
        ],
      },
      {
        type: 'box',
        press: { action: 'play', arg: '{card.id}' },
        label: '{episode.playLabel}',
        style: {
          position: 'relative',
          display: 'flex',
          'flex-direction': 'row',
          'align-items': 'center',
          'justify-content': 'center',
          'align-self': 'center',
          height: '50px',
          'box-sizing': 'border-box',
          'padding-left': '22px',
          'padding-right': '26px',
          'flex-shrink': '0',
          'border-radius': '$ui.radiusControl',
          'background-color': '$ui.ink',
          color: '$ui.inkInverse',
          'font-weight': '650',
          transition: 'background-color 180ms linear',
        },
        small: { 'align-self': 'stretch' },
        hover: { 'background-color': '$ui.inkHover' },
        focus: { 'box-shadow': focusRing },
        children: [
          {
            type: 'box',
            style: {
              display: 'flex',
              'flex-direction': 'row',
              gap: '10px',
              'align-items': 'center',
              'justify-content': 'center',
            },
            children: [
              { type: 'icon', symbol: 'play-fill', style: { width: '16px', height: '16px' } },
              { type: 'text', text: '{episode.playLabel}', style: { 'font-size': '15px' } },
            ],
          },
        ],
      },
    ],
  },
};

export const seasonTab = (on: boolean): Node => ({
  type: 'box',
  when: [{ test: 'season.on', not: !on }],
  press: { action: 'select', arg: '{season.pick}' },
  label: '{card.name}',
  style: {
    position: 'relative',
    display: 'flex',
    'flex-direction': 'row',
    'align-items': 'center',
    height: '42px',
    padding: '0px 18px',
    'box-sizing': 'border-box',
    border: '1px solid $ui.glassEdge',
    'border-radius': '$ui.radiusControl',
    'font-weight': '600',
    'flex-shrink': '0',
    'background-color': on ? '$ui.ink' : '$ui.control',
    color: on ? '$ui.inkInverse' : '$ui.ink',
    transition: 'background-color 180ms linear, color 180ms linear',
  },
  hover: { 'border-color': '$ui.glassEdgeStrong' },
  focus: { 'box-shadow': '0px 0px 0px 2px $ui.accent' },
  children: [{ type: 'text', text: '{card.name}', style: { 'font-size': '14px' } }],
});

export const episodes: Node = {
  type: 'box',
  when: [{ test: 'env.load', is: 'eq', value: 'ready' }, { test: 'detail.hasEpisodes' }],
  motion: enter(480),
  style: { display: 'flex', 'flex-direction': 'column', gap: '24px', ...side },
  small: { gap: '18px', ...sideSmall },
  children: [
    {
      type: 'box',
      style: {
        display: 'flex',
        'flex-direction': 'row',
        'align-items': 'flex-end',
        'justify-content': 'space-between',
        'flex-wrap': 'wrap',
        gap: '16px',
      },
      children: [
        {
          type: 'text',
          text: '{t:ui.episodes}',
          role: 'heading',
          level: 2,
          style: { ...display, 'font-size': '38px' },
          small: { 'font-size': '30px' },
        },
      ],
    },
    // The season tabs: a glass bar that scrolls sideways. Compiled pins it while its episodes
    // are in view; native pins only a route's direct children, which would keep it over the
    // rest of the page, so it scrolls with the list.
    {
      type: 'box',
      when: [{ test: 'detail.hasSeasons' }],
      role: 'group',
      label: '{t:ui.season}',
      testId: 'season-picker',
      style: {
        position: 'relative',
        display: 'flex',
        'flex-direction': 'row',
        gap: '8px',
        'overflow-x': 'auto',
        'overflow-y': 'hidden',
        'scrollbar-width': 'none',
        'margin-left': '-12px',
        'margin-right': '-12px',
        'padding-left': '12px',
        'padding-right': '12px',
        'padding-top': '10px',
        'padding-bottom': '10px',
        'border-radius': '16px',
        'background-color': veil(82),
        'backdrop-filter': 'blur(20px) saturate(1.3)',
      },
      small: {
        'margin-left': '-20px',
        'margin-right': '-20px',
        'padding-left': '20px',
        'padding-right': '20px',
        'border-radius': '0px',
      },
      children: [
        {
          type: 'repeat',
          over: 'detail.seasons',
          item: {
            type: 'box',
            style: { display: 'flex', 'flex-shrink': '0' },
            children: [seasonTab(true), seasonTab(false)],
          },
        },
      ],
    },
    upNext,
    // The episodes sit flush (each row draws its own padding and rule).
    {
      type: 'box',
      style: { display: 'flex', 'flex-direction': 'column' },
      children: [{ type: 'repeat', over: 'detail.episodes', item: episodeRow }],
    },
  ],
};

// An extra (trailer, featurette): a glass tile that plays, or says it is unavailable.
export const extraTile = (ready: boolean): Node =>
  ({
    type: 'box',
    ...(ready ? { active: { scale: '0.97' } } : {}),
    when: [{ test: 'extra.ready', not: !ready }],
    ...(ready ? { press: { action: 'playExtra', arg: '{extra.id}' } } : {}),
    label: '{extra.name}',
    style: {
      ...ghost,
      position: 'relative',
      'border-radius': '16px',
      width: '318px',
      height: '148px',
      padding: '18px',
      'box-sizing': 'border-box',
      'flex-shrink': '0',
      ...(ready ? {} : { opacity: '0.42' }),
    },
    small: { width: '258px', height: '134px' },
    ...(ready
      ? {
          hover: { 'background-color': '$ui.controlHover', 'border-color': '$ui.glassEdgeStrong' },
          focus: { 'box-shadow': focusRing },
        }
      : {}),
    children: [
      {
        type: 'box',
        style: {
          display: 'flex',
          'flex-direction': 'row',
          gap: '14px',
          'align-items': 'center',
          height: '100%',
        },
        children: [
          {
            type: 'box',
            style: {
              width: '40px',
              height: '40px',
              'border-radius': '20px',
              display: 'flex',
              'align-items': 'center',
              'justify-content': 'center',
              'background-color': ready ? '$ui.ink' : '$ui.control',
              'flex-shrink': '0',
            },
            children: [
              {
                type: 'icon',
                symbol: ready ? 'play-fill' : 'lock',
                style: { width: '14px', height: '14px', color: ready ? '$ui.inkInverse' : '$ui.inkQuiet' },
              },
            ],
          },
          {
            type: 'box',
            style: {
              display: 'flex',
              'flex-direction': 'column',
              gap: '4px',
              flex: '1',
              'min-width': '0px',
              'text-align': 'left',
            },
            children: [
              {
                type: 'text',
                text: '{extra.name}',
                style: { 'font-size': '15px', 'font-weight': '600', 'line-clamp': '2' },
              },
              ...(ready
                ? []
                : [
                    {
                      type: 'text',
                      text: '{t:ui.notAvailableYet}',
                      style: { 'font-size': '12px', color: '$ui.inkQuiet' },
                    } as Node,
                  ]),
            ],
          },
        ],
      },
    ],
  }) as Node;
export const extras: Node = {
  type: 'box',
  when: [{ test: 'env.load', is: 'eq', value: 'ready' }, { test: 'detail.hasExtras' }],
  motion: enter(520),
  style: { display: 'flex', 'flex-direction': 'column', gap: '16px' },
  children: [
    {
      ...sectionHeading('extras'),
      style: { ...display, 'font-size': '34px', ...side },
      small: { 'font-size': '28px', ...sideSmall },
    } as Node,
    {
      type: 'box',
      style: {
        display: 'flex',
        'flex-direction': 'row',
        gap: '14px',
        'overflow-x': 'auto',
        'overflow-y': 'hidden',
        'scrollbar-width': 'none',
        ...side,
        'padding-top': '4px',
        'padding-bottom': '8px',
      },
      small: { ...sideSmall },
      children: [
        {
          type: 'repeat',
          over: 'detail.extras',
          item: {
            type: 'box',
            style: { display: 'flex', 'flex-shrink': '0' },
            children: [extraTile(true), extraTile(false)],
          },
        },
      ],
    },
  ],
};

// The cast: round portraits (or initials) with names and roles.
export const cast: Node = {
  type: 'box',
  when: [{ test: 'env.load', is: 'eq', value: 'ready' }, { test: 'detail.hasCast' }],
  motion: enter(560),
  style: { display: 'flex', 'flex-direction': 'column', gap: '16px' },
  children: [
    {
      type: 'box',
      style: {
        display: 'flex',
        'flex-direction': 'row',
        'align-items': 'center',
        'justify-content': 'space-between',
        ...side,
      },
      small: { ...sideSmall },
      children: [sectionHeading('featuring')],
    },
    {
      type: 'box',
      style: {
        display: 'flex',
        'flex-direction': 'row',
        gap: '20px',
        'overflow-x': 'auto',
        'overflow-y': 'hidden',
        'scrollbar-width': 'none',
        'mask-image': 'linear-gradient(90deg, black 0%, black 94%, transparent 100%)',
        ...side,
        'padding-top': '4px',
        'padding-bottom': '8px',
      },
      small: { gap: '14px', ...sideSmall },
      children: [
        {
          type: 'repeat',
          over: 'detail.cast',
          item: {
            type: 'box',
            style: {
              display: 'flex',
              'flex-direction': 'column',
              width: '112px',
              'flex-shrink': '0',
              gap: '8px',
              'align-items': 'center',
              'text-align': 'center',
            },
            small: { width: '84px' },
            children: [
              {
                type: 'box',
                style: {
                  position: 'relative',
                  display: 'flex',
                  'align-items': 'center',
                  'justify-content': 'center',
                  width: '100px',
                  height: '100px',
                  'border-radius': '$ui.radiusControl',
                  'overflow-x': 'hidden',
                  'overflow-y': 'hidden',
                  'background-image': placeholder(135),
                  'box-shadow': '0px 0px 0px 1px $ui.glassEdgeStrong, 0px 12px 28px -14px $ui.shadow',
                },
                small: { width: '76px', height: '76px' },
                children: [
                  {
                    type: 'image',
                    when: [{ test: 'person.portrait' }],
                    src: '{person.portrait}',
                    alt: '',
                    fade: true,
                    style: {
                      position: 'absolute',
                      inset: '0px',
                      width: '100%',
                      height: '100%',
                      'object-fit': 'cover',
                      transition: 'opacity 420ms cubic-bezier(0.16, 1, 0.3, 1)',
                    },
                  },
                  {
                    type: 'text',
                    when: [{ test: 'person.portrait', not: true }],
                    text: '{person.initials}',
                    style: { ...display, 'font-size': '36px', color: '$ui.inkSecondary' },
                    small: { 'font-size': '28px' },
                  },
                ],
              },
              {
                type: 'text',
                text: '{person.name}',
                style: { 'font-size': '13px', 'font-weight': '600', 'line-clamp': '2', color: '$ui.ink' },
              },
              {
                type: 'text',
                when: [{ test: 'person.role' }],
                text: '{person.role}',
                style: { 'font-size': '12px', color: '$ui.inkQuiet', 'line-clamp': '2' },
              },
            ],
          },
        },
      ],
    },
  ],
};

export const crew: Node = {
  type: 'box',
  when: [{ test: 'env.load', is: 'eq', value: 'ready' }, { test: 'detail.crewLine' }],
  motion: enter(580),
  style: { display: 'flex', 'flex-direction': 'column', gap: '12px', ...side },
  small: { ...sideSmall },
  children: [
    sectionHeading('behindTheStory'),
    {
      type: 'text',
      text: '{detail.crewLine}',
      style: { 'font-size': '15px', color: '$ui.inkSecondary', 'line-height': '1.7', 'max-width': '48rem' },
    },
  ],
};

export const related: Node = {
  type: 'repeat',
  over: 'detail.related',
  when: [{ test: 'env.load', is: 'eq', value: 'ready' }],
  item: { type: 'use', template: 'velaRelatedRow', motion: enter(600) },
};

export const detailSections: Node[] = [
  band,
  pendingSection('detail.seasonsPending', '{t:ui.seasons}'),
  pendingSection('detail.episodesPending', '{t:ui.episodes}'),
  episodes,
  pendingSection('detail.extrasPending', '{t:ui.extras}'),
  extras,
  cast,
  crew,
  related,
];

export const titleLoading: Node = {
  type: 'box',
  when: [is('env.load', 'loading')],
  role: 'status',
  label: '{t:ui.openingTitle}',
  motion: 'velaStatusOpen',
  style: {
    display: 'flex',
    'flex-direction': 'column',
    gap: '18px',
    ...side,
    'padding-top': '300px',
    'padding-bottom': '48px',
    'background-image': `radial-gradient(ellipse 90% 60% at 30% 20%, $ui.skeleton 0%, ${veil(0)} 70%)`,
  } as Style,
  small: { ...sideSmall, 'padding-top': '260px' } as Style,
  children: [
    bone('90px', '10px', 4),
    bone('min(620px, 60%)', '72px', 10, { width: '85%', height: '44px' }),
    bone('260px', '14px', 4),
    bone('min(560px, 55%)', '52px', 8, { width: '100%' }),
    bone('170px', '56px', 28),
  ],
};
// The page frame; the scrim, blur and dissolve behind it are the route column's (the foundation's).
// The frame starts below the shell's 84px bar, so its close button never sits on the bar's
// profile (a 540px-tall TV screen leaves only 22px of 4vh). Its spacing is the frame's margin:
// the root is the route's scroll view, whose own padding native ignores.
export const title: Node = {
  type: 'box',
  style: {
    position: 'absolute',
    inset: '0px',
    display: 'flex',
    'flex-direction': 'column',
    color: '$ui.ink',
    'font-family': sans,
  },
  children: [
    {
      type: 'box',
      motion: 'velaOpen',
      style: {
        position: 'relative',
        display: 'flex',
        'flex-direction': 'column',
        // A fixed frame, exactly the screen less its margins: the route itself never scrolls,
        // only the region inside the frame does. Otherwise a TV's focus engine scrolls the whole
        // page to the focused action and carries the frame and its close button under the bar.
        height: 'calc(100vh - max(4vh, 92px) - 4vh)',
        'flex-shrink': '0',
        'overflow-x': 'hidden',
        'overflow-y': 'hidden',
        'border-radius': '$ui.radiusPanel',
        'background-color': '$ui.page',
        'box-shadow': '0px 50px 160px $ui.shadow, 0px 0px 0px 1px $ui.glassEdge',
        margin: '4vh 4vw',
        'margin-top': 'max(4vh, 92px)',
      },
      small: { 'border-radius': '0px', margin: '0px', 'margin-top': '0px', height: '100dvh' },
      children: [
        // The close button stands in a strip across the frame's top. On a TV the strip is a focus
        // region: up from anything at the top of the page lands on the button, which tvOS's focus
        // engine (moving only to what lies in line) otherwise never reaches from the left-hand
        // actions. The strip takes no pointer itself.
        {
          type: 'box',
          role: 'navigation',
          label: '{t:ui.close}',
          style: {
            position: 'absolute',
            top: '0px',
            left: '0px',
            right: '0px',
            'z-index': '10',
            display: 'flex',
            'flex-direction': 'row',
            'justify-content': 'flex-end',
            padding: '20px',
            'pointer-events': 'box-none',
          },
          // On a phone the page is full-bleed under the shell's bar and tabs: the button sits below them.
          small: { 'padding-top': 'calc(104px + env(safe-area-inset-top))', 'padding-right': '16px' },
          children: [
        {
          type: 'box',
          press: { action: 'back' },
          label: '{t:ui.close}',
          testId: 'detail-close',
          style: {
            width: '44px',
            height: '44px',
            'box-sizing': 'border-box',
            padding: '13px',
            'border-radius': '22px',
            border: '1px solid $ui.glassEdge',
            'background-color': '$ui.glass',
            'backdrop-filter': 'blur(20px) saturate(1.3)',
          },
          children: [{ type: 'icon', symbol: 'close', style: { width: '18px', height: '18px' } }],
        },
          ],
        },
        {
          type: 'box',
          id: '{env.route}-scroll-{env.entry}',
          role: 'region',
          style: {
            flex: '1',
            'min-height': '0px',
            // Scrolls vertically only. An overflow-x: hidden here becomes overflow: hidden on
            // native and on the web, which stops the region scrolling at all.
            'overflow-y': 'auto',
            display: 'flex',
            'flex-direction': 'column',
            gap: '52px',
            'padding-bottom': '72px',
          },
          small: { gap: '36px' },
          children: [
            titleLoading,
            failure('{t:ui.thisTitleCouldnTBeOpenedItMayNoLongerBeAvailable}'),
            ...detailSections,
          ],
        },
      ],
    },
  ],
};

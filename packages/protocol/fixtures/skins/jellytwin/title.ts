// The title page: backdrop, poster, facts and actions, then seasons, episodes, extras, cast and related rows.
import type { Condition, Node, Style } from '../../../skin';
import {
  type Press,
  sans,
  gradient,
  side,
  sideSmall,
  row,
  col,
  fill,
  hairline,
  glyph,
  jelly,
  kindGlyphs,
  tile,
  iconBtn,
  iconBtnHover,
  iconBtnFocus,
  tabNode,
  ready,
  waiting,
  failure,
} from './look';
import { section, sectionTitle } from './cards';

const heading2: Style = { 'font-size': '21px', 'font-weight': '600', color: '$ink-strong' };
const heading2Small: Style = { 'font-size': '17px' };
const heading20: Style = { 'font-size': '20px', 'font-weight': '600', color: '$ink-strong' };
const block: Style = col({ 'padding-bottom': '26px' });

// A round action under the title: the play circle carries the gradient.
const roundAction = (
  label: string,
  icon: Node,
  primary: boolean,
  press: Press,
  testId: string,
  when: Condition[] = [],
): Node => ({
  type: 'box',
  press,
  label,
  testId,
  when,
  style: col({
    position: 'relative',
    'align-items': 'center',
    gap: '6px',
    padding: '0px',
    'border-radius': '8px',
    color: '$ink-strong',
    cursor: 'pointer',
  }),
  hover: { opacity: '0.88' },
  focus: { outline: 'auto', 'box-shadow': '0px 0px 0px 2px $accent' },
  children: [
    {
      type: 'box',
      style: {
        width: '58px',
        height: '58px',
        'border-radius': '999px',
        display: 'flex',
        'align-items': 'center',
        'justify-content': 'center',
        'box-sizing': 'border-box',
        'box-shadow': '0px 4px 14px $shadow',
        ...(primary
          ? { 'background-color': '$accent', 'background-image': gradient }
          : { 'background-color': '$raised', border: '1px solid $line' }),
      },
      small: { width: '54px', height: '54px' },
      children: [icon],
    },
    { type: 'text', text: label, style: { 'font-size': '12px', color: '$secondary' } },
  ],
});
const infoLine = (label: string, value: string, when: Condition[]): Node => ({
  type: 'box',
  when,
  style: row({ gap: '10px', 'align-items': 'baseline' }),
  children: [
    { type: 'text', text: label, style: { color: '$secondary', width: '90px', 'flex-shrink': '0' } },
    { type: 'text', text: value, style: { color: '$ink', flex: '1', 'min-width': '0px' } },
  ],
});

const titleTop: Node = {
  type: 'box',
  style: col({ position: 'relative' }),
  children: [
    {
      type: 'box',
      style: col({
        position: 'relative',
        height: 'min(56vh, 520px)',
        'overflow-x': 'hidden',
        'overflow-y': 'hidden',
        'background-color': '$card',
      }),
      small: { height: '230px' },
      children: [
        tile('detail.seed', {}, [{ test: 'detail.backdrop', not: true }]),
        {
          type: 'image',
          when: [{ test: 'detail.backdrop' }],
          src: '{detail.backdrop}',
          alt: '',
          style: { ...fill, width: '100%', height: '100%', 'object-fit': 'cover' },
        },
        {
          type: 'box',
          style: {
            ...fill,
            'background-image':
              'linear-gradient(0deg, $page 0%, $scrim-page 18%, $scrim-clear 60%), ' +
              'linear-gradient(180deg, $scrim 0%, $scrim-clear 30%)',
          },
        },
      ],
    },
    {
      type: 'box',
      style: row({
        position: 'relative',
        gap: '36px',
        'align-items': 'flex-start',
        ...side,
        'margin-top': '-190px',
      }),
      small: { gap: '0px', ...sideSmall, 'margin-top': '-60px' },
      children: [
        {
          type: 'box',
          style: col({
            position: 'relative',
            width: 'clamp(180px, 17vw, 300px)',
            'flex-shrink': '0',
            'aspect-ratio': '2 / 3',
            'border-radius': '6px',
            'overflow-x': 'hidden',
            'overflow-y': 'hidden',
            'background-color': '$card',
            'box-shadow': '0px 8px 30px $shadow',
            'align-items': 'center',
            'justify-content': 'center',
            color: '$secondary',
          }),
          small: { display: 'none' },
          children: [
            tile('detail.seed', {}, [{ test: 'detail.poster', not: true }]),
            {
              type: 'image',
              when: [{ test: 'detail.poster' }],
              src: '{detail.poster}',
              alt: '',
              style: { width: '100%', height: '100%', 'object-fit': 'cover' },
            },
            {
              type: 'box',
              when: [{ test: 'detail.poster', not: true }],
              style: { position: 'relative', width: '56px', height: '56px' },
              children: kindGlyphs('detail.kind', 0, { width: '100%', height: '100%' }),
            },
          ],
        },
        {
          type: 'box',
          style: col({
            flex: '1',
            'min-width': '0px',
            gap: '16px',
            'padding-top': '60px',
            'align-items': 'flex-start',
            'text-align': 'left',
          }),
          small: { gap: '12px', 'padding-top': '0px', 'align-items': 'center', 'text-align': 'center' },
          children: [
            {
              type: 'image',
              when: [{ test: 'detail.logo' }],
              src: '{detail.logo}',
              alt: '{detail.name}',
              role: 'heading',
              level: 1,
              style: {
                height: '110px',
                width: '80%',
                'max-width': 'min(480px, 90%)',
                'object-fit': 'contain',
              },
              small: { height: '70px', 'max-width': '80%' },
            },
            {
              type: 'text',
              when: [{ test: 'detail.logo', not: true }],
              text: '{detail.name}',
              role: 'heading',
              level: 1,
              style: {
                'font-size': '40px',
                'font-weight': '700',
                color: '$ink-strong',
                'line-height': '1.15',
                'text-shadow': '0px 2px 10px $shadow',
              },
              small: { 'font-size': '28px' },
            },
            { type: 'use', template: 'velaEpisodeContext' },
            {
              type: 'box',
              style: row({
                gap: '14px',
                'align-items': 'center',
                'flex-wrap': 'wrap',
                'justify-content': 'flex-start',
                'font-size': '15px',
              }),
              small: { 'justify-content': 'center' },
              children: [
                { type: 'text', text: '{detail.kindLabel}', style: { color: '$secondary' } },
                {
                  type: 'text',
                  when: [{ test: 'detail.yearLabel' }],
                  text: '{detail.yearLabel}',
                  style: { color: '$ink-strong' },
                },
                {
                  type: 'text',
                  when: [{ test: 'detail.durationLabel' }, { test: 'detail.kind', is: 'ne', value: 'show' }],
                  text: '{detail.durationLabel}',
                  style: { color: '$ink-strong' },
                },
                {
                  type: 'text',
                  when: [{ test: 'detail.rating' }],
                  text: '{detail.rating}',
                  style: {
                    'font-size': '12px',
                    padding: '1px 6px',
                    border: '1px solid $secondary',
                    'border-radius': '3px',
                  },
                },
                {
                  type: 'box',
                  when: [{ test: 'detail.played' }],
                  style: row({ gap: '4px', 'align-items': 'center', color: '$accent' }),
                  children: [
                    glyph('checkmark', 16),
                    { type: 'text', text: '{s:played}', style: { 'font-size': '14px' } },
                  ],
                },
              ],
            },
            {
              type: 'box',
              style: row({
                gap: '12px',
                'align-items': 'flex-start',
                'flex-wrap': 'wrap',
                'justify-content': 'flex-start',
                'margin-top': '4px',
              }),
              small: { gap: '14px', 'justify-content': 'center' },
              children: [
                roundAction(
                  '{s:resume}',
                  glyph('play-fill', 28),
                  true,
                  { action: 'play', arg: '{detail.id}' },
                  'detail-play',
                  [{ test: 'detail.canPlay' }, { test: 'detail.hasResume' }],
                ),
                roundAction(
                  '{s:play}',
                  glyph('play-fill', 28),
                  true,
                  { action: 'play', arg: '{detail.id}' },
                  'detail-play',
                  [{ test: 'detail.canPlay' }, { test: 'detail.hasResume', not: true }],
                ),
                {
                  type: 'repeat',
                  over: 'detail.trailers',
                  item: roundAction(
                    '{s:trailer}',
                    jelly('film', 24),
                    false,
                    { action: 'playExtra', arg: '{extra.id}' },
                    'detail-trailer-{extra.id}',
                  ),
                },
              ],
            },
            {
              type: 'box',
              when: [{ test: 'detail.hasResume' }, { test: 'detail.durationLabel' }],
              style: col({ gap: '6px', width: '320px' }),
              small: { width: '70%' },
              children: [
                {
                  type: 'box',
                  role: 'progressbar',
                  label: '{s:watchProgress}',
                  style: {
                    height: '5px',
                    'border-radius': '3px',
                    'background-color': '$track',
                    'overflow-x': 'hidden',
                    'overflow-y': 'hidden',
                  },
                  children: [
                    {
                      type: 'box',
                      style: { height: '5px', width: '{detail.resumePct}%', 'background-color': '$accent' },
                    },
                  ],
                },
                { type: 'text', text: '{s:resumeFrom}', style: { 'font-size': '13px', color: '$secondary' } },
              ],
            },
            {
              type: 'text',
              when: [{ test: 'detail.summary' }],
              text: '{detail.summary}',
              style: {
                'font-size': '16px',
                'line-height': '1.6',
                color: '$ink',
                'max-width': '52rem',
                'text-align': 'left',
              },
              small: { 'font-size': '15px' },
            },
            {
              type: 'box',
              style: col({
                gap: '6px',
                'font-size': '14px',
                'max-width': '52rem',
                'align-self': 'stretch',
                'text-align': 'left',
              }),
              children: [
                infoLine('{s:genres}', '{detail.genresLine}', [{ test: 'detail.genresLine' }]),
                infoLine('{s:crew}', '{detail.crewLineComma}', [{ test: 'detail.crewLineComma' }]),
                {
                  type: 'box',
                  when: [{ test: 'detail.hasMediaFacts' }],
                  style: row({ gap: '8px', 'flex-wrap': 'wrap', 'margin-top': '6px' }),
                  children: [
                    {
                      type: 'repeat',
                      over: 'detail.mediaFacts',
                      item: {
                        type: 'text',
                        text: '{fact.text}',
                        style: {
                          'font-size': '12px',
                          'font-weight': '600',
                          padding: '4px 8px',
                          'border-radius': '4px',
                          'background-color': '$raised',
                          color: '$ink',
                        },
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

// One episode in a season's list: its still, number and name, facts and overview.
const episodeRow: Node = {
  type: 'box',
  group: true,
  style: row({
    position: 'relative',
    gap: '20px',
    'align-items': 'center',
    padding: '12px 8px',
    'border-radius': '6px',
    'background-color': 'transparent',
  }),
  small: { gap: '12px', 'align-items': 'flex-start' },
  children: [
    // The row's ground lights while it is hovered or its play button has focus.
    {
      type: 'box',
      style: { ...fill, 'border-radius': '6px', 'background-color': 'transparent' },
      groupHover: { 'background-color': '$hover' },
      groupFocus: { 'background-color': '$hover' },
    },
    {
      type: 'box',
      press: { action: 'play', arg: '{card.id}' },
      label: '{episode.playLabel}',
      style: {
        position: 'relative',
        width: '220px',
        'aspect-ratio': '16 / 9',
        'flex-shrink': '0',
        'border-radius': '4px',
        'overflow-x': 'hidden',
        'overflow-y': 'hidden',
        'background-color': '$card',
        color: '$ink-strong',
        cursor: 'pointer',
      },
      small: { width: '130px' },
      focus: { outline: 'auto', 'box-shadow': '0px 0px 0px 3px $accent' },
      children: [
        tile('card.seed', {}, [{ test: 'card.backdrop', not: true }]),
        {
          type: 'image',
          when: [{ test: 'card.backdrop' }],
          src: '{card.backdrop}',
          alt: '',
          style: { ...fill, width: '100%', height: '100%', 'object-fit': 'cover' },
        },
        {
          type: 'box',
          style: {
            ...fill,
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'center',
            'background-color': '$overlay',
            opacity: '0',
            transition: 'opacity 140ms linear',
          },
          groupHover: { opacity: '1' },
          groupFocus: { opacity: '1' },
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
                'background-color': '$accent',
              },
              children: [glyph('play-fill', 24)],
            },
          ],
        },
        {
          type: 'box',
          when: [{ test: 'card.played' }],
          style: {
            position: 'absolute',
            top: '6px',
            right: '6px',
            width: '24px',
            height: '24px',
            'border-radius': '12px',
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'center',
            'background-color': '$accent',
            color: '$ink-strong',
          },
          children: [glyph('checkmark', 14)],
        },
        {
          type: 'box',
          when: [{ test: 'card.hasProgress' }],
          style: {
            position: 'absolute',
            left: '0px',
            right: '0px',
            bottom: '0px',
            height: '4px',
            'background-color': '$overlay',
          },
          children: [
            {
              type: 'box',
              style: { height: '100%', width: '{card.progressPct}%', 'background-color': '$accent' },
            },
          ],
        },
      ],
    },
    {
      type: 'box',
      style: col({ position: 'relative', flex: '1', 'min-width': '0px', gap: '5px' }),
      children: [
        {
          type: 'box',
          press: { action: 'select', arg: '{card.kindId}' },
          label: '{card.label}',
          testId: 'episode-{card.id}',
          style: { position: 'relative', color: '$ink-strong', 'text-align': 'left', cursor: 'pointer' },
          hover: { color: '$accent' },
          focus: { outline: 'auto', color: '$accent' },
          children: [
            {
              type: 'text',
              text: '{episode.numberTitle}',
              style: { 'font-size': '16px', 'font-weight': '600', 'line-clamp': '2' },
              small: { 'font-size': '15px' },
            },
          ],
        },
        {
          type: 'text',
          when: [{ test: 'card.facts' }],
          text: '{card.facts}',
          style: { 'font-size': '13px', color: '$secondary', 'font-variant-numeric': 'tabular-nums' },
        },
        {
          type: 'text',
          when: [{ test: 'card.summary' }, { test: 'env.small', not: true }],
          text: '{card.summary}',
          style: { 'font-size': '14px', 'line-height': '1.5', color: '$ink', 'line-clamp': '2' },
        },
      ],
    },
  ],
};

const seasonTab = tabNode(
  '{card.name}',
  { test: 'season.on' },
  { action: 'select', arg: '{season.pick}' },
  { name: 'jt-season-tab', bottom: 0 },
);

// An extra: a wide tile that plays, or says it is not available yet.
const extraFace = (ready: boolean): Node =>
  ({
    type: 'box',
    when: [{ test: 'extra.ready', not: !ready }],
    press: { action: 'playExtra', arg: '{extra.id}' },
    label: ready ? '{s:playExtra}' : '{s:extraNotAvailable}',
    disabled: ready ? [] : [{ test: 'extra.ready', not: true }],
    style: {
      position: 'relative',
      width: '60px',
      height: '60px',
      'flex-shrink': '0',
      'border-radius': '6px',
      'overflow-x': 'hidden',
      'overflow-y': 'hidden',
      display: 'flex',
      'align-items': 'center',
      'justify-content': 'center',
      color: '$ink-strong',
      cursor: ready ? 'pointer' : 'default',
    },
    hover: { 'box-shadow': '0px 0px 0px 3px $accent' },
    focus: { outline: 'auto', 'box-shadow': '0px 0px 0px 3px $accent' },
    children: [
      tile('extra.seed'),
      {
        type: 'box',
        style: {
          position: 'relative',
          width: '48px',
          height: '48px',
          'border-radius': '24px',
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'center',
          'background-color': ready ? '$accent' : '$raised',
          opacity: ready ? '1' : '0.6',
        },
        children: [glyph(ready ? 'play-fill' : 'info', 24)],
      },
    ],
  }) as Node;
const extraCard: Node = {
  type: 'box',
  style: row({ width: 'clamp(220px, 18vw, 320px)', 'flex-shrink': '0', gap: '10px', 'align-items': 'center' }),
  small: { width: '52vw' },
  children: [
    extraFace(true),
    extraFace(false),
    {
      type: 'text',
      text: '{extra.name}',
      style: {
        'font-size': '13px',
        'font-weight': '500',
        color: '$ink-strong',
        'text-align': 'center',
        'line-clamp': '1',
      },
    },
    {
      type: 'text',
      when: [{ test: 'extra.ready', not: true }],
      text: '{s:notYet}',
      style: { 'font-size': '12px', color: '$secondary', 'text-align': 'center' },
    },
  ],
};

const person: Node = {
  type: 'box',
  role: 'listitem',
  style: col({
    width: 'clamp(110px, 8.6vw, 160px)',
    'flex-shrink': '0',
    gap: '2px',
    'align-items': 'center',
    'text-align': 'center',
  }),
  small: { width: '26vw' },
  children: [
    {
      type: 'image',
      when: [{ test: 'person.portrait' }],
      src: '{person.portrait}',
      alt: '',
      style: {
        width: '100%',
        'aspect-ratio': '2 / 3',
        'border-radius': '6px',
        'object-fit': 'cover',
        'margin-bottom': '4px',
        'overflow-x': 'hidden',
        'overflow-y': 'hidden',
      },
    },
    {
      type: 'box',
      when: [{ test: 'person.portrait', not: true }],
      style: col({
        position: 'relative',
        width: '100%',
        'aspect-ratio': '2 / 3',
        'border-radius': '6px',
        'margin-bottom': '4px',
        'align-items': 'center',
        'justify-content': 'center',
        color: '$secondary',
        'overflow-x': 'hidden',
        'overflow-y': 'hidden',
      }),
      children: [
        tile('person.seed'),
        glyph('person', 46, {
          style: { position: 'relative', width: '46px', height: '46px' },
          small: { width: '34px', height: '34px' },
        }),
      ],
    },
    {
      type: 'text',
      text: '{person.name}',
      style: {
        width: '100%',
        'font-size': '13px',
        'font-weight': '500',
        color: '$ink-strong',
        'line-clamp': '2',
      },
    },
    {
      type: 'text',
      when: [{ test: 'person.role' }],
      text: '{person.role}',
      style: { width: '100%', 'font-size': '12px', color: '$secondary', 'line-clamp': '1' },
    },
  ],
};

const hscroll = (children: Node[], role?: string): Node => ({
  type: 'box',
  style: row({ 'overflow-x': 'auto', 'overflow-y': 'hidden', 'scrollbar-width': 'none' }),
  children: [
    {
      type: 'box',
      role,
      style: row({ gap: '16px', ...side, 'padding-bottom': '6px' }),
      small: { gap: '10px', ...sideSmall },
      children,
    },
  ],
});

const titleRest: Node = {
  type: 'box',
  style: col({ 'padding-top': '40px', 'padding-bottom': '56px' }),
  small: { 'padding-top': '26px' },
  children: [
    {
      type: 'repeat',
      over: 'detail.upNext',
      item: {
        type: 'box',
        style: col({ gap: '10px', ...side, ...block }),
        small: { ...sideSmall, 'padding-bottom': '18px' },
        children: [
          {
            type: 'text',
            text: '{s:nextUp}',
            role: 'heading',
            level: 2,
            style: heading2,
            small: heading2Small,
          },
          {
            type: 'box',
            style: row({ gap: '14px', 'align-items': 'center' }),
            children: [
              { type: 'use', template: 'upNext' },
              {
                type: 'box',
                when: [{ test: 'env.small', not: true }],
                press: { action: 'play', arg: '{card.id}' },
                label: '{episode.playLabel}',
                style: { ...iconBtn(56), 'background-color': '$raised' },
                hover: iconBtnHover,
                focus: iconBtnFocus,
                children: [glyph('play-fill', 28)],
              },
            ],
          },
        ],
      },
    },
    {
      ...section('detail.seasons', [sectionTitle('{s:seasons}')], undefined),
      when: [
        { test: 'detail.seasonCount', is: 'gt', value: '0' },
        { test: 'detail.hasEpisodes', not: true },
      ],
    } as Node,
    {
      type: 'box',
      when: [{ test: 'detail.hasEpisodes' }],
      style: col({ gap: '4px', ...side, ...block }),
      small: { ...sideSmall, 'padding-bottom': '18px' },
      children: [
        {
          type: 'text',
          text: '{s:episodes}',
          role: 'heading',
          level: 2,
          style: { ...heading20, 'padding-bottom': '4px' },
        },
        {
          type: 'box',
          when: [{ test: 'detail.seasonCount', is: 'gt', value: '1' }],
          role: 'tablist',
          label: '{s:seasons}',
          testId: 'season-picker',
          style: row({
            'overflow-x': 'auto',
            'overflow-y': 'hidden',
            'scrollbar-width': 'none',
            'margin-bottom': '8px',
            ...hairline,
          }),
          children: [{ type: 'repeat', over: 'detail.seasons', item: seasonTab }],
        },
        { type: 'repeat', over: 'detail.episodes', item: episodeRow },
      ],
    },
    {
      type: 'box',
      when: [{ test: 'detail.hasExtras' }],
      style: col({ gap: '10px', ...block }),
      small: { 'padding-bottom': '18px' },
      children: [
        {
          type: 'text',
          text: '{s:specialFeatures}',
          role: 'heading',
          level: 2,
          style: { ...heading2, ...side },
          small: { ...heading2Small, ...sideSmall },
        },
        hscroll([{ type: 'repeat', over: 'detail.extras', item: extraCard }]),
      ],
    },
    {
      type: 'box',
      when: [{ test: 'detail.hasCast' }],
      style: col({ gap: '10px', ...block }),
      small: { 'padding-bottom': '18px' },
      children: [
        {
          type: 'text',
          text: '{s:cast}',
          role: 'heading',
          level: 2,
          style: { ...heading20, ...side },
          small: sideSmall,
        },
        hscroll([{ type: 'repeat', over: 'detail.cast', item: person }], 'list'),
      ],
    },
    {
      type: 'repeat',
      over: 'detail.related',
      item: section(
        'row.items',
        [
          sectionTitle('{row.name}', [{ test: 'row.name' }]),
          sectionTitle('{s:moreLikeThis}', [{ test: 'row.name', not: true }]),
        ],
        { test: 'row.landscape' },
      ),
    },
  ],
};

export const title: Node = {
  type: 'box',
  style: col({
    position: 'relative',
    height: '100%',
    'min-height': '0px',
    'overflow-x': 'hidden',
    'overflow-y': 'hidden',
    'background-color': '$page',
    color: '$ink',
  }),
  children: [
    {
      type: 'box',
      id: 'back',
      press: { action: 'back' },
      label: '{s:closeTitle}',
      testId: 'detail-close',
      style: {
        position: 'absolute',
        top: '20px',
        right: '20px',
        'z-index': '10',
        'box-sizing': 'border-box',
        width: '44px',
        height: '44px',
        border: '1px solid $close-line',
        'border-radius': '22px',
        padding: '13px',
        'background-color': '$close-ground',
        'backdrop-filter': 'blur(20px) saturate(1.3)',
        color: '$close-ink',
      },
      children: [
        { type: 'icon', symbol: 'close', style: { width: '19px', height: '19px', 'flex-shrink': '0' } },
      ],
    },
    {
      type: 'box',
      id: '{env.route}-scroll-{env.entry}',
      role: 'region',
      label: '{s:titleDetails}',
      style: col({
        flex: '1',
        'min-height': '0px',
        'overflow-y': 'auto',
        'overflow-x': 'hidden',
        'font-family': sans,
      }),
      children: [
        waiting(220, '{s:opening}'),
        failure('{s:titleFailed}'),
        { ...titleTop, when: [ready], motion: 'fadeIn' } as Node,
        { ...titleRest, when: [ready], motion: 'fadeIn' } as Node,
      ],
    },
  ],
};

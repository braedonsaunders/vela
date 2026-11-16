// The four player menus: subtitles (with their appearance where the engine draws the text),
// audio, quality (grouped by resolution, each by its bitrate and what it needs, with the info
// card's switch) and speed. Items the engine cannot switch to right now stay listed, dimmed.
import { Fragment } from 'react';
import { msg, number } from '@vela/core';
import type { CommandInput } from './context';
import type { PlayerLook } from './look';
import { ChoiceRow, MenuHeading, MenuRule, SegmentRow } from './menu';
import type { PlayerView, QualityOption } from './present';

export type MenuName = 'subtitles' | 'audio' | 'quality' | 'speed';

interface Props {
  look: PlayerLook;
  view: PlayerView;
  /** Nothing can change: the session is busy or has ended. */
  blocked: boolean;
  send(command: CommandInput): void;
}

const STANDARD_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

const SUBTITLE_SETTINGS = [
  {
    setting: 'subtitleSize',
    name: 'player.subtitleSize',
    values: ['small', 'medium', 'large', 'xl'],
    label: (v: string) => `player.size.${v}`,
  },
  {
    setting: 'subtitleBackground',
    name: 'player.subtitleBackground',
    values: ['none', 'shadow', 'box'],
    label: (v: string) => `player.background.${v}`,
  },
  {
    setting: 'subtitleColor',
    name: 'player.subtitleColor',
    values: ['white', 'yellow'],
    label: (v: string) => `player.color.${v}`,
  },
  {
    setting: 'subtitlePosition',
    name: 'player.subtitlePosition',
    values: ['bottom', 'raised'],
    label: (v: string) => `player.position.${v}`,
  },
] as const;

export function SubtitlesMenu({ look, view, blocked, send }: Props) {
  const off = view.subtitleId === '' && view.pendingSubtitleId === '';
  const appearance = view.subtitleLook;
  return (
    <>
      <ChoiceRow
        look={look}
        name={msg('ui.off')}
        selected={off}
        enabled={!blocked}
        testID="player-cc-off"
        onChoose={() => send({ type: 'subtitle', trackId: null })}
      />
      {view.subtitles.map(track => (
        <ChoiceRow
          key={track.id}
          look={look}
          name={track.name}
          detail={track.detail}
          enabled={!blocked}
          selected={view.subtitleId === track.id}
          pending={view.pendingSubtitleId === track.id}
          onChoose={() => send({ type: 'subtitle', trackId: track.id })}
        />
      ))}
      {view.subtitleError ? <MenuHeading look={look} text={view.subtitleError} /> : null}
      {appearance && view.subtitleId !== '' ? (
        <>
          <MenuRule look={look} />
          {SUBTITLE_SETTINGS.map(({ setting, name, values, label }) => (
            <SegmentRow
              key={setting}
              look={look}
              name={msg(name)}
              enabled={!blocked}
              current={appearance[settingKey(setting)]}
              options={values.map(value => ({ value, label: msg(label(value)) }))}
              onPick={value => send({ type: 'subtitleStyle', value: `${setting}=${value}` })}
            />
          ))}
        </>
      ) : null}
    </>
  );
}

function settingKey(setting: (typeof SUBTITLE_SETTINGS)[number]['setting']) {
  const keys = {
    subtitleSize: 'size',
    subtitleBackground: 'background',
    subtitleColor: 'color',
    subtitlePosition: 'position',
  } as const;
  return keys[setting];
}

export function AudioMenu({ look, view, blocked, send }: Props) {
  if (!view.audio.length) {
    return (
      <ChoiceRow look={look} name={msg('player.audioDefault')} selected enabled={false} onChoose={() => undefined} />
    );
  }
  return (
    <>
      {view.audio.map(track => (
        <ChoiceRow
          key={track.id}
          look={look}
          name={track.name}
          detail={track.detail}
          enabled={!blocked}
          selected={view.audioId === track.id}
          pending={view.pendingAudioId === track.id}
          onChoose={() => send({ type: 'audio', trackId: track.id })}
        />
      ))}
    </>
  );
}

/** The resolutions that more than one quality shares: those list under a heading, by bitrate. */
function sharedResolutions(options: QualityOption[]): Set<string> {
  const counts = new Map<string, number>();
  for (const o of options) counts.set(o.resolution, (counts.get(o.resolution) ?? 0) + 1);
  return new Set([...counts].filter(([, n]) => n > 1).map(([name]) => name));
}

interface QualityProps extends Props {
  info: boolean;
  onInfo(): void;
}

export function QualityMenu({ look, view, blocked, send, info, onInfo }: QualityProps) {
  const shared = sharedResolutions(view.qualities);
  const chosen = (option: QualityOption) =>
    view.lockedQuality === option.id || (!view.lockedQuality && !view.qualityAuto && view.qualityId === option.id);
  return (
    <>
      {view.qualityAuto ? (
        <ChoiceRow
          look={look}
          name={msg('player.auto')}
          detail={view.lockedQuality ? '' : view.quality}
          selected={!view.lockedQuality}
          enabled={!blocked}
          onChoose={() => send({ type: 'quality', renditionId: null })}
        />
      ) : null}
      {view.qualities.map((option, i) => {
        const grouped = shared.has(option.resolution);
        const heading = grouped && view.qualities[i - 1]?.resolution !== option.resolution;
        const name = grouped
          ? [option.traits, option.rate].filter(Boolean).join(' · ') || option.resolution
          : option.resolution;
        const detail = grouped ? option.needs : [option.traits, option.rate, option.needs].filter(Boolean).join(' · ');
        return (
          <Fragment key={option.id}>
            {heading ? <MenuHeading look={look} text={option.resolution} /> : null}
            <ChoiceRow
              look={look}
              name={name}
              detail={detail}
              selected={chosen(option)}
              pending={option.pending}
              enabled={!blocked && !option.pending}
              onChoose={() => send({ type: 'quality', renditionId: option.id })}
            />
          </Fragment>
        );
      })}
      {!view.qualities.length && !view.qualityAuto ? (
        <ChoiceRow look={look} name={view.quality || view.path} selected enabled={false} onChoose={() => undefined} />
      ) : null}
      <MenuRule look={look} />
      <ChoiceRow
        look={look}
        name={msg('player.info')}
        detail={look.tv ? '' : 'I'}
        selected={info}
        enabled
        onChoose={onInfo}
        testID="player-info-toggle"
      />
    </>
  );
}

export function SpeedMenu({ look, view, blocked, send }: Props) {
  const live = view.speeds.length > 0;
  const speeds = live ? view.speeds : STANDARD_SPEEDS;
  return (
    <>
      {speeds.map(rate => (
        <ChoiceRow
          key={rate}
          look={look}
          name={`${number(rate, { maximumFractionDigits: 2 })}×`}
          detail={rate === 1 ? msg('player.normal') : ''}
          selected={live ? view.speed === rate : rate === 1}
          enabled={live && !blocked}
          onChoose={() => send({ type: 'speed', value: rate })}
        />
      ))}
    </>
  );
}

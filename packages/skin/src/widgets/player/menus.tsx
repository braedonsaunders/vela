// The four player menus: subtitles (with their appearance where the engine draws the text),
// audio, quality (grouped by resolution, each by its bitrate and what it needs, with the info
// card's switch) and speed. Items the engine cannot switch to right now stay listed, dimmed.
import { SubtitleSearch } from './subtitle-search';
import { msg, number } from '@vela/core';
import type { CommandInput } from './context';
import type { PlayerLook } from './look';
import { ChoiceRow, MenuHeading, MenuRule, SegmentRow } from './menu';
import type { PlayerView, QualityOption } from './present';
import type { PlaybackPlan } from '@vela/player-api';
import { versionAvailability, versionBadge, versionChips, versionMenuGroups } from '../versions';

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
        onChoose={() => { if (!off) send({ type: 'subtitle', trackId: null }); }}
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
          onChoose={() => { if (view.subtitleId !== track.id && view.pendingSubtitleId !== track.id) send({ type: 'subtitle', trackId: track.id }); }}
        />
      ))}
      <SubtitleSearch look={look} send={send} />
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
          onChoose={() => { if (view.audioId !== track.id && view.pendingAudioId !== track.id) send({ type: 'audio', trackId: track.id }); }}
        />
      ))}
    </>
  );
}

interface QualityProps extends Props {
  plan: PlaybackPlan | null;
  pendingQualityId?: string;
  pendingVersionId?: string;
  versionMessage: string;
  switchVersion(id: string): void;
  info: boolean;
  onInfo(): void;
}

export function QualityMenu({ look, view, plan, blocked, send, switchVersion, pendingVersionId, versionMessage, info, onInfo, pendingQualityId }: QualityProps) {
  const chosen = (option: QualityOption) =>
    option.aliases.includes(view.lockedQuality) || (!view.lockedQuality && !view.qualityAuto && option.aliases.includes(view.qualityId));
  const groups = versionMenuGroups(plan?.versions, view.qualities);
  const selectedVersionId = plan?.selectedVersionId;
  return (
    <>
      {groups.versions.length ? <MenuHeading look={look} text="Versions" /> : null}
      {groups.versions.map(version => {
        const unavailable = version.availability === 'unavailable';
        const detail = [versionBadge(version), versionChips(version).join(' · '), versionAvailability(version)].filter(Boolean).join(' · ');
        return <ChoiceRow key={`version:${version.id}`} look={look} name={version.label} detail={detail}
          selected={version.id === selectedVersionId} pending={version.id === pendingVersionId}
          enabled={!blocked && !pendingVersionId && !unavailable}
          onChoose={() => { if (version.id !== selectedVersionId) switchVersion(version.id); }} />;
      })}
      {versionMessage ? <MenuHeading look={look} text={versionMessage} /> : null}
      {groups.versions.length ? <><MenuRule look={look} /><MenuHeading look={look} text="Converted" /></> : null}
      {view.qualityAuto ? (
        <ChoiceRow
          look={look}
          name={msg('player.auto')}
          detail={blocked ? msg('player.qualityUnavailable') : view.lockedQuality ? '' : view.quality}
          selected={!view.lockedQuality}
          pending={pendingQualityId === 'auto'}
          enabled={!blocked}
          onChoose={() => send({ type: 'quality', renditionId: null })}
        />
      ) : null}
      {groups.converted.map(option => (
        <ChoiceRow
          key={option.id}
          look={look}
          name={option.original ? [option.resolution, option.traits].filter(Boolean).join(' · ') : option.resolution}
          detail={option.disabledReason || (blocked ? msg('player.qualityUnavailable') : '') || [option.original ? '' : option.traits, option.rate, option.needs].filter(Boolean).join(' · ')}
          selected={chosen(option)}
          pending={!!pendingQualityId && option.aliases.includes(pendingQualityId)}
          enabled={!blocked && !option.disabledReason}
          onChoose={() => { if (!chosen(option)) send({ type: 'quality', renditionId: option.id }); }}
        />
      ))}
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

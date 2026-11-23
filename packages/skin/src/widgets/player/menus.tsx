// The four player menus: subtitles (with their appearance where the engine draws the text),
// audio, quality (grouped by resolution, each by its bitrate and what it needs, with the info
// card's switch) and speed. Items the engine cannot switch to right now stay listed, dimmed.
import { SubtitleSearch } from './subtitle-search';
import { msg, number } from '@vela/core';
import type { ReactNode } from 'react';
import type { CommandInput } from './context';
import type { PlayerLook } from './look';
import { ChoiceRow, MenuHeading, MenuRule, MenuSection, SegmentRow, VersionChoiceRow } from './menu';
import { nextSubtitleOffset, type PlayerView, type QualityOption } from './present';
import type { PlaybackPlan } from '@vela/player-api';
import { versionAvailability, versionMenuChips, versionMenuGroups } from '../versions';

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
      {view.subtitleOffset !== null && view.subtitleId !== '' ? (
        <SubtitleDelay look={look} offset={view.subtitleOffset} blocked={blocked} send={send} />
      ) : null}
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

const DELAY_STEPS = ['-0.5', '-0.1', '0', '+0.1', '+0.5'] as const;

function SubtitleDelay({ look, offset, blocked, send }: { look: PlayerLook; offset: number; blocked: boolean; send: Props['send'] }) {
  const shown = `${offset > 0 ? '+' : ''}${number(offset, { minimumFractionDigits: 1, maximumFractionDigits: 3 })} s`;
  return (
    <>
      <MenuRule look={look} />
      <SegmentRow
        look={look}
        name={msg('player.subtitleDelay', { value: shown })}
        enabled={!blocked}
        current=""
        options={DELAY_STEPS.map(step => ({ value: step, label: step === '0' ? msg('player.subtitleDelayReset') : `${step} s` }))}
        onPick={step => send({ type: 'subtitleStyle', value: `subtitleOffset=${nextSubtitleOffset(offset, step)}` })}
      />
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

/** Delivery choices an engine may honour, with their values in menu order. */
const OUTPUT_SETTINGS: Record<string, readonly string[]> = {
  surround: ['lossless', 'compatible'],
  passthrough: ['auto', 'off'],
  immersive: ['on', 'off'],
  speakerLayout: ['5.1.2', '5.1.4', '7.1.2', '7.1.4', '9.1.6'],
  dolbyVision: ['auto', 'base-layer'],
};

function outputLabel(name: string, value: string): string {
  return name === 'speakerLayout' ? value : msg(`player.output.${name}.${value}`);
}

/** The engine's delivery choices (surround, passthrough, Atmos rendering, speakers, Dolby Vision); none when it has none. */
function OutputSettings({ look, view, blocked, send }: Props) {
  const settings = view.output.filter(({ name }) => OUTPUT_SETTINGS[name]);
  if (!settings.length) return null;
  return (
    <>
      <MenuRule look={look} />
      <MenuHeading look={look} text={msg('player.output')} />
      {settings.map(({ name, value }) => (
        <SegmentRow
          key={name}
          look={look}
          name={msg(`player.output.${name}`)}
          enabled={!blocked}
          current={value}
          options={OUTPUT_SETTINGS[name].map(option => ({ value: option, label: outputLabel(name, option) }))}
          onPick={next => { if (next !== value) send({ type: 'outputPreference', value: `${name}=${next}` }); }}
        />
      ))}
    </>
  );
}

export function AudioMenu({ look, view, blocked, send }: Props) {
  if (!view.audio.length) {
    return (
      <>
        <ChoiceRow look={look} name={msg('player.audioDefault')} selected enabled={false} onChoose={() => undefined} />
        <OutputSettings look={look} view={view} blocked={blocked} send={send} />
      </>
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
      <OutputSettings look={look} view={view} blocked={blocked} send={send} />
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

export function qualityMenuRows({ look, view, plan, blocked, send, switchVersion, pendingVersionId, versionMessage, info, onInfo, pendingQualityId }: QualityProps): ReactNode[] {
  const chosen = (option: QualityOption) =>
    option.aliases.includes(view.lockedQuality) || (!view.lockedQuality && !view.qualityAuto && option.aliases.includes(view.qualityId));
  const groups = versionMenuGroups(plan?.versions, view.qualities);
  const selectedVersionId = plan?.selectedVersionId;
  const selectedVersion = groups.versions.find(version => version.id === selectedVersionId);
  const hasVersions = groups.versions.length > 0;
  const originals = groups.converted.filter(option => option.original);
  const converted = groups.converted.filter(option => !option.original);
  const qualityRow = (option: QualityOption) => {
    const originalQuality = hasVersions && option.original;
    return <ChoiceRow
      key={option.id}
      look={look}
      name={originalQuality ? 'Original quality' : option.original
        ? [option.resolution, option.traits].filter(Boolean).join(' · ') : option.resolution}
      detail={option.disabledReason || (blocked ? msg('player.qualityUnavailable') : '') ||
        (originalQuality ? 'No conversion' :
          [option.original ? '' : option.traits, option.rate, hasVersions ? '' : option.needs].filter(Boolean).join(' · '))}
      selected={chosen(option)}
      pending={!!pendingQualityId && option.aliases.includes(pendingQualityId)}
      enabled={!blocked && !option.disabledReason}
      onChoose={() => { if (!chosen(option)) send({ type: 'quality', renditionId: option.id }); }}
    />;
  };
  const qualityRows = [
    ...(hasVersions ? originals.map(qualityRow) : []),
    view.qualityAuto ? (
      <ChoiceRow key="auto" look={look}
        name={hasVersions ? 'Automatic quality' : msg('player.auto')}
        detail={blocked ? msg('player.qualityUnavailable') : view.lockedQuality ? '' : view.quality}
        selected={!view.lockedQuality}
        pending={pendingQualityId === 'auto'}
        enabled={!blocked}
        onChoose={() => send({ type: 'quality', renditionId: null })}
      />
    ) : null,
    ...(hasVersions ? converted : groups.converted).map(qualityRow),
  ];
  const convertedTitle = selectedVersion && selectedVersion.id !== groups.versions[0]?.id
    ? `Converted from ${selectedVersion.label.split(' · ')[0]}` : 'Converted from the current version';
  const hasConversions = view.qualityAuto || converted.length > 0;
  const showQuality = hasVersions && (hasConversions || originals.length > 0);
  return [
    hasVersions ? <MenuSection key="versions" look={look} title="Versions">
      {groups.versions.map(version => {
        const unavailable = version.availability === 'unavailable';
        return <VersionChoiceRow key={`version:${version.id}`} look={look} name={version.label}
          chips={versionMenuChips(version)} status={versionAvailability(version)} unavailable={unavailable}
          selected={version.id === selectedVersionId} pending={version.id === pendingVersionId}
          enabled={!blocked && !pendingVersionId && !unavailable}
          onChoose={() => { if (version.id !== selectedVersionId) switchVersion(version.id); }} />;
      })}
      {versionMessage ? <MenuHeading look={look} text={versionMessage} /> : null}
    </MenuSection> : null,
    showQuality ? <MenuRule key="quality-divider" look={look} /> : null,
    ...(showQuality ? [
      <MenuSection key="quality" look={look} title={hasConversions ? convertedTitle : 'Playback quality'}>{qualityRows}</MenuSection>,
    ] : qualityRows),
    !view.qualities.length && !view.qualityAuto ? (
      <ChoiceRow key="current" look={look} name={view.quality || view.path} selected enabled={false} onChoose={() => undefined} />
    ) : null,
    <MenuRule key="info-divider" look={look} />,
    <ChoiceRow
      key="info"
      look={look}
      name={msg('player.info')}
      detail={look.tv ? '' : 'I'}
      selected={info}
      enabled
      onChoose={onInfo}
      testID="player-info-toggle"
    />,
  ];
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

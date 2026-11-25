// The four player menus: subtitles (with their appearance where the engine draws the text),
// audio, quality (grouped by resolution, each by its bitrate and what it needs, with the info
// card's switch) and speed. Items the engine cannot switch to right now stay listed, dimmed.
import { SubtitleSearch, SubtitleSearchEntry } from './subtitle-search';
import { clock, msg, number, sleepLeftMs, STREAMING_QUALITIES, type StreamingQuality, type StreamingSettings } from '@vela/core';
import { useEffect } from 'react';
import { useState, type ReactNode } from 'react';
import type { CommandInput, PlayerChromeState } from './context';
import type { PlayerLook } from './look';
import { ChoiceRow, MenuHeading, MenuRule, MenuSection, SegmentRow, VersionChoiceRow } from './menu';
import { nextSubtitleOffset, type PlayerView, type QualityOption } from './present';
import type { PlaybackPlan } from '@vela/player-api';
import { versionAvailability, versionMenuChips, versionMenuGroups } from '../versions';

export type MenuName = 'subtitles' | 'audio' | 'quality' | 'speed' | 'sleep';

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

/** A plugin overlay's switch, as the subtitles menu lists it (surfaces/player.tsx). */
interface OverlayChoice { id: string; label: string; on: boolean; toggle(): void }

export function SubtitlesMenu({ look, view, blocked, send, overlays }: Props & { overlays?: OverlayChoice[] }) {
  const [searching, setSearching] = useState(false);
  const off = view.subtitleId === '' && view.pendingSubtitleId === '';
  const appearance = view.subtitleLook;
  if (searching) return <SubtitleSearch look={look} blocked={blocked} send={send} onClose={() => setSearching(false)} />;
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
      <SubtitleSearchEntry look={look} enabled={!blocked} onOpen={() => setSearching(true)} />
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
      {overlays?.length ? (
        <>
          {/* Every plugin overlay can be switched off here (on screen over the picture). */}
          <MenuRule look={look} />
          <MenuHeading look={look} text={msg('player.onScreen')} />
          {overlays.map(overlay => (
            <ChoiceRow key={overlay.id} look={look} name={overlay.label} selected={overlay.on} enabled testID={`player-overlay-switch-${overlay.id}`}
              onChoose={overlay.toggle} />
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
  streaming?: PlayerChromeState['streaming'];
  pendingQualityId?: string;
  pendingVersionId?: string;
  versionMessage: string;
  switchVersion(id: string): void;
  info: boolean;
  onInfo(): void;
}

export function qualityMenuRows({ look, view, plan, blocked, send, switchVersion, pendingVersionId, versionMessage, info, onInfo, pendingQualityId, streaming }: QualityProps): ReactNode[] {
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
      name={originalQuality ? msg('player.quality.original') : option.original
        ? [option.resolution, option.traits].filter(Boolean).join(' · ') : option.resolution}
      detail={option.disabledReason || (blocked ? msg('player.qualityUnavailable') : '') ||
        (originalQuality ? msg('player.quality.noConversion') :
          [option.original ? '' : option.traits, option.rate, hasVersions ? '' : option.needs].filter(Boolean).join(' · '))}
      selected={chosen(option)}
      pending={!!pendingQualityId && option.aliases.includes(pendingQualityId)}
      enabled={!blocked && !option.disabledReason}
      onChoose={() => { if (!chosen(option)) send({ type: 'quality', renditionId: option.id }); }}
    />;
  };
  const serverStream = view.serverStream;
  const qualityRows = [
    ...(hasVersions ? originals.map(qualityRow) : []),
    view.qualityAuto ? (
      <ChoiceRow key="auto" look={look}
        name={hasVersions ? msg('player.quality.automatic') : msg('player.auto')}
        detail={blocked ? msg('player.qualityUnavailable') : view.lockedQuality ? '' : view.quality}
        selected={!view.lockedQuality}
        pending={pendingQualityId === 'auto'}
        enabled={!blocked}
        onChoose={() => send({ type: 'quality', renditionId: null })}
      />
    ) : null,
    ...(hasVersions ? converted : groups.converted).map(qualityRow),
    serverStream ? <ChoiceRow key={serverStream.choice} look={look} name={msg('player.quality.plexStream')}
      selected={serverStream.selected} pending={pendingQualityId === serverStream.choice}
      enabled={!blocked && !pendingQualityId && !pendingVersionId}
      onChoose={() => { if (!serverStream.selected) send({ type: 'quality', renditionId: serverStream.choice }); }} /> : null,
  ];
  const convertedTitle = selectedVersion && selectedVersion.id !== groups.versions[0]?.id
    ? msg('player.quality.convertedFrom', { version: selectedVersion.label.split(' · ')[0]! }) : msg('player.quality.convertedFromCurrent');
  const hasConversions = view.qualityAuto || converted.length > 0 || !!serverStream;
  const showQuality = hasVersions && (hasConversions || originals.length > 0);
  return [
    hasVersions ? <MenuSection key="versions" look={look} title={msg('player.versions')}>
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
      <MenuSection key="quality" look={look} title={hasConversions ? convertedTitle : msg('player.quality.title')}>{qualityRows}</MenuSection>,
    ] : qualityRows),
    !view.qualities.length && !view.qualityAuto && !serverStream ? (
      <ChoiceRow key="current" look={look} name={view.quality || view.path} selected enabled={false} onChoose={() => undefined} />
    ) : null,
    ...(streaming ? [<MenuRule key="streaming-divider" look={look} />, <StreamingSettingsRows key="streaming" look={look} streaming={streaming} />] : []),
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

const STREAMING_LABELS: Record<StreamingQuality, string> = { original: 'player.streaming.original', '1080p': '1080p', '720p': '720p', '480p': '480p' };

/** The streaming cap on each network: this device's setting, applied from the next start. A TV is
 * never on mobile data, so it has one choice for every network. */
function StreamingSettingsRows({ look, streaming }: { look: PlayerLook; streaming: NonNullable<PlayerChromeState['streaming']> }) {
  const options = STREAMING_QUALITIES.map(value => ({ value, label: value === 'original' ? msg(STREAMING_LABELS[value]) : STREAMING_LABELS[value] }));
  const pick = (network: keyof StreamingSettings) => (value: string) => {
    if (value !== streaming.settings[network]) streaming.set({ [network]: value as StreamingQuality });
  };
  return (
    <>
      <MenuHeading look={look} text={msg('player.streaming')} />
      <SegmentRow look={look} name={msg(look.tv ? 'player.streaming.every' : 'player.streaming.wifi')} enabled
        current={streaming.settings.wifi} options={options} onPick={pick('wifi')} />
      {look.tv ? null : <SegmentRow look={look} name={msg('player.streaming.mobile')} enabled
        current={streaming.settings.mobile} options={options} onPick={pick('mobile')} />}
      <MenuHeading look={look} text={msg(streaming.metered ? 'player.streaming.onMobile' : 'player.streaming.nextTitle')} />
    </>
  );
}

const SLEEP_MINUTES = [15, 30, 60];

/** The sleep timer: off, after some minutes, or at the end of what plays. The running timer shows what is left. */
export function SleepMenu({ look, sleep, episode }: { look: PlayerLook; sleep: NonNullable<PlayerChromeState['sleep']>; episode: boolean }) {
  const { value } = sleep;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (value.mode !== 'timer') return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [value.mode]);
  const left = clock(Math.ceil(sleepLeftMs(value, now) / 1000));
  const minutes = value.mode === 'timer' ? value.minutes : 0;
  return (
    <>
      <ChoiceRow look={look} name={msg('player.sleep.off')} selected={value.mode === 'off'} enabled onChoose={() => sleep.set('off')} testID="player-sleep-off" />
      {SLEEP_MINUTES.map(count => (
        <ChoiceRow key={count} look={look} name={msg('player.sleep.minutes', { count: number(count) })}
          detail={value.mode === 'timer' && minutes === count ? msg('player.sleep.in', { time: left }) : ''}
          selected={value.mode === 'timer' && minutes === count} enabled onChoose={() => sleep.set('timer', count)} testID={`player-sleep-${count}`} />
      ))}
      <ChoiceRow look={look} name={msg(episode ? 'player.sleep.episode' : 'player.sleep.title')}
        detail={value.mode === 'item' ? msg('player.sleep.atEnd') : ''}
        selected={value.mode === 'item'} enabled onChoose={() => sleep.set('item')} testID="player-sleep-end" />
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

// Live watch inside the chrome: a channel plays at the live edge, so the timeline gives way to
// a status line (reconnecting, a delayed segment, a real lag behind live), and the control row
// takes channel up and down beside the play toggle and the LIVE mark (Go live once playback has
// fallen behind) with the same buttons as every other control. The mini guide shows while a
// channel is being dialled, and the remote's channel keys flick channels. The delivery rule and
// the flicking come from the live TV widgets (widgets/guide); this only places them.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { MOTION, Presence, useLast } from '../../presence';
import { catchUpPictureTime, clock, delayLabel, LIVE_SLACK_SECONDS, msg, pictureTime, timeshiftWindow, type TimeshiftWindow } from '@vela/core';
import type { PlaybackPlan, Snapshot } from '@vela/player-api';
import { liveBehind, liveNotices, liveWatchKey, MiniGuide, useLiveContext, useLiveView } from '../guide';
import { ChromeButton } from './button';
import { useMultiview } from '../multiview/context';
import type { ChromeTarget, CommandInput } from './context';
import { catchUpWatchOf, liveWatchOf } from './target';
import { backToLiveLeft } from './live-focus';
import type { PlayerLook } from './look';

export interface LiveWatch {
  /** The session plays a channel. */
  live: boolean;
  /** The channel being watched ('' for a live library or a film). */
  channelId: string;
  /** Channel up and down can dial from here (a live controller and a channel). */
  canZap: boolean;
  /** What the viewer should be told about delivery (empty while the channel plays normally). */
  notices: string[];
  /** Whole seconds behind live when playback can catch up, else 0. */
  behind: number;
  /** A key for live watch (dialling, tuning, forgetting); answers whether it was taken. */
  key(key: string): boolean;
  zap(step: -1 | 1): void;
  /** A programme from the channel's archive: Start over (still growing) or catch-up (ended); null on a channel. */
  archive: 'startOver' | 'catchUp' | null;
  /** The rewind window (a channel with timeshift, or Start over); null where there is none to draw. */
  window: TimeshiftWindow | null;
  /** "-12:30" while the picture trails live by intent, else ''. */
  delay: string;
  /** Seconds the picture trails live (0 at live): what the score bug must not run ahead of. */
  behindSeconds: number;
  /** The real time on screen (ms). */
  pictureAt: number;
  /** The real time the window starts (ms): Start over's programme start, else the rewind window's. */
  windowStartAt: number;
  windowEdgeAt: number;
  paused: boolean;
  /** Back to live: the edge of this channel, or the channel live from a programme in the archive. */
  backToLive(): void;
  /** The programme on air plays from its start (its start is in the archive); null when it cannot. */
  startOver: (() => void) | null;
  /** The viewer moved off live (a seek or a pause): Back to live's grace ends. */
  leftLive(): void;
}

/** How long Back to live reads as live while the engine gets there. */
const GO_LIVE_GRACE_MS = 20_000;

/** The plan's arrival, so the window's edge can grow in real time from it. */
function usePlanArrival(plan: PlaybackPlan | null): number {
  // Not the revision: a plan event that only reports progress carries the same edge, which has grown since.
  const key = plan ? `${plan.sessionId}|${plan.seekGeneration}|${plan.live?.liveEdgeSeconds ?? ''}` : '';
  return useMemo(() => Date.now(), [key]);
}

/** When the engine's reported edge last moved (it stands still while the engine is paused). */
function useEdgeMovedAt(edge: number | null | undefined, now: number): number | undefined {
  const last = useRef<{ edge: number; at: number } | null>(null);
  if (edge == null) { last.current = null; return undefined; }
  if (!last.current || last.current.edge !== edge) last.current = { edge, at: Math.min(now, Date.now()) };
  return last.current.at;
}

/** A second's clock while a window or delay is shown: the edge grows even while the picture is paused. */
function useSecondClock(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [on]);
  return on ? Math.max(now, Date.now()) : now;
}

export function useLiveWatchChrome(plan: PlaybackPlan | null, snapshot: Snapshot | null, target?: ChromeTarget, send?: (command: CommandInput) => void, seekingTo?: number, seeking = false): LiveWatch {
  const context = useLiveContext();
  const view = useLiveView();
  const watched = liveWatchOf(plan, target);
  const archived = catchUpWatchOf(plan, target);
  // A programme from the archive belongs to its channel: up and down flick from there, back to live.
  const channelId = watched.channelId || archived?.channelId || '';
  const isLive = watched.live;
  const controller = context?.controller;
  const live = snapshot?.live ?? null;
  const receivedAt = usePlanArrival(plan);
  const now = useSecondClock(!!plan?.live || !!plan?.catchUp);
  const position = seekingTo ?? snapshot?.seekTarget ?? snapshot?.position ?? plan?.positionSeconds ?? 0;
  const edgeMovedAt = useEdgeMovedAt(live?.edgeSeconds, now);
  const measured = plan?.live ? timeshiftWindow({ live: plan.live, receivedAt, now, position, engine: live ? { ...live, edgeMovedAt } : null }) : null;
  // Back to live is taken at its word while the engine moves there and settles its latency.
  const wentLive = useRef(0);
  const paused = snapshot?.state === 'paused' || plan?.state === 'paused';
  const delayed = !!measured && (measured.startOver || seekingTo !== undefined ||
    ((measured.delayed || (measured.seekable && paused && measured.behind >= 1)) && now - wentLive.current >= GO_LIVE_GRACE_MS));
  const window = measured ? { ...measured, delayed } : null;
  const rewindable = !!window?.seekable;
  const archiveStart = plan?.catchUp ? Date.parse(plan.catchUp.startAt) : NaN;
  const windowEdgeAt = window?.startOver && Number.isFinite(archiveStart)
    ? archiveStart + window.edge * 1000 : window?.edgeAt ?? now;
  const pictureAt = catchUpPictureTime(plan ?? {}, position) ?? pictureTime(windowEdgeAt, window?.behind ?? 0);
  const behindSeconds = plan?.catchUp ? Math.max(0, (now - pictureAt) / 1000) : window?.behind ?? 0;
  // A deliberate rewind is no delivery trouble: the window tells the delay, not "N seconds behind".
  // Behind live on purpose, the edge's publication waits are not the picture's business either.
  const notices = rewindable && live ? liveNotices({ ...live, canCatchUp: false, ...(window!.delayed || seeking ? { delivery: 'available' as const, reconnecting: false } : {}) }) : liveNotices(live);
  if (rewindable && window!.delayed) notices.push(msg('catchUp.behindLive', { delay: clock(behindSeconds) }));
  // Start over plays its programme from the beginning: an engine joins a growing stream at its edge,
  // so the session is placed at its start once, when the engine itself reports the window (a seek
  // before then is refused; one that never reports places Start over on its own).
  const placed = useRef('');
  const placeAt = archived?.kind === 'startOver' && window?.seekable && live?.edgeSeconds != null && snapshot?.state === 'playing' && plan && placed.current !== plan.sessionId
    // A second in: a live engine reads position 0 as "join at the edge".
    && window.position - window.start > LIVE_SLACK_SECONDS ? window.start + 1 : null;
  useEffect(() => {
    if (placeAt === null || !plan) return;
    placed.current = plan.sessionId;
    send?.({ type: 'seek', seconds: placeAt });
  }, [placeAt, plan?.sessionId]);
  const windowStartAt = Number.isFinite(archiveStart) ? archiveStart : windowEdgeAt - ((window?.edge ?? 0) - (window?.start ?? 0)) * 1000;
  const guideChannel = channelId ? view.guide?.channels.find(c => c.id === channelId) : undefined;
  const offer = controller?.catchUpOffer;
  const canStartOver = !archived && isLive && !window?.delayed && !seeking && !!offer?.archive && !!guideChannel?.nowStartOver && !!guideChannel.nowId;
  return {
    live: isLive,
    channelId,
    canZap: !!controller && !!channelId,
    notices,
    behind: rewindable ? 0 : liveBehind(live),
    key: key => (controller && channelId ? liveWatchKey(controller, key, channelId, view.watchZap !== '') : false),
    zap: step => {
      if (controller && channelId) controller.zapWatch(step, channelId);
    },
    archive: archived?.kind ?? null,
    window,
    delay: window && (window.delayed || window.startOver || (paused && rewindable)) ? delayLabel(behindSeconds) : plan?.catchUp ? delayLabel(behindSeconds) : '',
    behindSeconds,
    pictureAt,
    windowStartAt,
    windowEdgeAt,
    paused,
    backToLive: () => {
      wentLive.current = Date.now();
      if (archived?.kind === 'catchUp') {
        controller?.backToLive(archived.channelId);
        return;
      }
      send?.({ type: 'catchUp' });
      if (!plan?.live?.timeshift && !window?.startOver && snapshot?.state === 'paused') {
        setTimeout(() => send?.({ type: 'play' }), 250);
      }
    },
    leftLive: () => { wentLive.current = 0; },
    startOver: canStartOver && controller && guideChannel
      ? () => controller.playProgramme(guideChannel.id, guideChannel.nowId, 'startOver', true)
      : null,
  };
}

/** Channel up and down, as two of the bar's own buttons. */
export function LiveZap({ look, watch, disabled }: { look: PlayerLook; watch: LiveWatch; disabled: boolean }) {
  return (
    <>
      <ChromeButton
        look={look}
        icon="channelUp"
        label={msg('live.channelUp')}
        disabled={disabled}
        testID="player-channel-up"
        onPress={() => watch.zap(-1)}
      />
      <ChromeButton
        look={look}
        icon="channelDown"
        label={msg('live.channelDown')}
        disabled={disabled}
        testID="player-channel-down"
        onPress={() => watch.zap(1)}
      />
    </>
  );
}

/** Add to multiview: the channel joins the tiles, which replace full watch. */
export function LiveMultiview({ look, watch }: { look: PlayerLook; watch: LiveWatch }) {
  const multiview = useMultiview();
  if (!multiview || !watch.channelId) return null;
  return (
    <ChromeButton
      look={look}
      icon="tiles"
      label={msg('multiview.add')}
      testID="player-multiview"
      onPress={() => multiview.open(watch.channelId, { replace: true })}
    />
  );
}

/** LIVE at the edge; Back to live (the same control as the others) once the picture trails live, or
 * from a programme in the archive. */
export function LiveMark({ look, watch, onLeave }: { look: PlayerLook; watch: LiveWatch; onLeave?(): void }) {
  const offered = watch.behind > 0 || !!watch.window?.delayed || !!watch.archive || (watch.paused && !!watch.window?.seekable);
  // Pressed, Back to live gives way to the LIVE mark: the bar hands its focus on (onLeave).
  const pressed = useRef(false);
  useEffect(() => {
    if (!backToLiveLeft(pressed.current, offered)) return;
    pressed.current = false;
    onLeave?.();
  }, [offered]);
  if (offered) {
    return (
      <ChromeButton
        look={look}
        icon="live"
        text={msg('catchUp.backToLive')}
        label={msg('catchUp.backToLive')}
        testID="player-go-live"
        onPress={() => {
          pressed.current = true;
          watch.backToLive();
        }}
      />
    );
  }
  return (
    <View
      testID="player-live-mark"
      accessibilityRole="text"
      accessibilityLabel={msg('live.liveBadge')}
      style={{ flexDirection: 'row', alignItems: 'center', gap: look.size(7), paddingHorizontal: look.size(10) }}
    >
      <View style={{ width: look.size(8), height: look.size(8), borderRadius: look.size(4), backgroundColor: look.live }} />
      <Text style={[look.text(12, 700, look.ink), { letterSpacing: look.size(1.2) }]}>{msg('live.liveBadge')}</Text>
    </View>
  );
}

/** The bar's status line on a channel, where the timeline's clock sits on a film. */
export function LiveStatusLine({ look, watch }: { look: PlayerLook; watch: LiveWatch }) {
  if (!watch.notices.length) return null;
  return (
    <View accessibilityLiveRegion="polite" testID="player-live-status">
      <Text numberOfLines={1} style={[look.text(13, 500, look.inkSecondary), { fontVariant: ['tabular-nums'] }]}>
        {watch.notices.join(' · ')}
      </Text>
    </View>
  );
}

/**
 * While the chrome rests, a channel in trouble keeps one small line in the corner (never the
 * whole overlay): out of the focus tree and the pointer's way, gone once delivery recovers.
 */
export function LiveNotice({ look, watch, lift = 0 }: { look: PlayerLook; watch: LiveWatch; lift?: number }) {
  // It rises in and sinks away with the shared motion, still showing its last words as it goes.
  const shown = watch.live && watch.notices.length > 0;
  const notice = useLast(shown ? watch.notices[0] : undefined);
  if (!notice) return null;
  return (
    <Presence shown={shown} still={look.still || Platform.isTV} offstage={{ y: 8 }} exitMs={MOTION.quick}
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0, top: 0 }}>
    <View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      testID="player-live-notice"
      style={{
        position: 'absolute',
        left: look.gutter,
        bottom: (look.small ? 18 : look.size(30)) + lift,
        maxWidth: '70%',
        flexDirection: 'row',
        alignItems: 'center',
        gap: look.size(8),
        paddingVertical: look.size(6),
        paddingHorizontal: look.size(12),
        borderRadius: look.radiusControl,
        backgroundColor: look.scrim,
      }}
    >
      <View style={{ width: look.size(8), height: look.size(8), borderRadius: look.size(4), backgroundColor: look.live }} />
      <Text numberOfLines={1} style={[look.text(13, 500, look.inkSecondary), { flexShrink: 1, fontVariant: ['tabular-nums'] }]}>
        {notice}
      </Text>
    </View>
    </Presence>
  );
}

/** The dialled channel between its neighbours, while flicking. */
export function LiveDial({ channelId, small, still }: { channelId: string; small: boolean; still: boolean }) {
  if (!channelId) return null;
  return <MiniGuide playingId={channelId} small={small} still={still} />;
}

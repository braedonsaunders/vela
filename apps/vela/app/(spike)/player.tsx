// Spike (b): VelaPlayerView on Apple TV with a real lab plan (docs/rn-migration.md).
// Signs in from configuration (apps/vela/.env.local, never committed):
//   EXPO_PUBLIC_VELA_ORIGIN, EXPO_PUBLIC_VELA_USER, EXPO_PUBLIC_VELA_PASSWORD, EXPO_PUBLIC_VELA_TITLE (a search query),
//   EXPO_PUBLIC_VELA_MUTED=1 to start muted (a drive at night)
// then asks Ether for a plan with this device's capabilities and plays it. Remote: the buttons below.
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { VelaPlayer, VelaPlayerView } from '@vela/player';
import type { Command, PlaybackPlan, PlayerObservation, Snapshot } from '@vela/player-api';

const origin = process.env.EXPO_PUBLIC_VELA_ORIGIN ?? '';
const api = `${origin}/vela/v0`;
// The lab Ether admits client builds below 0.2.0; until it admits the React Native app's, the spike
// reports the web client's build (EXPO_PUBLIC_VELA_APP_VERSION).
const appVersion = process.env.EXPO_PUBLIC_VELA_APP_VERSION ?? '0.2.0';
const device = { id: 'vela-tvos-spike', name: 'Apple TV', platform: 'tvos', appVersion };

/** What libmpv plays on the device: originals of these families, never converted by the server. */
const client = {
  device,
  protocolVersions: [0],
  containers: ['mp4'],
  videoCodecs: ['h264', 'hevc'],
  audioCodecs: ['aac', 'ac3', 'eac3'],
  subtitleFormats: ['webvtt', 'srt', 'ass', 'ssa', 'pgs', 'tx3g'],
  hls: true,
  mse: false,
  originalPlayback: {
    version: 1,
    range: true,
    webgpu: false,
    demuxContainers: ['mkv', 'webm', 'mp4', 'mpegts'],
    videoDecoders: ['h264', 'hevc', 'av1', 'vp9', 'mpeg2video', 'vc1'],
    audioDecoders: [
      'aac', 'ac3', 'eac3', 'dts', 'truehd', 'mlp', 'flac', 'alac', 'opus', 'vorbis', 'mp3', 'pcm_s16le', 'pcm_s24le',
    ],
  },
};

let token = '';

/** A command without its id, for each kind of command. */
type CommandBody = Command extends infer C ? (C extends Command ? Omit<C, 'id'> : never) : never;

async function call<T>(method: string, path: string, body?: object): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) {
    headers.authorization = `Bearer ${token}`;
    headers['x-vela-device-id'] = device.id;
  }
  const response = await fetch(api + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!response.ok) {
    throw new Error(`${method} ${path}: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

const key = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Signs in, negotiates and asks for the first movie the configured query finds. */
async function labPlan(): Promise<PlaybackPlan> {
  const tokens = await call<{ accessToken: string }>('POST', '/auth/sign-in', {
    idempotencyKey: key(),
    username: process.env.EXPO_PUBLIC_VELA_USER,
    password: process.env.EXPO_PUBLIC_VELA_PASSWORD,
    device,
  });
  token = tokens.accessToken;
  await call('POST', '/negotiate', { idempotencyKey: key(), client });
  const query = process.env.EXPO_PUBLIC_VELA_TITLE ?? '1917';
  const found = await call<{ items: { id: string; kind: string }[] }>('POST', '/search', {
    idempotencyKey: key(), query, generation: 1, mode: 'fast', limit: 5,
  });
  const title = found.items.find((item) => item.kind === 'movie') ?? found.items[0];
  if (!title) {
    throw new Error(`Nothing found for ${query}`);
  }
  return call<PlaybackPlan>('POST', '/playback', { idempotencyKey: key(), titleId: title.id, client });
}

/** Ends the session on the server, so its media grant is released. */
function stopSession(plan: PlaybackPlan) {
  void call('POST', `/sessions/${plan.sessionId}/commands`, {
    idempotencyKey: key(),
    kind: 'stop',
    sourceGeneration: plan.sourceGeneration,
    seekGeneration: plan.seekGeneration,
  }).catch(() => {});
}

function postObservation(event: { sessionId: string; observation: PlayerObservation }) {
  void call('POST', `/sessions/${event.sessionId}/observations`, event.observation).catch(() => {});
}

function clock(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds)) {
    return '--:--';
  }
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}

export default function PlayerSpike() {
  const [plan, setPlan] = useState<PlaybackPlan>();
  const [command, setCommand] = useState<Command>();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [problem, setProblem] = useState('');
  const commandId = useRef(0);

  useEffect(() => {
    // Ether's broker paths need no headers; the origin resolves the plan's relative URLs.
    VelaPlayer.setMediaAccess({ origin, pathPrefix: '/sessions/media/', headers: async () => ({}) });
    labPlan().then(setPlan, (error) => setProblem(String(error)));
    return () => VelaPlayer.setMediaAccess(null);
  }, []);

  const send = (next: CommandBody) => {
    commandId.current += 1;
    setCommand({ ...next, id: commandId.current } as Command);
  };

  useEffect(() => {
    return () => {
      if (plan) {
        stopSession(plan);
      }
    };
  }, [plan]);

  useEffect(() => {
    if (plan && process.env.EXPO_PUBLIC_VELA_MUTED === '1') {
      send({ type: 'mute', muted: true });
    }
  }, [plan]);

  const nextTrack = (kind: 'audio' | 'subtitle') => {
    const tracks = kind === 'audio' ? plan?.audioTracks ?? [] : plan?.subtitleTracks ?? [];
    const current = kind === 'audio' ? snapshot?.audioTrackId : snapshot?.subtitleTrackId;
    const at = tracks.findIndex((track) => track.id === current);
    const next = kind === 'subtitle' && at === tracks.length - 1 ? null : tracks[(at + 1) % Math.max(tracks.length, 1)];
    if (kind === 'audio' && next) {
      send({ type: 'audio', trackId: next.id });
    }
    if (kind === 'subtitle') {
      send({ type: 'subtitle', trackId: next?.id ?? null });
    }
  };

  const audio = plan?.audioTracks.find((track) => track.id === snapshot?.audioTrackId);
  const subtitle = plan?.subtitleTracks.find((track) => track.id === snapshot?.subtitleTrackId);
  const video = snapshot?.video;
  const playing = snapshot?.state === 'playing';
  const muted = snapshot?.muted ?? false;
  return (
    <View style={styles.stage}>
      {plan ? (
        <VelaPlayerView
          plan={plan}
          command={command}
          onSnapshot={setSnapshot}
          onError={(failure) => setProblem(`${failure.kind}: ${failure.message}`)}
          onObservation={postObservation}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      <View style={styles.chrome}>
        <Text style={styles.status}>
          {problem || `${snapshot?.state ?? 'loading'}  ${clock(snapshot?.position)} / ${clock(snapshot?.duration)}`}
        </Text>
        <Text style={styles.detail}>
          {video ? `${video.width}x${video.height} ${video.codec} ${video.dynamicRange ?? ''}` : ''}
          {`  audio: ${audio ? `${audio.codec} ${audio.channels ?? ''}ch ${audio.language}` : '-'}`}
          {`  subtitles: ${subtitle ? `${subtitle.codec} ${subtitle.language}` : 'off'}`}
          {`  buffer: ${snapshot?.bufferAheadSeconds?.toFixed(0) ?? '-'} s  dropped: ${snapshot?.droppedFrames ?? '-'}`}
        </Text>
        <View style={styles.buttons}>
          <Control label="Play/Pause" onPress={() => send({ type: playing ? 'pause' : 'play' })} />
          <Control label="-10 s" onPress={() => send({ type: 'seekBy', seconds: -10 })} />
          <Control label="+60 s" onPress={() => send({ type: 'seekBy', seconds: 60 })} />
          <Control label="+10 min" onPress={() => send({ type: 'seekBy', seconds: 600 })} />
          <Control label="Audio" onPress={() => nextTrack('audio')} />
          <Control label="Subtitles" onPress={() => nextTrack('subtitle')} />
          <Control label={muted ? 'Unmute' : 'Mute'} onPress={() => send({ type: 'mute', muted: !muted })} />
        </View>
      </View>
    </View>
  );
}

function Control({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ focused }) => [styles.button, focused && styles.focused]}>
      {({ focused }) => <Text style={[styles.label, focused && styles.focusedLabel]}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, backgroundColor: '#000' },
  chrome: { position: 'absolute', left: 80, right: 80, bottom: 60, gap: 12 },
  status: { color: '#fff', fontSize: 34, fontWeight: '600' },
  detail: { color: '#ddd', fontSize: 24 },
  buttons: { flexDirection: 'row', gap: 20 },
  button: { paddingHorizontal: 28, paddingVertical: 14, borderRadius: 40, backgroundColor: 'rgba(255,255,255,0.18)' },
  focused: { backgroundColor: '#fff', transform: [{ scale: 1.08 }] },
  label: { color: '#fff', fontSize: 26, fontWeight: '600' },
  focusedLabel: { color: '#000' },
});

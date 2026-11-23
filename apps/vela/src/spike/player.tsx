// Spike: VelaPlayerView with a real lab plan on any platform (docs/architecture.md, spike b).
// Signs in from configuration (apps/vela/.env.local, never committed):
//   EXPO_PUBLIC_VELA_ORIGIN, EXPO_PUBLIC_VELA_USER, EXPO_PUBLIC_VELA_PASSWORD, EXPO_PUBLIC_VELA_TITLE (a search query),
//   EXPO_PUBLIC_VELA_MUTED=1 to start muted (a drive at night),
//   EXPO_PUBLIC_VELA_ORIGINALS=0 to declare no original playback (the server's HLS, server-applied seeks and tracks),
//   EXPO_PUBLIC_VELA_PREVIEW=1 to play the title's trailer preview instead (VelaPlayerView's preview mode)
// then asks Ether for a plan with this device's capabilities and plays it. Remote: the buttons below.
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { VelaPlayer, VelaPlayerView } from '@vela/player';
import type {
  Command, PlaybackPlan, PlayerObservation, PreviewSource, SessionCommand, Snapshot,
} from '@vela/player-api';

const origin = process.env.EXPO_PUBLIC_VELA_ORIGIN ?? '';
const api = `${origin}/vela/v0`;
// The lab Ether admits client builds below 0.2.0; until it admits the React Native app's, the spike
// reports the web client's build (EXPO_PUBLIC_VELA_APP_VERSION).
const appVersion = process.env.EXPO_PUBLIC_VELA_APP_VERSION ?? '0.2.0';
const platform = Platform.isTV && Platform.OS === 'ios' ? 'tvos' : Platform.OS;
const device = { id: `vela-${platform}-spike`, name: `Vela spike (${platform})`, platform, appVersion };

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
/** Signs in, negotiates and finds the first movie the configured query names. */
async function labTitle(): Promise<{ id: string; client: object }> {
  const tokens = await call<{ accessToken: string }>('POST', '/auth/sign-in', {
    idempotencyKey: key(),
    username: process.env.EXPO_PUBLIC_VELA_USER,
    password: process.env.EXPO_PUBLIC_VELA_PASSWORD,
    device,
  });
  token = tokens.accessToken;
  // What this platform's player plays, as the player itself declares it.
  const capabilities = await VelaPlayer.capabilities();
  const client = { device, protocolVersions: [0], ...capabilities };
  const declared = process.env.EXPO_PUBLIC_VELA_ORIGINALS === '0' ? { ...client, originalPlayback: undefined } : client;
  await call('POST', '/negotiate', { idempotencyKey: key(), client: declared });
  const query = process.env.EXPO_PUBLIC_VELA_TITLE ?? '1917';
  const found = await call<{ items: { id: string; kind: string }[] }>('POST', '/search', {
    idempotencyKey: key(), query, generation: 1, mode: 'fast', limit: 5,
  });
  const title = found.items.find((item) => item.kind === 'movie') ?? found.items[0];
  if (!title) {
    throw new Error(`Nothing found for ${query}`);
  }
  return { id: title.id, client: declared };
}

async function labPlan(): Promise<PlaybackPlan> {
  const title = await labTitle();
  return call<PlaybackPlan>('POST', '/playback', { idempotencyKey: key(), titleId: title.id, client: title.client });
}

type PreviewAnswer = { state: 'ready'; grant: { url: string; mimeType: string; expiresAt: string } }
  | { state: 'preparing'; retryAfterSeconds: number } | { state: 'unavailable'; reason: string };

/** The title's trailer preview grant, asked again while the server prepares it (up to a minute). */
async function labPreview(): Promise<PreviewSource> {
  const title = await labTitle();
  for (let attempt = 0; attempt < 30; attempt++) {
    const answer = await call<PreviewAnswer>('POST', `/titles/${title.id}/trailer-preview`, {
      idempotencyKey: key(), client: title.client,
    });
    if (answer.state === 'ready') {
      return { url: answer.grant.url, mimeType: answer.grant.mimeType, expiresAt: answer.grant.expiresAt, loop: true };
    }
    if (answer.state === 'unavailable') {
      throw new Error(`No preview: ${answer.reason}`);
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(1, answer.retryAfterSeconds) * 1000));
  }
  throw new Error('The preview was still preparing after a minute');
}

// The root layout may remount this route while the app signs in: one lab request per app run, and a stop
// only when the route has really gone (not remounted within a few seconds).
let sharedPlan: Promise<PlaybackPlan> | undefined;
let sharedPreview: Promise<PreviewSource> | undefined;
let pendingStop: ReturnType<typeof setTimeout> | undefined;

/** Ends the session on the server, so its media grant is released. */
function stopSession(plan: PlaybackPlan) {
  void call('POST', `/sessions/${plan.sessionId}/commands`, {
    idempotencyKey: key(),
    kind: 'stop',
    sourceGeneration: plan.sourceGeneration,
    seekGeneration: plan.seekGeneration,
  }).catch(() => {});
}

/** The server applies a session command and answers with the plan to play. */
function sessionCommand(event: { sessionId: string; command: SessionCommand }): Promise<PlaybackPlan> {
  return call<PlaybackPlan>('POST', `/sessions/${event.sessionId}/commands`, event.command);
}

function freshPlan(event: { sessionId: string }): Promise<PlaybackPlan> {
  return call<{ plan: PlaybackPlan }>('GET', `/sessions/${event.sessionId}`).then((snapshot) => snapshot.plan);
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
  const [preview, setPreview] = useState<PreviewSource>();
  const commandId = useRef(0);
  const latestPlan = useRef<PlaybackPlan | undefined>(undefined);
  latestPlan.current = plan;

  useEffect(() => {
    clearTimeout(pendingStop);
    // Ether's broker paths need no headers; the origin resolves the plan's relative URLs.
    VelaPlayer.setMediaAccess({ origin, pathPrefix: '/', headers: async () => ({}) });
    if (process.env.EXPO_PUBLIC_VELA_PREVIEW === '1') {
      sharedPreview ??= labPreview();
      sharedPreview.then(setPreview, (error) => setProblem(String(error)));
    } else {
      sharedPlan ??= labPlan();
      sharedPlan.then(setPlan, (error) => setProblem(String(error)));
    }
    return () => {
      pendingStop = setTimeout(() => {
        if (latestPlan.current) {
          stopSession(latestPlan.current);
        }
        sharedPlan = undefined;
        sharedPreview = undefined;
        VelaPlayer.setMediaAccess(null);
      }, 3000);
    };
  }, []);

  const send = (next: CommandBody) => {
    commandId.current += 1;
    setCommand({ ...next, id: commandId.current } as Command);
  };

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
      {preview ? (
        <VelaPlayerView preview={preview} active onSnapshot={setSnapshot} style={StyleSheet.absoluteFill} />
      ) : null}
      {plan ? (
        <VelaPlayerView
          plan={plan}
          command={command}
          onSnapshot={setSnapshot}
          onError={(failure) => setProblem(`${failure.kind}: ${failure.message}`)}
          onObservation={postObservation}
          onSessionCommand={(event) => sessionCommand(event).then(setPlan, (error) => setProblem(String(error)))}
          onSessionRefresh={(event) => freshPlan(event).then(setPlan, (error) => setProblem(String(error)))}
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

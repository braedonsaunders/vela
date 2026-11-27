'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { connect } = require('./mpv-ipc');
const { createProxy } = require('./media-proxy');
const { downloadsRoot, localizePlayback, localFileOf } = require('../downloads-paths');
const { acceptPlan, physicalBounds, playbackRate, parseEld, playbackSettings, audioOptions, subtitleProperties,
  isLive, isStartOver, demuxerOptions, liveWindow, liveSnapshot, catchUpTarget, clampLiveSeek, resumeTarget } = require('./logic');
// A downloaded title plays from disk: its vela-app://app/vela-downloads/ URLs become the validated local
// paths, which mpv opens itself; the media proxy and its grant are never involved.
const downloads = () => downloadsRoot(require('electron').app.getPath('userData'));
const root = () => process.env.VELA_LINUX_NATIVE_DIR || path.join(process.resourcesPath || path.dirname(__dirname), 'native-linux');
function available() {
  return process.platform === 'linux' && !!process.env.DISPLAY && fs.existsSync(path.join(root(), 'vela-mpv'))
    && spawnSync(path.join(root(),'vela-mpv'),['--probe'],{env:{...process.env,LD_LIBRARY_PATH:path.join(root(),'lib')},timeout:2000,stdio:'ignore'}).status === 0;
}
/** playback.json beside Electron's other app data; the same fields as on Windows. */
function settings() {
  try {
    const { app } = require('electron');
    return playbackSettings(JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'playback.json'), 'utf8')));
  } catch { return playbackSettings(null); }
}
/** The HDMI sink behind a direct ALSA device ("alsa/hdmi:CARD=NVidia,DEV=0"), from its ELD. */
function sinkFor(device) {
  const card = /CARD=([^,]+)/.exec(device || '')?.[1];
  if (!card || !/^hdmi:/.test(device.slice(5)) || !/^\w+$/.test(card)) return null;
  try {
    const dir = path.join('/proc/asound', card);
    const sinks = fs.readdirSync(dir).filter(name => name.startsWith('eld#')).map(name => parseEld(fs.readFileSync(path.join(dir, name), 'utf8'))).filter(Boolean);
    if (sinks.length !== 1) return null; // none connected, or several and no way to tell which DEV is which
    return sinks[0];
  } catch { return null; }
}
/** Channels of the PulseAudio/PipeWire default sink, when pactl is installed. */
function defaultSinkChannels() {
  try {
    const name = spawnSync('pactl', ['get-default-sink'], { encoding: 'utf8', timeout: 1000 }).stdout.trim();
    const line = spawnSync('pactl', ['list', 'short', 'sinks'], { encoding: 'utf8', timeout: 1000 }).stdout.split('\n').find(l => l.split('\t')[1] === name);
    const channels = Number(/(\d+)ch/.exec(line || '')?.[1]);
    return Number.isFinite(channels) && channels > 0 ? { channels, hdmi: /hdmi/i.test(name) } : null;
  } catch { return null; }
}
async function capabilities() {
  const wanted = settings(), sink = sinkFor(wanted.audioDevice), pulse = sink ? null : defaultSinkChannels();
  // X11 has no HDR signalling, so HDR is tone-mapped and not claimed. Bitstreams are claimed only for a
  // direct ALSA HDMI device whose sink lists them; through PulseAudio/PipeWire mpv still tries them.
  const mpv = { hdrDisplay: false, passthrough: sink ? wanted.passthrough.filter(codec => sink.passthrough.includes(codec)) : [],
    maxChannels: sink?.maxChannels || pulse?.channels || 2, maxSampleRate: sink?.maxSampleRate || undefined };
  return { mpv, containers: ['mp4','mkv','webm','mpegts'], videoCodecs: ['h264','hevc','vp9','av1'],
    audioCodecs: ['aac','ac3','eac3','dts','truehd','flac','opus'], subtitleFormats: ['webvtt','srt','ass','ssa','pgs','tx3g'],
    hls: true, mse: false, originalPlayback: { version: 1, range: true, webgpu: false,
      demuxContainers: ['mkv','webm','mp4','mpegts'], videoDecoders: ['h264','hevc','vp9','av1'],
      audioDecoders: ['aac','ac3','eac3','dts','truehd','flac','alac','opus','vorbis','mp3','mp2','pcm_s16le','pcm_s24le','pcm_s32le'] } };
}
async function create({ window, emit }) {
  if (!available()) throw new Error('Native Linux player unavailable');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-mpv-'));
  const socket = path.join(temp, 'ipc');
  const handle = window.getNativeWindowHandle();
  const xid = handle.length >= 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE());
  const child = spawn(path.join(root(), 'vela-mpv'), [String(xid), socket], {
    env: { ...process.env, LD_LIBRARY_PATH: path.join(root(), 'lib') }, stdio: ['pipe','pipe','ignore'] });
  let ipc, proxy, plan, source = '', seek = '', disposed = false, timer, sequence = 0, lastCommand = -1, pendingSeek, externalSubtitle, accessGeneration = 0, loadedAt = 0, appliedTracks = {}, activeEntry = null, localSource = false;
  let rect = { x:0, y:0, width:0, height:0, scaleFactor:1 }, chain = Promise.resolve();
  let renderer = '', facts = null, described = 0, subtitleAppearance = '';
  let subtitlePosition = 100, captionLift = 0;
  const updateSubtitlePosition = () => cmd('set_property', 'sub-pos', Math.min(subtitlePosition, 100 - captionLift)).catch(() => {});
  // Live timeshift: when the plan arrived (its edge grows from then), the behind-live verdict held between
  // snapshots, and a local live seek in flight ({ target, at }, on the axis of the reported position).
  let planReceivedAt = 0, liveBehind = false, liveSeek = null, liveStartup, liveStartupId = 0;
  const playback = settings(), sink = sinkFor(playback.audioDevice), audio = audioOptions(playback, sink);
  const windowEvents=['move','resize','show','hide','minimize','restore','focus','blur','enter-full-screen','leave-full-screen'];
  const send = (event, value) => { if (!disposed) emit(event, value); };
  function bounds() {
    if (disposed || window.isDestroyed()) return;
    const b = physicalBounds(window.getContentBounds(), rect, rect.scaleFactor || 1);
    child.stdin.write(`${b.x} ${b.y} ${window.isVisible() && !window.isMinimized() ? b.width : 0} ${b.height}\n`);
  }
  async function destroy() {
    if (disposed) return; disposed = true; clearInterval(timer); proxy?.close(); ipc?.close();
    for (const event of windowEvents) window.removeListener(event, bounds);
    child.stdin.destroy();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 1500))]);
      if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await once(child, 'exit'); }
    }
    fs.rmSync(temp, { recursive:true, force:true });
  }
  async function fallback(error) { send('fallback', { message:'Native playback unavailable', reason:['Unsupported path','Server failed','Native video output unavailable','Native command timeout','Native command failed','Media outside access grant','Invalid URL','Browser fallback required'].includes(error?.message) ? error.message : 'Native host unavailable' }); await destroy(); }
  child.on('error', () => { void fallback(); });
  child.on('exit', code => { if (!disposed) { send('fallback',{message:'Native player exited',reason:`Native process exit ${code}`}); void destroy(); } });
  child.stdin.on('error', () => { if (!disposed) void fallback(); });
  try {
    await Promise.race([once(child.stdout, 'data').then(([line]) => { renderer = /^ready (\S+)/.exec(String(line))?.[1] || ''; }), once(child, 'exit').then(() => { throw new Error('Native startup failed'); }),
      new Promise((_, reject) => { const t = setTimeout(() => reject(new Error('Native startup timeout')), 5000); t.unref(); })]);
    ipc = await connect(socket, event => {
      if (event.event === 'start-file') activeEntry=event.playlist_entry_id;
      if (event.event === 'end-file' && event.reason === 'error' && (proxy || localSource) && source
          && activeEntry != null && event.playlist_entry_id === activeEntry) {
        send('fallback',{message:'Native decoder failed',reason:'Native decoder error'}); void destroy();
      }
    });
  } catch { await destroy(); throw new Error('Native Linux player failed to start'); }
  const cmd = (...args) => ipc.command(...args);
  const get = name => cmd('get_property', name).catch(() => null);
  const enqueue = fn => { chain = chain.then(() => disposed ? undefined : fn()).catch(fallback); return chain; };
  // A device or option this libmpv refuses leaves mpv's default in place.
  for (const [name, value] of Object.entries(audio)) await cmd('set_property', name, value).catch(() => {});
  const factNames = ['current-tracks/video','current-tracks/audio','video-params','video-target-params','audio-params','audio-out-params','hwdec-current','container-fps','deinterlace-active'];
  async function describe(p) {
    if (facts && Date.now() - described < 1000) return;
    described = Date.now();
    const values = await Promise.all(factNames.map(get));
    const named = Object.fromEntries(factNames.map((n, i) => [n, values[i]]));
    facts = { videoTrack: named['current-tracks/video'], audioTrack: named['current-tracks/audio'], 'video-params': named['video-params'],
      'video-target-params': named['video-target-params'], 'audio-params': named['audio-params'], 'audio-out-params': named['audio-out-params'],
      'hwdec-current': named['hwdec-current'], 'container-fps': named['container-fps'], 'deinterlace-active': named['deinterlace-active'],
      volume: p.volume, speed: p.speed };
  }
  function output() {
    let refreshRate;
    try { const { screen } = require('electron'); refreshRate = screen.getDisplayMatching(window.getBounds()).displayFrequency || undefined; } catch {}
    const passthrough = /^spdif-/.test(facts?.['audio-out-params']?.format || '');
    // The helper fixes the target to SDR BT.709 (no HDR signalling on X11); mpv's render API reports no target.
    return { display: refreshRate ? { refreshRate } : null, range: 'sdr', frameRateMatch: 'unsupported', rangeMatch: 'unsupported',
      exclusive: audio['audio-exclusive'] || passthrough, route: /hdmi/i.test(playback.audioDevice) || (!playback.audioDevice && defaultHdmi) ? 'hdmi' : undefined };
  }
  const defaultHdmi = !playback.audioDevice && !!defaultSinkChannels()?.hdmi;
  for (const event of windowEvents) window.on(event, bounds);
  let ticking = false;
  timer = setInterval(() => {
    if (!plan || !source || disposed || ticking) return;
    ticking = true;
    void enqueue(async () => {
      if (!plan || !source || (!proxy && !localSource)) return;
      const names = ['time-pos','duration','pause','paused-for-cache','eof-reached','demuxer-cache-duration','volume','mute','frame-drop-count','track-list','video-out-params','hwdec-current','estimated-vf-fps','speed','seeking','demuxer-cache-state'];
      const values = await Promise.all(names.map(get));
      const p = Object.fromEntries(names.map((n,i) => [n,values[i]]));
      if (Date.now()-loadedAt > 10000 && p['track-list']?.some(t => t.type === 'video') && !p['video-out-params']) throw new Error('Native video output unavailable');
      const landing = liveStartup?.landing;
      const offset = landing?.segmentStart ?? (plan.paths.find(p => p.id === plan.selectedPathId)?.timelineOriginSeconds || 0);
      if (landing && !liveStartup.placed && p['time-pos'] != null) {
        const relative = landing.position - landing.segmentStart;
        if (relative > 0 && Math.abs(p['time-pos'] - relative) > 0.1) {
          const cached = p['demuxer-cache-state']?.['seekable-ranges']?.some(range => range.start <= relative && relative < range.end);
          // FFmpeg live HLS is not demuxer-seekable. Wait for the selected segment to enter mpv's cache.
          if (cached && await liveSeekTo(landing.position, offset, true)) {
            liveStartup.placed = true;
            return;
          }
          if (Date.now() - loadedAt < 10000) return;
        }
        liveStartup.placed = true;
      }
      if (p['time-pos'] != null) await describe(p);
      if (pendingSeek != null && p['time-pos'] != null) { await cmd('seek',pendingSeek,'absolute+exact'); pendingSeek=null; }
      const position = (p['time-pos'] || 0) + offset;
      const state = p['eof-reached'] ? 'ended' : p['paused-for-cache'] ? 'buffering' : p.pause ? 'paused' : p['time-pos'] == null ? 'loading' : 'playing';
      let live = null;
      if (isLive(plan)) {
        if (liveSeek && (!p.seeking && Math.abs(position - liveSeek.target) < 2 || Date.now() - liveSeek.at > 10000)) liveSeek = null;
        const window = liveWindow({ plan, cacheState: p['demuxer-cache-state'], origin: offset, receivedAt: planReceivedAt, now: Date.now(), targetDuration: proxy.targetDuration() });
        // A stall while playing is the connection, not a seek or a pause.
        const reconnecting = state === 'buffering' && !p.pause && !p.seeking && !liveSeek && pendingSeek == null;
        const report = liveSnapshot(window, liveSeek?.target ?? position, liveBehind, reconnecting);
        liveBehind = report.behind; live = report.live;
      }
      for (const kind of ['audio','subtitle']) {
        const id = plan[kind === 'audio' ? 'selectedAudioTrackId' : 'selectedSubtitleTrackId'];
        const track = plan[kind === 'audio' ? 'audioTracks' : 'subtitleTracks']?.find(t => t.id === id);
        const native = p['track-list']?.find(t => t.type === (kind === 'audio' ? 'audio' : 'sub') && t['ff-index'] === track?.streamIndex);
        if (native && appliedTracks[kind] !== native.id) { await cmd('set_property', kind === 'audio' ? 'aid' : 'sid', native.id); appliedTracks[kind]=native.id; }
        else if (kind === 'subtitle' && track?.delivery?.kind === 'external' && externalSubtitle !== id) { await cmd('sub-add',mediaSource(track.delivery.url || track.url),'select'); externalSubtitle=id; }
        else if (kind === 'subtitle' && !id) await cmd('set_property','sid','no');
      }
      send('snapshot', {sessionId:plan.sessionId,sourceGeneration:plan.sourceGeneration,seekGeneration:plan.seekGeneration,state,position,duration:live ? null : (p.duration || 0)+offset,live,seekTarget:liveSeek?.target ?? null,bufferAheadSeconds:p['demuxer-cache-duration'] || 0,volume:(p.volume || 0)/100,muted:!!p.mute,speed:playbackRate(plan,p.speed),speeds:plan.channelId || plan.live ? [1] : [.5,.75,1,1.25,1.5,2],droppedFrames:p['frame-drop-count'] || 0,nativeVideo:p['video-out-params'],nativeHwdec:p['hwdec-current'],nativeFps:p['estimated-vf-fps'],mpv:facts,output:output()});
      if (liveSeek?.startup) return;
      send('observation', {sessionId:plan.sessionId,observation:{idempotencyKey:`${source}:${++sequence}`,sequence,
        sourceGeneration:plan.sourceGeneration,seekGeneration:plan.seekGeneration,observedAt:new Date().toISOString(),positionSeconds:position,state:state === 'loading' ? 'buffering' : state,
        selectedPathId:plan.selectedPathId,audioTrackId:plan.selectedAudioTrackId,subtitleTrackId:plan.selectedSubtitleTrackId,
        playableRanges:p['demuxer-cache-duration'] > 0 ? [{startSeconds:position,endSeconds:position+p['demuxer-cache-duration']}] : []}});
    }).finally(() => { ticking = false; });
  }, 500);
  /** The live window and position now, on the axis of the reported position. */
  async function liveNow(origin) {
    const [time, cacheState] = await Promise.all([get('time-pos'), get('demuxer-cache-state')]);
    return { position: (time || 0) + origin, window: liveWindow({ plan, cacheState, origin, receivedAt: planReceivedAt, now: Date.now(), targetDuration: proxy.targetDuration() }) };
  }
  /** A seek inside the live window mpv holds; false when mpv refused it. */
  async function liveSeekTo(target, origin, startup = false) {
    liveSeek = { target, at: Date.now(), startup }; pendingSeek = null;
    try { await cmd('seek', Math.max(0, target - origin), 'absolute+exact'); return true; }
    catch { liveSeek = null; return false; }
  }
  /**
   * A live plan's play, pause, seek and catchUp stay in mpv, inside the window it holds; none becomes a
   * session command (positions here are on mpv's timeline, not the server's). Returns a refusal or null.
   */
  async function liveCommand(c, origin) {
    const { position, window } = await liveNow(origin);
    const from = liveSeek?.target ?? position;
    if (c.type === 'pause') { await cmd('set_property','pause',true); return null; }
    if (c.type === 'play') {
      // A long pause: the window may have slid past the position. Resume inside it, never at the edge.
      const target = !liveSeek && window ? resumeTarget(window, position) : null;
      if (target !== null) await liveSeekTo(target, origin);
      await cmd('set_property','pause',false);
      return null;
    }
    if (c.type === 'catchUp') {
      const target = window ? catchUpTarget(window, from) : null;
      if (target === null) return 'No newer live media to catch up to';
      return await liveSeekTo(target, origin) ? null : 'The live seek failed';
    }
    const target = window ? clampLiveSeek(window, c.type === 'seekBy' ? from + c.seconds : c.seconds) : null;
    if (target === null) return window?.edge == null ? 'The live window is not known yet' : 'This live stream keeps no history to rewind';
    return await liveSeekTo(target, origin) ? null : 'The live seek failed';
  }
  /** What mpv opens for a plan URL: a downloaded file's validated path, else the grant's proxy route. */
  function mediaSource(address, startup) {
    if (typeof address === 'string' && /^file:/i.test(address)) {
      const file = localFileOf(downloads(), address);
      if (!file) throw new Error('Invalid URL');
      return file;
    }
    if (!proxy) throw new Error('Media outside access grant');
    return proxy.register(address, startup);
  }
  let latestProps;
  const apply = async props => {
      if (props.preview || props.session) throw new Error('Browser fallback required');
      if (props.active === false || !props.plan) { await cmd('stop'); source=''; plan=null; return; }
      if (props.serverError) throw new Error('Server failed');
      const appearance = JSON.stringify(props.subtitleAppearance ?? null);
      if (appearance !== subtitleAppearance) {
        subtitleAppearance = appearance;
        for (const [name, value] of subtitleProperties(props.subtitleAppearance)) {
          if (name === 'sub-pos') { subtitlePosition = value; await updateSubtitlePosition(); }
          else await cmd('set_property', name, value).catch(() => {});
        }
      }
      if (!acceptPlan(plan, props.plan)) return;
      const next = props.plan, selected = next.paths.find(p => p.id === next.selectedPathId);
      const local = typeof selected?.url === 'string' && /^file:/i.test(selected.url);
      if (!proxy && !local) return;
      if (!selected || !(selected.transport === 'hls' || selected.transport === 'file' && selected.original)) throw new Error('Unsupported path');
      if (plan?.sessionId !== next.sessionId) { sequence=0; lastCommand=-1; liveBehind=false; liveSeek=null; }
      if (plan?.sessionId !== next.sessionId || plan.revision !== next.revision) planReceivedAt = Date.now();
      plan=next;
      const key = `${plan.sessionId}:${selected.id}:${plan.sourceGeneration}`;
      const loading = source !== key;
      if (loading) {
        // The demuxer reads these when it opens: live's bounded timeshift buffer, Start over from its first segment.
        liveStartup = selected.transport === 'hls' && plan.live?.timeshift && !isStartOver(plan)
          ? { key: ++liveStartupId, live: plan.live, requested: plan.seekGeneration > 0 ? plan.positionSeconds : null } : undefined;
        for (const [name, value] of demuxerOptions(plan, !!liveStartup)) await cmd('set_property', name, value).catch(() => {});
        await cmd('loadfile', mediaSource(selected.url, liveStartup), 'replace'); source=key; localSource=local; externalSubtitle=null; appliedTracks={}; loadedAt=Date.now(); facts=null;
        liveBehind=false; liveSeek=null;
        await cmd('set_property','speed',1);
      }
      const seekKey = `${key}:${plan.seekGeneration}`;
      if (seek !== seekKey) {
        const target = Math.max(0,plan.positionSeconds-(selected.timelineOriginSeconds || 0));
        // A channel joins at its edge: its plan position is not on mpv's timeline. Start over starts at its position.
        pendingSeek = target > 0 && (!isLive(plan) || isStartOver(plan)) ? target : null; seek=seekKey;
      }
      // Live pause and play are the viewer's, held here: a refreshed live plan does not undo them.
      if (!isLive(plan) || loading) await cmd('set_property','pause',plan.state === 'paused');
      const c = props.command;
      if (c && c.id > lastCommand && isLive(plan) && ['play','pause','seek','seekBy','catchUp'].includes(c.type)) {
        lastCommand = c.id;
        const refusal = await liveCommand(c, liveStartup?.landing?.segmentStart ?? (selected.timelineOriginSeconds || 0));
        send('command', refusal ? {id:c.id,ok:false,failure:{kind:'action',message:refusal,recoverable:true}} : {id:c.id,ok:true});
      } else if (c && c.id > lastCommand && c.type === 'catchUp') {
        lastCommand = c.id;
        send('command',{id:c.id,ok:false,failure:{kind:'action',message:'Only a live stream can catch up to live',recoverable:true}});
      } else if (c && c.id > lastCommand) {
        lastCommand = c.id;
        const kind = {play:'resume',audio:'tracks',subtitle:'tracks',seekBy:'seek',switchPath:'switch'}[c.type] || c.type;
        if (['play','pause','seek','seekBy','audio','subtitle','switchPath'].includes(c.type)) {
          const payload = {kind,sourceGeneration:plan.sourceGeneration,seekGeneration:plan.seekGeneration,idempotencyKey:require('node:crypto').randomUUID()};
          if (c.type === 'seek' || c.type === 'seekBy') payload.positionSeconds = Math.max(0,(c.type === 'seekBy' ? ((await get('time-pos')) || 0) + (selected.timelineOriginSeconds || 0) : 0) + c.seconds);
          if (c.type === 'audio') payload.audioTrackId=c.trackId;
          if (c.type === 'subtitle') payload.subtitleTrackId=c.trackId;
          if (c.type === 'switchPath') { payload.pathId=c.pathId; payload.atSeconds=((await get('time-pos')) || 0)+(selected.timelineOriginSeconds || 0); }
          send('session-command',{sessionId:plan.sessionId,command:payload});
        }
        if (c.type === 'play') await cmd('set_property','pause',false);
        if (c.type === 'pause') await cmd('set_property','pause',true);
        if (c.type === 'mute') await cmd('set_property','mute',!!c.muted);
        if (c.type === 'volume') await cmd('set_property','volume',Math.max(0,Math.min(1,c.value))*100);
        if (c.type === 'speed') await cmd('set_property','speed',playbackRate(plan,c.value));
        send('command',{id:c.id,ok:true});
      }
  };
  return {
    async setCaptionInsets(_insets, layout) {
      if (!layout || !Number.isFinite(layout.lift) || !Number.isFinite(layout.margin)) return;
      captionLift = Math.max(0, Math.min(100, layout.lift));
      await Promise.all([
        updateSubtitlePosition(),
        cmd('set_property', 'sub-margin-x', Math.max(19, Math.min(4096, Math.round(layout.margin)))).catch(() => {}),
        cmd('set_property', 'sub-align-x', ['left', 'right'].includes(layout.align) ? layout.align : 'center').catch(() => {}),
      ]);
    },
    setBounds(value) { rect = value; bounds(); },
    setAccess(grant) {
      const generation = ++accessGeneration;
      const immutable = grant ? {origin:grant.origin,pathPrefix:grant.pathPrefix,headers:{...grant.headers}} : null;
      if (localSource && source) {
        // A downloaded file plays without a grant: replace the grant for the next server plan, keep the file playing.
        proxy?.close(); proxy=null;
        return enqueue(async () => { if (generation === accessGeneration && immutable) proxy=await createProxy(immutable); });
      }
      activeEntry=null; source=''; localSource=false; proxy?.close(); proxy=null;
      return enqueue(async () => { await cmd('stop'); source=''; seek=''; plan=null; pendingSeek=null; liveStartup=undefined;
        if (generation === accessGeneration && immutable) { proxy=await createProxy(immutable); if(latestProps) await apply(latestProps); }
      });
    },
    update(props) { return enqueue(() => { latestProps=localizePlayback(props, downloads()); return apply(latestProps); }); },
    diagnostics: async () => ({renderer,active:!!source,hasAccess:!!proxy,sessionId:plan?.sessionId,position:await get('time-pos'),video:await get('video-out-params'),hwdec:await get('hwdec-current'),speed:await get('speed')}),
    destroy,
  };
}
module.exports = { available, capabilities, create };

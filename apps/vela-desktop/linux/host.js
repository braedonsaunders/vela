'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { connect } = require('./mpv-ipc');
const { createProxy } = require('./media-proxy');
const { acceptPlan, physicalBounds } = require('./logic');
const root = () => process.env.VELA_LINUX_NATIVE_DIR || path.join(process.resourcesPath || path.dirname(__dirname), 'native-linux');
function available() {
  return process.platform === 'linux' && !!process.env.DISPLAY && fs.existsSync(path.join(root(), 'vela-mpv'))
    && spawnSync(path.join(root(),'vela-mpv'),['--probe'],{env:{...process.env,LD_LIBRARY_PATH:path.join(root(),'lib')},timeout:2000,stdio:'ignore'}).status === 0;
}
async function capabilities() {
  return { containers: ['mp4','mkv','webm','mpegts'], videoCodecs: ['h264','hevc','vp9','av1'],
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
  let ipc, proxy, plan, source = '', seek = '', disposed = false, timer, sequence = 0, lastCommand = -1, pendingSeek, externalSubtitle, accessGeneration = 0, loadedAt = 0;
  let rect = { x:0, y:0, width:0, height:0, scaleFactor:1 }, chain = Promise.resolve();
  const send = (event, value) => { if (!disposed) emit(event, value); };
  function bounds() {
    if (disposed || window.isDestroyed()) return;
    const b = physicalBounds(window.getContentBounds(), rect, rect.scaleFactor || 1);
    child.stdin.write(`${b.x} ${b.y} ${window.isVisible() && !window.isMinimized() ? b.width : 0} ${b.height}\n`);
  }
  async function destroy() {
    if (disposed) return; disposed = true; clearInterval(timer); proxy?.close(); ipc?.close();
    for (const event of ['move','resize','show','hide','minimize','restore']) window.removeListener(event, bounds);
    child.stdin.destroy();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 1500))]);
      if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await once(child, 'exit'); }
    }
    fs.rmSync(temp, { recursive:true, force:true });
  }
  async function fallback() { send('fallback', { message:'Native playback unavailable' }); await destroy(); }
  child.on('error', () => { void fallback(); });
  child.on('exit', () => { if (!disposed) void fallback(); });
  child.stdin.on('error', () => { if (!disposed) void fallback(); });
  try {
    await Promise.race([once(child.stdout, 'data'), once(child, 'exit').then(() => { throw new Error('Native startup failed'); }),
      new Promise((_, reject) => { const t = setTimeout(() => reject(new Error('Native startup timeout')), 5000); t.unref(); })]);
    ipc = await connect(socket, event => { if (event.event === 'end-file' && event.reason === 'error') void fallback(); });
  } catch { await destroy(); throw new Error('Native Linux player failed to start'); }
  const cmd = (...args) => ipc.command(...args);
  const get = name => cmd('get_property', name).catch(() => null);
  const enqueue = fn => { chain = chain.then(() => disposed ? undefined : fn()).catch(fallback); return chain; };
  for (const event of ['move','resize','show','hide','minimize','restore']) window.on(event, bounds);
  let ticking = false;
  timer = setInterval(() => {
    if (!plan || !source || disposed || ticking) return;
    ticking = true;
    void enqueue(async () => {
      const names = ['time-pos','duration','pause','paused-for-cache','eof-reached','demuxer-cache-duration','volume','mute','frame-drop-count','track-list','video-out-params','hwdec-current','estimated-vf-fps'];
      const values = await Promise.all(names.map(get));
      const p = Object.fromEntries(names.map((n,i) => [n,values[i]]));
      if (Date.now()-loadedAt > 10000 && p['track-list']?.some(t => t.type === 'video') && !p['video-out-params']) throw new Error('Native video output unavailable');
      const offset = plan.paths.find(p => p.id === plan.selectedPathId)?.timelineOriginSeconds || 0;
      if (pendingSeek != null && p['time-pos'] != null) { await cmd('seek',pendingSeek,'absolute+exact'); pendingSeek=null; }
      const position = (p['time-pos'] || 0) + offset;
      const state = p['eof-reached'] ? 'ended' : p['paused-for-cache'] ? 'buffering' : p.pause ? 'paused' : p['time-pos'] == null ? 'loading' : 'playing';
      for (const kind of ['audio','subtitle']) {
        const id = plan[kind === 'audio' ? 'selectedAudioTrackId' : 'selectedSubtitleTrackId'];
        const track = plan[kind === 'audio' ? 'audioTracks' : 'subtitleTracks']?.find(t => t.id === id);
        const native = p['track-list']?.find(t => t.type === (kind === 'audio' ? 'audio' : 'sub') && t['ff-index'] === track?.streamIndex);
        if (native) await cmd('set_property', kind === 'audio' ? 'aid' : 'sid', native.id);
        else if (kind === 'subtitle' && track?.delivery?.kind === 'external' && externalSubtitle !== id) { await cmd('sub-add',proxy.register(track.delivery.url || track.url),'select'); externalSubtitle=id; }
        else if (kind === 'subtitle' && !id) await cmd('set_property','sid','no');
      }
      send('snapshot', {state,position,duration:(p.duration || 0)+offset,bufferAheadSeconds:p['demuxer-cache-duration'] || 0,volume:(p.volume || 0)/100,muted:!!p.mute,speed:1,droppedFrames:p['frame-drop-count'] || 0,nativeVideo:p['video-out-params'],nativeHwdec:p['hwdec-current'],nativeFps:p['estimated-vf-fps']});
      send('observation', {sessionId:plan.sessionId,observation:{idempotencyKey:`${source}:${++sequence}`,sequence,
        sourceGeneration:plan.sourceGeneration,seekGeneration:plan.seekGeneration,observedAt:new Date().toISOString(),positionSeconds:position,state:state === 'loading' ? 'buffering' : state,
        selectedPathId:plan.selectedPathId,audioTrackId:plan.selectedAudioTrackId,subtitleTrackId:plan.selectedSubtitleTrackId,
        playableRanges:p['demuxer-cache-duration'] > 0 ? [{startSeconds:position,endSeconds:position+p['demuxer-cache-duration']}] : []}});
    }).finally(() => { ticking = false; });
  }, 500);
  return {
    setBounds(value) { rect = value; bounds(); },
    setAccess(grant) {
      const generation = ++accessGeneration; proxy?.close(); proxy=null;
      const immutable = grant ? {origin:grant.origin,pathPrefix:grant.pathPrefix,headers:{...grant.headers}} : null;
      return enqueue(async () => { await cmd('stop'); source=''; seek=''; plan=null; pendingSeek=null;
        if (generation === accessGeneration && immutable) proxy=await createProxy(immutable);
      });
    },
    update(props) { return enqueue(async () => {
      if (props.preview || props.session) throw new Error('Browser fallback required');
      if (props.active === false || !props.plan) { await cmd('stop'); source=''; plan=null; return; }
      if (props.serverError) throw new Error('Server failed');
      if (!acceptPlan(plan, props.plan)) return;
      const next = props.plan, selected = next.paths.find(p => p.id === next.selectedPathId);
      if (!proxy || !selected || !(selected.transport === 'hls' || selected.transport === 'file' && selected.original)) throw new Error('Unsupported path');
      if (plan?.sessionId !== next.sessionId) { sequence=0; lastCommand=-1; }
      plan=next;
      const key = `${plan.sessionId}:${selected.id}:${plan.sourceGeneration}`;
      if (source !== key) {
        await cmd('loadfile', proxy.register(selected.url), 'replace'); source=key; externalSubtitle=null; loadedAt=Date.now();
        await cmd('set_property','speed',1);
      }
      const seekKey = `${key}:${plan.seekGeneration}`;
      if (seek !== seekKey) {
        const target = Math.max(0,plan.positionSeconds-(selected.timelineOriginSeconds || 0));
        pendingSeek = target > 0 ? target : null; seek=seekKey;
      }
      await cmd('set_property','pause',plan.state === 'paused');
      const c = props.command;
      if (c && c.id > lastCommand) {
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
        if (c.type === 'speed') await cmd('set_property','speed',1);
        send('command',{id:c.id,ok:true});
      }
    }); },
    destroy,
  };
}
module.exports = { available, capabilities, create };

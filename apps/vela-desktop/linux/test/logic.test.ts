import { test, expect } from 'bun:test';
const { inScope, createProxy } = require('../media-proxy');
const { acceptPlan, physicalBounds } = require('../logic');
test('access uses exact origin and path boundary, including decoded paths', () => {
  const grant = { origin:'https://media.example:443',pathPrefix:'/stream',headers:{} };
  expect(inScope('/stream/movie',grant)).toBe(true);
  for (const url of ['/streaming/movie','https://elsewhere/stream/movie','http://media.example/stream/a','/stream/%2e%2e/private','/stream%2f..%2fprivate','/stream/%252e%252e/private','/stream/%2500','https://u:p@media.example/stream/a'])
    expect(inScope(url,grant)).toBe(false);
});
test('generations cannot regress within a session', () => {
  const old = {sessionId:'a',sourceGeneration:3,seekGeneration:4};
  expect(acceptPlan(old,{...old,sourceGeneration:2,seekGeneration:8})).toBe(false);
  expect(acceptPlan(old,{...old,seekGeneration:3})).toBe(false);
  expect(acceptPlan(old,{...old,sessionId:'b',sourceGeneration:0,seekGeneration:0})).toBe(true);
});
test('surface follows content offset and backing scale', () => {
  expect(physicalBounds({x:10,y:20},{x:2,y:3,width:100,height:50},2)).toEqual({x:24,y:46,width:200,height:100});
});
test('proxy rewrites HLS and refuses redirects outside grant before attaching credentials', async () => {
  const http = require('node:http');
  let leaked = false;
  const server = http.createServer((req, res) => {
    if (req.url === '/outside') { leaked = true; res.end('bad'); }
    else if (req.url === '/media/list.m3u8') { res.setHeader('content-type','application/vnd.apple.mpegurl'); res.end('#EXTM3U\nsegment.ts\n'); }
    else if (req.url === '/media/redirect') { res.writeHead(302,{location:'/outside'}).end(); }
    else { expect(req.headers.authorization).toBe('Bearer private'); res.end('segment'); }
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const proxy = await createProxy({origin,pathPrefix:'/media',headers:{Authorization:'Bearer private'}});
  try {
    const playlist = await (await fetch(proxy.register('/media/list.m3u8'))).text();
    const segment = playlist.split('\n')[1];
    expect(segment.startsWith('http://127.0.0.1:')).toBe(true);
    expect(await (await fetch(segment)).text()).toBe('segment');
    expect((await fetch(proxy.register('/media/redirect'))).status).toBe(502);
    expect(leaked).toBe(false);
  } finally { proxy.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
test('live never changes rate to recover latency; VOD permits bounded user speed', () => {
  const { playbackRate } = require('../logic');
  expect(playbackRate({channelId:'live'},2)).toBe(1);
  expect(playbackRate({live:{mode:'adaptive'}},.5)).toBe(1);
  expect(playbackRate({},1.5)).toBe(1.5);
  expect(playbackRate({},Infinity)).toBe(1);
  expect(playbackRate({},20)).toBe(4);
});
test('ABI gate compares GLIBC versions numerically and refuses newer loaders', () => {
  const {glibcRequirement}=require('../abi');
  expect(glibcRequirement('GLIBC_2.9 GLIBC_2.3.4 GLIBC_2.35')).toBe('2.35');
  expect(glibcRequirement('GLIBC_2.34 GLIBC_2.2.5')).toBe('2.34');
  expect(() => glibcRequirement('GLIBC_2.38')).toThrow('baseline');
  expect(() => glibcRequirement('GLIBC_ABI_DT_RELR')).toThrow('Unsupported');
  expect(() => glibcRequirement('GLIBC_PRIVATE')).toThrow('Unsupported');
});
test('HDMI ELD lists the sink bitstreams and its widest LPCM', () => {
  const { parseEld } = require('../logic');
  const eld = ['monitor_present\t\t1', 'eld_valid\t\t1', 'monitor_name\t\tSR7015', 'sad_count\t\t5',
    'sad0_coding_type\t[0x1] LPCM', 'sad0_channels\t\t8', 'sad0_rates\t\t[0x1ee0] 32000 44100 48000 88200 96000 176400 192000', 'sad0_bits\t\t[0xe0000] 16 20 24',
    'sad1_coding_type\t[0x2] AC-3', 'sad2_coding_type\t[0x7] DTS', 'sad3_coding_type\t[0xa] E-AC-3/DD+ (Dolby Digital Plus)',
    'sad4_coding_type\t[0xb] DTS-HD', 'sad5_coding_type\t[0xc] MLP (Dolby TrueHD)', 'sad6_coding_type\t[0xa] E-AC-3/DD+ (Dolby Digital Plus)'].join('\n');
  expect(parseEld(eld)).toEqual({ name: 'SR7015', passthrough: ['ac3', 'dts', 'eac3', 'dts-hd', 'truehd'], maxChannels: 8, maxSampleRate: 192000 });
  expect(parseEld(eld.replace('monitor_present\t\t1', 'monitor_present\t\t0'))).toBeNull();
  expect(parseEld('monitor_present\t\t1\neld_valid\t\t0')).toBeNull();
});
test('playback settings and the mpv audio options they make', () => {
  const { playbackSettings, audioOptions } = require('../logic');
  expect(playbackSettings(null)).toEqual({ passthrough: ['ac3', 'eac3', 'dts', 'dts-hd', 'truehd'], exclusive: false, audioDevice: '' });
  expect(playbackSettings({ passthrough: 'off', audioDevice: '$(rm -rf /)' })).toEqual({ passthrough: [], exclusive: false, audioDevice: '' });
  const direct = playbackSettings({ passthrough: ['truehd', 'eac3', 'mp3'], audioDevice: 'alsa/hdmi:CARD=NVidia,DEV=0' });
  expect(direct.passthrough).toEqual(['eac3', 'truehd']);
  // A direct ALSA device only attempts what the receiver's ELD lists, and is exclusive by nature.
  expect(audioOptions(direct, { passthrough: ['ac3', 'eac3'] })).toEqual({ 'audio-device': 'alsa/hdmi:CARD=NVidia,DEV=0', 'audio-spdif': 'eac3', 'audio-exclusive': true, 'audio-channels': 'auto' });
  expect(audioOptions(playbackSettings({}), null)).toEqual({ 'audio-device': 'auto', 'audio-spdif': 'ac3,eac3,dts,dts-hd,truehd', 'audio-exclusive': false, 'audio-channels': 'auto-safe' });
});
test('subtitle preferences become mpv sub properties', () => {
  const { subtitleProperties } = require('../logic');
  expect(Object.fromEntries(subtitleProperties({ subtitleSize: 'large', subtitleBackground: 'box', subtitleColor: 'yellow', subtitlePosition: 'raised', offsetSeconds: -0.5 })))
    .toEqual({ 'sub-scale': 1.25, 'sub-color': '#FFFFE14D', 'sub-pos': 88, 'sub-border-style': 'background-box', 'sub-shadow-offset': 0, 'sub-back-color': '#B0000000', 'sub-delay': -0.5 });
  expect(subtitleProperties(null)).toEqual([]);
});

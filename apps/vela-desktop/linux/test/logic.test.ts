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

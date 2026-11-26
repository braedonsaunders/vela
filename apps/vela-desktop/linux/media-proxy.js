'use strict';
const http = require('node:http');
const { randomBytes } = require('node:crypto');
const { timeshiftLanding } = require('./logic');
function inScope(address, grant) {
  try {
    const url = new URL(address, grant.origin), origin = new URL(grant.origin);
    const path = decodeURIComponent(url.pathname);
    const prefix = decodeURIComponent(grant.pathPrefix || '/').replace(/\/$/, '');
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      && url.origin === origin.origin && !path.includes('\\') && !/%(?:00|2e|2f|5c)/i.test(path) && !/[\x00-\x1f\x7f]/.test(path) && !path.split('/').some(part => part === '..' || part === '.')
      && (path === prefix || path.startsWith(prefix + '/'));
  } catch { return false; }
}
async function createProxy(grant) {
  const secret = randomBytes(24).toString('hex'), routes = new Map(), reverse = new Map(), requests = new Set();
  // The newest media playlist's EXT-X-TARGETDURATION: the live segment length, for the live latency.
  let base, closed = false, targetDuration = null;
  const register = (address, startup) => {
    const url = new URL(address, grant.origin).href;
    if (!inScope(url, grant)) throw new Error('Media outside access grant');
    const key = startup ? `${startup.key}\n${url}` : url;
    let token = reverse.get(key);
    if (!token) {
      token = randomBytes(18).toString('hex'); routes.set(token, { url, key, startup }); reverse.set(key, token);
      if (routes.size > 16384) { const oldest = routes.keys().next().value; reverse.delete(routes.get(oldest).key); routes.delete(oldest); }
    }
    return `${base}/${secret}/${token}`;
  };
  const server = http.createServer(async (req, res) => {
    const parts = req.url.split('/');
    const route = parts.length === 3 && parts[1] === secret && routes.get(parts[2]);
    if (closed || !route || !['GET','HEAD'].includes(req.method)) { res.writeHead(404).end(); return; }
    const { url: address, startup } = route;
    const controller = new AbortController(); requests.add(controller);
    res.on('close', () => controller.abort());
    try {
      const headers = { ...grant.headers };
      if (req.headers.range) headers.Range = req.headers.range;
      let url = address, response;
      for (let n=0; n<6; n++) {
        if (!inScope(url, grant)) throw new Error('Media redirect outside grant');
        response = await fetch(url, { headers, method: req.method, redirect: 'manual', signal: controller.signal });
        if (![301,302,303,307,308].includes(response.status)) break;
        await response.body?.cancel();
        url = new URL(response.headers.get('location'), url).href;
        if (n === 5) throw new Error('Too many redirects');
      }
      const contentType = response.headers.get('content-type') || '';
      const playlist = /mpegurl/i.test(contentType) || /\.m3u8($|\?)/i.test(url);
      const out = {};
      for (const key of ['content-type','content-range','accept-ranges']) if (response.headers.has(key)) out[key] = response.headers.get(key);
      if (playlist && req.method !== 'HEAD' && response.ok) {
        let text = await response.text();
        if (text.length > 4*1024*1024 || !text.startsWith('#EXTM3U')) throw new Error('Invalid playlist');
        const target = Number(/^#EXT-X-TARGETDURATION:\s*(\d+(?:\.\d+)?)\s*$/m.exec(text)?.[1]);
        if (target > 0 && target <= 60) targetDuration = target;
        if (startup) {
          const landing = timeshiftLanding(text, response.headers, startup.live, startup.requested);
          if (landing) {
            startup.landing ??= landing;
            text = text.replace(/^#EXT-X-START:.*\r?\n/gm, '')
              .replace('#EXTM3U', `#EXTM3U\n#EXT-X-START:TIME-OFFSET=${landing.offset.toFixed(6)}`);
          }
        }
        const rewritten = text.split('\n').map(line => line.startsWith('#')
          ? line.replace(/URI="([^"]+)"/g, (_, uri) => `URI="${register(new URL(uri, url).href, startup)}"`)
          : line.trim() ? register(new URL(line.trim(), url).href, startup) : line).join('\n');
        res.writeHead(response.status, out).end(rewritten);
      } else {
        if (response.headers.has('content-length')) out['content-length'] = response.headers.get('content-length');
        res.writeHead(response.status, out);
        if (response.body) for await (const chunk of response.body) {
          if (!res.write(chunk)) await new Promise(resolve => { res.once('drain', resolve); res.once('close', resolve); });
        }
        res.end();
      }
    } catch { if (!res.headersSent) res.writeHead(502); res.end(); }
    finally { requests.delete(controller); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  return { register, targetDuration: () => targetDuration, close() { closed = true; for (const c of requests) c.abort(); routes.clear(); reverse.clear(); server.closeAllConnections(); server.close(); } };
}
module.exports = { inScope, createProxy };

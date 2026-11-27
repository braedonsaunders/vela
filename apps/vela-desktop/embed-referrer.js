// The trailer embed (YouTube's privacy-enhanced player, framed by the page) asks for a Referer that names
// its embedder; a page on the app's own vela-app: scheme sends none, so YouTube refuses to play. Its frame
// request alone is given the app's identity, as YouTube asks web-view clients to do; nothing else is touched.
const EMBED_FRAMES = ['https://www.youtube-nocookie.com/embed/*'];
const APP_REFERRER = 'https://app.ether.vela/';

function withEmbedReferrer(details) {
  const headers = { ...details.requestHeaders };
  const named = Object.keys(headers).some(name => name.toLowerCase() === 'referer');
  if (details.resourceType === 'subFrame' && !named) headers.Referer = APP_REFERRER;
  return headers;
}

function attachEmbedReferrer(session) {
  session.webRequest.onBeforeSendHeaders({ urls: EMBED_FRAMES }, (details, callback) => {
    callback({ requestHeaders: withEmbedReferrer(details) });
  });
}

module.exports = { APP_REFERRER, attachEmbedReferrer, withEmbedReferrer };

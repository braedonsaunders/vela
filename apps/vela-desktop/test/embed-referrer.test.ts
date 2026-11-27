import { expect, test } from 'bun:test';
const { APP_REFERRER, attachEmbedReferrer, withEmbedReferrer } = require('../embed-referrer');

test('the trailer embed frame names the app when the page sends no referrer', () => {
  expect(withEmbedReferrer({ resourceType: 'subFrame', requestHeaders: { Accept: 'text/html' } })).toEqual({ Accept: 'text/html', Referer: APP_REFERRER });
  expect(withEmbedReferrer({ resourceType: 'subFrame', requestHeaders: { referer: 'http://vela.localhost/' } })).toEqual({ referer: 'http://vela.localhost/' });
  expect(withEmbedReferrer({ resourceType: 'xhr', requestHeaders: {} })).toEqual({});
});

test('only YouTube nocookie embed frames are filtered', () => {
  let filter: { urls: string[] } | undefined;
  attachEmbedReferrer({ webRequest: { onBeforeSendHeaders: (value: { urls: string[] }) => { filter = value; } } });
  expect(filter).toEqual({ urls: ['https://www.youtube-nocookie.com/embed/*'] });
});

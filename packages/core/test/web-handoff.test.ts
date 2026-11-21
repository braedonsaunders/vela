import { expect, test } from 'bun:test';
import { consoleURL, pageServerOrigin, parseWebHandoff } from '../src/session/web-handoff';

test('reads an encoded fragment and permits the console on another port of the same host', () => {
  expect(parseWebHandoff('#code=one-use&console=http%3A%2F%2Fether.local%3A32450%2Fconsole%2F', 'http://ether.local:32550'))
    .toEqual({ code: 'one-use', consoleUrl: 'http://ether.local:32450/console/' });
  expect(parseWebHandoff('#code=', 'http://ether.local').code).toBe('');
});

test('return links reject other hosts, credentials, relative URLs and non-HTTP schemes', () => {
  for (const value of ['https://evil.test/', 'https://ether.local.evil.test/', 'javascript:alert(1)', '//ether.local/', '/console', 'https://user@ether.local/']) {
    expect(consoleURL(value, 'https://ether.local:32550')).toBeUndefined();
  }
  expect(consoleURL('https://ETHER.local:32450/console/#watch', 'http://ether.local:32550')).toBe('https://ether.local:32450/console/#watch');
});

test('only an http(s) page origin implies a server; a desktop shell origin is standalone', () => {
  expect(pageServerOrigin('https://ether.local:32550')).toBe('https://ether.local:32550');
  expect(pageServerOrigin('http://192.168.1.20')).toBe('http://192.168.1.20');
  for (const origin of ['vela-app://app', 'file://', 'null', '', 'app://vela']) expect(pageServerOrigin(origin)).toBeUndefined();
});

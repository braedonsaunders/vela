import { describe, expect, test } from 'bun:test';
import { resolveDocument } from '../src/resolve';
import { viewerAvatarFor } from '../src/viewer-avatar';

describe('the viewer avatar', () => {
  const badge = { width: '32px', height: '32px' };

  test('draws over a viewer badge that sizes itself, and only when the server gives a picture', () => {
    expect(viewerAvatarFor(true, badge, 'https://ether.example/a?w=96')).toBe('https://ether.example/a?w=96');
    expect(viewerAvatarFor(true, badge, '')).toBe('');
    expect(viewerAvatarFor(true, badge, undefined)).toBe('');
    expect(viewerAvatarFor(false, badge, 'https://ether.example/a')).toBe('');
    // A bare initial inside some other box stays a letter.
    expect(viewerAvatarFor(true, { 'font-size': '18px' }, 'https://ether.example/a')).toBe('');
    expect(viewerAvatarFor(true, { width: '32px' }, 'https://ether.example/a')).toBe('');
  });

  test('a text that is exactly the viewer initial is a badge, at any renderer version', () => {
    const doc = { schema: 1 as const, renderer: 15, id: 'badge', name: 'Badge', version: '1', swatches: [], slots: {
      shell: { type: 'box' as const, children: [
        { type: 'text' as const, text: ' {env.viewerInitial} ' },
        { type: 'text' as const, text: 'Hi {env.viewerInitial}' },
        { type: 'slot' as const, slot: 'children' as const },
      ] },
    } };
    const shell = resolveDocument(doc, 1440, 'en').shell!;
    if (shell.kind !== 'box') throw new Error('Expected the shell box');
    expect(shell.children.map(child => child.kind === 'text' && !!child.avatar)).toEqual([true, false, false]);
  });
});

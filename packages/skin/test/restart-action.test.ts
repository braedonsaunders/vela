import { expect, test } from 'bun:test';
import { heroResumeLayout, restartAction, secondaryPlayAction } from '../src/restart-action';
import type { RNode } from '../src/resolve';

const secondary: Extract<RNode, { kind: 'box' }> = { kind: 'box', when: [], states: [], group: false, order: 0, controlStates: true,
  base: { style: { height: '58px', 'border-radius': '30px', border: '1px solid white' }, hover: { opacity: '0.8' } },
  press: { action: 'playExtra', arg: 'trailer' }, children: [{ kind: 'text', text: 'Watch trailer', when: [], states: [], group: false, order: 0, base: { style: { 'font-size': '15px' } } }] };
test('restart inherits secondary dimensions and interaction styles without depending on trailer availability', () => {
  const template = { ...secondary, when: [{ read: () => 'false', is: 'set', value: '', not: false }] } as RNode;
  const found = secondaryPlayAction({ ...secondary, press: undefined, children: [template] });
  const restart = restartAction(secondary, found, 'film|||0', 'Restart');
  expect(restart.base.style).toMatchObject({ height: '58px', 'border-radius': '9999px', border: '1px solid white' });
  expect(restart.base.hover).toEqual(secondary.base.hover);
  expect(restart.when).toEqual([]);
  expect(restart.press).toEqual({ action: 'play', arg: 'film|||0' });
  expect(restart.children[0]).toMatchObject({ text: 'Restart', base: { style: { 'font-size': '15px' } } });
  expect(secondary.children[0]).toMatchObject({ text: 'Watch trailer' });
});

test('secondary trailer buttons repeated over available trailers supply the restart look', () => {
  const repeated: RNode = { ...secondary, kind: 'repeat', over: 'detail.trailers', limit: 1, item: secondary };
  expect(secondaryPlayAction({ ...secondary, press: undefined, children: [repeated] })).toBe(secondary);
});

test('fallback primary labels with resume/play conditions produce only one restart label', () => {
  const primary = { ...secondary, children: [...secondary.children, ...secondary.children] };
  const restart = restartAction(primary, undefined, 'film|||0', 'Restart');
  expect(restart.children).toHaveLength(1);
});

test('a compact restart is a labelled 44px mark with no words', () => {
  const restart = restartAction(secondary, secondary, 'film|||0', 'Restart', true);
  expect(restart.label).toBe('Restart');
  expect(restart.press).toEqual({ action: 'play', arg: 'film|||0' });
  expect(restart.base.style).toMatchObject({ width: '44px', height: '44px' });
  expect(restart.children).toEqual([expect.objectContaining({ kind: 'icon', symbol: 'restart' })]);
});

test('a restart cloned from Resume leaves out its progress track', () => {
  const box = (children: RNode[], style: Record<string, string> = {}): Extract<RNode, { kind: 'box' }> => ({ kind: 'box', when: [], states: [], group: false, order: 0, controlStates: false, base: { style }, children });
  const text = { kind: 'text', text: 'Resume', when: [], states: [], group: false, order: 0, base: { style: {} } } as RNode;
  const icon = { kind: 'icon', symbol: 'play-fill', when: [], states: [], group: false, order: 0, base: { style: {} } } as RNode;
  const primary = { ...box([box([icon]), text, box([box([], { width: '40%' })], { height: '3px' })]), press: { action: 'play' as const, arg: 'film' } };
  const restart = restartAction(primary, undefined, 'film|||0', 'Restart');
  expect(restart.children).toHaveLength(2);
  expect(restart.children[1]).toMatchObject({ kind: 'text', text: 'Restart' });
});

test('a phone hero keeps Resume its own width beside the Restart mark, in a column or a wrapping row of actions', () => {
  for (const parent of ['row', 'column'] as const) {
    const { pair, resume } = heroResumeLayout(parent);
    expect(pair).toMatchObject({ flexDirection: 'row', alignSelf: 'stretch' });
    // A zero basis (flex: 1) drew Resume as nothing wherever the pair sized to its content.
    expect(resume).toEqual({ flexGrow: 1, flexShrink: 1, minWidth: 0 });
    expect(resume.flex).toBeUndefined();
    expect(resume.flexBasis).toBeUndefined();
  }
  // In a row (Late Night's hero buttons) the pair takes the line's spare room; a column already spans it.
  expect(heroResumeLayout('row').pair).toMatchObject({ flexGrow: 1, flexShrink: 1, minWidth: 0 });
  expect(heroResumeLayout('column').pair.flexGrow).toBeUndefined();
});

// A heroPreview reports which hero it has on screen: as its box comes into and leaves view, and
// when the hero changes under a box that stays in view (on TV the hero widget stays as the carousel
// rotates, so without this no later hero was reported shown and no hero trailer was asked for).
import { expect, test } from 'bun:test';
import { heroVisibility } from '../src/widgets/common/hero-visibility';

function recorder() {
  const calls: string[] = [];
  const shown = new Set<string>();
  const report = (id: string, visible: boolean) => {
    calls.push(`${id}:${visible}`);
    if (visible) shown.add(id); else shown.delete(id);
  };
  return { calls, shown, report };
}

test('a hero comes on screen and leaves with its box', () => {
  const { shown, report } = recorder();
  const hero = heroVisibility(report);
  hero.hero('psycho');
  expect([...shown]).toEqual([]);
  hero.visible(true);
  expect([...shown]).toEqual(['psycho']);
  hero.visible(false);
  expect([...shown]).toEqual([]);
});

test('the hero changing under a box in view: the leaving title is gone, the arriving one shown', () => {
  const { calls, shown, report } = recorder();
  const hero = heroVisibility(report);
  hero.hero('psycho');
  hero.visible(true);
  hero.hero('moon');
  expect(calls).toEqual(['psycho:true', 'psycho:false', 'moon:true']);
  expect([...shown]).toEqual(['moon']);
  hero.hero('derry');
  expect([...shown]).toEqual(['derry']);
});

test('the hero changing under a box out of view shows nothing', () => {
  const { shown, report } = recorder();
  const hero = heroVisibility(report);
  hero.hero('psycho');
  hero.hero('moon');
  expect([...shown]).toEqual([]);
  hero.visible(true);
  expect([...shown]).toEqual(['moon']);
});

test('unmounting reports the hero gone', () => {
  const { shown, report } = recorder();
  const hero = heroVisibility(report);
  hero.hero('psycho');
  hero.visible(true);
  hero.hero('');
  expect([...shown]).toEqual([]);
});

test('the same hero again reports nothing new', () => {
  const { calls, report } = recorder();
  const hero = heroVisibility(report);
  hero.hero('psycho');
  hero.visible(true);
  hero.hero('psycho');
  expect(calls).toEqual(['psycho:true']);
});

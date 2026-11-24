// Which hero a heroPreview has on screen. Its box coming into or leaving view reports its hero; so
// does the hero changing under a box that stays in view (on TV the hero on show keeps one widget as
// the carousel rotates): the title leaving is reported gone, the one arriving is reported shown.

export interface HeroVisibility {
  /** The widget's box came into view (true) or left it (false). */
  visible(onScreen: boolean): void;
  /** The widget now draws this hero ('' for none, as when it unmounts). */
  hero(heroId: string): void;
}

export function heroVisibility(report: (heroId: string, visible: boolean) => void): HeroVisibility {
  let current = '';
  let onScreen = false;
  return {
    visible(next) {
      onScreen = next;
      if (current) report(current, next);
    },
    hero(next) {
      if (next === current) return;
      if (current) report(current, false);
      current = next;
      if (current && onScreen) report(current, true);
    },
  };
}

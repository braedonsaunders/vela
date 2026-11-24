// Whether the viewer is using the home hero, which holds its carousel.
// Focus moving between the hero's controls blurs one and focuses the next: releasing the hold at
// once and taking it again changed the flags twice, and each change redrew the routes reading them.
// The release waits a turn, and a focus in the hero within it keeps the hold.
// On TV, focus rests in the hero from launch (Home opens on its Play button), so focus alone must
// not freeze the carousel: a move within the hero holds it for TV_HERO_HOLD_MS, then it rotates on.
export const TV_HERO_HOLD_MS = 12_000;

let heroRelease: ReturnType<typeof setTimeout> | undefined;

export function holdHero(setFlag: (flag: string, on: boolean) => void, on: boolean, tv: boolean): void {
  if (heroRelease !== undefined) clearTimeout(heroRelease);
  heroRelease = undefined;
  const release = (after: number) => {
    heroRelease = setTimeout(() => { heroRelease = undefined; setFlag('hero-interacting', false); }, after);
  };
  if (on) setFlag('hero-interacting', true);
  if (on && tv) release(TV_HERO_HOLD_MS);
  else if (!on) release(0);
}

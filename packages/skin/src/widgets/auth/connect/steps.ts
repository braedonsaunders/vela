// The choreography of the signed-out flow, as data: which step is showing (a key that changes
// exactly when the content should dissolve into the next), which way the flow moved, how each
// block of a step enters in turn, and what each step says. Free of React Native for the tests.
import type { AuthStep } from '@vela/core';
import type { Motion } from '../../../keyframes';
import type { PlexLink } from './model';

export type StepDirection = 'forward' | 'back';

/** What the step shows inside its page: Plex's link states and the offline notice are steps of
 * their own visually, though the flow's history does not change between them. */
export function stepKey(step: AuthStep, detail = ''): string {
  return ['serverId' in step ? `${step.page}:${step.serverId}` : step.page, detail].filter(Boolean).join('/');
}

/** Plex's states that change what the page is about (a code to enter, servers, profiles). */
export function plexDetail(link: PlexLink | null, starting: boolean): string {
  if (starting || link?.state === 'waiting') return 'link';
  if (link?.state === 'linked') return 'servers';
  if (link?.state === 'profiles') return 'profiles';
  return 'start';
}

/** Deeper history is forward; returning through it is back. A change within one page (Plex's
 * code arriving, then its servers) continues forward. */
export function stepDirection(before: number, after: number): StepDirection {
  return after < before ? 'back' : 'forward';
}

const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';

/** The n-th block of an entering step: it rises (or, going back, settles down) into place after
 * the one before it, capped so a long list does not keep the viewer waiting. */
export function blockEntrance(index: number, direction: StepDirection, first = false): Motion {
  const offset = direction === 'back' ? -14 : 18;
  return {
    keyframes: direction === 'back' ? 'velaStepSettle' : 'velaStepRise',
    frames: {
      velaStepRise: { from: { opacity: 0, transform: [{ translateY: offset }] } },
      velaStepSettle: { from: { opacity: 0, transform: [{ translateY: offset }] } },
    },
    // The first screen waits for the sail to draw; later steps follow the outgoing one's fade.
    delay: (first ? 900 : 140) + Math.min(index, 8) * 70,
    duration: 620,
    easing: EASE_OUT,
    fill: 'both',
    still: { keyframes: 'dissolve', duration: 200 },
  };
}

/** How long the outgoing step takes to dissolve, and how far it drifts as it goes. */
export const STEP_EXIT_MS = 240;
export const exitDrift = (direction: StepDirection) => (direction === 'back' ? 12 : -12);

export interface StepCopy {
  title: string;
  subtitle: string;
}

/** What each step says: a confident title and one line of help under it. */
export function stepCopy(args: {
  page: AuthStep['page'];
  first: boolean;
  name: string;
  savedOffline?: boolean;
  plex?: string;
  quickExpired?: boolean;
}): StepCopy {
  const { page, first, name, savedOffline, plex } = args;
  if (savedOffline) return { title: "You're offline", subtitle: '' };
  switch (page) {
    case 'choose':
      return { title: 'Choose a server', subtitle: 'Pick up where you left off.' };
    case 'add':
      return first
        ? { title: 'Vela', subtitle: 'Your films, shows and music,\nfrom your own server.' }
        : { title: 'Add a server', subtitle: 'Sign in with Plex, or connect\nto a server by its address.' };
    case 'address':
      return { title: 'Your server', subtitle: 'Ether, Jellyfin, Emby or Plex:\ntype its address.' };
    case 'plex':
    case 'server-plex':
      return plex === 'servers'
        ? { title: 'Choose a server', subtitle: 'The servers on your Plex account.' }
        : plex === 'profiles'
          ? { title: 'Who’s watching?', subtitle: '' }
          : plex === 'link'
            ? { title: 'Sign in with Plex', subtitle: '' }
            : { title: 'Sign in with Plex', subtitle: 'Link this device to your Plex account.' };
    case 'code':
      return { title: 'Use a code', subtitle: '' };
    case 'signin':
      return { title: `Sign in to ${name}`, subtitle: '' };
  }
}

// The live home's document actions (docs/skin-schema.md, "Live home"), run against the app's
// LiveController. The host's dispatch hands them here and keeps the rest.
import type { Action } from '../../../../protocol/skin';
import type { LiveController } from './controller';

/** Runs a live action and says whether it was one. `guide` opens the full guide through the app. */
export function liveAction(live: LiveController | null, action: Action, arg: string, openGuide: () => void): boolean {
  switch (action) {
    case 'guide':
      openGuide();
      return true;
    case 'watch':
      live?.watch(arg);
      return true;
    case 'preview':
      if (arg) live?.preview(arg);
      return true;
    case 'zap': {
      const step = Number(arg);
      if (step === 1 || step === -1) live?.zapHome(step);
      return true;
    }
    case 'tuneIn':
      live?.tuneIn();
      return true;
    case 'unmute':
      live?.toggleMute();
      return true;
    default:
      return false;
  }
}

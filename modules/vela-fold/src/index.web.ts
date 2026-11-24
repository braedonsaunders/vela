// The web has no fold to report (a browser's Device Posture API is not wired up): always flat.
import { FLAT, type FoldState } from './model';

export * from './model';

export function useFold(): FoldState { return FLAT; }

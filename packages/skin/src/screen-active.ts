import { createContext } from 'react';

/** A covered screen keeps its content but must not animate or hold navigation keys. */
export const ScreenActive = createContext(true);

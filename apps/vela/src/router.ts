/**
 * Vela's imperative router: Expo Router's `router`, behind the guard in router-guard.ts, so that a
 * press can never crash the app when no navigation root is ready. Import `router` from here, not
 * from 'expo-router' (test/router-guard.test.ts keeps it that way).
 */
import { router as expoRouter } from 'expo-router';
import { guardRouter } from './router-guard';

export const router = guardRouter(expoRouter, {
  schedule: retry => { setTimeout(retry, 32); },
  now: () => Date.now(),
  report: (message, error) => console.warn(`[vela] ${message}`, error ?? ''),
});

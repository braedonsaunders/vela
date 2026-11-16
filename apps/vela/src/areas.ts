// App-side state for product areas (search, live TV, sign-in…) until packages/core's store
// replaces apps/vela/src/vela.tsx. Each area is one hook, listed once in useAreas in a fixed
// order. It returns what it adds to the view state (env), to the renderer's host, and the
// document actions it handles.
import type { Action } from '../../../protocol/v0/skin';
import type { Env, HomeModel, SkinHost } from '@vela/skin';
import type { EtherClient } from './ether';

export interface AppArea {
  env?: Partial<Env>;
  host?: Partial<SkinHost>;
  /** True when the area handled the action. */
  dispatch?(action: Action, arg: string): boolean;
}

export interface AreaInput {
  client: EtherClient;
  /** Resolves once the session is signed in and negotiated. */
  session(): Promise<void>;
  query: string;
  home?: HomeModel;
}

export function useAreas(_input: AreaInput): AppArea[] {
  return [
  ];
}

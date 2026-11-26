// Build-time configuration (EXPO_PUBLIC_*, read by Metro at bundle time; never secrets of the
// app itself). A development or lab build names its server and may sign in from configuration.
export const config = {
  /** A lab native build's pinned Ether server (release builds leave it unset and run standalone);
   * on the web, a development override of the page's origin. */
  server: process.env.EXPO_PUBLIC_VELA_SERVER ?? '',
  /** Development sign-in (the Basement install against the lab); unset in a release build. */
  user: process.env.EXPO_PUBLIC_VELA_USER ?? '',
  password: process.env.EXPO_PUBLIC_VELA_PASSWORD ?? '',
  /** The mock server's demo sign-in (mock-server/). */
  mock: process.env.EXPO_PUBLIC_VELA_MOCK === '1',
  /** The build Ether is told this client is (the lab admits builds it knows). */
  appVersion: process.env.EXPO_PUBLIC_VELA_APP_VERSION ?? '0.2.71',
  /** The skin document to start with, by id (`?skin=` on the web). */
  skin: process.env.EXPO_PUBLIC_VELA_SKIN ?? '',
  /** A lab build's routes to open once home is ready, `|`-separated, a few seconds apart (a TV
   * simulator has no remote to get there). Unset in a release build. */
  startRoutes: process.env.EXPO_PUBLIC_VELA_START_ROUTES ?? '',
  /** `documents`: listen libraries draw the built-in listen documents (until the hard cut of the
   * hand-written music app; parity captures build both). */
  listen: process.env.EXPO_PUBLIC_VELA_LISTEN ?? '',
};

/** The development server when none is configured: mock-server on this machine. */
export const DEVELOPMENT_SERVER = 'http://127.0.0.1:7777';

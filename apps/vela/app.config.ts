// The web build is served at /vela (docs/distribution.md), so the web export sets
// VELA_WEB_BASE=/vela. Native builds must not get a base URL: export:embed would copy assets
// into Vela.app/vela/, which on a case-insensitive volume collides with the Vela executable.
import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),
  experiments: { ...config.experiments, ...(process.env.VELA_WEB_BASE ? { baseUrl: process.env.VELA_WEB_BASE } : {}) },
});

// The player spike (src/spike/player.tsx) is development tooling: it signs in from build-time
// configuration. A release build compiles __DEV__ to false, so the require below is dropped and
// neither the spike nor anything it reads is bundled; the route there just goes home.
import { Redirect } from 'expo-router';
import type { ComponentType } from 'react';

function Home() {
  return <Redirect href="/" />;
}

const PlayerSpike: ComponentType = __DEV__ ? require('../../src/spike/player').default : Home;
export default PlayerSpike;

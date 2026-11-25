// The Listen blocks lab (src/spike/listen-blocks.tsx) is development tooling: a release build
// compiles __DEV__ to false, so the require below is dropped and the route just goes home.
import { Redirect } from 'expo-router';
import type { ComponentType } from 'react';

function Home() {
  return <Redirect href="/" />;
}

const ListenBlocksLab: ComponentType = __DEV__ ? require('../../src/spike/listen-blocks').default : Home;
export default ListenBlocksLab;

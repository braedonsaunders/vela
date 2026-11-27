// The signed-out flow's states, staged with fixtures for design review (src/sign-in-preview.tsx).
// Development and mock builds only: a release build drops the require and the route goes home.
import { Redirect } from 'expo-router';
import type { ComponentType } from 'react';
import { config } from '../../src/data/config';

function Home() {
  return <Redirect href="/" />;
}

const SignInPreview: ComponentType = __DEV__ || config.mock ? require('../../src/sign-in-preview').default : Home;
export default SignInPreview;

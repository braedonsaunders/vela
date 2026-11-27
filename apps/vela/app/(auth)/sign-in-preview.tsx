// The signed-out flow's states, staged with fixtures for design review (src/sign-in-preview.tsx).
// Development and mock builds only: the condition is inlined at bundle time, so a release build
// drops the require (and the fixtures) entirely and the route just goes home.
import { Redirect } from 'expo-router';
import type { ComponentType } from 'react';

function Home() {
  return <Redirect href="/" />;
}

const SignInPreview: ComponentType = __DEV__ || process.env.EXPO_PUBLIC_VELA_MOCK === '1' ? require('../../src/sign-in-preview').default : Home;
export default SignInPreview;

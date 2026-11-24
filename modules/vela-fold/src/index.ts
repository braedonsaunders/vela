// The device's fold for the app's layout: an iPhone Duo's posture and the division iOS reserves
// while it is partly open (ios/VelaFoldModule.swift). Everywhere else (Android today, tvOS, a phone
// or tablet that does not fold) it is flat and nothing is linked or listened to.
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { FLAT, foldState, sameFold, type FoldState } from './model';

export * from './model';

interface NativeFold {
  current(): Promise<unknown>;
  addListener(event: 'onChange', listener: (state: unknown) => void): { remove(): void };
}

const native = Platform.OS === 'ios' && !Platform.isTV ? requireOptionalNativeModule<NativeFold>('VelaFold') : null;

/** The fold now, kept current; FLAT where nothing folds. */
export function useFold(): FoldState {
  const [state, setState] = useState<FoldState>(FLAT);
  useEffect(() => {
    if (!native) return;
    let live = true;
    const take = (value: unknown) => {
      const next = foldState(value);
      if (live) setState(current => (sameFold(current, next) ? current : next));
    };
    const subscription = native.addListener('onChange', take);
    native.current().then(take, () => undefined);
    return () => { live = false; subscription.remove(); };
  }, []);
  return state;
}

// The Top Shelf writer on Apple TV (ios/VelaTopShelfModule.swift): the snapshot and its pictures
// go into the App Group the TV Services extension reads. Elsewhere (iPhone, iPad, Android) there is
// no Top Shelf and nothing is linked: `topShelfWriter` is null.
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import type { TopShelfDownload, TopShelfWriter } from './model';

export * from './model';

interface NativeTopShelf {
  publish(sequence: number, snapshot: string, downloads: TopShelfDownload[]): Promise<void>;
  clear(sequence: number): Promise<void>;
}

const native = Platform.OS === 'ios' && Platform.isTV ? requireOptionalNativeModule<NativeTopShelf>('VelaTopShelf') : null;

export const topShelfWriter: TopShelfWriter | null = native
  ? { publish: (sequence, snapshot, downloads) => native.publish(sequence, snapshot, downloads), clear: sequence => native.clear(sequence) }
  : null;

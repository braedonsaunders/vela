// VelaPlayerView and VelaPlayer on the web: Vela's WebCodecs/WebGPU core (web/engine), mounted
// into the DOM node react-native-web draws for a View. The contract is packages/player-api; the
// browser host (createWebPlayerHost) owns the engine, and a trailer preview is a plain muted video
// (web/preview.ts). This file only binds them to React. Media credentials reach them through
// VelaPlayer.setMediaAccess, never through props.
import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import type { Failure, MediaAccess, VelaPlayerModule, VelaPlayerProps, VelaPlayerViewProps } from '@vela/player-api';
import { playerAssetBase } from '../web/asset-base';
import { audioCapabilities } from '../web/audio-capabilities';
import { playerCapabilities } from '../web/capabilities';
import { currentMediaAccess, onMediaAccessChange, setMediaAccess } from '../web/media-access';
import { createWebPreview } from '../web/preview';

import { isWindowsHost, setWindowsMediaAccess, windowsCapabilities } from './windows/bridge';
import { createWindowsPlayerHost } from './windows/host';

export const VelaPlayer: VelaPlayerModule = {
  setMediaAccess(access) { setWindowsMediaAccess(access); setMediaAccess(access); },
  capabilities: () => isWindowsHost() ? windowsCapabilities().catch(() => playerCapabilities()) : playerCapabilities(),
  // Music plays in the page's own audio engine on every desktop host too, never in the native video
  // host (libmpv, Aether), so its list is not the native one.
  audioCapabilities,
};

/** What a view mounts into its DOM node: the playback host or a preview. */
interface Mounted {
  update(props: VelaPlayerProps): void;
  dispose(): void;
}

type Mount = (node: HTMLElement, props: VelaPlayerProps) => Mounted;

/** Drops the React Native style; the host sees only the contract's props. */
function contractProps({ style: _style, ...props }: VelaPlayerViewProps): VelaPlayerProps {
  return props;
}

function unsupported(message: string): Failure {
  return { kind: 'unsupported', message, recoverable: false };
}

const mountBrowserPlayback: Mount = (node, initial) => {
  const assetBaseURL = playerAssetBase();
  if (!assetBaseURL) throw new Error('This build has no player assets');
  let props = initial;
  let disposed = false;
  let host: Mounted | undefined;
  void import('../web/engine/host').then(({ createWebPlayerHost }) => {
    if (!disposed) host = createWebPlayerHost(node, props, { assetBaseURL, access: currentMediaAccess });
  }).catch(error => {
    if (!disposed) props.onError?.(unsupported(error instanceof Error ? error.message : 'The player could not start'));
  });
  return {
    update(next) {
      props = next;
      host?.update(next);
    },
    dispose() {
      disposed = true;
      host?.dispose();
    },
  };
};

// The Windows host draws one native player; multiview tiles play side by side in the browser engine.
const mountPlayback: Mount = (node, props) =>
  !props.ambient && props.tile === undefined && isWindowsHost()
    ? createWindowsPlayerHost(node, props, next => mountBrowserPlayback(node, next))
    : mountBrowserPlayback(node, props);

const mountPreview: Mount = (node, props) => {
  const preview = createWebPreview(node, { ...props, preview: props.preview! }, currentMediaAccess);
  return {
    update: (next) => {
      if (next.preview) preview.update({ ...next, preview: next.preview });
    },
    dispose: () => preview.dispose(),
  };
};

/** Mounts once per view, re-applies changed props, and re-applies them when the media access changes. */
function useMounted(element: React.RefObject<HTMLElement | null>, props: VelaPlayerViewProps, mount: Mount) {
  const latest = useRef(props);
  latest.current = props;
  const mounted = useRef<Mounted | null>(null);
  const applied = useRef<VelaPlayerViewProps | null>(null);

  useEffect(() => {
    const node = element.current;
    if (!node) return;
    try {
      applied.current = latest.current;
      mounted.current = mount(node, contractProps(latest.current));
    } catch (error) {
      latest.current.onError?.(unsupported(error instanceof Error ? error.message : 'The player could not start'));
      return;
    }
    // A new access object retires the old request scope; re-applying the props lets the host see it.
    const unsubscribe = onMediaAccessChange(() => mounted.current?.update(contractProps(latest.current)));
    return () => {
      unsubscribe();
      mounted.current?.dispose();
      mounted.current = null;
    };
  }, [element, mount]);

  useEffect(() => {
    if (!mounted.current || applied.current === props) return;
    applied.current = props;
    mounted.current.update(contractProps(props));
  }, [props]);
}

function WebSurface({ mount, ...props }: VelaPlayerViewProps & { mount: Mount }) {
  const element = useRef<HTMLElement | null>(null);
  useMounted(element, props, mount);
  return <View ref={element as never} style={[{ backgroundColor: props.preview ? 'transparent' : '#000', overflow: 'hidden' }, props.style]} />;
}

/** The player view. Switching between a trailer preview, an ambient preview and full playback
 * mounts a new engine. */
export function VelaPlayerView(props: VelaPlayerViewProps) {
  if (props.preview) return <WebSurface key="preview" mount={mountPreview} {...props} />;
  return <WebSurface key={props.ambient ? 'ambient' : props.tile !== undefined ? `tile-${props.tile}` : 'playback'} mount={mountPlayback} {...props} />;
}

export type { VelaPlayerViewProps, MediaAccess };

/** The web player owns no system media key; the page hears its keys itself. */
export const claimPlayPause = (_onPress: () => void): (() => void) => () => {};

/** A browser's picture-in-picture keeps the page in the foreground: nothing to report. */
export const pictureInPicture = (): boolean => false;

export const sampleUIFrames = async (_enabled: boolean): Promise<Record<string, number> | undefined> => undefined;

/** The browser's view of the network (the Network Information API, where the browser has it). */
interface NetworkInformation extends EventTarget { type?: string; saveData?: boolean }
const connection = (): NetworkInformation | undefined =>
  typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { connection?: NetworkInformation }).connection;

/** Mobile data, or the viewer asked the browser to save data; unmetered where the browser does not say. */
export const networkMetered = (): boolean => {
  const network = connection();
  return !!network && (network.type === 'cellular' || network.saveData === true);
};

export function onNetwork(listener: (metered: boolean) => void): () => void {
  const network = connection();
  if (!network?.addEventListener) return () => {};
  const changed = () => listener(networkMetered());
  network.addEventListener('change', changed);
  return () => network.removeEventListener('change', changed);
}

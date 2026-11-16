// VelaPlayerView and VelaPlayer on the web: Vela's WebCodecs/WebGPU core (client/player), mounted
// into the DOM node react-native-web draws for a View. The contract is packages/player-api; the
// browser host (createWebPlayerHost) owns the engine, and this file only binds it to React.
// Media credentials reach the host through VelaPlayer.setMediaAccess, never through props.
import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import type { MediaAccess, VelaPlayerModule, VelaPlayerProps, VelaPlayerViewProps } from '@vela/player-api';
import { createWebPlayerHost } from '../../../client/player/host';
import { playerAssetBase } from '../web/asset-base';
import { playerCapabilities } from '../web/capabilities';
import { currentMediaAccess, onMediaAccessChange, setMediaAccess } from '../web/media-access';

export const VelaPlayer: VelaPlayerModule = { setMediaAccess, capabilities: playerCapabilities };

/** Drops the React Native style; the host sees only the contract's props. */
function contractProps({ style: _style, ...props }: VelaPlayerViewProps): VelaPlayerProps {
  return props;
}

function useWebPlayerHost(element: React.RefObject<HTMLElement | null>, props: VelaPlayerViewProps) {
  const latest = useRef(props);
  latest.current = props;
  const host = useRef<ReturnType<typeof createWebPlayerHost> | null>(null);
  const applied = useRef<VelaPlayerViewProps | null>(null);

  useEffect(() => {
    const node = element.current;
    const assetBaseURL = playerAssetBase();
    if (!node) return;
    if (!assetBaseURL) {
      latest.current.onError?.({
        kind: 'unsupported',
        message: 'This build has no player assets',
        recoverable: false,
      });
      return;
    }
    try {
      applied.current = latest.current;
      host.current = createWebPlayerHost(node, contractProps(latest.current), {
        assetBaseURL,
        access: currentMediaAccess,
      });
    } catch (error) {
      latest.current.onError?.({
        kind: 'unsupported',
        message: error instanceof Error ? error.message : 'The player could not start',
        recoverable: false,
      });
      return;
    }
    // A new access object retires the old request scope; re-applying the props lets the host see it.
    const unsubscribe = onMediaAccessChange(() => host.current?.update(contractProps(latest.current)));
    return () => {
      unsubscribe();
      host.current?.dispose();
      host.current = null;
    };
  }, [element]);

  useEffect(() => {
    if (!host.current || applied.current === props) return;
    applied.current = props;
    host.current.update(contractProps(props));
  }, [props]);
}

function WebPlayerSurface(props: VelaPlayerViewProps) {
  const element = useRef<HTMLElement | null>(null);
  useWebPlayerHost(element, props);
  return <View ref={element as never} style={[{ backgroundColor: '#000', overflow: 'hidden' }, props.style]} />;
}

/** The player view. Switching between a preview (`ambient`) and full playback mounts a new engine. */
export function VelaPlayerView(props: VelaPlayerViewProps) {
  return <WebPlayerSurface key={props.ambient ? 'ambient' : 'playback'} {...props} />;
}

export type { VelaPlayerViewProps, MediaAccess };

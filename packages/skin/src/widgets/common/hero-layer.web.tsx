import { ExpoHeroLayer, type HeroLayerProps } from './hero-layer-fallback';

/** The hero is the page's largest paint. Start its visible artwork immediately while retaining
 * Expo for bundled or headered assets; the blurred underlay stays low priority. */
export function HeroLayer(props: HeroLayerProps) {
  const { source, blurred, onError, onLoad } = props;
  if (typeof source !== 'object' || !source?.uri || source.headers) return <ExpoHeroLayer {...props} />;
  return <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', transform: blurred ? 'scale(1.15)' : undefined }}>
    <img src={source.uri} alt="" aria-hidden="true" draggable={false} loading={blurred ? 'lazy' : 'eager'} decoding="async"
      fetchPriority={blurred ? 'low' : 'high'} onError={onError} onLoad={onLoad}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
        filter: blurred ? 'blur(55px)' : undefined }} />
  </div>;
}

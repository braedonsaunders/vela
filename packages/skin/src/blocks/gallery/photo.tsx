import { useContext, useState } from 'react';
import { Image } from 'expo-image';
import { Text, View } from 'react-native';
import { msg, type Card } from '@vela/core';
import { useHost } from '../../host';
import { usePart } from '../listen/look';
import { dayLabel } from '../media/day';
import { useMediaLook } from '../media/parts';
import { photoImage, PhotoNavigationContext, PhotoViewerNavigation } from './viewer-nav';
import { Eyebrow, FactList, Facts } from '../media/title';
import { MediaContentHeight } from '../media/viewport';
import { photoStageHeight } from './photo-layout';

/** The image retains its aspect ratio. The title frame owns scrolling and closing. */
export function PhotoViewer({ card }: { card: Card }) {
  const m = useMediaLook();
  const host = useHost();
  const root = usePart('photoViewer.root');
  const stage = usePart('photoViewer.stage');
  const metadata = usePart('photoViewer.metadata');
  const eyebrow = usePart('photoViewer.eyebrow');
  const title = usePart('photoViewer.title');
  const date = usePart('photoViewer.date');
  const facts = usePart('photoViewer.facts');
  const navigation = useContext(PhotoNavigationContext);
  const viewport = useContext(MediaContentHeight);
  const [captionHeight, setCaptionHeight] = useState<number>();
  const [width, setWidth] = useState(0);
  const [imageSize, setImageSize] = useState<{ uri: string; ratio: number }>();
  const uri = photoImage(card);
  const ratio = uri === imageSize?.uri ? imageSize.ratio : undefined;
  const gap = m.small ? 20 : 28;
  const preferred = Math.max(240, Math.round(m.height * (m.small ? 0.58 : 0.7)));
  const fitted = navigation && ratio && width ? Math.min(preferred, width / ratio) : preferred;
  const bottomInset = m.small ? 12 : 16;
  const height = photoStageHeight(fitted, gap, viewport == null ? undefined : viewport - bottomInset, captionHeight);
  const stageWidth = navigation && ratio && width ? Math.min(width, height * ratio) : '100%';
  const image = uri ? <Image key={navigation ? uri : undefined} source={host.image(uri)} contentFit="contain" transition={200} accessibilityLabel={card.name}
    onLoad={event => {
      const source = event.source;
      if (navigation && source.width > 0 && source.height > 0) setImageSize({ uri, ratio: source.width / source.height });
    }} style={{ width: '100%', height: '100%' }} />
    : <View style={{ width: '60%', height: '80%', borderRadius: 10, backgroundColor: m.ui.skeleton }} />;
  return (
    <View testID="media-photo-page" style={root.box}
      onLayout={navigation ? event => setWidth(event.nativeEvent.layout.width) : undefined}>
      <View testID="media-photo" style={[{ width: stageWidth, height, marginBottom: gap, alignSelf: 'center',
        alignItems: 'center', justifyContent: 'center' }, stage.box]}>
        {navigation ? <PhotoViewerNavigation card={card} navigation={navigation}>{image}</PhotoViewerNavigation> : image}
      </View>
      <View testID="gallery-photo-caption" style={[{ gap: 8, marginBottom: navigation ? bottomInset : 32 }, metadata.box]}
        onLayout={event => setCaptionHeight(event.nativeEvent.layout.height)}>
        <Eyebrow style={eyebrow.text}>{msg('media.ui.photo')}</Eyebrow>
        <Text accessibilityRole="header" style={[m.text({ 'font-family': '$ui.fontDisplay', 'font-size': m.small ? '26px' : '34px', 'line-height': '1.1', color: '$ui.ink' }), title.text]}>{card.name}</Text>
        <Facts items={[dayLabel(card)]} style={date.text} />
      </View>
      {!navigation ? <FactList card={card} style={facts.box} /> : null}
    </View>
  );
}

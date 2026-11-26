import { Image } from 'expo-image';
import { useContext, useState } from 'react';
import { Text, View } from 'react-native';
import { msg, type Card } from '@vela/core';
import { useHost } from '../../host';
import { usePart } from '../listen/look';
import { dayLabel } from '../media/day';
import { useMediaLook } from '../media/parts';
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
  const uri = card.thumbnail || card.backdrop || card.poster;
  const viewport = useContext(MediaContentHeight);
  const [captionHeight, setCaptionHeight] = useState<number>();
  const captionGap = m.small ? 20 : 28;
  const preferred = Math.max(240, Math.round(m.height * (m.small ? 0.58 : 0.7)));
  const height = photoStageHeight(preferred, captionGap, viewport, captionHeight);
  return (
    <View testID="media-photo-page" style={root.box}>
      <View testID="media-photo" style={[{ width: '100%', height, marginBottom: captionGap, alignItems: 'center', justifyContent: 'center' }, stage.box]}>
        {uri ? <Image source={host.image(uri)} contentFit="contain" transition={200} accessibilityLabel={card.name}
          style={{ width: '100%', height: '100%' }} />
          : <View style={{ width: '60%', height: '80%', borderRadius: 10, backgroundColor: m.ui.skeleton }} />}
      </View>
      <View style={[{ gap: 8, marginBottom: 32 }, metadata.box]} onLayout={event => setCaptionHeight(event.nativeEvent.layout.height)}>
        <Eyebrow style={eyebrow.text}>{msg('media.ui.photo')}</Eyebrow>
        <Text accessibilityRole="header" style={[m.text({ 'font-family': '$ui.fontDisplay', 'font-size': m.small ? '26px' : '34px', 'line-height': '1.1', color: '$ui.ink' }), title.text]}>{card.name}</Text>
        <Facts items={[dayLabel(card)]} style={date.text} />
      </View>
      <FactList card={card} style={facts.box} />
    </View>
  );
}

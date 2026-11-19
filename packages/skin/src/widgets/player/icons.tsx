// The chrome's icons: 24x24 strokes and fills in one colour, the compiled Cinematic geometry.
import { View } from 'react-native';
import Svg, { Circle, Path, Rect, Text as SvgText } from 'react-native-svg';

export type PlayerIconName =
  | 'back'
  | 'play'
  | 'pause'
  | 'restart'
  | 'skipBack'
  | 'skipForward'
  | 'speaker'
  | 'speakerMute'
  | 'captions'
  | 'captionsOn'
  | 'audio'
  | 'quality'
  | 'speed'
  | 'chapters'
  | 'pip'
  | 'fullscreen'
  | 'alert'
  | 'check';

interface Props {
  name: PlayerIconName;
  size: number;
  color: string;
}

/** Four corners, drawn one after another. */
const FULLSCREEN = [
  'M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9',
  'M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9',
  'M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15',
  'M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15',
].join('');

const STROKE = { fill: 'none', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

function Skip({ forward, color }: { forward: boolean; color: string }) {
  return (
    <>
      <Path
        d={forward ? 'M12 5.5a7.5 7.5 0 1 0 7.5 7.5' : 'M12 5.5a7.5 7.5 0 1 1-7.5 7.5'}
        stroke={color}
        {...STROKE}
      />
      <Path d={forward ? 'M11 2.6 14.2 5.5 11 8.4' : 'M13 2.6 9.8 5.5 13 8.4'} stroke={color} {...STROKE} />
      <SvgText x={12} y={16} fontSize={7} fontWeight="700" textAnchor="middle" fill={color}>
        10
      </SvgText>
    </>
  );
}

function Captions({ on, color }: { on: boolean; color: string }) {
  return (
    <>
      {on ? <Rect x={2.5} y={4.5} width={19} height={15} rx={3} fill={color} opacity={0.3} /> : null}
      <Rect x={2.5} y={4.5} width={19} height={15} rx={3} stroke={color} {...STROKE} />
      <Path d="M6.5 12.5h4M13 12.5h4.5M6.5 15.5h7M15.5 15.5h2" stroke={color} {...STROKE} />
    </>
  );
}

function Shape({ name, color }: { name: PlayerIconName; color: string }) {
  switch (name) {
    case 'back':
      return <Path d="M15 5l-7 7 7 7" stroke={color} {...STROKE} />;
    case 'play':
      return <Path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z" fill={color} />;
    case 'pause':
      return <Path d="M6.5 4.5h3.5v15H6.5zM14 4.5h3.5v15H14z" fill={color} />;
    case 'restart':
      return <Path d="M4 10a8 8 0 1 1 1 8M4 4v6h6" stroke={color} {...STROKE} />;
    case 'skipBack':
      return <Skip forward={false} color={color} />;
    case 'skipForward':
      return <Skip forward color={color} />;
    case 'speaker':
      return (
        <Path
          d="M4 9.5h3.5L12 5.5v13l-4.5-4H4zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"
          stroke={color}
          {...STROKE}
        />
      );
    case 'speakerMute':
      return <Path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4zM16 9.5l5 5M21 9.5l-5 5" stroke={color} {...STROKE} />;
    case 'captions':
      return <Captions on={false} color={color} />;
    case 'captionsOn':
      return <Captions on color={color} />;
    case 'audio':
      return <Path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 10.5v3" stroke={color} {...STROKE} />;
    case 'quality':
      return (
        <>
          <Path d="M4 7h9M17 7h3M4 17h3M11 17h9" stroke={color} {...STROKE} />
          <Circle cx={15} cy={7} r={2} stroke={color} {...STROKE} />
          <Circle cx={9} cy={17} r={2} stroke={color} {...STROKE} />
        </>
      );
    case 'speed':
      return (
        <>
          <Path d="M4.5 17.5a8.5 8.5 0 1 1 15 0" stroke={color} {...STROKE} />
          <Path d="M12 14.5l4-5" stroke={color} {...STROKE} strokeWidth={1.9} />
          <Circle cx={12} cy={14.5} r={1.6} fill={color} />
        </>
      );
    case 'chapters':
      return <Path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" stroke={color} {...STROKE} strokeWidth={2} />;
    case 'pip':
      return (
        <>
          <Rect x={2.5} y={4.5} width={19} height={15} rx={3} stroke={color} {...STROKE} />
          <Rect x={12} y={11.5} width={7} height={5.5} rx={1.5} fill={color} />
        </>
      );
    case 'fullscreen':
      return <Path d={FULLSCREEN} stroke={color} {...STROKE} strokeWidth={1.8} />;
    case 'alert':
      return <Path d="M12 3.5l9.5 16.5h-19zM12 10v4.5M12 17.4v.1" stroke={color} {...STROKE} />;
    case 'check':
      return <Path d="M4.5 12.5l5 5L19.5 7" stroke={color} {...STROKE} strokeWidth={2} />;
  }
}

/** In a view of its own, so it stacks in order over a panel's absolutely placed glass (on the web too). */
export function PlayerIcon({ name, size, color }: Props) {
  return (
    <View pointerEvents="none" style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Shape name={name} color={color} />
      </Svg>
    </View>
  );
}

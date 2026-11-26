// Glyphs the media pages and players draw (24-unit, painted in currentColor-like `color`).
import Svg, { Path } from 'react-native-svg';

const PATHS: Record<string, { d: string[]; stroke?: boolean }> = {
  play: { d: ['M7 4.8v14.4c0 .8.9 1.3 1.6.9l11.3-7.2c.6-.4.6-1.3 0-1.7L8.6 3.9C7.9 3.5 7 4 7 4.8z'] },
  pause: { d: ['M6.5 4h3.2c.4 0 .8.4.8.8v14.4c0 .4-.4.8-.8.8H6.5c-.4 0-.8-.4-.8-.8V4.8c0-.4.4-.8.8-.8z', 'M14.3 4h3.2c.4 0 .8.4.8.8v14.4c0 .4-.4.8-.8.8h-3.2c-.4 0-.8-.4-.8-.8V4.8c0-.4.4-.8.8-.8z'] },
  next: { d: ['M4.5 5.6v12.8c0 .8.9 1.2 1.5.8l9-6.4c.5-.4.5-1.2 0-1.6l-9-6.4c-.6-.4-1.5 0-1.5.8z', 'M17.5 5h1.8c.4 0 .7.3.7.7v12.6c0 .4-.3.7-.7.7h-1.8c-.4 0-.7-.3-.7-.7V5.7c0-.4.3-.7.7-.7z'] },
  previous: { d: ['M19.5 5.6v12.8c0 .8-.9 1.2-1.5.8l-9-6.4c-.5-.4-.5-1.2 0-1.6l9-6.4c.6-.4 1.5 0 1.5.8z', 'M6.5 5H4.7c-.4 0-.7.3-.7.7v12.6c0 .4.3.7.7.7h1.8c.4 0 .7-.3.7-.7V5.7c0-.4-.3-.7-.7-.7z'] },
  shuffle: { stroke: true, d: ['M3 7h3.5c2 0 3.3 1 4.4 2.6l2.2 3.8c1 1.6 2.4 2.6 4.4 2.6H21', 'M18 13l3 3-3 3', 'M3 17h3.5c1.4 0 2.4-.5 3.3-1.3', 'M14.2 8.3c.9-.8 1.9-1.3 3.3-1.3H21', 'M18 4l3 3-3 3'] },
  repeat: { stroke: true, d: ['M4 11V9.5A3.5 3.5 0 0 1 7.5 6H19', 'M16 3l3 3-3 3', 'M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H5', 'M8 21l-3-3 3-3'] },
  repeatOne: { stroke: true, d: ['M4 11V9.5A3.5 3.5 0 0 1 7.5 6H19', 'M16 3l3 3-3 3', 'M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H5', 'M8 21l-3-3 3-3', 'M11.5 10.5l1.2-.8v4.6'] },
  back15: { stroke: true, d: ['M4.5 12a7.5 7.5 0 1 0 2.2-5.3', 'M4 3.5v3.7h3.7', 'M10 10l1.2-.7V15', 'M13.8 15h1.4a1.4 1.4 0 0 0 0-2.8h-1.4V9.3h2.6'] },
  forward30: { stroke: true, d: ['M19.5 12a7.5 7.5 0 1 1-2.2-5.3', 'M20 3.5v3.7h-3.7', 'M8.6 9.6c.3-.3.8-.4 1.3-.4.8 0 1.4.5 1.4 1.3s-.6 1.2-1.4 1.2c.9 0 1.6.5 1.6 1.4 0 .9-.7 1.5-1.6 1.5-.6 0-1.1-.2-1.4-.6', 'M14.6 9.3c1 0 1.6.9 1.6 2.9s-.6 2.9-1.6 2.9-1.6-.9-1.6-2.9.6-2.9 1.6-2.9z'] },
  queue: { stroke: true, d: ['M4 6h11', 'M4 11h11', 'M4 16h7', 'M17 14v6.5', 'M17 20.5a2 2 0 1 1-2-2 2 2 0 0 1 2 2z', 'M17 14l3.5-1'] },
  chapters: { stroke: true, d: ['M8 6h12', 'M8 12h12', 'M8 18h12', 'M4 6h.01', 'M4 12h.01', 'M4 18h.01'] },
  moon: { stroke: true, d: ['M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z'] },
  speed: { stroke: true, d: ['M4.5 17a8.5 8.5 0 1 1 15 0', 'M12 13l4-4.5'] },
  book: { stroke: true, d: ['M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15H5.5A1.5 1.5 0 0 0 4 20.5z', 'M20 5.5A1.5 1.5 0 0 0 18.5 4H13v15h5.5a1.5 1.5 0 0 1 1.5 1.5z'] },
  headphones: { stroke: true, d: ['M4 15v-3a8 8 0 0 1 16 0v3', 'M4 15h2.5a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z', 'M20 15h-2.5a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1H19a1 1 0 0 0 1-1z'] },
  disc: { stroke: true, d: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'] },
  close: { stroke: true, d: ['M6 6l12 12', 'M18 6L6 18'] },
  back: { stroke: true, d: ['M15 5l-7 7 7 7'] },
  forward: { stroke: true, d: ['M9 5l7 7-7 7'] },
  info: { stroke: true, d: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 11v5', 'M12 8h.01'] },
  expand: { stroke: true, d: ['M9 4H4v5', 'M15 4h5v5', 'M4 15v5h5', 'M20 15v5h-5'] },
  collapse: { stroke: true, d: ['M4 9h5V4', 'M20 9h-5V4', 'M9 20v-5H4', 'M15 20v-5h5'] },
  down: { stroke: true, d: ['M5 9l7 7 7-7'] },
  text: { stroke: true, d: ['M4 19l5-14 5 14', 'M5.8 14h6.4', 'M15 19l3-8 3 8', 'M16 16.5h4'] },
  contents: { stroke: true, d: ['M5 6h14', 'M5 10h14', 'M5 14h9', 'M5 18h9'] },
  visualizer: { stroke: true, d: ['M3 12h2l2-6 3 13 3-15 3 13 2-5h3'] },
  sound: { stroke: true, d: ['M6 4v8', 'M6 16v4', 'M8 14a2 2 0 1 1-4 0 2 2 0 0 1 4 0z', 'M12 4v2', 'M12 10v10', 'M14 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0z', 'M18 4v10', 'M18 18v2', 'M20 16a2 2 0 1 1-4 0 2 2 0 0 1 4 0z'] },
  volume: { stroke: true, d: ['M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z', 'M15.5 9a4 4 0 0 1 0 6', 'M18 6.5a7.5 7.5 0 0 1 0 11'] },
};

export function MediaGlyph({ name, size = 20, color }: { name: keyof typeof PATHS | string; size?: number; color: string }) {
  const glyph = PATHS[name];
  if (!glyph) return null;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" pointerEvents="none">
      {glyph.d.map((d, i) => glyph.stroke
        ? <Path key={i} d={d} fill="none" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
        : <Path key={i} d={d} fill={color} />)}
    </Svg>
  );
}

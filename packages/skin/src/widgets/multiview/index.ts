// Live TV multiview: up to four live channels on one screen, audio following focus.
export { MultiviewController, type LiveEventRef, type MultiviewOptions, type MultiviewSource, type MultiviewTile, type MultiviewTileRequest, type MultiviewView } from './controller';
export { layoutsFor, neighbour, placement, settleLayout, slotRects, ladderHeight, featureBand, HEIGHT_LADDER, MAX_TILES, type MultiviewLayout, type Rect, type Size } from './layout';
export { connectionCap, tileRefusal, type ConnectionCap, type TileRefusal } from './refusal';
export { MultiviewScreen, useMultiviewView, type MultiviewScreenProps } from './screen';
export { MultiviewProvider, useMultiview } from './context';

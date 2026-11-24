// Renderer-19 layout blocks (`packages/skin/src/blocks/*`) and their single dispatcher (`Block`).
// Dispatches the screen layout blocks (`sections`, `shelf`, `grid`, `marquee`, `tabs`, `table`,
// `lineGraph`, `player`, `paramInput`, `titleCard`) from `packages/skin/src/render.tsx`.
import type { Ctx } from '../vocabulary';
import { GridBlock } from './grid';
import { LineGraphBlock } from './line-graph';
import { MarqueeBlock } from './marquee';
import { ParamInputBlock } from './param-input';
import { PlayerBlock } from './player';
import { SectionsBlock } from './sections';
import { ShelfBlock } from './shelf';
import { TableBlock } from './table';
import { TabsBlock } from './tabs';
import { TitleCardBlock } from './title-card';
import type { AnyBlockNode } from './types';

export {
  stripRecordPrefix,
  validateOpenLinkHref,
  validateScreenAction,
  type BuiltinScreenRoute,
  type ValidateActionContext,
  type ValidatedScreenAction,
} from './action-validation';
export { FocusBand, FocusableTableRow } from './focus';
export { luminance, normalizeSeriesPoints, pathLength, probabilityPath, readableSeriesColor } from './graph-math';
export {
  FIRST_SECTIONS,
  applyStableOrder,
  chunkGridRows,
  initialStreamedCount,
  nextStreamedCount,
  parseItemWidth,
  parsePoints,
  resolveActiveTabValue,
  resolveShelfItemWidth,
  type ParsedItemWidth,
  type TabBindingState,
} from './layout-math';
export { alpha, createScalePx, isLight, useBlockLook, type BlockLook } from './look';
export {
  fitTable,
  fitTextMetrics,
  normalizeTableData,
  numericColumn,
  tableNaturalWidth,
  textWidth,
  type ColumnFit,
  type FitText,
  type NormalizedTableData,
  type NormalizedTableRow,
  type RawTableData,
  type RawTableRow,
  type TableFit,
} from './table-fit';
export {
  BLOCK_KINDS,
  ScreenBlockRuntimeProvider,
  createScreenBlockRuntime,
  useScreenBlockRuntime,
  type AnyBlockNode,
  type BlockKind,
  type GridBlockNode,
  type LineGraphBlockNode,
  type MarqueeBlockNode,
  type ParamInputBlockNode,
  type PlayerBlockNode,
  type ScreenBlockRuntime,
  type SectionsBlockNode,
  type ShelfBlockNode,
  type TableBlockNode,
  type TabsBlockNode,
  type TitleCardBlockNode,
} from './types';

export function Block({ node, ctx }: { node: AnyBlockNode; ctx: Ctx }) {
  switch (node.kind) {
    case 'sections':
      return <SectionsBlock node={node} ctx={ctx} />;
    case 'shelf':
      return <ShelfBlock node={node} ctx={ctx} />;
    case 'grid':
      return <GridBlock node={node} ctx={ctx} />;
    case 'marquee':
      return <MarqueeBlock node={node} ctx={ctx} />;
    case 'tabs':
      return <TabsBlock node={node} ctx={ctx} />;
    case 'table':
      return <TableBlock node={node} ctx={ctx} />;
    case 'lineGraph':
      return <LineGraphBlock node={node} ctx={ctx} />;
    case 'player':
      return <PlayerBlock node={node} ctx={ctx} />;
    case 'paramInput':
      return <ParamInputBlock node={node} ctx={ctx} />;
    case 'titleCard':
      return <TitleCardBlock node={node} ctx={ctx} />;
    default:
      return null;
  }
}

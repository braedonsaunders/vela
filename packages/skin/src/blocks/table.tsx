// The `table` layout block (`docs/plugin-screens.md` §6): renders a standings, box-score, or
// statistical table with auto-fitted columns (`fitTable`), tabular numerals, highlighted rows,
// and optional row-by-row TV focus (`focusRows`) for long tables.
// Matches legacy `TableView` pixel-for-pixel.
import { useMemo, useState } from 'react';
import { Platform, Text, View, type LayoutChangeEvent } from 'react-native';
import { useHost } from '../host';
import { fill, type Template } from '../resolve';
import type { Ctx } from '../vocabulary';
import { FocusableTableRow } from './focus';
import { alpha, useBlockLook } from './look';
import { fitTable, fitTextMetrics, normalizeTableData, type NormalizedTableData } from './table-fit';
import type { TableBlockNode } from './types';

export function TableBlock({ node, ctx }: { node: TableBlockNode; ctx: Ctx }) {
  const host = useHost();
  const look = useBlockLook();
  const { px } = look;
  const compact = node.compact === true;
  const [width, setWidth] = useState(0);

  const rawData = typeof node.data === 'function' ? node.data(ctx, host.env) : node.data;
  const table: NormalizedTableData | null = normalizeTableData(rawData);
  const text = fitTextMetrics(px, compact);
  const fit = useMemo(
    () => (table ? fitTable(table, width || Infinity, text) : null),
    [table, width, text.size, text.headerSize, text.gap],
  );

  if (!table || !fit || (!table.columns.length && !table.rows.length)) return null;

  const onLayout = (e: LayoutChangeEvent) => {
    const w = Math.floor(e.nativeEvent.layout.width);
    if (w > 0 && w !== width) setWidth(w);
  };

  // Each column's gap is on its leading side (the first column's on its trailing side), so a
  // right-aligned number never runs into the words after it.
  const cellStyle = (c: (typeof fit.columns)[number], n: number) => {
    const pad = n === 0 ? { paddingRight: text.gap } : c.align === 'left' ? { paddingLeft: text.gap } : null;
    return c.name
      ? { flex: 1, minWidth: 0, textAlign: 'left' as const, ...pad }
      : { width: c.width, textAlign: c.align, ...pad };
  };

  const label = node.label ? fill(node.label as Template, ctx, host.env) : table.title;
  const testID = node.testId ? fill(node.testId as Template, ctx, host.env).trim() || undefined : undefined;
  const threshold = node.focusRows && node.focusRows > 0 ? node.focusRows : Infinity;
  const focusEachRow = Platform.isTV && table.rows.length > threshold;

  return (
    <View
      testID={testID}
      onLayout={onLayout}
      accessibilityLabel={label || undefined}
      style={{ gap: px(2), opacity: width ? 1 : 0 }}
    >
      {table.title ? (
        <Text
          numberOfLines={2}
          ellipsizeMode="tail"
          style={{
            ...look.face(700),
            fontSize: px(12),
            lineHeight: px(12 * 1.25),
            color: look.quiet,
            letterSpacing: px(1.1),
            textTransform: 'uppercase',
            marginBottom: px(6),
          }}
        >
          {table.title}
        </Text>
      ) : null}
      <View
        style={{
          flexDirection: 'row',
          paddingBottom: px(6),
          borderBottomWidth: 1,
          borderBottomColor: look.line,
        }}
      >
        {fit.columns.map((c, n) => (
          <Text
            key={`${c.index}-${table.columns[c.index]}`}
            numberOfLines={1}
            ellipsizeMode="tail"
            style={{
              ...look.face(650),
              fontSize: px(11.5),
              lineHeight: px(11.5 * 1.25),
              color: look.quiet,
              ...cellStyle(c, n),
            }}
          >
            {table.columns[c.index] ?? ''}
          </Text>
        ))}
      </View>
      {table.rows.map((row, r) => {
        const on = row.highlight;
        const last = r === table.rows.length - 1;
        const rowStyle = {
          flexDirection: 'row' as const,
          alignItems: 'center' as const,
          paddingVertical: px(compact ? 5 : 7),
          borderBottomWidth: last ? 0 : 1,
          borderBottomColor: on ? 'transparent' : look.line,
          marginHorizontal: -px(6),
          paddingHorizontal: px(6),
          backgroundColor: on ? alpha(look.accent, 0.14) : 'transparent',
          borderRadius: on ? px(7) : 0,
        };
        const rowCells = fit.columns.map((c, n) => {
          const total = c.index === table.columns.length - 1 && !c.name;
          const cellSize = compact ? 13 : 13.5;
          return (
            <Text
              key={c.index}
              numberOfLines={1}
              ellipsizeMode="tail"
              style={{
                ...look.face(c.name ? 650 : total ? 700 : 520),
                fontSize: px(cellSize),
                lineHeight: px(cellSize * 1.25),
                color: c.name || total ? look.ink : look.secondary,
                fontVariant: ['tabular-nums'],
                ...cellStyle(c, n),
              }}
            >
              {row.cells[c.index] ?? ''}
            </Text>
          );
        });
        if (focusEachRow) {
          return (
            <FocusableTableRow
              key={r}
              look={look}
              style={rowStyle}
              label={row.cells.filter(Boolean).join(' ')}
            >
              {rowCells}
            </FocusableTableRow>
          );
        }
        return (
          <View key={r} style={rowStyle}>
            {rowCells}
          </View>
        );
      })}
    </View>
  );
}

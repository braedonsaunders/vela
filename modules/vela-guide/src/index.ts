import { Platform, processColor } from 'react-native';
import { requireNativeViewManager } from 'expo-modules-core';
import { createElement, memo, useMemo, type ComponentType } from 'react';
import type { GuideRowDrawingProps, RowDrawing } from '@vela/skin/src/widgets/guide/drawing';

type NativeDrawing = Omit<RowDrawing, 'colours' | 'cells'> & {
  colours: Record<string, ReturnType<typeof processColor>>;
  cells: (Omit<RowDrawing['cells'][number], 'tone'> & { tone: ReturnType<typeof processColor> })[];
};
const Native = Platform.OS === 'ios' && Platform.isTV
  ? requireNativeViewManager<Omit<GuideRowDrawingProps, 'drawing'> & { drawing: NativeDrawing }>('VelaGuide') : undefined;

const AppleRow = memo(function AppleRow(props: GuideRowDrawingProps) {
  const drawing = useMemo(() => ({ ...props.drawing,
    colours: Object.fromEntries(Object.entries(props.drawing.colours).map(([key, value]) => [key, processColor(value)])),
    cells: props.drawing.cells.map(cell => ({ ...cell, tone: processColor(cell.tone || 'transparent') })),
  }), [props.drawing]);
  return Native ? createElement(Native, { ...props, drawing }) : null;
});

/** Drawing only. The host keeps all guide data, navigation and focus in shared TypeScript. */
export const GuideRowDrawing: ComponentType<GuideRowDrawingProps> | undefined = Native ? AppleRow : undefined;

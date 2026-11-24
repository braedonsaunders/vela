// The `tabs` layout block (`docs/plugin-screens.md` §6): horizontal tab / chip selector bound to
// either a page parameter (`bind.param`, clearing any `bind.clear` parameters) or a local view-state
// flag (`bind.state`), with an optional leading `all` tab, `default` fallback value, and optional
// trailing `after` nodes inside the same horizontal ScrollView (such as the Hide-scores switch).
// Renders each option using W1's resolved kit template `node.chip` (`vela:tab` by default, or
// `vela:chip`) with `$tab` bound via `bindTabCtx` and `role: 'tab'` / `press` cloned onto the root box.
import { useMemo } from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { useHost } from '../host';
import { fill, type RPress, type Template } from '../resolve';
import type { Ctx } from '../vocabulary';
import { FocusBand } from './focus';
import { resolveActiveTabValue } from './layout-math';
import { useBlockLook } from './look';
import { useScreenBlockRuntime, type TabsBlockNode } from './types';

function literalTemplate(text: string): Template {
  return text;
}

interface TabEntry {
  key: string;
  value: string;
  label: string;
  count: string;
  itemCtx: Ctx | undefined;
}

export function TabsBlock({ node, ctx }: { node: TabsBlockNode; ctx: Ctx }) {
  const host = useHost();
  const look = useBlockLook();
  const runtime = useScreenBlockRuntime();
  const { px } = look;

  const rawItems = runtime ? runtime.evalItems(node, ctx, host.env) : [];
  const allLabel = node.all ? fill(node.all as Template, ctx, host.env).trim() : '';
  const hasAllOption = Boolean(node.all && allLabel);

  const options: TabEntry[] = useMemo(() => {
    const list: TabEntry[] = [];
    if (hasAllOption) {
      list.push({
        key: '__all__',
        value: '',
        label: allLabel,
        count: '',
        itemCtx: undefined,
      });
    }
    for (let i = 0; i < rawItems.length; i++) {
      const itemCtx = rawItems[i]!;
      const val = fill(node.value as Template, itemCtx, host.env).trim();
      const lbl = fill(node.label as Template, itemCtx, host.env).trim();
      const cnt = node.count ? fill(node.count as Template, itemCtx, host.env).trim() : '';
      if (!lbl && !val) continue;
      list.push({
        key: `${i}:${val}`,
        value: val,
        label: lbl || val,
        count: cnt && cnt !== '0' ? cnt : '',
        itemCtx,
      });
    }
    return list;
  }, [hasAllOption, allLabel, rawItems, node.value, node.label, node.count, host.env]);

  if (!runtime || !options.length) return null;

  const screenScope = ctx.screen;
  const paramName = node.bind.param;
  const stateName = node.bind.state;
  const currentParamValue = paramName
    ? (screenScope?.page?.params?.[paramName] ?? '')
    : stateName
      ? (screenScope?.state?.[stateName] ?? host.env.flags.find(f => f.startsWith(`${stateName}:`))?.slice(stateName.length + 1) ?? '')
      : '';
  const defaultValue = node.default ? fill(node.default as Template, ctx, host.env).trim() : '';

  const activeValue = resolveActiveTabValue({
    paramValue: currentParamValue,
    defaultValue,
    hasAllOption,
    optionValues: options.filter(o => o.key !== '__all__').map(o => o.value),
  });

  const clearStr = node.bind.clear?.length ? node.bind.clear.join(',') : '';
  const afterNodes = Array.isArray(node.after) ? node.after : [];
  const alias = node.items?.as ?? 'item';

  return (
    <FocusBand>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityRole={Platform.OS === 'web' ? ('tablist' as 'header') : undefined}
        contentContainerStyle={{
          paddingHorizontal: look.gutter,
          gap: px(8),
          alignItems: 'center',
        }}
      >
        {options.map(opt => {
          const on = opt.value === activeValue;
          const tabCtx = runtime.bindTabCtx(
            ctx,
            opt.itemCtx,
            {
              label: opt.label,
              count: opt.count,
              on,
            },
            alias,
          );
          const press: RPress | undefined = paramName
            ? {
                action: 'setParam',
                arg: literalTemplate(paramName),
                args: {
                  param: literalTemplate(paramName),
                  value: literalTemplate(opt.value),
                  ...(clearStr ? { clear: literalTemplate(clearStr) } : {}),
                },
              }
            : stateName
              ? {
                  action: 'only',
                  arg: literalTemplate(opt.value ? `${stateName}:${opt.value}` : stateName),
                }
              : undefined;
          const chipObj = node.chip && typeof node.chip === 'object' ? (node.chip as Record<string, unknown>) : null;
          const chipWithPress = chipObj
            ? {
                ...chipObj,
                role: 'tab',
                ...(press ? { press } : {}),
              }
            : node.chip;
          return <View key={opt.key}>{runtime.renderNode(chipWithPress, tabCtx)}</View>;
        })}
        {afterNodes.map((trailing, idx) => (
          <View key={`after-${idx}`}>
            {runtime.renderNode(trailing, ctx)}
          </View>
        ))}
      </ScrollView>
    </FocusBand>
  );
}

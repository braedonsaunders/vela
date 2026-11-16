// What a `select` widget offers (renderer 10): its options, read through the vocabulary from the
// collection `params.options` names (`library.genres`, `library.sorts`, `library.kinds`, each item
// an `opt`) or from the document's fixed `params.choices` (`value|label;…`, for `library.played`);
// the current value; and the action a choice runs (`params.action` with `params.arg`, where
// `{value}` is the chosen id).
import type { Action } from '../../../../../protocol/v0/skin';
import { useHost, type WidgetProps } from '../../host';
import { accessor, collection, type Ctx, type Env } from '../../vocabulary';

export interface Choice {
  value: string;
  label: string;
}

export interface SelectModel {
  choices: Choice[];
  value: string;
  label: string;
  choose(value: string): void;
}

/** The vocabulary key that holds each collection's current value. */
const CURRENT: Record<string, string> = {
  'library.sorts': 'library.sort',
  'library.kinds': 'library.kindFilter',
  'library.genres': 'library.genreFilter',
  'library.played': 'library.playedFilter',
};
const MAX_OPTIONS = 500;

function read(key: string, c: Ctx, e: Env): string {
  return accessor(key)?.(c, e) ?? '';
}

function choicesOf(params: Record<string, string>, c: Ctx, e: Env): Choice[] {
  const fixed = params.choices
    ? params.choices.split(';').filter(Boolean).map(pair => {
      const [value, ...label] = pair.split('|');
      return { value, label: label.join('|') };
    })
    : collection(params.options ?? '', c, e, MAX_OPTIONS).map(item => ({ value: read('opt.id', item, e), label: read('opt.label', item, e) }));
  return params.none !== undefined ? [{ value: '', label: params.none }, ...fixed] : fixed;
}

export function useSelectModel({ params, ctx }: WidgetProps): SelectModel {
  const host = useHost();
  const choices = choicesOf(params, ctx, host.env);
  const current = CURRENT[params.options ?? ''];
  return {
    choices,
    value: current ? read(current, ctx, host.env) : '',
    label: params.label ?? '',
    choose: value => {
      if (!params.action) return;
      const arg = params.arg ? params.arg.split('{value}').join(value) : value;
      host.dispatch(params.action as Action, arg);
    },
  };
}

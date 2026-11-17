import type { Node } from '../../../../protocol/skin';
import { focusRing, placeholder } from './look';

/** Cast is one focus target; only its round portrait carries the focus ring. */
const portrait: Node = {
  type: 'box',
  style: { width: '100px', height: '100px', 'border-radius': '999px', 'background-color': '$ui.raised' },
  small: { width: '76px', height: '76px' },
  groupFocus: { 'box-shadow': focusRing, scale: '1.04' },
  children: [{ type: 'box', style: { width: '100%', height: '100%', 'border-radius': '999px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'background-image': placeholder(135) }, children: [
    { type: 'text', text: '{person.initials}', style: { 'font-size': '28px', color: '$ui.inkSecondary' } },
    { type: 'image', when: [{ test: 'person.portrait' }], src: '{person.portrait}', alt: '', style: { position: 'absolute', inset: '0px', width: '100%', height: '100%', 'object-fit': 'cover' } },
  ] }],
};
const contents: Node[] = [portrait,
  { type: 'text', text: '{person.name}', style: { 'font-size': '14px', 'font-weight': '600', color: '$ui.inkSecondary', 'text-align': 'center', 'line-clamp': '2' }, groupFocus: { color: '$ui.ink' } },
  { type: 'text', when: [{ test: 'person.role' }], text: '{person.role}', style: { 'font-size': '12px', color: '$ui.inkQuiet', 'text-align': 'center', 'line-clamp': '2' } },
];
const item = (interactive: boolean): Node => ({
  type: 'box', group: interactive,
  when: [{ test: 'person.canOpen', ...(interactive ? {} : { not: true }) }],
  ...(interactive ? { press: { action: 'person' as const, arg: '{person.name}' }, label: '{person.name}', hover: { scale: '1.04' }, controlStates: false } : {}),
  style: { display: 'flex', 'flex-direction': 'column', 'align-items': 'center', gap: '8px', width: '112px' },
  small: { width: '84px' }, children: contents,
});
export const castPerson: Node = { type: 'box', style: { padding: '6px', 'flex-shrink': '0' }, children: [item(true), item(false)] };

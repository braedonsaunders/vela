import type { BoxNode, Node } from '../../../../protocol/skin';
import { title } from './title';
import { titleGrid } from './cards';
import { display, focusRing, gutter, gutterSmall, placeholder, pulse } from './look';

const section = (label: string, count: string, over: string): Node => ({
  type: 'box', when: [{ test: count, is: 'gt', value: '0' }],
  style: { display: 'flex', 'flex-direction': 'column', gap: '24px' },
  children: [
    { type: 'text', role: 'heading', level: 2, text: label, style: { ...gutter, ...display, 'font-size': '28px' }, small: { ...gutterSmall, 'font-size': '22px' } },
    { ...titleGrid, id: 'vela-person-grid', children: [{ type: 'repeat', over, item: { type: 'use', template: 'velaPersonCard' } }] } as Node,
  ],
});
const hero: Node = {
  type: 'box', style: { display: 'flex', 'flex-direction': 'row', 'align-items': 'center', gap: '36px', ...gutter, 'padding-top': '76px' },
  small: { ...gutterSmall, gap: '18px', 'padding-top': '110px' },
  children: [
    { type: 'box', style: { position: 'relative', width: '240px', height: '240px', 'flex-shrink': '0', 'border-radius': '999px', 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'background-image': placeholder(135), display: 'flex', 'align-items': 'center', 'justify-content': 'center' }, small: { width: '132px', height: '132px' }, children: [
      { type: 'text', text: '{personPage.initials}', style: { ...display, 'font-size': '70px', color: '$ui.inkSecondary' }, small: { 'font-size': '40px' } },
      { type: 'image', when: [{ test: 'personPage.portrait' }], src: '{personPage.portrait}', alt: '', style: { position: 'absolute', inset: '0px', width: '100%', height: '100%', 'object-fit': 'cover' } },
    ] },
    { type: 'box', style: { display: 'flex', 'flex-direction': 'column', gap: '12px', 'min-width': '0px', 'flex-shrink': '1' }, children: [
      { type: 'text', text: '{personPage.name}', role: 'heading', level: 1, style: { ...display, 'font-size': '52px', color: '$ui.ink' }, small: { 'font-size': '30px' } },
      { type: 'text', when: [{ test: 'personPage.role' }], text: '{personPage.role}', style: { 'font-size': '18px', color: '$ui.inkSecondary' } },
      { type: 'text', when: [{ test: 'personPage.birthday' }], text: '{personPage.birthday}', style: { 'font-size': '16px', color: '$ui.inkSecondary' } },
    ] },
  ],
};
const content: Node[] = [hero,
  { type: 'text', when: [{ test: 'personPage.biography' }], text: '{personPage.biography}', style: { ...gutter, 'font-size': '17px', 'line-height': '1.55', 'line-clamp': '3', color: '$ui.inkSecondary' }, small: { ...gutterSmall, 'font-size': '15px' } },
  { type: 'box', when: [{ test: 'personPage.loading' }], style: { ...gutter }, children: [{ type: 'widget', widget: 'contentLoader', params: { inline: '{personPage.paging}' } }] },
  { type: 'text', when: [{ test: 'personPage.empty' }, { test: 'env.load', is: 'eq', value: 'ready' }], text: '{personPage.emptyText}', style: { ...gutter, color: '$ui.inkSecondary', 'font-size': '18px' } },
  section('{t:person.movies}', 'personPage.moviesCount', 'personPage.movies'),
  section('{t:person.tvShows}', 'personPage.tvCount', 'personPage.tv'),
  { type: 'box', when: [{ test: 'personPage.more' }], press: { action: 'personMore' }, label: '{t:library.loadMore}', style: { ...gutter, padding: '16px', 'align-self': 'center', color: '$ui.ink', 'border-radius': '$ui.radiusControl', 'background-color': '$ui.control' }, focus: { 'box-shadow': focusRing }, children: [{ type: 'text', text: '{t:library.loadMore}' }] },
  { type: 'box', when: [{ test: 'env.load', is: 'eq', value: 'failed' }], press: { action: 'retry' }, label: '{t:ui.tryAgain}', style: { ...gutter, padding: '16px', color: '$ui.ink' }, focus: { 'box-shadow': focusRing }, children: [{ type: 'text', text: '{t:person.failed}' }] },
];
// Keep the same fixed modal frame and close region as the shared title page.
const root = title as BoxNode;
const frame = root.children![0] as BoxNode;
const nav = frame.children![0] as BoxNode;
const scroll = frame.children![1] as BoxNode;
export function personContent(layout?: BoxNode): Node {
  const nodes = layout ? content.map(node => {
    if (node.type !== 'box' || !node.children) return node;
    return { ...node, children: node.children.map(child => child.type === 'box' && child.id === 'vela-person-grid'
      ? { ...child, style: layout.style, small: layout.small, wide: layout.wide } : child) } as Node;
  }) : content;
  return { ...scroll, children: nodes };
}
export const personRoute: Node = { ...root, children: [{ ...frame, children: [
  { ...nav, children: [{ type: 'use', template: 'velaPersonClose' }] },
  personContent(),
] }] };

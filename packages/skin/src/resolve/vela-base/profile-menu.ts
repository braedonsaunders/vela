// The profile menu's default look (renderer 22): compiled Cinematic's menu written on the document's
// ui tokens. Every look starts from these parts; a document replaces the ones it draws itself.
import type { Node, ProfileMenuLook, Style } from '../../../../protocol/skin';
import { eyebrow, navFocus } from './look';

// The viewer's badge, as shell.ts draws it (the renderer puts their avatar over the initial).
const badge = (size: number, fontSize: string): Node => ({
  type: 'text',
  text: '{env.viewerInitial}',
  style: {
    width: `${size}px`, height: `${size}px`, 'border-radius': `${size / 2}px`, 'flex-shrink': '0',
    display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'font-size': fontSize, 'font-weight': '650',
    color: '$ui.ink', 'background-image': 'linear-gradient(135deg, #c0703f 0%, #5b2a4a 100%)',
  },
});

// A row spans the panel's padding (its negative margin) so its wash meets the panel's inner edge less 10px.
const rowStyle: Style = {
  position: 'relative', display: 'flex', 'flex-direction': 'row', gap: '10px', 'align-items': 'center', 'min-height': '44px',
  'box-sizing': 'border-box', padding: '8px 10px', margin: '0px -10px', 'border-radius': '12px', 'font-size': '14px', color: '$ui.ink',
};

export const velaProfileMenu: ProfileMenuLook = {
  parts: {
    header: {
      type: 'box',
      style: { display: 'flex', 'flex-direction': 'row', gap: '12px', 'align-items': 'center' },
      children: [
        badge(40, '17px'),
        { type: 'text', text: '{entry.label}', style: { 'font-size': '16px', 'font-weight': '600', flex: '1', 'line-clamp': '1' } },
      ],
    },
    divider: { type: 'box', style: { height: '1px', 'flex-shrink': '0', 'background-color': '$ui.glassEdge' } },
    // A section: its heading and rows close together; the panel's gap parts the sections.
    group: { type: 'box', style: { display: 'flex', 'flex-direction': 'column', gap: '2px' } },
    section: {
      type: 'text',
      text: '{section.title}',
      role: 'heading',
      level: 2,
      style: { ...eyebrow, 'font-size': '12px', color: '$ui.inkQuiet', 'padding-top': '4px', 'padding-bottom': '4px' },
    },
    row: {
      type: 'box',
      style: rowStyle,
      hover: { 'background-color': '$ui.control' },
      focus: navFocus,
      children: [
        { type: 'icon', symbol: '{entry.icon}', style: { width: '16px', height: '16px', 'flex-shrink': '0' } },
        { type: 'text', text: '{entry.label}', style: { flex: '1', 'line-clamp': '1' } },
      ],
    },
    picker: {
      type: 'box',
      style: { ...rowStyle, 'justify-content': 'space-between', 'min-height': '56px' },
      hover: { 'background-color': '$ui.control' },
      focus: navFocus,
      children: [
        {
          type: 'box',
          style: { display: 'flex', 'flex-direction': 'column', gap: '2px', flex: '1', 'min-width': '0px' },
          children: [
            { type: 'text', text: '{entry.label}', style: { ...eyebrow, 'font-size': '12px', color: '$ui.inkQuiet' } },
            { type: 'text', when: [{ test: 'entry.detail' }], text: '{entry.detail}', style: { 'font-size': '14px', 'line-clamp': '1' } },
          ],
        },
        { type: 'icon', symbol: 'forward-chevron', style: { width: '12px', height: '12px', color: '$ui.inkQuiet' } },
      ],
    },
    // The server list, its rows' names at the menu rows' size.
    servers: { type: 'box', style: { display: 'flex', 'flex-direction': 'column', 'font-size': '14px' } },
    // The About line: a rule, then the stop alone, so on TV its focus ring goes round the text.
    about: {
      type: 'box',
      style: { 'padding-top': '14px', 'margin-top': '-4px',
        'border-style': 'solid', 'border-width': '0px', 'border-top-width': '1px', 'border-top-color': '$ui.glassEdge' },
      children: [{
        type: 'box',
        testId: '{entry.testId}',
        style: { 'border-radius': '6px' },
        children: [{ type: 'text', text: '{entry.label}', style: { 'font-size': '12px', 'line-height': '16px', color: '$ui.inkQuiet' } }],
      }],
    },
  },
};

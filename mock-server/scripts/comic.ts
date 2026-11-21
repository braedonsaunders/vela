// A short original wordless comic, "Captain Pebble and the Lighthouse Cat", drawn with the
// raster canvas: eight pages (a cover and seven pages of panels), rendered at 2× and downsampled.
import { Canvas, hex, type RGB } from './book-formats';

const ink = hex('#22222b'), paper = hex('#fbf6ea'), orange = hex('#f28c28'), navy = hex('#263a66'), red = hex('#c4372f');
const skin = hex('#f2c7a5'), white = hex('#ffffff'), lamp = hex('#ffe680'), rock = hex('#5d5a63');
interface Panel { c: Canvas; x: number; y: number; w: number; h: number }
const at = (p: Panel, fx: number, fy: number): [number, number] => [p.x + fx * p.w, p.y + fy * p.h];

function sky(p: Panel, top: string, bottom: string) { p.c.gradient(p.x, p.y, p.w, p.h, hex(top), hex(bottom)); }
function sea(p: Panel, level: number, colour: string, crest = '#9ad1d4', rough = 0) {
  const [x, y] = at(p, 0, level), c = p.c;
  c.rect(x, y, p.w, p.y + p.h - y, hex(colour));
  for (let i = 0; i < 9; i++) {
    const wy = y + (i + 1) * (p.y + p.h - y) / 10, amp = 4 + rough * 18;
    for (let k = 0; k < 7; k++) {
      const wx = p.x + ((k + (i % 2) * 0.5) / 7) * p.w;
      c.line(wx, wy, wx + p.w / 16, wy - amp, 4 + rough * 3, hex(crest), 0.5);
      c.line(wx + p.w / 16, wy - amp, wx + p.w / 8, wy, 4 + rough * 3, hex(crest), 0.5);
    }
  }
}
function sun(p: Panel, fx: number, fy: number, r: number, colour: string, glow = 0.25) {
  const [x, y] = at(p, fx, fy);
  p.c.circle(x, y, r * p.h * 1.8, hex(colour), glow); p.c.circle(x, y, r * p.h, hex(colour));
}
function stars(p: Panel, count: number, seed: number) {
  for (let i = 0; i < count; i++) { const [x, y] = at(p, ((i * 73 + seed * 31) % 97) / 97, ((i * 41 + seed * 17) % 89) / 89 * 0.5); p.c.circle(x, y, 2 + (i % 3), white, 0.9); }
}
function cloud(p: Panel, fx: number, fy: number, s: number, colour: string) {
  const [x, y] = at(p, fx, fy), u = s * p.h;
  for (const [dx, dy, r] of [[0, 0, 0.5], [0.45, -0.2, 0.6], [0.95, 0, 0.5], [0.45, 0.15, 0.55]] as const) p.c.circle(x + dx * u, y + dy * u, r * u, hex(colour));
}
function rocks(p: Panel, fx: number, fy: number, s: number) {
  const [x, y] = at(p, fx, fy), u = s * p.h;
  p.c.polygon([[x - u, y + u * 0.6], [x - u * 0.6, y - u * 0.3], [x, y - u * 0.5], [x + u * 0.7, y - u * 0.2], [x + u * 1.1, y + u * 0.6]], rock);
  p.c.polygon([[x - u * 0.6, y - u * 0.3], [x, y - u * 0.5], [x - u * 0.1, y - u * 0.1]], hex('#77737e'));
}
function lighthouse(p: Panel, fx: number, base: number, height: number, lit: boolean) {
  const c = p.c, [x, bottom] = at(p, fx, base), h = height * p.h, w = h * 0.22, top = bottom - h;
  const edge = (t: number) => w / 2 * (1 - 0.35 * t);
  c.polygon([[x - edge(0), bottom], [x - edge(1), top], [x + edge(1), top], [x + edge(0), bottom]], paper);
  for (let band = 0; band < 3; band++) {
    const t0 = 0.15 + band * 0.28, t1 = t0 + 0.12;
    c.polygon([[x - edge(t0), bottom - t0 * h], [x - edge(t1), bottom - t1 * h], [x + edge(t1), bottom - t1 * h], [x + edge(t0), bottom - t0 * h]], red);
  }
  c.rect(x - edge(1) - w * 0.12, top - w * 0.1, edge(1) * 2 + w * 0.24, w * 0.1, ink);
  if (lit) c.circle(x, top - w * 0.4, w * 1.6, lamp, 0.3);
  c.rect(x - edge(1) * 0.8, top - w * 0.7, edge(1) * 1.6, w * 0.6, lit ? lamp : hex('#4a4a55'));
  c.polygon([[x - edge(1), top - w * 0.7], [x, top - w * 1.15], [x + edge(1), top - w * 0.7]], red);
  c.rect(x - w * 0.12, bottom - h * 0.12, w * 0.24, h * 0.12, ink);
}
function beam(p: Panel, fx: number, fy: number, angle: number, length: number, spread = 0.18) {
  const [x, y] = at(p, fx, fy), l = length * p.w;
  p.c.polygon([[x, y], [x + Math.cos(angle - spread) * l, y + Math.sin(angle - spread) * l], [x + Math.cos(angle + spread) * l, y + Math.sin(angle + spread) * l]], lamp, 0.35);
}
function boat(p: Panel, fx: number, fy: number, s: number, sail = '#fbf6ea') {
  const [x, y] = at(p, fx, fy), u = s * p.h;
  p.c.polygon([[x - u, y], [x + u, y], [x + u * 0.7, y + u * 0.35], [x - u * 0.7, y + u * 0.35]], hex('#8a4b2a'));
  p.c.line(x, y, x, y - u * 1.4, u * 0.06, ink);
  p.c.polygon([[x + u * 0.05, y - u * 1.35], [x + u * 0.05, y - u * 0.15], [x + u * 0.8, y - u * 0.15]], hex(sail));
}
function ship(p: Panel, fx: number, fy: number, s: number, colour: string) {
  const [x, y] = at(p, fx, fy), u = s * p.h;
  p.c.polygon([[x - u * 1.6, y], [x + u * 1.6, y], [x + u * 1.2, y + u * 0.45], [x - u * 1.3, y + u * 0.45]], hex(colour));
  p.c.rect(x - u * 0.6, y - u * 0.5, u * 1.1, u * 0.5, hex(colour)); p.c.rect(x - u * 0.2, y - u * 0.95, u * 0.3, u * 0.45, hex(colour));
}
function pebble(p: Panel, fx: number, fy: number, s: number, mood: 'happy' | 'worried' = 'happy') {
  const [x, y] = at(p, fx, fy), u = s * p.h, c = p.c;
  c.ellipse(x, y, u * 0.55, u * 0.62, navy);
  c.rect(x - u * 0.08, y - u * 0.5, u * 0.16, u * 1.0, hex('#d9b44a'), 0.9);
  c.circle(x, y - u * 0.95, u * 0.42, skin);
  c.rect(x - u * 0.48, y - u * 1.3, u * 0.96, u * 0.12, ink);
  c.ellipse(x, y - u * 1.36, u * 0.36, u * 0.2, white);
  c.circle(x - u * 0.14, y - u * 0.98, u * 0.05, ink); c.circle(x + u * 0.14, y - u * 0.98, u * 0.05, ink);
  if (mood === 'happy') c.ellipse(x, y - u * 0.8, u * 0.12, u * 0.05, red);
  else c.rect(x - u * 0.1, y - u * 0.8, u * 0.2, u * 0.04, ink);
}
function cat(p: Panel, fx: number, fy: number, s: number, facing: 1 | -1 = 1) {
  const [x, y] = at(p, fx, fy), u = s * p.h, c = p.c, f = facing;
  c.line(x - f * u * 0.5, y, x - f * u * 0.95, y - u * 0.5, u * 0.14, orange);
  c.ellipse(x, y, u * 0.55, u * 0.38, orange);
  const hx = x + f * u * 0.45, hy = y - u * 0.42;
  c.polygon([[hx - u * 0.3, hy - u * 0.1], [hx - u * 0.22, hy - u * 0.5], [hx - u * 0.02, hy - u * 0.22]], orange);
  c.polygon([[hx + u * 0.3, hy - u * 0.1], [hx + u * 0.22, hy - u * 0.5], [hx + u * 0.02, hy - u * 0.22]], orange);
  c.circle(hx, hy, u * 0.32, orange);
  for (const dx of [-0.11, 0.11]) c.ellipse(hx + dx * u, hy - u * 0.03, u * 0.05, u * 0.08, ink);
  c.polygon([[hx - u * 0.04, hy + u * 0.08], [hx + u * 0.04, hy + u * 0.08], [hx, hy + u * 0.13]], hex('#e46a6a'));
  for (const dx of [-0.25, 0.15]) c.rect(x + dx * u, y + u * 0.2, u * 0.12, u * 0.22, orange);
}
function bubble(p: Panel, fx: number, fy: number, s: number, symbol: string, tailX: number, tailY: number) {
  const [x, y] = at(p, fx, fy), u = s * p.h, [tx, ty] = at(p, tailX, tailY);
  p.c.polygon([[x - u * 0.15, y + u * 0.3], [x + u * 0.15, y + u * 0.3], [tx, ty]], ink);
  p.c.ellipse(x, y, u * 0.62, u * 0.47, ink); p.c.ellipse(x, y, u * 0.56, u * 0.41, white);
  p.c.polygon([[x - u * 0.1, y + u * 0.3], [x + u * 0.1, y + u * 0.3], [tx + (x - tx) * 0.15, ty + (y - ty) * 0.15]], white);
  if (symbol === 'heart') {
    p.c.circle(x - u * 0.12, y - u * 0.06, u * 0.15, red); p.c.circle(x + u * 0.12, y - u * 0.06, u * 0.15, red);
    p.c.polygon([[x - u * 0.26, y], [x + u * 0.26, y], [x, y + u * 0.27]], red);
  } else {
    const scale = Math.max(2, Math.round(u * 0.08));
    p.c.text(symbol, x - p.c.textWidth(symbol, scale) / 2, y - scale * 3.5, scale, ink);
  }
}
function rain(p: Panel, count: number) {
  for (let i = 0; i < count; i++) { const [x, y] = at(p, ((i * 53) % 101) / 101, ((i * 37) % 89) / 89); p.c.line(x, y, x - p.w * 0.03, y + p.h * 0.08, 3, hex('#cfd8e8'), 0.6); }
}
function caption(p: Panel, text: string, scale: number) {
  const w = p.c.textWidth(text, scale);
  p.c.rect(p.x + 16, p.y + 16, w + 32, scale * 7 + 28, hex('#ffe14d')); p.c.frame(p.x + 16, p.y + 16, w + 32, scale * 7 + 28, 4, ink);
  p.c.text(text, p.x + 32, p.y + 30, scale, ink);
}

type Draw = (p: Panel) => void;
const scenes: Draw[][] = [
  [ // 2. Arrival
    p => { sky(p, '#8ecae6', '#e0f1f7'); sun(p, 0.82, 0.25, 0.1, '#ffd166'); cloud(p, 0.12, 0.22, 0.12, '#ffffff'); sea(p, 0.62, '#2f6fa3'); lighthouse(p, 0.75, 0.64, 0.42, false); rocks(p, 0.75, 0.66, 0.1); boat(p, 0.25, 0.7, 0.12); caption(p, 'ONE BRIGHT MORNING', 5); },
    p => { sky(p, '#a8dadc', '#f1faee'); sea(p, 0.72, '#2f6fa3'); boat(p, 0.5, 0.78, 0.22); pebble(p, 0.45, 0.62, 0.16); bubble(p, 0.75, 0.25, 0.2, '!', 0.5, 0.42); },
    p => { sky(p, '#8ecae6', '#e0f1f7'); sea(p, 0.7, '#2f6fa3'); rocks(p, 0.55, 0.72, 0.2); lighthouse(p, 0.55, 0.7, 0.6, false); boat(p, 0.2, 0.78, 0.1); pebble(p, 0.36, 0.68, 0.08); },
  ],
  [ // 3. The cat
    p => { sky(p, '#bde0fe', '#fefae0'); sea(p, 0.68, '#3a86b4'); rocks(p, 0.7, 0.75, 0.22); cat(p, 0.68, 0.56, 0.18, -1); bubble(p, 0.4, 0.25, 0.18, '?', 0.6, 0.45); },
    p => { sky(p, '#bde0fe', '#fefae0'); sea(p, 0.75, '#3a86b4'); pebble(p, 0.35, 0.62, 0.2); const [x, y] = at(p, 0.62, 0.5); p.c.ellipse(x, y, p.h * 0.08, p.h * 0.035, hex('#9fb7c9')); p.c.polygon([[x + p.h * 0.07, y], [x + p.h * 0.12, y - p.h * 0.04], [x + p.h * 0.12, y + p.h * 0.04]], hex('#9fb7c9')); },
    p => { sky(p, '#ffd6a5', '#fefae0'); sea(p, 0.7, '#3a86b4'); rocks(p, 0.5, 0.78, 0.25); pebble(p, 0.38, 0.62, 0.14); cat(p, 0.62, 0.66, 0.13, -1); bubble(p, 0.5, 0.22, 0.16, 'heart', 0.5, 0.42); },
  ],
  [ // 4. Up the stairs
    p => { p.c.gradient(p.x, p.y, p.w, p.h, hex('#cfc6b8'), hex('#9c9283')); for (let i = 0; i < 9; i++) { const [x, y] = at(p, 0.1 + i * 0.09, 0.9 - i * 0.09); p.c.rect(x, y, p.w * 0.14, p.h * 0.04, hex('#6b6259')); } pebble(p, 0.42, 0.52, 0.1); cat(p, 0.62, 0.36, 0.08); caption(p, 'UP AND UP', 5); },
    p => { sky(p, '#264653', '#2a9d8f'); p.c.rect(p.x, p.y + p.h * 0.62, p.w, p.h * 0.38, hex('#3d3d46')); const [x, y] = at(p, 0.5, 0.42); p.c.circle(x, y, p.h * 0.2, hex('#8d8d99')); p.c.circle(x, y, p.h * 0.12, hex('#b5b5c2')); pebble(p, 0.2, 0.7, 0.12); cat(p, 0.8, 0.74, 0.1, -1); },
  ],
  [ // 5. The storm
    p => { sky(p, '#2b2d42', '#5c677d'); cloud(p, 0.1, 0.2, 0.16, '#3c3f58'); cloud(p, 0.55, 0.15, 0.2, '#454a66'); sea(p, 0.6, '#1d3557', '#a8dadc', 1); rain(p, 60); caption(p, 'THAT NIGHT', 5); },
    p => { sky(p, '#22223b', '#4a4e69'); sea(p, 0.72, '#1d3557', '#a8dadc', 1); rocks(p, 0.5, 0.75, 0.2); lighthouse(p, 0.5, 0.73, 0.62, false); rain(p, 50); bubble(p, 0.8, 0.22, 0.16, '!', 0.55, 0.2); },
    p => { sky(p, '#22223b', '#4a4e69'); sea(p, 0.6, '#1d3557', '#a8dadc', 1); ship(p, 0.5, 0.58, 0.1, '#111118'); rain(p, 50); },
  ],
  [ // 6. The lamp
    p => { p.c.rect(p.x, p.y, p.w, p.h, hex('#2b2b36')); const [x, y] = at(p, 0.5, 0.4); p.c.circle(x, y, p.h * 0.22, hex('#55555f')); pebble(p, 0.25, 0.75, 0.16, 'worried'); bubble(p, 0.25, 0.22, 0.16, '?', 0.28, 0.45); },
    p => { p.c.rect(p.x, p.y, p.w, p.h, hex('#2b2b36')); const [x, y] = at(p, 0.6, 0.55); p.c.rect(x - 6, y - p.h * 0.3, 12, p.h * 0.3, hex('#999')); p.c.circle(x, y - p.h * 0.3, p.h * 0.04, red); cat(p, 0.42, 0.7, 0.2); },
    p => { p.c.rect(p.x, p.y, p.w, p.h, hex('#3a3220')); const [x, y] = at(p, 0.5, 0.42); p.c.circle(x, y, p.h * 0.45, lamp, 0.25); p.c.circle(x, y, p.h * 0.22, lamp); pebble(p, 0.2, 0.78, 0.13); cat(p, 0.8, 0.82, 0.1, -1); bubble(p, 0.82, 0.22, 0.14, '!', 0.8, 0.6); },
  ],
  [ // 7. The beam
    p => { sky(p, '#0b132b', '#1c2541'); stars(p, 30, 7); sea(p, 0.68, '#0b2545', '#5c7aa8'); lighthouse(p, 0.15, 0.7, 0.55, true); beam(p, 0.15, 0.32, 0.12, 1.1); ship(p, 0.78, 0.66, 0.06, '#c9c9d6'); caption(p, 'THE LIGHT', 5); },
    p => { sky(p, '#0b132b', '#1c2541'); stars(p, 20, 3); sea(p, 0.6, '#0b2545', '#5c7aa8'); ship(p, 0.5, 0.58, 0.11, '#e0e0ea'); beam(p, -0.1, 0.3, 0.25, 1.3, 0.25); },
    p => { sky(p, '#0b132b', '#3a506b'); stars(p, 40, 11); sea(p, 0.7, '#0b2545', '#5c7aa8'); rocks(p, 0.5, 0.74, 0.18); lighthouse(p, 0.5, 0.72, 0.55, true); beam(p, 0.5, 0.33, Math.PI + 0.25, 0.7); beam(p, 0.5, 0.33, -0.2, 0.7); },
  ],
  [ // 8. Morning
    p => { sky(p, '#ffb4a2', '#ffe5d9'); sun(p, 0.5, 0.62, 0.14, '#ffd166', 0.3); sea(p, 0.62, '#4d7ea8', '#ffd6a5'); ship(p, 0.82, 0.6, 0.05, '#5c5470'); caption(p, 'MORNING', 5); },
    p => { sky(p, '#ffcdb2', '#fff1e6'); p.c.rect(p.x, p.y + p.h * 0.7, p.w, p.h * 0.06, ink); pebble(p, 0.36, 0.6, 0.16); cat(p, 0.64, 0.64, 0.14, -1); bubble(p, 0.5, 0.2, 0.16, 'heart', 0.5, 0.4); },
    p => { p.c.rect(p.x, p.y, p.w, p.h, paper); const text = 'THE END', scale = Math.floor(Math.min(p.h / 14, p.w * 0.8 / (text.length * 6))); p.c.text(text, p.x + (p.w - p.c.textWidth(text, scale)) / 2, p.y + p.h / 2 - scale * 3.5, scale, ink); },
  ],
];
const layouts: [number, number, number, number][][] = [
  [[0, 0, 1, 0.42], [0, 0.42, 0.5, 0.58], [0.5, 0.42, 0.5, 0.58]],
  [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 1, 0.5]],
  [[0, 0, 1, 0.55], [0, 0.55, 1, 0.45]],
];

/** Eight PNG pages, `width`×1.5·`width`, drawn at 2× and downsampled. */
export function comicPages(width: number, title: [string, string], credit: string): Uint8Array[] {
  const W = width * 2, H = width * 3, gutter = W * 0.025, margin = W * 0.04;
  const pages: Uint8Array[] = [];
  { // Cover
    const c = new Canvas(W, H, paper), p: Panel = { c, x: 0, y: 0, w: W, h: H };
    sky(p, '#1f3b73', '#f6c065'); stars(p, 30, 5); sea(p, 0.78, '#203a5c', '#9ad1d4');
    lighthouse(p, 0.68, 0.8, 0.5, true); beam(p, 0.68, 0.36, Math.PI + 0.12, 0.9, 0.12); beam(p, 0.68, 0.36, -0.12, 0.5, 0.12);
    rocks(p, 0.6, 0.82, 0.08); c.rect(W * 0.08, H * 0.875, W * 0.42, H * 0.018, hex('#8a4b2a')); for (const fx of [0.1, 0.28, 0.46]) c.rect(W * fx, H * 0.875, W * 0.015, H * 0.08, hex('#5e321c'));
    pebble(p, 0.22, 0.875, 0.07); cat(p, 0.38, 0.86, 0.05);
    const fitScale = (text: string, max: number) => Math.min(max, Math.floor((W - margin * 2 - 80) / (text.length * 6)));
    const big = fitScale(title[0], Math.round(W / 70)), small = fitScale(title[1], Math.round(W / 130));
    c.rect(margin, margin, W - margin * 2, big * 7 + small * 7 + big * 5, hex('#ffe14d')); c.frame(margin, margin, W - margin * 2, big * 7 + small * 7 + big * 5, 8, ink);
    c.text(title[0], (W - c.textWidth(title[0], big)) / 2, margin + big * 2, big, ink);
    c.text(title[1], (W - c.textWidth(title[1], small)) / 2, margin + big * 10, small, ink);
    const s = Math.round(W / 220); c.rect(0, H - s * 16, W, s * 16, ink); c.text(credit, (W - c.textWidth(credit, s)) / 2, H - s * 11.5, s, hex('#ffe14d'));
    pages.push(c.downsample(2).png());
  }
  scenes.forEach((panels, index) => {
    const c = new Canvas(W, H, paper), layout = layouts[index % layouts.length]!.length === panels.length ? layouts[index % layouts.length]! : layouts.find(l => l.length === panels.length)!;
    const innerW = W - margin * 2, innerH = H - margin * 2 - W * 0.04;
    panels.forEach((draw, n) => {
      const [fx, fy, fw, fh] = layout[n]!;
      const panel: Panel = { c, x: margin + fx * innerW + gutter / 2, y: margin + fy * innerH + gutter / 2, w: fw * innerW - gutter, h: fh * innerH - gutter };
      c.clip = [Math.round(panel.x), Math.round(panel.y), Math.round(panel.w), Math.round(panel.h)];
      draw(panel);
      c.clip = [0, 0, W, H];
      c.frame(panel.x, panel.y, panel.w, panel.h, 7, ink);
    });
    const s = Math.round(W / 260), number = String(index + 2);
    c.text(number, (W - c.textWidth(number, s)) / 2, H - margin - s * 4, s, ink);
    pages.push(c.downsample(2).png());
  });
  return pages;
}

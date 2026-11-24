// Original procedural SVG covers for the music, book, audiobook and podcast fixtures: album art,
// cloth-bound book covers, audiobook and podcast covers and abstract artist/author portraits.
// No external images or font files; system font stacks only.
import { coverVariant, mediaPerson, mediaSeed, mediaTitle, paletteFor, type CoverPalette } from '../packages/protocol/fixtures/media';
import type { Title } from '../packages/protocol/types';

const SANS = `'Helvetica Neue', Helvetica, Arial, sans-serif`;
const SERIF = `Georgia, 'Times New Roman', serif`;
const DISPLAY = `'Didot', 'Bodoni 72', 'Bodoni MT', Georgia, serif`;
const CONDENSED = `'Avenir Next Condensed', 'Arial Narrow', 'Helvetica Neue', sans-serif`;

const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function random(seed: number) {
  let state = seed | 0;
  return () => { state = state + 0x6d2b79f5 | 0; let t = Math.imul(state ^ state >>> 15, 1 | state); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function mix(hex: string, toward: string, amount: number): string {
  const parse = (value: string) => [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16));
  const [a, b] = [parse(hex), parse(toward)];
  return `#${a.map((v, i) => Math.round(v + (b[i]! - v) * amount).toString(16).padStart(2, '0')).join('')}`;
}
const darken = (hex: string, amount: number) => mix(hex, '#000000', amount);
const lighten = (hex: string, amount: number) => mix(hex, '#ffffff', amount);
const luminance = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).reduce((sum, v, i) => sum + v * [0.299, 0.587, 0.114][i]!, 0) / 255;
/** Greedy word wrap to at most `max` characters a line. */
function wrap(text: string, max: number): string[] {
  const lines: string[] = [];
  for (const word of text.split(/\s+/)) {
    const last = lines[lines.length - 1];
    if (last !== undefined && (last + ' ' + word).length <= max) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}
/** A font size that fits the longest line in `width` (average glyph width ≈ ratio × size). */
const fit = (lines: string[], width: number, max: number, ratio = 0.56) => Math.min(max, Math.floor(width / (Math.max(...lines.map(line => line.length)) * ratio)));
const roman = (n: number) => ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n] ?? String(n);
const grain = (id: string, opacity: number, size: number, height = size) =>
  `<filter id="${id}"><feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="${size}" height="${height}" filter="url(#${id})" opacity="${opacity}"/>`;
function textLines(lines: string[], x: number, y: number, size: number, lineHeight: number, attrs: string): string {
  return lines.map((line, i) => `<text x="${x}" y="${(y + i * size * lineHeight).toFixed(1)}" font-size="${size}" ${attrs}>${esc(line)}</text>`).join('');
}
const svg = (width: number, w: number, h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${Math.round(width * h / w)}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

// ---------------------------------------------------------------------------------------------
// Albums (1000 × 1000)
function albumCover(name: string, artist: string, seed: number, variant: number, p: CoverPalette): string {
  const r = random(seed), style = variant % 6, [a0, a1, a2] = p.accents;
  const caps = `font-family="${SANS}" letter-spacing="6" font-weight="500"`;
  if (style === 0) { // Bauhaus tiles
    const colours = [a0, a1, a2, p.ink];
    const tiles = Array.from({ length: 12 }, (_, n) => {
      const x = 60 + (n % 4) * 220, y = 60 + Math.floor(n / 4) * 220, c = colours[Math.floor(r() * 4)]!, d = colours[Math.floor(r() * 4)]!;
      const rot = Math.floor(r() * 4) * 90, t = Math.floor(r() * 7), cx = x + 110, cy = y + 110;
      const shape = [
        `<circle cx="${cx}" cy="${cy}" r="100" fill="${c}"/>`,
        `<path d="M${x} ${cy}A110 110 0 0 1 ${x + 220} ${cy}Z" fill="${c}"/>`,
        `<path d="M${x} ${y}H${x + 220}A220 220 0 0 1 ${x} ${y + 220}Z" fill="${c}"/>`,
        `<rect x="${x}" y="${y}" width="220" height="220" fill="${c}"/><circle cx="${cx}" cy="${cy}" r="60" fill="${p.bg}"/>`,
        `<path d="M${x} ${y + 220}L${cx} ${y}L${x + 220} ${y + 220}Z" fill="${c}"/>`,
        [0, 1, 2, 3].map(i => `<rect x="${x}" y="${y + 12 + i * 55}" width="220" height="26" fill="${c}"/>`).join(''),
        `<circle cx="${cx}" cy="${cy}" r="86" fill="none" stroke="${c}" stroke-width="34"/><circle cx="${cx}" cy="${cy}" r="24" fill="${d}"/>`,
      ][t];
      return `<g transform="rotate(${rot} ${cx} ${cy})">${shape}</g>`;
    }).join('');
    const lines = wrap(name.toUpperCase(), 18), size = fit(lines, 880, 76, 0.66);
    return `<rect width="1000" height="1000" fill="${p.bg}"/>${tiles}<text x="60" y="772" font-size="26" fill="${p.ink}" ${caps} opacity=".8">${esc(artist.toUpperCase())}</text>${textLines(lines, 60, 772 + size + 12, size, 1.02, `font-family="${SANS}" font-weight="800" fill="${p.ink}" letter-spacing="-1"`)}${grain('g', 0.07, 1000)}`;
  }
  if (style === 1) { // Gradient orb over still water
    const cx = 380 + r() * 240, horizon = 640;
    const ripples = Array.from({ length: 12 }, (_, i) => `<rect x="${cx - 260 + i * 12 + r() * 40}" y="${horizon + 20 + i * 26}" width="${520 - i * 30 - r() * 60}" height="${5 - i * 0.3}" fill="${a0}" opacity="${0.55 - i * 0.04}"/>`).join('');
    return `<defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="${darken(p.bg, luminance(p.bg) > 0.6 ? 0.05 : 0.2)}"/><stop offset="1" stop-color="${mix(p.bg, a2, 0.35)}"/></linearGradient><radialGradient id="orb" cx=".38" cy=".32" r=".8"><stop stop-color="${lighten(a0, 0.25)}"/><stop offset=".55" stop-color="${a0}"/><stop offset="1" stop-color="${a1}"/></radialGradient></defs>
<rect width="1000" height="1000" fill="url(#sky)"/><circle cx="${cx}" cy="${horizon - 40}" r="260" fill="url(#orb)"/><rect y="${horizon}" width="1000" height="${1000 - horizon}" fill="${darken(p.bg, 0.55)}" opacity=".92"/>${ripples}
<text x="500" y="150" text-anchor="middle" font-size="${Math.min(56, Math.floor(880 / (name.length * 0.9)))}" font-family="${SANS}" font-weight="300" letter-spacing="${Math.min(14, Math.floor(880 / (name.length * 0.9)) * 0.25)}" fill="${p.ink}">${esc(name.toUpperCase())}</text><text x="500" y="930" text-anchor="middle" font-size="24" ${caps} fill="${lighten(a0, 0.3)}">${esc(artist.toUpperCase())}</text>${grain('g', 0.09, 1000)}`;
  }
  if (style === 2) { // Concentric rings
    const cx = 300 + r() * 400, cy = 260 + r() * 300, colours = [a0, a1, a2, p.ink];
    const rings = Array.from({ length: 12 }, (_, i) => `<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${60 + i * 64}" fill="none" stroke="${colours[(i + seed) % 4]}" stroke-width="${22 + (i * 7 + seed) % 26}" opacity="${i % 3 === 2 ? 0.55 : 1}"/>`).join('');
    const lines = wrap(name, 16), size = fit(lines, 820, 92, 0.6);
    return `<rect width="1000" height="1000" fill="${p.bg}"/>${rings}<rect x="0" y="${940 - lines.length * size * 1.02 - 70}" width="1000" height="${lines.length * size * 1.02 + 130}" fill="${p.bg}" opacity=".9"/>${textLines(lines, 940, 960 - (lines.length - 1) * size * 1.02 - 50, size, 1.02, `text-anchor="end" font-family="${SANS}" font-weight="800" fill="${p.ink}" letter-spacing="-2"`)}<text x="940" y="${940 - lines.length * size * 1.02 - 26}" text-anchor="end" font-size="24" ${caps} fill="${a0}">${esc(artist.toUpperCase())}</text>`;
  }
  if (style === 3) { // Striped sun
    const gaps = Array.from({ length: 7 }, (_, i) => `<rect x="0" y="${540 + i * 30 + i * i * 2}" width="1000" height="${4 + i * 3}" fill="url(#sky)"/>`).join('');
    const lines = wrap(name.toUpperCase(), 14), size = fit(lines, 860, 110, 0.5);
    return `<defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="${p.bg}"/><stop offset="1" stop-color="${mix(p.bg, a2, 0.5)}"/></linearGradient><linearGradient id="sun" x2="0" y2="1"><stop stop-color="${a2}"/><stop offset=".5" stop-color="${a0}"/><stop offset="1" stop-color="${a1}"/></linearGradient></defs>
<rect width="1000" height="1000" fill="url(#sky)"/><circle cx="500" cy="560" r="250" fill="url(#sun)"/>${gaps}<rect y="740" width="1000" height="260" fill="${darken(p.bg, 0.6)}"/>${Array.from({ length: 6 }, (_, i) => `<rect x="${380 - i * 10 + r() * 30}" y="${762 + i * 30}" width="${240 - i * 20}" height="6" fill="${a0}" opacity="${0.7 - i * 0.1}"/>`).join('')}
${textLines(lines, 500, 70 + size, size, 0.95, `text-anchor="middle" font-family="${CONDENSED}" font-weight="700" font-style="italic" fill="${p.ink}"`)}<text x="500" y="955" text-anchor="middle" font-size="24" ${caps} fill="${a0}">${esc(artist.toUpperCase())}</text>${grain('g', 0.06, 1000)}`;
  }
  if (style === 4) { // Flowing lines
    const lines = Array.from({ length: 34 }, (_, i) => {
      const y = 140 + i * 24, amp = 40 + 60 * Math.sin(i / 5 + seed % 7), phase = r() * 120;
      return `<path d="M-20 ${y}C${200 + phase} ${y - amp} ${420 - phase} ${y + amp} 600 ${y}S${900 + phase / 2} ${y - amp * 0.6} 1020 ${y + 10}" fill="none" stroke="${i % 2 ? a0 : a1}" stroke-width="${2.5 + (i % 5) * 0.6}" opacity="${0.35 + 0.6 * Math.abs(Math.sin(i / 6))}"/>`;
    }).join('');
    const title = wrap(name, 12), size = fit(title, 700, 96, 0.58);
    return `<rect width="1000" height="1000" fill="${darken(p.bg, luminance(p.bg) > 0.6 ? 0.75 : 0.25)}"/>${lines}<rect x="60" y="60" width="${Math.max(...title.map(line => line.length)) * size * 0.58 + 60}" height="${title.length * size * 1.05 + 90}" fill="${p.bg}"/>${textLines(title, 90, 80 + size, size, 1.05, `font-family="${SERIF}" font-style="italic" fill="${p.ink}"`)}<text x="90" y="${100 + title.length * size * 1.05 + 14}" font-size="22" ${caps} fill="${a0}">${esc(artist.toUpperCase())}</text>`;
  }
  // Swiss type
  const words = name.toUpperCase().split(/\s+/), size = fit(words, 880, 200, 0.64);
  return `<rect width="1000" height="1000" fill="${p.bg}"/><rect x="140" y="160" width="720" height="440" fill="${a0}" transform="rotate(-8 500 380)"/><circle cx="${600 + r() * 100}" cy="${260 + r() * 80}" r="150" fill="${a1}" opacity=".92"/><path d="M60 ${880 - words.length * size * 0.86}H940" stroke="${p.ink}" stroke-width="3"/>
${textLines(words, 60, 940 - (words.length - 1) * size * 0.86, size, 0.86, `font-family="${SANS}" font-weight="900" fill="${p.ink}" letter-spacing="-4"`)}<text transform="translate(950 60) rotate(90)" font-size="24" ${caps} fill="${p.ink}">${esc(artist.toUpperCase())}</text>${grain('g', 0.05, 1000)}`;
}

// ---------------------------------------------------------------------------------------------
// Books (600 × 900)
const fleuron = (x: number, y: number, c: string) => `<g transform="translate(${x} ${y})" fill="${c}"><path d="M0 -26L14 0L0 26L-14 0Z"/><circle cx="-34" cy="0" r="6"/><circle cx="34" cy="0" r="6"/><path d="M-20 -4C-48 -30 -84 -18 -96 0C-84 18 -48 30 -20 4Z" opacity=".85"/><path d="M20 -4C48 -30 84 -18 96 0C84 18 48 30 20 4Z" opacity=".85"/><path d="M-140 0H-104M104 0H140" stroke="${c}" stroke-width="2"/></g>`;
const bird = (x: number, y: number, c: string) => `<g transform="translate(${x} ${y})" fill="${c}"><ellipse cx="0" cy="0" rx="58" ry="30"/><circle cx="52" cy="-22" r="20"/><path d="M70 -26L98 -20L70 -14Z"/><path d="M-50 -6L-110 -34L-96 0L-110 30Z"/><path d="M-20 -10C0 -70 40 -76 54 -64C30 -48 14 -24 10 -6Z" opacity=".75"/><circle cx="58" cy="-26" r="3.5" fill="#fff"/><path d="M-8 28L-14 56M10 28L8 56" stroke="${c}" stroke-width="4"/></g>`;
const cloth = (p: CoverPalette, seed: number) => `<filter id="cloth"><feTurbulence type="fractalNoise" baseFrequency=".9 .05" numOctaves="2" seed="${seed % 97}"/><feColorMatrix type="saturate" values="0"/></filter><filter id="weave"><feTurbulence type="fractalNoise" baseFrequency=".05 .9" numOctaves="2" seed="${(seed >> 3) % 97}"/><feColorMatrix type="saturate" values="0"/></filter>
<rect width="600" height="900" fill="${p.bg}"/><rect width="600" height="900" filter="url(#cloth)" opacity=".12"/><rect width="600" height="900" filter="url(#weave)" opacity=".08"/>`;
const hinge = `<defs><linearGradient id="hinge"><stop stop-color="#000" stop-opacity=".35"/><stop offset=".05" stop-color="#fff" stop-opacity=".08"/><stop offset=".08" stop-color="#000" stop-opacity=".12"/><stop offset=".2" stop-color="#000" stop-opacity="0"/></linearGradient></defs>`;
function bookCover(title: Title, seed: number, p: CoverPalette): string {
  const author = title.media?.credits?.find(credit => credit.role === 'author')?.name ?? '';
  const role = title.media?.role, format = title.media?.reading?.format;
  const parent = title.media?.parents?.[0];
  const kicker = role === 'series' ? `A series in ${['', 'one', 'two', 'three', 'four', 'five'][title.media?.childCount ?? 0] ?? title.media?.childCount} books` : parent ? `${parent.name.replace(/^The /, '')} · ${roman(title.media?.index ?? 0)}` : format === 'pdf' ? 'An illustrated guide' : '';
  const [a0, a1, a2] = p.accents, style = role === 'series' ? 0 : format === 'cbz' ? 3 : format === 'pdf' ? 0 : Math.round(coverVariant(title.id) / 7) % 3;
  const lines = wrap(title.name, style === 1 ? 13 : 15);
  if (style === 3) return comicCover(title.name, author, seed, p);
  const shade = `<rect width="600" height="900" fill="url(#hinge)"/>`;
  if (style === 0) { // Cloth-bound classic
    const gold = luminance(p.bg) > 0.55 ? darken(a0, 0.1) : lighten(a0, 0.15);
    const size = fit(lines, 460, 62, 0.5), top = 250;
    const stack = role === 'series' ? Array.from({ length: title.media?.childCount ?? 3 }, (_, i) => `<rect x="${226 + i * 52}" y="${648 - i * 4}" width="40" height="${96 + i * 4}" rx="3" fill="${[a0, a1, a2][i % 3]}" stroke="${gold}" stroke-width="1.5"/><path d="M${232 + i * 52} ${668 - i * 4}h28M${232 + i * 52} ${720}h28" stroke="${gold}" stroke-width="2"/>`).join('') : '';
    return `${hinge}${cloth(p, seed)}<rect x="36" y="36" width="528" height="828" fill="none" stroke="${gold}" stroke-width="3"/><rect x="48" y="48" width="504" height="804" fill="none" stroke="${gold}" stroke-width="1"/>${[[48, 48], [552, 48], [48, 852], [552, 852]].map(([x, y]) => `<path d="M${x} ${y! - 9}L${x! + 9} ${y}L${x} ${y! + 9}L${x! - 9} ${y}Z" fill="${gold}"/>`).join('')}
${kicker ? `<text x="300" y="168" text-anchor="middle" font-size="17" font-family="${SERIF}" letter-spacing="4" fill="${gold}">${esc(kicker.toUpperCase())}</text>` : ''}${textLines(lines, 300, top + size * 0.7, size, 1.14, `text-anchor="middle" font-family="${DISPLAY}" fill="${p.ink}"`)}
${role === 'series' ? stack : format === 'pdf' ? bird(300, 600, gold) : fleuron(300, Math.max(560, top + lines.length * size * 1.14 + 90), gold)}<text x="300" y="800" text-anchor="middle" font-size="24" font-family="${SERIF}" letter-spacing="6" fill="${p.ink}">${esc(author.toUpperCase())}</text>${shade}`;
  }
  if (style === 1) { // Modern block
    const r = random(seed), size = fit(lines, 500, 60, 0.6), block = 500;
    const art = `<rect width="600" height="${block}" fill="${a0}"/><circle cx="${380 + r() * 120}" cy="${180 + r() * 120}" r="${150 + r() * 60}" fill="${a1}"/><circle cx="${120 + r() * 120}" cy="${340 + r() * 60}" r="56" fill="${p.ink}" opacity=".9"/><path d="M0 ${block - 120}L600 ${block - 260}" stroke="${p.bg}" stroke-width="10"/><rect width="600" height="${block}" filter="url(#cloth)" opacity=".1"/>`;
    return `${hinge}${cloth(p, seed)}${art}${kicker ? `<text x="48" y="${block + 50}" font-size="16" font-family="${SANS}" letter-spacing="3" fill="${a0}">${esc(kicker.toUpperCase())}</text>` : ''}${textLines(lines, 48, block + 70 + size, size, 1.04, `font-family="${SANS}" font-weight="800" fill="${p.ink}" letter-spacing="-1"`)}<text x="48" y="850" font-size="22" font-family="${SANS}" letter-spacing="5" fill="${p.ink}" opacity=".8">${esc(author.toUpperCase())}</text>${shade}`;
  }
  // Three bands
  const cream = luminance(p.bg) > 0.6 ? p.bg : '#f2e8d5', ink = luminance(p.bg) > 0.6 ? p.ink : '#2a2420';
  const size = fit(lines, 470, 56, 0.5);
  return `${hinge}<filter id="cloth"><feTurbulence type="fractalNoise" baseFrequency=".9 .05" numOctaves="2" seed="${seed % 97}"/><feColorMatrix type="saturate" values="0"/></filter><rect width="600" height="900" fill="${cream}"/><rect width="600" height="230" fill="${a0}"/><rect y="680" width="600" height="220" fill="${a0}"/><rect width="600" height="900" filter="url(#cloth)" opacity=".1"/>
<text x="300" y="130" text-anchor="middle" font-size="18" font-family="${SANS}" letter-spacing="5" fill="${cream}">${esc((kicker || title.genres[0] || '').toUpperCase())}</text>${textLines(lines, 300, 455 - (lines.length - 1) * size * 0.6, size, 1.15, `text-anchor="middle" font-family="${SERIF}" font-style="italic" fill="${ink}"`)}<path d="M250 ${470 + lines.length * size * 0.6}H350" stroke="${a1}" stroke-width="3"/>
<text x="300" y="800" text-anchor="middle" font-size="24" font-family="${SANS}" letter-spacing="6" fill="${cream}">${esc(author.toUpperCase())}</text>${shade}`;
}
function comicCover(name: string, author: string, seed: number, p: CoverPalette): string {
  const words = wrap(name.toUpperCase(), 12), size = fit(words, 520, 70, 0.62);
  return `<defs><pattern id="dots" width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="9" cy="9" r="4" fill="#ffffff" opacity=".18"/></pattern><linearGradient id="dusk" x2="0" y2="1"><stop stop-color="#1f3b73"/><stop offset=".7" stop-color="#e0765a"/><stop offset="1" stop-color="#f6c065"/></linearGradient><radialGradient id="lamp"><stop stop-color="#fff3b0"/><stop offset="1" stop-color="#fff3b0" stop-opacity="0"/></radialGradient></defs>
<rect width="600" height="900" fill="url(#dusk)"/><rect width="600" height="900" fill="url(#dots)"/><path d="M372 318L0 230V430Z M388 318L600 250V420Z" fill="#fff3b0" opacity=".28"/><circle cx="380" cy="318" r="90" fill="url(#lamp)"/>
<path d="M330 760L350 360H410L430 760Z" fill="#f4f1ea"/><path d="M336 640H424L428 700H332Z M342 520H418L421 570H339Z M347 410H413L415 450H345Z" fill="#c4372f"/><rect x="342" y="300" width="76" height="60" fill="#2a2a33"/><rect x="352" y="306" width="56" height="48" fill="#ffe680"/><path d="M336 300L380 262L424 300Z" fill="#c4372f"/>
<path d="M0 760C120 730 220 790 330 760C430 735 520 780 600 760V900H0Z" fill="#203a5c"/><path d="M0 800C140 780 260 830 600 800" stroke="#9ad1d4" stroke-width="4" fill="none" opacity=".6"/>
<g transform="translate(190 726)"><ellipse cx="0" cy="18" rx="44" ry="26" fill="#f28c28"/><circle cx="34" cy="-12" r="24" fill="#f28c28"/><path d="M18 -28L22 -52L36 -34Z M40 -34L54 -52L56 -26Z" fill="#f28c28"/><path d="M-40 14C-70 0 -74 -30 -58 -40" stroke="#f28c28" stroke-width="10" fill="none" stroke-linecap="round"/><circle cx="42" cy="-14" r="3" fill="#2a2a33"/></g>
<rect x="30" y="34" width="540" height="${words.length * size * 1.02 + 46}" fill="#ffe14d" stroke="#2a2a33" stroke-width="6" transform="rotate(-2 300 100)"/>${textLines(words, 300, 64 + size, size, 1.02, `text-anchor="middle" font-family="${SANS}" font-weight="900" fill="#2a2a33" letter-spacing="-1" transform="rotate(-2 300 100)"`)}
<rect x="380" y="836" width="190" height="40" fill="#2a2a33"/><text x="475" y="863" text-anchor="middle" font-size="17" font-family="${SANS}" font-weight="700" letter-spacing="2" fill="#ffe14d">${esc(author.toUpperCase())}</text><text x="40" y="866" font-size="16" font-family="${SANS}" font-weight="700" letter-spacing="3" fill="#ffe14d">A WORDLESS ADVENTURE</text>`;
}

// ---------------------------------------------------------------------------------------------
// Audiobooks (1000 × 1000)
function audiobookCover(title: Title, seed: number, p: CoverPalette, part?: number): string {
  const author = title.media?.credits?.find(credit => credit.role === 'author')?.name ?? '';
  const narrator = title.media?.credits?.find(credit => credit.role === 'narrator')?.name ?? '';
  const [a0, a1, a2] = p.accents, r = random(seed);
  const badge = part ? `<circle cx="868" cy="560" r="86" fill="${a1}"/><text x="868" y="546" text-anchor="middle" font-size="22" font-family="${SANS}" letter-spacing="5" fill="${p.bg}">PART</text><text x="868" y="604" text-anchor="middle" font-size="58" font-family="${DISPLAY}" fill="${p.bg}">${roman(part)}</text>` : '';
  const lines = wrap(title.name, 18), size = fit(lines, 820, 78, 0.5);
  const credits = `<text x="500" y="842" text-anchor="middle" font-size="28" font-family="${SANS}" letter-spacing="8" fill="${p.ink}">${esc(author.toUpperCase())}</text><text x="500" y="900" text-anchor="middle" font-size="26" font-family="${SERIF}" font-style="italic" fill="${a0}">Read by ${esc(narrator)}</text>`;
  if (Math.round(coverVariant(title.id) / 5) % 2 === 0) { // Headphones
    return `<defs><radialGradient id="bg" cx=".5" cy=".3" r=".9"><stop stop-color="${lighten(p.bg, 0.08)}"/><stop offset="1" stop-color="${darken(p.bg, 0.25)}"/></radialGradient></defs><rect width="1000" height="1000" fill="url(#bg)"/><circle cx="${760 + r() * 80}" cy="${200 + r() * 80}" r="300" fill="${a2}" opacity=".16"/><circle cx="${140 + r() * 80}" cy="760" r="220" fill="${a0}" opacity=".1"/>
<path d="M330 420V380A170 170 0 0 1 670 380V420" fill="none" stroke="${p.ink}" stroke-width="26" stroke-linecap="round"/><rect x="290" y="370" width="84" height="150" rx="36" fill="${a0}"/><rect x="626" y="370" width="84" height="150" rx="36" fill="${a0}"/><rect x="312" y="400" width="18" height="90" rx="9" fill="${p.bg}" opacity=".5"/><rect x="670" y="400" width="18" height="90" rx="9" fill="${p.bg}" opacity=".5"/>
${Array.from({ length: 9 }, (_, i) => `<rect x="${420 + i * 18}" y="${450 - (10 + Math.abs(Math.sin(i * 1.3 + seed)) * 40)}" width="8" height="${2 * (10 + Math.abs(Math.sin(i * 1.3 + seed)) * 40)}" rx="4" fill="${a1}"/>`).join('')}
${textLines(lines, 500, 650 - (lines.length - 1) * size * 0.55, size, 1.1, `text-anchor="middle" font-family="${DISPLAY}" fill="${p.ink}"`)}<path d="M440 ${700 + (lines.length - 1) * size * 0.55}H560" stroke="${a0}" stroke-width="3"/>${credits}${badge}${grain('g', 0.06, 1000)}`;
  }
  // Broadcast waves around a single point
  const arc = (radius: number, side: 1 | -1) => {
    const dx = Math.cos(Math.PI / 4.5) * radius * side, dy = Math.sin(Math.PI / 4.5) * radius;
    return `M${(500 + dx).toFixed(1)} ${(560 - dy).toFixed(1)}A${radius} ${radius} 0 0 ${side === 1 ? 1 : 0} ${(500 + dx).toFixed(1)} ${(560 + dy).toFixed(1)}`;
  };
  const waves = Array.from({ length: 5 }, (_, i) => ([1, -1] as const).map(side => `<path d="${arc(80 + i * 56, side)}" fill="none" stroke="${[a0, a1, a2][i % 3]}" stroke-width="${18 - i * 2}" stroke-linecap="round" opacity="${1 - i * 0.12}"/>`).join('')).join('');
  return `<rect width="1000" height="1000" fill="${p.bg}"/><circle cx="${820 - r() * 100}" cy="${180 + r() * 60}" r="260" fill="${a2}" opacity=".12"/><circle cx="500" cy="560" r="34" fill="${a0}"/>${waves}
${textLines(lines, 80, 110 + size, size, 1.06, `font-family="${SERIF}" font-weight="700" fill="${p.ink}"`)}${credits}${badge}${grain('g', 0.05, 1000)}`;
}

// ---------------------------------------------------------------------------------------------
// Podcast shows (1000 × 1000): a microphone in a ring of sound, the show's name and its hosts
function podcastCover(title: Title, seed: number, p: CoverPalette): string {
  const hosts = (title.media?.credits ?? []).filter(credit => credit.role === 'host').map(credit => credit.name).join(' & ');
  const [a0, a1, a2] = p.accents, r = random(seed);
  const lines = wrap(title.name, 14), size = fit(lines, 820, 104, 0.52);
  const rings = Array.from({ length: 4 }, (_, i) => `<circle cx="500" cy="300" r="${118 + i * 40}" fill="none" stroke="${[a0, a1, a2][i % 3]}" stroke-width="${12 - i * 2.5}" opacity="${0.9 - i * 0.18}" stroke-dasharray="${i % 2 ? '24 18' : 'none'}"/>`).join('');
  return `<defs><linearGradient id="bg" x2="0" y2="1"><stop stop-color="${lighten(p.bg, 0.06)}"/><stop offset="1" stop-color="${darken(p.bg, 0.3)}"/></linearGradient></defs><rect width="1000" height="1000" fill="url(#bg)"/>
<circle cx="${160 + r() * 80}" cy="${820 + r() * 60}" r="260" fill="${a2}" opacity=".12"/>${rings}
<rect x="460" y="208" width="80" height="140" rx="40" fill="${p.ink}"/><path d="M432 306A68 68 0 0 0 568 306" fill="none" stroke="${p.ink}" stroke-width="12" stroke-linecap="round"/><path d="M500 376V404M468 406H532" stroke="${p.ink}" stroke-width="12" stroke-linecap="round"/>
${textLines(lines, 500, 640 + size * 0.35 - (lines.length - 1) * size * 0.5, size, 1.04, `text-anchor="middle" font-family="${DISPLAY}" fill="${p.ink}"`)}<text x="500" y="912" text-anchor="middle" font-size="30" font-family="${SANS}" letter-spacing="7" fill="${a0}">${esc(hosts.toUpperCase())}</text>${grain('g', 0.06, 1000)}`;
}

// ---------------------------------------------------------------------------------------------
// Photos: a landscape at some hour (sky, sun, hills, water), seeded per picture
function photoScene(seed: number, p: CoverPalette, w: number, h: number): string {
  const r = random(seed), [a0, a1, a2] = p.accents;
  const horizon = h * (0.5 + r() * 0.15), sunX = w * (0.2 + r() * 0.6), sunY = horizon - h * (0.08 + r() * 0.2);
  const hill = (base: number, amp: number, fill: string, op: number) => {
    const pts = Array.from({ length: 9 }, (_, i) => `${(i * w / 8).toFixed(0)},${(base - Math.abs(Math.sin(i * 1.7 + seed % 7 + base)) * amp).toFixed(0)}`).join(' ');
    return `<polygon points="0,${h} ${pts} ${w},${h}" fill="${fill}" opacity="${op}"/>`;
  };
  return `<defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="${darken(a2, 0.2)}"/><stop offset=".7" stop-color="${lighten(a0, 0.25)}"/><stop offset="1" stop-color="${lighten(a1, 0.35)}"/></linearGradient><filter id="soft"><feGaussianBlur stdDeviation="${(w / 80).toFixed(0)}"/></filter></defs>
<rect width="${w}" height="${h}" fill="url(#sky)"/><circle cx="${sunX.toFixed(0)}" cy="${sunY.toFixed(0)}" r="${(w * 0.06).toFixed(0)}" fill="${lighten(a1, 0.6)}" filter="url(#soft)"/>
${hill(horizon, h * 0.12, darken(p.bg, 0.1), 0.85)}${hill(horizon + h * 0.12, h * 0.1, darken(p.bg, 0.45), 0.95)}<rect x="0" y="${(horizon + h * 0.2).toFixed(0)}" width="${w}" height="${h}" fill="${darken(a2, 0.5)}" opacity=".9"/>${grain('g', 0.08, w, h)}`;
}

// ---------------------------------------------------------------------------------------------
// Portraits (1000 × 1000; clients draw artists round) and artist backdrops (1600 × 900)
function portrait(name: string, seed: number, p: CoverPalette): string {
  const r = random(seed), [a0, a1, a2] = p.accents;
  const count = /quartet/i.test(name) ? 4 : /&/.test(name) ? 2 : /^the /i.test(name) ? 3 : 1;
  const figure = (x: number, scale: number, fill: string) => `<g transform="translate(${x} ${1000 - 1000 * scale}) scale(${scale})"><circle cx="0" cy="430" r="${130 + (seed % 3) * 8}" fill="${fill}"/><path d="M-290 1000C-290 760 -170 640 0 640C170 640 290 760 290 1000Z" fill="${fill}"/></g>`;
  const ink = darken(p.bg, 0.65);
  const people = count === 1 ? figure(500, 1, ink) : Array.from({ length: count }, (_, i) => figure(500 + (i - (count - 1) / 2) * (720 / count), count > 2 ? 0.62 : 0.78, i % 2 ? darken(p.bg, 0.55) : ink)).join('');
  return `<defs><radialGradient id="glow" cx="${0.35 + r() * 0.3}" cy=".35" r=".75"><stop stop-color="${lighten(a0, 0.2)}"/><stop offset=".6" stop-color="${mix(a0, p.bg, 0.5)}"/><stop offset="1" stop-color="${darken(p.bg, 0.2)}"/></radialGradient></defs>
<rect width="1000" height="1000" fill="url(#glow)"/>${Array.from({ length: 6 }, (_, i) => `<circle cx="500" cy="440" r="${180 + i * 90}" fill="none" stroke="${i % 2 ? a1 : a2}" stroke-width="3" opacity="${0.35 - i * 0.04}"/>`).join('')}<path d="M${100 + r() * 200} 0A520 520 0 0 0 ${900 - r() * 100} 1000" stroke="${a1}" stroke-width="80" fill="none" opacity=".25"/>${people}${grain('g', 0.08, 1000)}`;
}
function backdrop(name: string, seed: number, p: CoverPalette): string {
  const r = random(seed), [a0, a1, a2] = p.accents;
  const blobs = [a0, a1, a2, a0].map((c, i) => `<circle cx="${200 + r() * 1200}" cy="${150 + r() * 600}" r="${220 + r() * 260}" fill="${c}" opacity="${0.55 - i * 0.08}"/>`).join('');
  return `<defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="${darken(p.bg, 0.35)}"/><stop offset="1" stop-color="${darken(p.bg, 0.7)}"/></linearGradient><filter id="soft"><feGaussianBlur stdDeviation="90"/></filter></defs><rect width="1600" height="900" fill="url(#bg)"/><g filter="url(#soft)">${blobs}</g>${Array.from({ length: 14 }, (_, i) => `<path d="M0 ${520 + i * 26}Q800 ${380 + i * 34 + r() * 40} 1600 ${560 + i * 22}" stroke="${p.ink}" stroke-width="1.5" fill="none" opacity=".12"/>`).join('')}<text x="80" y="820" font-size="${Math.min(210, Math.floor(1440 / (name.length * 0.66)))}" font-family="${SANS}" font-weight="900" fill="${p.ink}" opacity=".08" letter-spacing="-6">${esc(name.toUpperCase())}</text>${grain('g', 0.07, 1600, 900)}`;
}

// ---------------------------------------------------------------------------------------------
// Concert stills (1600 × 900) and posters (600 × 900): a lit stage, beams and a crowd
function concertStage(title: Title, seed: number, p: CoverPalette, w: number, h: number): string {
  const r = random(seed), [a0, a1, a2] = p.accents;
  const artist = title.media?.parents?.[0]?.name ?? '';
  const venue = title.media?.facts?.find(fact => fact.label === 'Venue')?.value ?? '';
  const stage = h * 0.68;
  const beams = Array.from({ length: 7 }, (_, i) => {
    const x = w * (0.12 + i * 0.125) + (r() - 0.5) * w * 0.04, spread = w * (0.08 + r() * 0.08), c = [a0, a1, a2][i % 3];
    return `<path d="M${x.toFixed(0)} 0L${(x - spread).toFixed(0)} ${stage.toFixed(0)}L${(x + spread).toFixed(0)} ${stage.toFixed(0)}Z" fill="${c}" opacity="${(0.16 + r() * 0.14).toFixed(2)}"/>`;
  }).join('');
  const crowd = Array.from({ length: Math.round(w / 34) }, (_, i) => {
    const x = i * 34 + r() * 14, y = h - 40 - r() * h * 0.08, s = 26 + r() * 12;
    return `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${(s * 0.5).toFixed(0)}" fill="#07080b"/><rect x="${(x - s * 0.7).toFixed(0)}" y="${(y + s * 0.4).toFixed(0)}" width="${(s * 1.4).toFixed(0)}" height="${h}" rx="${(s * 0.6).toFixed(0)}" fill="#07080b"/>${r() > 0.82 ? `<rect x="${(x + s * 0.2).toFixed(0)}" y="${(y - s * 2.2).toFixed(0)}" width="${(s * 0.32).toFixed(0)}" height="${(s * 2.4).toFixed(0)}" rx="${(s * 0.16).toFixed(0)}" fill="#07080b"/>` : ''}`;
  }).join('');
  const lines = wrap(title.name, w > h ? 26 : 14), size = fit(lines, w * 0.8, w > h ? 92 : 64, 0.55);
  return `<defs><linearGradient id="sky" y2="1"><stop stop-color="${darken(p.bg, 0.75)}"/><stop offset="1" stop-color="${darken(a0, 0.55)}"/></linearGradient><filter id="soft"><feGaussianBlur stdDeviation="${(w / 60).toFixed(0)}"/></filter></defs>
<rect width="${w}" height="${h}" fill="url(#sky)"/><g filter="url(#soft)">${beams}</g><rect x="0" y="${stage.toFixed(0)}" width="${w}" height="${(h - stage).toFixed(0)}" fill="${darken(p.bg, 0.8)}"/>
<ellipse cx="${w / 2}" cy="${stage.toFixed(0)}" rx="${w * 0.36}" ry="${h * 0.05}" fill="${lighten(a1, 0.3)}" opacity=".35"/>${crowd}
<text x="${w * 0.06}" y="${h * 0.12}" font-size="${(w > h ? 26 : 22)}" font-family="${SANS}" letter-spacing="6" fill="${p.ink}" opacity=".85">${esc(artist.toUpperCase())}</text>
${textLines(lines, w * 0.06, h * 0.12 + size * 1.3, size, 1.05, `font-family="${DISPLAY}" fill="#ffffff"`)}<text x="${w * 0.06}" y="${h * 0.12 + size * (1.4 + lines.length * 1.05)}" font-size="${w > h ? 24 : 20}" font-family="${SERIF}" font-style="italic" fill="${lighten(a1, 0.2)}">${esc(venue)}</text>${grain('g', 0.07, w, h)}`;
}

/** SVG for a media fixture artwork id, or undefined so the caller falls back to the video art. */
export function renderCover(id: string, kind: string, width: number): string | undefined {
  const person = mediaPerson(id);
  if (person) return svg(width, 1000, 1000, portrait(person.name, mediaSeed(id), paletteFor(id)));
  const title = mediaTitle(id);
  if (!title?.media) return undefined;
  const role = title.media.role;
  if (title.media.class === 'photo') return kind === 'poster' ? svg(width, 1000, 1000, photoScene(mediaSeed(id), paletteFor(id), 1000, 1000)) : svg(width, 1600, 900, photoScene(mediaSeed(id), paletteFor(id), 1600, 900));
  if (role === 'concert') return kind === 'poster' ? svg(width, 600, 900, concertStage(title, mediaSeed(id), paletteFor(id), 600, 900)) : svg(width, 1600, 900, concertStage(title, mediaSeed(id), paletteFor(id), 1600, 900));
  if (role === 'artist') return kind === 'backdrop' ? svg(width, 1600, 900, backdrop(title.name, mediaSeed(id), paletteFor(id))) : svg(width, 1000, 1000, portrait(title.name, mediaSeed(id), paletteFor(id)));
  if (role === 'track') return renderCover(title.media.parents?.[0]?.id ?? '', kind, width);
  if (role === 'album') return svg(width, 1000, 1000, albumCover(title.name, title.showName ?? '', mediaSeed(id), coverVariant(id) / 5, paletteFor(id)));
  if (role === 'part') {
    const parent = mediaTitle(title.media.parents?.[0]?.id ?? '');
    return parent && svg(width, 1000, 1000, audiobookCover(parent, mediaSeed(parent.id), paletteFor(parent.id), title.media.index));
  }
  if (role === 'audiobook') return svg(width, 1000, 1000, audiobookCover(title, mediaSeed(id), paletteFor(id)));
  if (role === 'show') return svg(width, 1000, 1000, podcastCover(title, mediaSeed(id), paletteFor(id)));
  if (role === 'episode') return renderCover(title.media.parents?.[0]?.id ?? '', kind, width);
  return svg(width, 600, 900, bookCover(title, mediaSeed(id), paletteFor(id)));
}

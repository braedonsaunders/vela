// Generates the book fixtures' documents without dependencies: an EPUB 3 per EPUB book, a PDF
// field guide and a CBZ comic. Usage: bun mock-server/scripts/make-book-media.ts [output-dir]
// (default ~/.scratch/tmp/vela/media-books, or VELA_MOCK_BOOKS_ROOT).
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { mediaGroups, mediaSeed, paletteFor, readingSourceFor } from '../../packages/protocol/fixtures/media';
import type { Title } from '../../packages/protocol/types';
import { renderCover } from '../covers';
import { booksRoot } from '../media-kinds';
import { pdf, pdfText, zip } from './book-formats';
import { voices, writeChapters } from './book-prose';
import { comicPages } from './comic';

const root = process.argv[2] ?? booksRoot;
await mkdir(root, { recursive: true });
const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const author = (title: Title) => title.media?.credits?.find(credit => credit.role === 'author')?.name ?? 'Unknown';
const publisher = (title: Title) => title.media?.facts?.find(fact => fact.label === 'Publisher')?.value ?? 'Vela Fixtures';
function uuid(id: string) {
  const h = [mediaSeed(id), mediaSeed(`${id}:a`), mediaSeed(`${id}:b`), mediaSeed(`${id}:c`)].map(n => n.toString(16).padStart(8, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
const xhtml = (title: string, body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en">
<head><meta charset="utf-8"/><title>${esc(title)}</title><link rel="stylesheet" type="text/css" href="styles.css"/></head>
<body>${body}</body>
</html>
`;
const css = `body { font-family: Georgia, "Times New Roman", serif; line-height: 1.55; margin: 0 5%; }
h1 { font-weight: normal; text-align: center; margin: 2em 0 .3em; }
h2 { font-weight: normal; text-align: center; font-size: 1.5em; margin: 2.5em 0 1.5em; letter-spacing: .04em; }
h2 .number { display: block; font-size: .55em; letter-spacing: .3em; text-transform: uppercase; color: #8a7a66; margin-bottom: .6em; }
h3 { font-size: .8em; text-transform: uppercase; letter-spacing: .25em; text-align: center; margin: 2em 0 1em; color: #8a7a66; }
p { margin: 0; text-indent: 1.4em; text-align: justify; hyphens: auto; }
p.first { text-indent: 0; }
p.first::first-letter { float: left; font-size: 3.1em; line-height: .9; padding: .05em .08em 0 0; }
p.break { text-align: center; text-indent: 0; margin: 1em 0; letter-spacing: .6em; }
figure { margin: 2em 0; text-align: center; }
figure img { max-width: 100%; }
figcaption { font-size: .85em; font-style: italic; margin-top: .6em; color: #6b5f52; }
.cover { margin: 0; padding: 0; text-align: center; }
.cover img { height: 100%; max-width: 100%; }
nav ol { list-style: none; padding: 0; }
nav li { margin: .4em 0; }
.colophon { text-align: center; font-size: .85em; margin-top: 3em; color: #6b5f52; }
`;
function plate(title: Title, caption: string): string {
  const p = paletteFor(title.id), seed = mediaSeed(title.id);
  const coast = Array.from({ length: 24 }, (_, i) => `${40 + i * 22},${180 + Math.round(Math.sin(i * 0.7 + seed % 5) * 40 + Math.sin(i * 1.9) * 14)}`).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400" width="600" height="400"><rect width="600" height="400" fill="#f4ecdc"/><rect x="12" y="12" width="576" height="376" fill="none" stroke="#3b2f25" stroke-width="2"/>
<polyline points="${coast}" fill="none" stroke="#3b2f25" stroke-width="2.5"/>${Array.from({ length: 6 }, (_, i) => `<polyline points="${coast}" fill="none" stroke="${p.accents[1]}" stroke-width="1" opacity="${0.5 - i * 0.07}" transform="translate(0 ${12 + i * 12})"/>`).join('')}
<g transform="translate(480 300)" stroke="#3b2f25" fill="none"><circle r="44"/><circle r="36" stroke-dasharray="2 4"/><path d="M0 -58L8 0L0 58L-8 0Z" fill="${p.accents[0]}"/><path d="M-58 0L0 -6L58 0L0 6Z" fill="#3b2f25"/></g><text x="480" y="232" text-anchor="middle" font-family="Georgia, serif" font-size="16" fill="#3b2f25">N</text>
<text x="40" y="360" font-family="Georgia, serif" font-style="italic" font-size="16" fill="#3b2f25">${esc(caption)}</text></svg>`;
}
function epub(title: Title): Uint8Array {
  const voice = voices[title.genres[0] ?? ''] ?? voices['Literary Fiction']!;
  const chapters = writeChapters(voice, mediaSeed(title.id));
  const series = title.media?.parents?.[0];
  const words = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'];
  const files = chapters.map((chapter, n) => {
    const half = Math.ceil(chapter.paragraphs.length / 2);
    const paragraph = (text: string, i: number) => `<p${i === 0 ? ' class="first"' : ''}>${esc(text)}</p>`;
    const figure = n === 3 ? `<figure><img src="images/plate.svg" alt="${esc(voice.plate)}"/><figcaption>${esc(voice.plate)}.</figcaption></figure>` : '';
    return { name: `chapter-${String(n + 1).padStart(2, '0')}.xhtml`, title: chapter.title,
      body: `<section epub:type="chapter" id="chapter-${n + 1}"><h2><span class="number">Chapter ${words[n]}</span>${esc(chapter.title)}</h2>
${chapter.paragraphs.slice(0, half).map(paragraph).join('\n')}
${figure}<h3>${esc(chapter.subheading)}</h3>
${chapter.paragraphs.slice(half).map(paragraph).join('\n')}
${n === chapters.length - 1 ? `<p class="break">* * *</p><p class="colophon">${esc(title.name)} is an original placeholder text generated for Vela’s test library. Every name in it is invented.</p>` : ''}</section>` };
  });
  const id = `urn:uuid:${uuid(title.id)}`;
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="en">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${id}</dc:identifier>
    <dc:title>${esc(title.name)}</dc:title>
    <dc:creator id="author">${esc(author(title))}</dc:creator>
    <meta refines="#author" property="role" scheme="marc:relators">aut</meta>
    <dc:language>en</dc:language>
    <dc:publisher>${esc(publisher(title))}</dc:publisher>
    <dc:date>${title.year ?? 2020}</dc:date>
    <dc:description>${esc(title.summary)}</dc:description>
    ${title.genres.map(genre => `<dc:subject>${esc(genre)}</dc:subject>`).join('')}
    <meta property="dcterms:modified">2026-01-01T12:00:00Z</meta>
    <meta name="cover" content="cover-image"/>
    ${series ? `<meta property="belongs-to-collection" id="series">${esc(series.name)}</meta><meta refines="#series" property="collection-type">series</meta><meta refines="#series" property="group-position">${title.media?.index ?? 1}</meta>` : ''}
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="styles.css" media-type="text/css"/>
    <item id="cover-image" href="images/cover.svg" media-type="image/svg+xml" properties="cover-image"/>
    <item id="plate" href="images/plate.svg" media-type="image/svg+xml"/>
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
${files.map((file, n) => `    <item id="chapter-${n + 1}" href="${file.name}" media-type="application/xhtml+xml"/>`).join('\n')}
  </manifest>
  <spine toc="ncx">
    <itemref idref="cover"/>
${files.map((_, n) => `    <itemref idref="chapter-${n + 1}"/>`).join('\n')}
  </spine>
  <guide><reference type="cover" title="Cover" href="cover.xhtml"/></guide>
</package>
`;
  const nav = xhtml('Contents', `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>
${files.map(file => `<li><a href="${file.name}">${esc(file.title)}</a></li>`).join('\n')}
</ol></nav>
<nav epub:type="landmarks" hidden="hidden"><ol><li><a epub:type="cover" href="cover.xhtml">Cover</a></li><li><a epub:type="bodymatter" href="${files[0]!.name}">Begin reading</a></li></ol></nav>`);
  const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="en">
  <head><meta name="dtb:uid" content="${id}"/><meta name="dtb:depth" content="1"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head>
  <docTitle><text>${esc(title.name)}</text></docTitle>
  <navMap>
${files.map((file, n) => `    <navPoint id="nav-${n + 1}" playOrder="${n + 1}"><navLabel><text>${esc(file.title)}</text></navLabel><content src="${file.name}"/></navPoint>`).join('\n')}
  </navMap>
</ncx>
`;
  return zip([
    { name: 'mimetype', data: 'application/epub+zip' },
    { name: 'META-INF/container.xml', data: `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>
` },
    { name: 'OEBPS/content.opf', data: opf },
    { name: 'OEBPS/nav.xhtml', data: nav },
    { name: 'OEBPS/toc.ncx', data: ncx },
    { name: 'OEBPS/styles.css', data: css },
    { name: 'OEBPS/images/cover.svg', data: renderCover(title.id, 'poster', 600)! },
    { name: 'OEBPS/images/plate.svg', data: plate(title, voice.plate) },
    { name: 'OEBPS/cover.xhtml', data: xhtml(title.name, `<section epub:type="cover" class="cover"><img src="images/cover.svg" alt="Cover of ${esc(title.name)}"/></section>`) },
    ...files.map(file => ({ name: `OEBPS/${file.name}`, data: xhtml(file.title, file.body) })),
  ]);
}

// A six-page PDF: a title page and five birds, each with a vector drawing and Helvetica text.
const birds = [
  { name: 'The Lantern Wren', latin: 'Troglodytes lucernae', colour: [0.85, 0.55, 0.2], song: 'a dry tick, like a match being struck', habitat: 'lighthouse galleries and harbour walls', weather: 'fog, especially at dusk',
    text: 'A small, round bird with a tail held upright like a candle flame. It roosts in pairs inside disused lamps and is said to sing only when a ship is in sight. Lighthouse keepers once kept a tally of its visits in the margins of their logs.' },
  { name: 'The Greater Mist Heron', latin: 'Ardea nebulosa', colour: [0.55, 0.62, 0.7], song: 'a long low note, rising at the end', habitat: 'tidal marshes and flooded meadows', weather: 'still mornings with heavy dew',
    text: 'Tall, grey and nearly invisible in low cloud, the mist heron stands motionless for hours at the edge of the water. Its plumage is the exact colour of the fog it prefers, and walkers often notice it only when it lifts away on enormous, unhurried wings.' },
  { name: 'The Clockwork Finch', latin: 'Fringilla horologia', colour: [0.75, 0.62, 0.25], song: 'twelve evenly spaced chirps on the hour', habitat: 'town squares and church towers', weather: 'any, but most punctual in frost',
    text: 'A brass-coloured finch with a habit of calling at regular intervals. Townspeople claim to set their watches by it, though careful observers note that it runs about four minutes fast in summer and a little slow after rain.' },
  { name: 'The Saltmarsh Bellbird', latin: 'Campanula maritima', colour: [0.2, 0.5, 0.55], song: 'a clear ringing tone, repeated three times', habitat: 'saltmarsh creeks and shingle spits', weather: 'bright, blustery afternoons',
    text: 'Named for its astonishing call, which carries for miles across open water. The bellbird nests in hollows among the sea lavender and lines them with fragments of sea glass, choosing green pieces whenever it can find them.' },
  { name: 'The Velvet Nightjar', latin: 'Caprimulgus holosericus', colour: [0.35, 0.25, 0.4], song: 'a soft purr that seems to come from everywhere', habitat: 'heaths, orchards and quiet gardens', weather: 'warm nights after a hot day',
    text: 'Almost never seen by day, the velvet nightjar is known mainly by its song and by the faint scent of lavender it leaves behind. It feeds on moths drawn to lit windows and is considered a sign of a good harvest.' },
];
function wrapPdf(text: string, size: number, width: number): string[] {
  const max = Math.floor(width / (size * 0.5)), lines: string[] = [];
  for (const word of text.split(' ')) { const last = lines[lines.length - 1]; if (last !== undefined && (last + ' ' + word).length <= max) lines[lines.length - 1] = `${last} ${word}`; else lines.push(word); }
  return lines;
}
function birdDrawing(x: number, y: number, s: number, [r, g, b]: number[]): string {
  const k = 0.5523, e = (cx: number, cy: number, rx: number, ry: number) => `${cx + rx} ${cy} m ${cx + rx} ${cy + ry * k} ${cx + rx * k} ${cy + ry} ${cx} ${cy + ry} c ${cx - rx * k} ${cy + ry} ${cx - rx} ${cy + ry * k} ${cx - rx} ${cy} c ${cx - rx} ${cy - ry * k} ${cx - rx * k} ${cy - ry} ${cx} ${cy - ry} c ${cx + rx * k} ${cy - ry} ${cx + rx} ${cy - ry * k} ${cx + rx} ${cy} c f`;
  return [`q ${r} ${g} ${b} rg`, e(x, y, 70 * s, 38 * s), e(x + 64 * s, y + 30 * s, 26 * s, 26 * s),
    `${x + 86 * s} ${y + 34 * s} m ${x + 122 * s} ${y + 28 * s} l ${x + 86 * s} ${y + 22 * s} l f`,
    `${x - 60 * s} ${y + 6 * s} m ${x - 130 * s} ${y + 40 * s} l ${x - 116 * s} ${y} l ${x - 130 * s} ${y - 34 * s} l f`,
    `${r * 0.7} ${g * 0.7} ${b * 0.7} rg ${x - 26 * s} ${y + 12 * s} m ${x + 6 * s} ${y + 80 * s} ${x + 54 * s} ${y + 84 * s} ${x + 66 * s} ${y + 70 * s} c ${x + 36 * s} ${y + 52 * s} ${x + 18 * s} ${y + 26 * s} ${x + 14 * s} ${y + 6 * s} c f`,
    `1 1 1 rg`, e(x + 72 * s, y + 36 * s, 4.5 * s, 4.5 * s),
    `0.2 0.2 0.2 RG 3 w ${x - 10 * s} ${y - 36 * s} m ${x - 16 * s} ${y - 70 * s} l S ${x + 12 * s} ${y - 36 * s} m ${x + 10 * s} ${y - 70 * s} l S`,
    `0.4 0.35 0.3 RG 2 w 120 ${y - 74 * s} m 492 ${y - 74 * s} l S Q`].join('\n');
}
function fieldGuide(title: Title): Uint8Array {
  const pages = [
    ['q 0.96 0.93 0.86 rg 0 0 612 792 re f Q', 'q 0.23 0.18 0.15 RG 2 w 54 54 504 684 re S 0.5 w 64 64 484 664 re S Q',
      birdDrawing(300, 470, 1.3, [0.75, 0.45, 0.25]),
      `BT /F2 30 Tf 0.23 0.18 0.15 rg 1 0 0 1 ${Math.round(306 - title.name.length * 7.3)} 640 Tm ${pdfText(title.name)} Tj ET`,
      `BT /F3 16 Tf 0.23 0.18 0.15 rg 1 0 0 1 ${Math.round(306 - (author(title).length + 3) * 3.4)} 330 Tm ${pdfText(`by ${author(title)}`)} Tj ET`,
      `BT /F1 11 Tf 0.4 0.35 0.3 rg 1 0 0 1 172 120 Tm ${pdfText('A Vela fixture document. Every bird is imaginary.')} Tj ET`].join('\n'),
    ...birds.map((bird, n) => {
      const body = wrapPdf(bird.text, 12, 460).map((line, i) => `1 0 0 1 76 ${330 - i * 18} Tm ${pdfText(line)} Tj`).join('\n');
      const facts = [['Song', bird.song], ['Habitat', bird.habitat], ['Preferred weather', bird.weather]].map(([label, value], i) => `/F2 11 Tf 1 0 0 1 76 ${200 - i * 22} Tm ${pdfText(`${label}:`)} Tj /F1 11 Tf 1 0 0 1 ${76 + (label!.length + 2) * 6.4} ${200 - i * 22} Tm ${pdfText(value!)} Tj`).join('\n');
      return ['q 0.98 0.96 0.91 rg 0 0 612 792 re f Q', birdDrawing(300, 560, 1.1, bird.colour),
        `BT 0.23 0.18 0.15 rg /F1 10 Tf 1 0 0 1 76 740 Tm ${pdfText(`PLATE ${['I', 'II', 'III', 'IV', 'V'][n]}`)} Tj /F2 24 Tf 1 0 0 1 76 410 Tm ${pdfText(bird.name)} Tj /F3 14 Tf 1 0 0 1 76 386 Tm ${pdfText(bird.latin)} Tj /F1 12 Tf\n${body}\n${facts} /F1 10 Tf 1 0 0 1 300 50 Tm ${pdfText(String(n + 2))} Tj ET`].join('\n');
    }),
  ];
  return pdf(pages, { title: title.name, author: author(title) });
}

function comic(title: Title): Uint8Array {
  const credits = (title.media?.credits ?? []).map(credit => credit.name);
  const pages = comicPages(800, ['CAPTAIN PEBBLE', 'AND THE LIGHTHOUSE CAT'], credits.join(' & ').toUpperCase());
  const info = `<?xml version="1.0" encoding="UTF-8"?>
<ComicInfo xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><Title>${esc(title.name)}</Title><Summary>${esc(title.summary)}</Summary><Year>${title.year}</Year><Writer>${esc(author(title))}</Writer><Penciller>${esc(title.media?.credits?.find(credit => credit.role === 'illustrator')?.name ?? '')}</Penciller><Publisher>${esc(publisher(title))}</Publisher><PageCount>${pages.length}</PageCount><LanguageISO>en</LanguageISO><Manga>No</Manga></ComicInfo>
`;
  return zip([...pages.map((data, n) => ({ name: `${String(n + 1).padStart(2, '0')}.png`, data })), { name: 'ComicInfo.xml', data: info }]);
}

const written: string[] = [];
for (const title of mediaGroups.books) {
  const source = readingSourceFor(title.id)!;
  const bytes = source.format === 'epub' ? epub(title) : source.format === 'pdf' ? fieldGuide(title) : comic(title);
  await Bun.write(join(root, source.file), bytes);
  written.push(source.file);
}
// Structural checks with the host's tools when present: zip integrity and well-formed XML.
if (Bun.which('unzip')) for (const file of written.filter(name => /\.(epub|cbz)$/.test(name))) {
  const test = Bun.spawnSync(['unzip', '-tq', join(root, file)]);
  if (test.exitCode) throw new Error(`unzip -t failed for ${file}: ${test.stderr}`);
  const list = Bun.spawnSync(['unzip', '-Z1', join(root, file)]).stdout.toString().split('\n');
  if (file.endsWith('.epub') && list[0] !== 'mimetype') throw new Error(`${file}: mimetype is not the first entry`);
  if (Bun.which('xmllint')) for (const entry of list.filter(name => /\.(xhtml|opf|ncx|xml|svg)$/.test(name))) {
    const xml = Bun.spawnSync(['unzip', '-p', join(root, file), entry]).stdout;
    const lint = Bun.spawnSync(['xmllint', '--noout', '-'], { stdin: xml });
    if (lint.exitCode) throw new Error(`${file}:${entry} is not well-formed XML: ${lint.stderr}`);
  }
}
console.log(`Book media ready: ${root} (${written.length} files)`);

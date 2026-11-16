# Vela brand

The mark is a **searchlight V**. Its two arms are two beams of light shining up from the
ground: the **light side** (left) reaches the baseline, and the **shadow side** (right) stops
short against it. It is always two-tone. The name is set in a custom monoline lowercase whose
stroke matches the weight of the beams.

Everything here comes from one file, [build.mjs](build.mjs):

```sh
node brand/build.mjs --readme # only the animated GitHub README logo
node brand/build.mjs          # SVG sources in brand/svg and the app's assets in client/assets/brand
node brand/build.mjs --png    # also the PNG icons in brand/png (uses Google Chrome through playwright-core)
```

Edit the geometry or colours there, never the generated files. The round-by-round explorations
that led here are kept as `options*.html` (open them in a browser).

## Construction

- **Symbol grid: 64 units.** Light beam `M9 8H26.4L41 57.6H32.4Z`, shadow beam
  `M38 8H55L36.8 50.8 32.4 57.6Z`. Both tops sit on y = 8 and are 17.4 and 17 units wide.
  The shadow beam meets the light beam at y = 50.8 and ends at the light beam's inner foot.
- **Wordmark grid: 100-unit ascender,** x-height 64 (y 36 to 100). Strokes are 12.5 units
  with round caps and joins: `v` a straight chevron, `e` a horizontal bar closing into a
  320° bowl, `l` a single stem, `a` single-storey (a full bowl and a stem).
- **Horizontal lockup:** the symbol stands 1.86 ascenders tall, centred on the word, with a
  gap of 64 wordmark units (about one beam width at that scale).
- **Stacked lockup:** the symbol is 3 ascenders tall, with the word centred 71 units below it.
- **App icon:** the symbol at 58% of a night tile (a radial gradient from `#1C222B` to
  `#07090C`) with a hairline edge. The maskable version shrinks the symbol to 46% so it sits
  inside the safe circle.

## Motion

The signature animation (`client/foundation/splash.contract`) treats each beam as a
motorised lamp turning rigidly about its own base (light beam about (36.7, 57.6), shadow beam
about (34.6, 54.2)):

1. **Power on, 0 to 300 ms:** a stepped flicker at the lamps, with the beams crossed at ±20°.
2. **Two mirrored passes, 300 to 1,620 ms:** each pass runs at constant speed with a 12% ramp
   at each end and a 40 ms dwell at the reversal, so it reads as a servo, not a pendulum.
3. **Drive into the V and lock, 1,620 to 1,930 ms:** the beams stop with no overshoot, and a
   half-strength flash of full power marks the stop.
4. **The name lights up like bulbs, from 1,990 ms:** one stepped flicker per letter, 90 ms
   apart. Everything is still by about 2.5 s.

Reduced motion shows the finished mark with no animation. Never loop the animation and never
add easing that bounces. An idle sway is not part of the mark.

## Clear space and minimum sizes

- **Clear space:** one **beam**, the width of the shadow beam's top (17 symbol units, about a
  third of the symbol's width), on every side of the symbol or lockup.
- **Symbol:** at least 16 px tall on the night tile (favicon), and at least 12 px tall bare.
- **Horizontal lockup:** at least 72 px wide; below that, use the symbol alone.
- **Stacked lockup:** at least 48 px wide.

## Colour

| Use | Light side | Shadow side | Ground |
|---|---|---|---|
| On dark (default) | `#F5F1E9` warm white | `#DCB998` champagne | `#090B0E` |
| On paper | `#111419` ink | `#A65B38` ember | `#F3F0E8` |
| One colour, white | `#FFFFFF` | white at 55% | any dark |
| One colour, ink | `#111419` | ink at 55% | any light |
| Reversed on ember | `#FFF6EC` | `#FFF6EC` at 60% | `#A65B38` |

The app has these as theme tokens: `brand.light`, `brand.shadow`, `brand.paper-light`,
`brand.paper-shadow` and `brand.lift` (the splash's central glow).

## Files

| File | For |
|---|---|
| `svg/vela-symbol*.svg` | The symbol: dark (default), paper, white, ink |
| `svg/vela-wordmark*.svg` | The name alone: dark, paper |
| `svg/vela-lockup*.svg` | Horizontal lockup: dark, paper, white, ink, ember |
| `svg/vela-stacked*.svg` | Stacked lockup: dark, paper |
| `svg/vela-icon.svg` | App icon and SVG favicon (rounded night tile) |
| `svg/vela-icon-square.svg` | Full-bleed tile for platforms that apply their own mask (iOS) |
| `svg/vela-icon-maskable.svg` | Maskable PWA icon (symbol inside the safe zone) |
| `png/favicon-{16,32,48}.png` | Raster favicons |
| `png/apple-touch-icon-180.png` | iOS home screen |
| `png/vela-icon-{192,512}.png` | PWA icons, purpose `any` |
| `png/vela-icon-maskable-{192,512}.png` | PWA icons, purpose `maskable` |

The app loads the mark as **image assets, one node per use**, from `client/assets/brand/`.
Use `image "assets/brand/vela-lockup.svg"` and the like, never an inline SVG copied into a
component. The only inline drawing of the mark is the animated splash, which is mounted once.
PWA colours: `theme_color` and `background_color` are both `#090B0E`.

## Do

- Keep the two tones and the asymmetry: the light side always reaches lower.
- Use the paper variants on light grounds and the white or ink one-colour versions where only
  one colour is possible.
- Give the mark its clear space, and let it sit on calm, dark grounds.

## Don't

- Make the V symmetrical, swap the sides, or put the shadow side in front.
- Add glows, gradients, outlines or extra beams to the mark itself. The atmosphere belongs to
  the scene, not the logo.
- Set "vela" in another typeface, track it out, capitalise it or recolour individual letters.
- Rotate, skew or animate the mark with a different motion than the one above.
- Place it on busy imagery without a scrim.

# Contour map labels

`contour-labels.r8` is a tightly packed 1024 × 200 linear R8 texture. The first byte is the bottom-left texel, matching the framework's flipped Canvas2D upload. The shader reads the red channel. Upload the bytes with a row stride of 1024, generate mipmaps and use clamp-to-edge, linear magnification and trilinear minification. The file occupies 204,800 bytes uncompressed and approximately 20 KiB with gzip.

`contour-labels.json` gives the top-to-bottom, left-to-right order of the 20 cells. The map's first label is PORT LEGATO in the top-left cell. The bottom row contains NEON CARTOGRAPHY, SURVEY IN PROGRESS and two empty cells. The font is macOS's system Baskerville family (600 italic, 23 px, 3 px letter spacing). The repository carries the rasterized words. The source font's digest is recorded in the JSON.

## Regeneration

Run from the repository root on macOS with Python 3 and Google Chrome installed. Set `CHROME` to select another Chrome executable.

```sh
python3 packages/visualizer/tools/contour-atlas.py
shasum -a 256 packages/visualizer/assets/contour-labels.r8
```

The generator initializes `33_contour.js` with the framework's `25_helpers.js` and intercepts the texture upload. The original canvas draws the labels with its own font stack, letter spacing, alignment, maximum width and middle baseline. Each occupied cell is checked for ink and both padding cells for zero coverage. The generator reverses the rows as it extracts red, preserving antialiasing.

The checked-in raster was generated with macOS 26.6.2 and Chrome 158.0.8127.37. Its SHA-256 is `75077529eed4031abbf3049168a280273b669e92c7da1f27210acaec50af7110`. Platform font or browser changes can affect rasterization. The runtime asset is independent of installed fonts.

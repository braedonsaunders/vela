"""Regenerate the native contour-labels R8 asset using the framework's own Canvas2D rasterizer."""
import base64
import hashlib
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
framework = root / "framework"
assets = root / "assets"
chrome = os.environ.get("CHROME", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
font_file = Path("/System/Library/Fonts/Supplemental/Baskerville.ttc")
font_hash = hashlib.sha256(font_file.read_bytes()).hexdigest()

# Initializing the actual scene supplies the current MAP_NAMES, cell sizes and font.
# Its helper paints a real 2D canvas. Only intercept its upload to read the red channel.
html = """<!doctype html><meta charset="utf-8"><body><script>
let canvas, flipped = false;
const VS = '', FSH = '';
function program() { return {}; }
const gl = {
  createTexture() {}, bindTexture() {}, generateMipmap() {}, texParameteri() {},
  pixelStorei(_, value) { flipped = value; },
  texImage2D(_, level, format, channels, type, image) {
    if (!flipped) throw Error('Expected a flipped canvas upload');
    canvas = image;
  }
};
""" + (framework / "25_helpers.js").read_text() + """
const drawAtlas = textAtlas;
const info = {};
textAtlas = function(labels, columns, cellWidth, cellHeight, font) {
  Object.assign(info, {labels, columns, cellWidth, cellHeight, font});
  return drawAtlas(labels, columns, cellWidth, cellHeight, font);
};
function scene(def) { def.init(); }
""" + (framework / "33_contour.js").read_text() + """
const {width, height} = canvas;
const rgba = canvas.getContext('2d').getImageData(0, 0, width, height).data;
let r8 = '';
for (let y = height - 1; y >= 0; --y) {
  for (let x = 0; x < width; ++x) r8 += String.fromCharCode(rgba[(y * width + x) * 4]);
}
document.body.innerHTML = '<pre>' + btoa(JSON.stringify({
  ...info, width, height, pixels: btoa(r8)
})) + '</pre>';
</script>"""

with tempfile.TemporaryDirectory(prefix="vela-map-atlas-") as scratch:
    scratch = Path(scratch)
    page = scratch / "atlas.html"
    page.write_text(html)
    result = subprocess.run([
        chrome, "--headless", "--disable-gpu", "--mute-audio", "--disable-extensions",
        "--disable-background-networking", "--no-first-run", "--no-default-browser-check",
        f"--user-data-dir={scratch / 'profile'}", "--dump-dom", page.as_uri(),
    ], check=True, capture_output=True, text=True, timeout=60)
    payload = re.search(r"<pre>([A-Za-z0-9+/=]+)</pre>", result.stdout)
    if not payload:
        raise RuntimeError("Scene did not produce an atlas")
    info = json.loads(base64.b64decode(payload[1], validate=True))

pixels = base64.b64decode(info.pop("pixels"), validate=True)
width, height = info["width"], info["height"]
cw, ch, columns = info["cellWidth"], info["cellHeight"], info["columns"]
assert len(pixels) == width * height
assert columns * cw == width and height == ((len(info["labels"]) + columns - 1) // columns) * ch
for index, name in enumerate(info["labels"]):
    x, y = (index % columns) * cw, height - (index // columns + 1) * ch
    ink = sum(sum(pixels[row*width+x:row*width+x+cw]) for row in range(y, y+ch))
    if bool(ink) != bool(name):
        raise ValueError(f"Unexpected ink coverage for cell {index} ({name!r})")
info.update(format="R8_UNORM", rowOrder="bottom-row-first",
            sha256=hashlib.sha256(pixels).hexdigest(), sourceFontSHA256=font_hash)
(assets / "contour-labels.r8").write_bytes(pixels)
(assets / "contour-labels.json").write_text(json.dumps(info, indent=2) + "\n")
print(f"{width} × {height}, {len(pixels)} bytes, SHA-256 {info['sha256']}")

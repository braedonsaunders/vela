// SVGs load as data URIs rather than image assets: Metro sizes image assets from their
// width/height, and skin documents use SVGs sized by their box (width="100%"), which Metro
// rejects. expo-image draws an SVG data URI on every platform.
const upstream = require('@expo/metro-config/babel-transformer');

module.exports.transform = function transform({ src, filename, options }) {
  if (filename.endsWith('.svg')) {
    const uri = `data:image/svg+xml;base64,${Buffer.from(src).toString('base64')}`;
    return upstream.transform({ src: `module.exports = ${JSON.stringify(uri)};`, filename, options });
  }
  return upstream.transform({ src, filename, options });
};

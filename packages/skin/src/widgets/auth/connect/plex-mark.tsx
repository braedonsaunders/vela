// Plex's familiar gold chevron, decorative because its button already has a complete label.
import Svg, { Path } from 'react-native-svg';

export function PlexMark() {
  return <Svg width={17} height={22} viewBox="0 0 17 22">
    <Path fill="#E5A00D" d="M0 0h6.2L17 11 6.2 22H0l10.8-11z" />
  </Svg>;
}

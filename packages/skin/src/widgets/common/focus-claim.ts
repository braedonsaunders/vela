// Preferred TV focus, taken once rather than held. react-native-tvos asks again for a view's
// focus whenever a view that has `hasTVPreferredFocus` set is laid out anew, so a control that
// keeps it (the play toggle, a menu's selected row) pulls focus back from wherever the viewer
// moved as soon as anything about it changes: a seek, a new label, a re-rendered row. The claim
// is made when `preferred` turns on (or the view mounts preferred) and let go a frame later.
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

export function useFocusClaim(preferred: boolean | undefined): boolean {
  const wanted = Platform.isTV && !!preferred;
  const [claim, setClaim] = useState(wanted);
  useEffect(() => {
    if (wanted) setClaim(true);
  }, [wanted]);
  useEffect(() => {
    if (!claim) return;
    const frame = requestAnimationFrame(() => setClaim(false));
    return () => cancelAnimationFrame(frame);
  }, [claim]);
  return claim;
}

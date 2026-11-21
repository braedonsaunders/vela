// `mediaPage`: the media page drawn in the title page's scroll region (resolve/media-title.ts), so
// a music, book or audiobook title opens in the document's own title frame.
import type { WidgetProps } from '../../host';
import { useHost } from '../../host';
import { MediaTitlePage } from './pages';

export function MediaPageWidget(_: WidgetProps) {
  const { env } = useHost();
  return env.entry ? <MediaTitlePage id={env.entry} framed /> : null;
}

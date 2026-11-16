// Natively there is no preview surface yet: the player view takes a session or plan, not a
// URL, so the app offers no previews (and asks the server for none) until it does.
import type { ComponentType } from 'react';

export const PreviewSurface: ComponentType<{ url: string }> | null = null;

import { createContext } from 'react';
import type { LayoutChangeEvent } from 'react-native';

interface MediaFrameViewport {
  height?: number;
  onLayout(event: LayoutChangeEvent): void;
}

/** A modal can observe the layout of its title scroll region. */
export const MediaFrameViewport = createContext<MediaFrameViewport | undefined>(undefined);

/** Height left for the media page after the frame's header and top inset. */
export const MediaContentHeight = createContext<number | undefined>(undefined);

/** Reports the bottom of the active title controls in window coordinates. */
export const TitleChromeLayout = createContext<((control: string, bottom: number) => void) | undefined>(undefined);

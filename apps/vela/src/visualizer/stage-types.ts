export type VisualizerMode = 'background' | 'fullscreen';
export interface StageProps {
  sceneId: string;
  active: boolean;
  still: boolean;
  mode: VisualizerMode;
  onUnavailable(): void;
  accent?: string;
  artworkTint?: string;
}

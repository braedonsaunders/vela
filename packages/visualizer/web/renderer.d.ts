export interface AnalysisSample {
  sampleRate: number;
  frequency: Float32Array;
  shortFrequency: Float32Array;
  waveform: Float32Array;
}
export interface SceneRenderer {
  resize(width: number, height: number): void;
  tint(rgb: number[] | null): void;
  resetBudget(): void;
  frame(seconds: number, sample: AnalysisSample | null, targetSeconds: number): 'keep' | 'limit30' | 'disable';
  stats(): { scene: string; frames: number; resolution: number[]; beat: number; level: number; gpuMs: number | null };
}
export function createRenderer(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext, stage: {
  sceneId: string; width: number; height: number; constrained: boolean; measure: boolean;
  analysisRange: { minDecibels: number; maxDecibels: number };
}): SceneRenderer;

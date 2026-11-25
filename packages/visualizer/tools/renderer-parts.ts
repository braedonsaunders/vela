import { readdirSync } from 'node:fs';
import review from '../review.json';

/** Both native and web compile the same scene selection from the reviewed page. */
export function rendererParts(directory: string, includeForest = review.includeForest): string[] {
  return readdirSync(directory).filter(name =>
    /^[1-9]\d_.*\.js$/.test(name) && name !== '11_synth.js' && name !== '95_ui.js'
    && (includeForest || name !== '64_forest.js')
  ).sort();
}

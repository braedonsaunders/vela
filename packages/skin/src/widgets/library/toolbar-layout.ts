/** Keep filters usable when fixed tabs and sorting would squeeze their scroll strip. */
export function singleLibraryStrip(width: number, tv: boolean): boolean {
  return !tv && width < 1200;
}

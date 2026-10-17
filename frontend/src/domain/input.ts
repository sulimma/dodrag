export const TITLE_LIMIT = 2000;
export function normalizeTitleInput(value: string): string {
  // Future AI summarization belongs here; for now retain the first 2000 code points.
  return Array.from(value.replace(/\r?\n/g,' ')).slice(0,TITLE_LIMIT).join('');
}

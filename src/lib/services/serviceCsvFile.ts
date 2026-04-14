/**
 * Import accepts .csv files only (extension-based; MIME is often missing or generic).
 */
export function isAllowedCsvFile(file: File): boolean {
  const name = file.name.trim().toLowerCase();
  return name.endsWith('.csv');
}

export function stripUtf8Bom(text: string): string {
  if (text.charCodeAt(0) === 0xfeff) {
    return text.slice(1);
  }
  return text;
}

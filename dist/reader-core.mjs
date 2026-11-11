export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
export function pageNumber(value, count, fallback = 1) {
  const n = Number(value);
  return Number.isFinite(n) && String(value).trim() ? clamp(Math.trunc(n), 1, count) : fallback;
}
export function pairedPage(page, side, offset, count) { return clamp(page + (side === 'left' ? offset : -offset), 1, count); }
export function fitScale(mode, width, height, pageWidth, pageHeight) {
  return mode === 'page' ? Math.min(width / pageWidth, height / pageHeight) : mode === 'width' ? width / pageWidth : clamp(Number(mode) || 1, .25, 4);
}
export function scrollFraction(position, scrollSize, clientSize) { return scrollSize <= clientSize ? 0 : clamp(position / (scrollSize - clientSize), 0, 1); }
export function excerpt(text, query, padding = 28) {
  const i = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (i < 0) return null;
  return { before: (i > padding ? '…' : '') + text.slice(Math.max(0, i - padding), i), match: text.slice(i, i + query.length), after: text.slice(i + query.length, i + query.length + padding) + (text.length > i + query.length + padding ? '…' : '') };
}
export function fileKey(file) { return [file.name, file.size, file.lastModified || 0].join(':'); }
export async function validPDF(file) { return file && file.size > 4 && new TextDecoder().decode(await file.slice(0, 1024).arrayBuffer()).includes('%PDF-'); }

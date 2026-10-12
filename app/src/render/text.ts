export type Measure = (text: string) => number;

/** Truncates `text` with an ellipsis so it fits `maxWidth`. */
export function ellipsize(measure: Measure, text: string, maxWidth: number): string {
  if (measure(text) <= maxWidth) return text;
  const chars = Array.from(text);
  let lo = 0, hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(chars.slice(0, mid).join('').trimEnd() + '…') <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return chars.slice(0, lo).join('').trimEnd() + '…';
}

/** Greedy word wrap into at most `maxLines` lines; the last line is ellipsized when text is left over. */
export function wrapText(measure: Measure, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  let i = 0;
  for (; i < words.length && lines.length < maxLines; i++) {
    const word = words[i] as string;
    const candidate = current ? `${current} ${word}` : word;
    if (measure(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (!current) {
      // A single word longer than the line: hard cut.
      lines.push(ellipsize(measure, word, maxWidth));
      continue;
    }
    lines.push(current);
    current = '';
    i--; // retry this word on the next line
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (i < words.length && lines.length > 0) {
    // Leftover words: make sure the last line carries an ellipsis.
    const last = lines.length - 1;
    const rest = words.slice(i).join(' ');
    lines[last] = ellipsize(measure, `${lines[last]} ${rest}`, maxWidth);
  }
  return lines.slice(0, maxLines);
}

export const ctxMeasure = (ctx: { measureText(t: string): { width: number } }): Measure => (s) => ctx.measureText(s).width;

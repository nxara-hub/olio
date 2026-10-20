import { relative } from "node:path";

const color = process.stdout.isTTY === true && !("NO_COLOR" in process.env);
const paint =
  (code: number) =>
  (text: string): string =>
    color ? `\u001B[${code}m${text}\u001B[0m` : text;

export const bold = paint(1);
export const dim = paint(2);
export const red = paint(31);
export const green = paint(32);
export const cyan = paint(36);

/** A path relative to the working directory when it is inside it. */
export function shortPath(path: string): string {
  const rel = relative(process.cwd(), path);
  return rel.startsWith("..") ? path : rel;
}

/** `label` padded into a dim column, then the value. */
export const row = (label: string, value: string): string =>
  `  ${dim(label.padEnd(11))}${value}`;

/** `1 file`, `3 files`. */
export const count = (n: number, word: string): string =>
  `${n} ${word}${n === 1 ? "" : "s"}`;

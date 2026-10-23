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

export function shortPath(path: string): string {
  const rel = relative(process.cwd(), path);
  return rel.startsWith("..") ? path : rel;
}

export const row = (label: string, value: string): string =>
  `  ${dim(label.padEnd(11))}${value}`;

export const count = (n: number, word: string): string =>
  `${n} ${word}${n === 1 ? "" : "s"}`;

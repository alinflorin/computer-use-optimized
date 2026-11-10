import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = promisify(execFile);

/** Linux input-event keycodes for common keys. */
const KEYS: Record<string, number> = {
  esc: 1, "1": 2, "2": 3, "3": 4, "4": 5, "5": 6, "6": 7, "7": 8, "8": 9, "9": 10, "0": 11,
  backspace: 14, tab: 15, q: 16, w: 17, e: 18, r: 19, t: 20, y: 21, u: 22, i: 23, o: 24, p: 25,
  enter: 28, return: 28, ctrl: 29, a: 30, s: 31, d: 32, f: 33, g: 34, h: 35, j: 36, k: 37, l: 38,
  shift: 42, z: 44, x: 45, c: 46, v: 47, b: 48, n: 49, m: 50, alt: 56, space: 57,
  f1: 59, f2: 60, f3: 61, f4: 62, f5: 63, f6: 64, f7: 65, f8: 66, f9: 67, f10: 68, f11: 87, f12: 88,
  home: 102, up: 103, pageup: 104, left: 105, right: 106, end: 107, down: 108, pagedown: 109,
  insert: 110, delete: 111, super: 125, meta: 125,
};

/** Resolve a combo like "ctrl+shift+t" to ydotool key events (all down in order, then up in reverse). */
export function comboToEvents(combo: string): string[] {
  const codes = combo.toLowerCase().split("+").map((k) => {
    const c = KEYS[k.trim()];
    if (c === undefined) throw new Error(`Unknown key "${k}"`);
    return c;
  });
  return [...codes.map((c) => `${c}:1`), ...[...codes].reverse().map((c) => `${c}:0`)];
}

export async function pressKeys(combo: string): Promise<void> {
  await run("ydotool", ["key", ...comboToEvents(combo)]);
}

export async function typeText(text: string): Promise<void> {
  await run("ydotool", ["type", "--", text]);
}

export async function clickAt(x: number, y: number, button: "left" | "right" | "middle" = "left"): Promise<void> {
  await run("ydotool", ["mousemove", "--absolute", "-x", String(Math.round(x)), "-y", String(Math.round(y))]);
  const code = { left: "0xC0", right: "0xC1", middle: "0xC2" }[button];
  await run("ydotool", ["click", code]);
}

/** Take a screenshot with Spectacle; returns base64 PNG. */
export async function screenshot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "cuo-"));
  const file = join(dir, "shot.png");
  try {
    await run("spectacle", ["-b", "-n", "-f", "-o", file]);
    return (await readFile(file)).toString("base64");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

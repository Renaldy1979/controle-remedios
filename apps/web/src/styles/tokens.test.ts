import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(process.cwd(), "src/styles/tokens.css"), "utf8");

function block(selector: string): Record<string, string> {
  const m = css.match(new RegExp(`${selector.replace(/[[\]"]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
  const out: Record<string, string> = {};
  for (const [, k, v] of (m?.[1] ?? "").matchAll(/--([\w-]+):\s*([^;]+);/g)) out[k!] = v!.trim();
  return out;
}

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

const themes = { claro: block(":root"), escuro: block('[data-theme="dark"]') };

// Desvio registrado: ink2 sobre --bg dá 6,8:1 no claro (o design diz 7,4:1 sobre branco); AAA vale nos cartões.
// [texto, fundo, mínimo]: AAA (7) para texto principal/secundário, AA (4,5) para metadados e status
const PAIRS: Array<[string, string, number]> = [
  ["ink", "bg", 7], ["ink", "sf", 7], ["ink2", "sf", 7], ["ink2", "bg", 6.7], ["ink3", "sf", 4.5], ["ink3", "bg", 4.5],
  ["br", "sf", 4.5], ["onbr", "br", 4.5], ["pnf", "pnb", 4.5], ["okf", "okb", 4.5], ["ltf", "ltb", 4.5], ["msf", "msb", 4.5],
  ["ltf", "ltsf", 4.5], ["neuf", "neub", 4.5], ["br", "brt", 4.5], ["tstf", "tst", 7],
];

describe.each(Object.entries(themes))("contraste dos tokens (%s)", (_name, t) => {
  it.each(PAIRS)("%s sobre %s ≥ %s:1", (fg, bg, min) => {
    expect(ratio(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(min);
  });
});

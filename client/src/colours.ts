// Domain colours are pale tints (from the Excel tracker). Rows use the tint as
// background; borders and badges use a stronger shade derived from it.

function hexToHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

const hsl = (h: number, s: number, l: number) => `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;

const cache = new Map<string, { tint: string; accent: string; text: string }>();

export function domainColours(hex: string | null | undefined) {
  const key = hex ?? '#DDDDDD';
  let c = cache.get(key);
  if (!c) {
    const [h, s] = hexToHsl(/^#[0-9a-f]{6}$/i.test(key) ? key : '#DDDDDD');
    c = { tint: key, accent: hsl(h, Math.max(s, 0.45), 0.45), text: hsl(h, Math.max(s, 0.5), 0.22) };
    cache.set(key, c);
  }
  return c;
}

export const verdictClass = (behaviour: string | null | undefined) =>
  behaviour === 'pass' ? 'v-pass' : behaviour === 'conditional' ? 'v-cond' : behaviour === 'fail' ? 'v-fail' : 'v-none';

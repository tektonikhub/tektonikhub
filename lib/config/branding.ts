import type { BrandTokens } from '@/lib/domain/types';
export const BRAND_MAP = { accent: '--accent', bg: '--bg', card: '--card', fg: '--fg', fgSoft: '--fg-soft', line: '--line', green: '--green', amber: '--amber', displayFont: '--display-font', bodyFont: '--body-font', rCard: '--r-card', rSm: '--r-sm' } as const;
export function validBrandValue(key: keyof typeof BRAND_MAP, value: unknown): value is string {
  return typeof value === 'string' && (key.endsWith('Font') ? /^[a-zA-Z0-9 ,"'\-]+$/.test(value) : key.startsWith('r') ? /^\d{1,3}px$/.test(value) : /^#[0-9a-f]{6}$/i.test(value));
}
export function applyBrand(tokens: BrandTokens, target: Pick<CSSStyleDeclaration, 'setProperty'>) {
  for (const key of Object.keys(BRAND_MAP) as (keyof typeof BRAND_MAP)[]) {
    if (!validBrandValue(key, tokens[key])) throw new Error(`Token de marca inválido: ${key}`);
  }
  for (const key of Object.keys(BRAND_MAP) as (keyof typeof BRAND_MAP)[]) target.setProperty(BRAND_MAP[key], tokens[key]);
  const channels = tokens.accent.slice(1).match(/.{2}/g)?.map(channel => parseInt(channel, 16) / 255) ?? [1, 1, 1];
  const luminance = channels.map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  target.setProperty('--accent-on', luminance[0] * 0.2126 + luminance[1] * 0.7152 + luminance[2] * 0.0722 < 0.32 ? '#FFFFFF' : '#111111');
}

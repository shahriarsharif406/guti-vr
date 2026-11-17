/** Shared choices for Kite Alive: how to play, where, when, and which kite. */
export type KMode = 'battle' | 'free' | 'wind' | 'sky' | 'rescue';
export type KPlace = 'village' | 'bil' | 'winter' | 'char';
export type KTime = 'golden' | 'morning' | 'noon' | 'cloudy' | 'storm';

export const K_MODES: { id: KMode; name: string; bn: string; hint: string }[] = [
  { id: 'battle', name: 'Kite Festival', bn: 'ঘুড়ি কাটাকাটি', hint: 'Cut rival kites, dodge crows' },
  { id: 'free', name: 'Free Flight', bn: 'মুক্ত উড়ান', hint: 'No rivals, no timer. Just fly' },
  { id: 'wind', name: 'Wind Master', bn: 'বাতাসের ওস্তাদ', hint: 'Strong gusts: stay up as long as you can' },
  { id: 'sky', name: 'Sky Challenge', bn: 'আকাশ চ্যালেঞ্জ', hint: 'Fly through the glowing rings' },
  { id: 'rescue', name: 'Rescue Mission', bn: 'উদ্ধার', hint: 'Free a snagged kite, climb back to open sky' },
];
export const K_PLACES: { id: KPlace; name: string; bn: string }[] = [
  { id: 'village', name: 'Village Paddy', bn: 'গ্রামের মাঠ' },
  { id: 'bil', name: 'Monsoon Beel', bn: 'বর্ষার বিল' },
  { id: 'winter', name: 'Winter Field', bn: 'শীতের মাঠ' },
  { id: 'char', name: 'River Char', bn: 'নদীর চর' },
];
export const K_TIMES: { id: KTime; name: string; wind: number }[] = [
  { id: 'golden', name: 'Golden evening', wind: 1 },
  { id: 'morning', name: 'Soft morning', wind: 0.7 },
  { id: 'noon', name: 'Warm noon', wind: 0.9 },
  { id: 'cloudy', name: 'Cloudy day', wind: 1.25 },
  { id: 'storm', name: 'Before the storm', wind: 1.7 },
];
/** Kite shapes: how the kite follows the hand and how the wind shoves it. */
export const K_SHAPES = [
  { name: 'Chand-tara', follow: 7, wind: 0.9, scale: 1, sx: 0.8, sy: 1.15, hit: 1 },
  { name: 'Pata (small)', follow: 11, wind: 1.2, scale: 0.8, sx: 0.78, sy: 1.05, hit: 0.8 },
  { name: 'Dhaka (big)', follow: 5, wind: 0.6, scale: 1.3, sx: 0.95, sy: 1.2, hit: 1.25 },
];
export const K_COLORS = [0xff4d6d, 0x2ec4b6, 0xffd23f, 0x7b5cff, 0xff8c1a, 0x3a86ff];
export const K_TAILS = [{ name: 'No tail', len: 0 }, { name: 'Short tail', len: 0.6 }, { name: 'Long tail', len: 1.3 }];

export const kiteCfg = {
  mode: 'battle' as KMode,
  place: 'village' as KPlace,
  time: 'golden' as KTime,
  shape: 0,
  color: 0,
  tail: 2,
};

export function loadKiteCfg(): void {
  try {
    const s = JSON.parse(localStorage.getItem('guti-kite-cfg') ?? '{}');
    for (const k of Object.keys(kiteCfg) as (keyof typeof kiteCfg)[]) {
      if (s[k] !== undefined) (kiteCfg as Record<string, unknown>)[k] = s[k];
    }
  } catch {
    /* ignore */
  }
}
export function saveKiteCfg(): void {
  try {
    localStorage.setItem('guti-kite-cfg', JSON.stringify(kiteCfg));
  } catch {
    /* ignore */
  }
}

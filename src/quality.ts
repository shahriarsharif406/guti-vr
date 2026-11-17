/** Adaptive quality governor: watches frame time, steps tier 3 (Ultra) .. 0 (Low). Q cycles manually. */
export const quality = { tier: 3, manual: false };
const NAMES = ['Low', 'Medium', 'High', 'Ultra'];
let acc = 0;
let n = 0;
let slow = 0;
export function qualityName(): string {
  return NAMES[quality.tier];
}
export function tickQuality(dt: number): void {
  if (quality.manual) return;
  if (dt > 0.25) return; // tab switch / load hitch
  acc += dt;
  n++;
  if (n < 90) return;
  const avg = acc / n;
  acc = 0;
  n = 0;
  if (avg > 1 / 50) slow++;
  else slow = Math.max(0, slow - 1);
  if (slow >= 2 && quality.tier > 0) {
    quality.tier--;
    slow = 0;
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'q' || e.key === 'Q') {
      quality.manual = true;
      quality.tier = (quality.tier + 3) % 4; // 3 -> 2 -> 1 -> 0 -> 3
    }
  });
}

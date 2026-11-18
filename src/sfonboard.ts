/**
 * SPELLFORGE onboarding (pure logic, no rendering): one-time contextual tips for a first run and
 * discovery nudges that point toward fusions the player has not found yet, without naming them.
 */
import type { Element } from './sfdata';
import { ELEMENT_NAME, FUSIONS } from './sfdata';

export type TipId = 'shield' | 'lowhp' | 'phase' | 'fizzle' | 'fusion' | 'absorb';
export const TIPS: Record<TipId, { xr: string; desk: string }> = {
  shield: { xr: 'Tip: an attack is winding up. Cross your wrists in front of you to raise a shield.', desk: 'Tip: an attack is winding up. Hold SPACE or the right mouse button to shield.' },
  lowhp: { xr: 'Tip: you are hurt and health does not come back on its own. Shield more (cross your wrists); an Aether + Verdant fusion heals.', desk: 'Tip: you are hurt and health does not come back on its own. Shield more (SPACE); an Aether + Verdant fusion heals.' },
  phase: { xr: 'Tip: a new boss phase means new attacks. Read the line under the bar for how to beat it.', desk: 'Tip: a new boss phase means new attacks. Read the line under the bar for how to beat it.' },
  fizzle: { xr: 'Tip: a spell fizzled. The line below says why: charge longer, or wait for energy to refill.', desk: 'Tip: a spell fizzled. The line below says why: hold the button longer, or wait for energy to refill.' },
  fusion: { xr: 'Tip: touch a different sigil with each hand to mix two elements into a fusion.', desk: 'Tip: give each hand a different element (Shift+1-6 right, Alt+1-6 left) to mix a fusion.' },
  absorb: { xr: 'Tip: some foes feed on one element. Switch sigils or mix two elements.', desk: 'Tip: some foes feed on one element. Switch elements (keys 1-6) or mix two.' },
};
export const ALL_TIPS = Object.keys(TIPS) as TipId[];

/** Text for a tip the player has not seen yet, or '' (seen tips are skipped). Marks it seen. */
export function takeTip(id: TipId, seen: string[], xr: boolean): string {
  if (seen.includes(id)) return '';
  seen.push(id);
  return xr ? TIPS[id].xr : TIPS[id].desk;
}

/**
 * A nudge toward an undiscovered fusion that uses one of the currently attuned elements.
 * It names the partner element but not the fusion, so finding it is still a discovery. '' when all are found.
 */
export function fusionNudge(discovered: ReadonlySet<string>, left: Element, right: Element): string {
  const found = FUSIONS.filter((f) => discovered.has(f.id)).length;
  if (found >= FUSIONS.length) return 'All ' + FUSIONS.length + ' fusions discovered.';
  for (const el of right === left ? [right] : [right, left]) {
    const open = FUSIONS.filter((f) => !discovered.has(f.id) && f.elements.includes(el));
    if (open.length) {
      const other = open[0].elements[0] === el ? open[0].elements[1] : open[0].elements[0];
      return ELEMENT_NAME[el] + ' still hides ' + open.length + (open.length === 1 ? ' fusion' : ' fusions') + '. Try it with ' + ELEMENT_NAME[other] + '.  (' + found + '/' + FUSIONS.length + ' found)';
    }
  }
  const any = FUSIONS.find((f) => !discovered.has(f.id))!;
  return 'Undiscovered fusions remain. Try ' + ELEMENT_NAME[any.elements[0]] + ' with ' + ELEMENT_NAME[any.elements[1]] + '.  (' + found + '/' + FUSIONS.length + ' found)';
}

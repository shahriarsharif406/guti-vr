/**
 * "Workshop Mentor": after you finish something, a small language model gives one
 * friendly line of feedback on what you actually built. It uses a free, key-less
 * text endpoint (Pollinations). If the network is slow or blocked, a built-in
 * line is used instead, so the game never waits on it.
 */
const FALLBACK: Record<string, string[]> = {
  dominoes: ['Nice rhythm. Every domino counts.', 'A tidy chain. Try a curve next time!', 'Satisfying. Add a few more for a long run.'],
  bricks: ['Solid build. That went down with a bang!', 'Bold tower. Tall ones fall best.', 'Good eye. Try mixing colours next time.'],
  gears: ['Beautiful ratio. That machine hums.', 'Clever gearing. Every tooth earned its place.', 'You found the fit. Smooth as clockwork.'],
  pottery: ['A lovely shape. The glaze suits it.', 'Steady hands. That pot has character.', 'Nice curves. Try a narrower neck next.'],
};

function pick(kind: string): string {
  const a = FALLBACK[kind] ?? FALLBACK.bricks;
  return a[Math.floor(Math.random() * a.length)];
}

export function askMentor(kind: 'dominoes' | 'bricks' | 'pottery' | 'gears', facts: string, done: (line: string) => void): void {
  const prompt =
    'You are a warm, witty craft mentor in a tiny VR workshop. In ONE short sentence (max 14 words, no quotes, no emojis) comment on what the player just made. Facts: ' +
    facts;
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), 5000);
  fetch('https://text.pollinations.ai/' + encodeURIComponent(prompt) + '?model=openai-fast', { signal: ctl.signal })
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error('http'))))
    .then((t) => {
      window.clearTimeout(timer);
      const line = t.replace(/\s+/g, ' ').trim();
      done(line.length >= 8 && line.length <= 110 && !line.startsWith('{') && !line.startsWith('<') ? line : pick(kind));
    })
    .catch(() => {
      window.clearTimeout(timer);
      done(pick(kind));
    });
}

/** A one-sentence challenge story for a goal the game itself will verify (so it is always fair). */
export function askChallenge(kind: 'dominoes' | 'bricks', goal: string, done: (line: string) => void): void {
  const prompt =
    'You are a playful craft mentor in a tiny VR workshop. Write ONE short sentence (max 12 words, no quotes, no emojis) that sets this challenge as a fun mini story: ' +
    goal;
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), 5000);
  const ok = (t: string): boolean => t.length >= 8 && t.length <= 90 && !t.startsWith('{') && !t.startsWith('<');
  fetch('https://text.pollinations.ai/' + encodeURIComponent(prompt) + '?model=openai-fast', { signal: ctl.signal })
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error('http'))))
    .then((t) => {
      window.clearTimeout(timer);
      const line = t.replace(/\s+/g, ' ').trim();
      done(ok(line) ? line : goal);
    })
    .catch(() => {
      window.clearTimeout(timer);
      done(goal);
    });
  void kind;
}

/**
 * Aura Weaver: the thread PLAY controller (pure; no rendering). Turns pointer input in board coordinates into
 * weaving actions: grab a node and pull a thread, stretch it (tension), release on a node to connect, tap a thread to
 * cut it, pull a full node's thread off to re-route it, turn celestial rings, hold keys, switch era, record and
 * replay memory echoes. Emits events that the view, audio and save layers listen to.
 * Unit-tested in tests/aura.test.ts (thread grabbing, connections, reset, ring turns, echo replay).
 */
import { ECHO_MAX, EchoTrack, LIVE_HOLDS, OUT_CAP, brokenThreads, canWeave, echoReady, evaluate, freshState, holdLimit, keyAt, latchMemories, nodePos, reach, solveWeave } from './threadlogic.js';
import type { Era, Thread, Weave, WeaveEval, WeaveRefusal, WeaveSolution, WeaveState } from './threadlogic.js';

export type PlayEvent =
  | { t: 'grab'; node: number }
  | { t: 'connect'; a: number; b: number; len: number }
  | { t: 'refuse'; reason: WeaveRefusal | 'no-node'; a: number }
  | { t: 'cut'; a: number; b: number }
  | { t: 'snap'; a: number; b: number }
  | { t: 'hold'; node: number }
  | { t: 'release'; node: number }
  | { t: 'ring'; ring: number; step: number }
  | { t: 'ringLocked'; ring: number }
  | { t: 'era'; era: Era }
  | { t: 'recStart' }
  | { t: 'recStop'; ok: boolean }
  | { t: 'echoHold'; node: number }
  | { t: 'power'; node: number }
  | { t: 'receiver'; node: number; on: boolean }
  | { t: 'latch'; node: number }
  | { t: 'align'; socket: number; on: boolean };

type DragKind = 'thread' | 'ring' | 'press';
interface Drag {
  kind: DragKind;
  node: number;
  ring: number;
  x: number;
  y: number;
  sx: number;
  sy: number;
  ang0: number;
  a0: number;
  moved: boolean;
  t0: number;
}
export interface PlayHint {
  kind: 'thread' | 'ring' | 'era' | 'record' | 'hold' | 'cut' | 'charge' | 'none';
  a: number;
  b: number;
  era: Era;
  ring: number;
  step: number;
}

export const TAP_MOVE = 0.03;
export const TAP_TIME = 0.45;

export class ThreadPlay {
  s: WeaveState;
  ev: WeaveEval;
  readonly drags = new Map<number, Drag>();
  readonly events: PlayEvent[] = [];
  /** finished echoes (looping) and the playback clock of each */
  readonly echoes: EchoTrack[] = [];
  echoClock: number[] = [];
  /** the board position each echo is replaying right now (for its ghost) */
  readonly echoPose: { x: number; y: number; down: boolean; t: number }[] = [];
  rec: EchoTrack | null = null;
  private recPid = -1;
  private liveHold: { pid: number; node: number } | null = null;
  private track = new Map<number, { x: number; y: number; down: boolean }>();
  time = 0;
  moves = 0;
  sol: WeaveSolution | null = null;
  private prevMask: number[] = [];
  private prevRecv: boolean[] = [];
  private prevAlign: boolean[] = [];
  private ringStart: number[];

  constructor(
    public w: Weave,
    public pickR = 0.055,
    slack = 0,
  ) {
    this.ringStart = w.rings.map((r) => r.a);
    this.s = freshState(w, w.eras === 2 ? 2 : 2);
    this.s.slack = slack;
    this.s.lightOn = [false, false, false];
    this.ev = evaluate(w, this.s);
    this.snapshot();
    this.sol = solveWeave(w, { slack });
  }

  private snapshot(): void {
    this.prevMask = this.ev.mask[1].map((m, i) => m | this.ev.mask[0][i]);
    this.prevRecv = this.ev.receiverOk.slice();
    this.prevAlign = this.ev.aligned.slice();
  }

  reset(): void {
    this.w.rings.forEach((r, i) => (r.a = this.ringStart[i]));
    const light = this.s.lightOn;
    const slack = this.s.slack;
    this.s = freshState(this.w);
    this.s.slack = slack;
    this.s.lightOn = light;
    this.drags.clear();
    this.echoes.length = 0;
    this.echoClock.length = 0;
    this.echoPose.length = 0;
    this.rec = null;
    this.liveHold = null;
    this.moves = 0;
    this.ev = evaluate(this.w, this.s);
    this.snapshot();
  }

  setSlack(v: number): void {
    this.s.slack = v;
  }
  setLight(i: number, on: boolean): void {
    this.s.lightOn[i] = on;
  }

  // ---------------------------------------------------------------- picking
  nearestNode(x: number, y: number, r = this.pickR, except = -1): number {
    let best = -1;
    let bd = r;
    const ei = this.s.era - 1;
    const p = { x: 0, y: 0 };
    for (let i = 0; i < this.w.nodes.length; i++) {
      if (i === except || !this.ev.exists[ei][i]) continue;
      nodePos(this.w, i, p);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }
  ringAt(x: number, y: number): number {
    let best = -1;
    let bd = Math.max(0.03, this.pickR * 0.6);
    this.w.rings.forEach((r, i) => {
      const d = Math.abs(Math.hypot(x - r.cx, y - r.cy) - r.r);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }
  /** a woven (non-fixed) thread of the current era near a point */
  threadAt(x: number, y: number, r = 0.025): Thread | null {
    let best: Thread | null = null;
    let bd = r;
    const p = { x: 0, y: 0 };
    const q = { x: 0, y: 0 };
    for (const t of this.s.threads) {
      if (t.era !== this.s.era) continue;
      nodePos(this.w, t.a, p);
      nodePos(this.w, t.b, q);
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const L2 = dx * dx + dy * dy || 1e-9;
      const u = Math.max(0, Math.min(1, ((x - p.x) * dx + (y - p.y) * dy) / L2));
      const d = Math.hypot(p.x + dx * u - x, p.y + dy * u - y);
      if (d < bd && u > 0.12 && u < 0.88) {
        bd = d;
        best = t;
      }
    }
    return best;
  }
  ringFree(i: number): boolean {
    const m = this.w.rings[i].motor;
    return m < 0 || this.ev.motorOn[m];
  }
  private outLeft(n: number, era: Era = this.s.era): number {
    const used = this.w.fixed.concat(this.s.threads).filter((t) => t.era === era && t.a === n).length;
    return OUT_CAP[this.w.nodes[n].kind] - used;
  }

  // ---------------------------------------------------------------- input (board coordinates)
  /** per-frame pointer position (used by the echo recorder and by hover); call before down/up */
  trackPointer(pid: number, x: number, y: number, down: boolean): void {
    const t = this.track.get(pid);
    if (t) {
      t.x = x;
      t.y = y;
      t.down = down;
    } else this.track.set(pid, { x, y, down });
  }

  /** Returns true if the press landed on something of the thread board. */
  down(pid: number, x: number, y: number): boolean {
    const n = this.nearestNode(x, y);
    const d: Drag = { kind: 'press', node: -1, ring: -1, x, y, sx: x, sy: y, ang0: 0, a0: 0, moved: false, t0: this.time };
    if (n >= 0) {
      const kind = this.w.nodes[n].kind;
      d.node = n;
      const nd = this.w.nodes[n];
      if (kind === 'star' && nd.ring >= 0 && this.ev.mask[0][n] === 0 && this.ev.mask[1][n] === 0) {
        // a dark star carries no energy to weave: taking hold of it turns its ring instead
        const R = this.w.rings[nd.ring];
        if (!this.ringFree(nd.ring)) this.events.push({ t: 'ringLocked', ring: nd.ring });
        else {
          d.kind = 'ring';
          d.ring = nd.ring;
          d.node = -1;
          d.ang0 = Math.atan2(y - R.cy, x - R.cx);
          d.a0 = R.a;
        }
      } else if (kind === 'key') {
        d.kind = 'press';
        this.holdKey(pid, n);
      } else if (kind === 'memory' && echoReady(this.w, this.s)) {
        d.kind = 'press';
      } else if (this.outLeft(n) > 0) {
        d.kind = 'thread';
        this.events.push({ t: 'grab', node: n });
      } else {
        // a full node: pull its own woven thread off and carry it somewhere new
        const own = this.s.threads.filter((t) => t.era === this.s.era && t.a === n);
        if (own.length) {
          const t = own[own.length - 1];
          this.removeThread(t, 'cut');
          d.kind = 'thread';
          this.events.push({ t: 'grab', node: n });
        } else d.kind = 'press';
      }
      this.drags.set(pid, d);
      return true;
    }
    const r = this.ringAt(x, y);
    if (r >= 0) {
      const R = this.w.rings[r];
      if (!this.ringFree(r)) {
        this.events.push({ t: 'ringLocked', ring: r });
        this.drags.set(pid, d);
        return true;
      }
      d.kind = 'ring';
      d.ring = r;
      d.ang0 = Math.atan2(y - R.cy, x - R.cx);
      d.a0 = R.a;
      this.drags.set(pid, d);
      return true;
    }
    const th = this.threadAt(x, y);
    if (th) {
      d.kind = 'press';
      this.drags.set(pid, d);
      return true;
    }
    return false;
  }

  move(pid: number, x: number, y: number): void {
    const d = this.drags.get(pid);
    if (!d) return;
    d.x = x;
    d.y = y;
    if (Math.hypot(x - d.sx, y - d.sy) > TAP_MOVE) d.moved = true;
    if (d.kind === 'press' && d.node >= 0 && d.moved && Math.hypot(x - d.sx, y - d.sy) > 0.06) {
      const kind = this.w.nodes[d.node].kind;
      // pulling away from a key or the memory crystal turns the press into a thread
      if ((kind === 'key' || kind === 'memory') && this.outLeft(d.node) > 0) {
        if (kind === 'key') this.releaseKey(pid);
        d.kind = 'thread';
        this.events.push({ t: 'grab', node: d.node });
      }
    }
    if (d.kind === 'ring') {
      const R = this.w.rings[d.ring];
      if (!this.ringFree(d.ring)) return;
      let da = Math.atan2(y - R.cy, x - R.cx) - d.ang0;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      const step = (((d.a0 + Math.round((da / (Math.PI * 2)) * R.steps)) % R.steps) + R.steps) % R.steps;
      if (step !== R.a) this.setRing(d.ring, step);
    }
  }

  up(pid: number, x: number, y: number): void {
    const d = this.drags.get(pid);
    if (!d) return;
    this.drags.delete(pid);
    d.x = x;
    d.y = y;
    const tap = !d.moved && this.time - d.t0 < TAP_TIME;
    if (d.kind === 'thread') {
      const b = this.nearestNode(x, y, this.pickR, d.node);
      if (b < 0) {
        if (d.moved) this.events.push({ t: 'refuse', reason: 'no-node', a: d.node });
        return;
      }
      this.tryConnect(d.node, b);
      return;
    }
    if (d.kind === 'press') {
      if (d.node >= 0 && this.w.nodes[d.node].kind === 'key') this.releaseKey(pid);
      if (!tap) return;
      if (d.node >= 0 && this.w.nodes[d.node].kind === 'memory' && echoReady(this.w, this.s)) {
        this.toggleRecord(pid);
        return;
      }
      if (d.node >= 0) {
        // tap a node: cut the newest woven thread arriving at it
        const inc = this.s.threads.filter((t) => t.era === this.s.era && t.b === d.node);
        if (inc.length) this.removeThread(inc[inc.length - 1], 'cut');
        return;
      }
      const th = this.threadAt(d.sx, d.sy);
      if (th) this.removeThread(th, 'cut');
    }
    if (d.kind === 'ring' && tap) this.setRing(d.ring, (this.w.rings[d.ring].a + 1) % this.w.rings[d.ring].steps);
  }

  /** Abort every drag (e.g. pause). Live key holds are released. */
  cancel(): void {
    for (const pid of [...this.drags.keys()]) {
      const d = this.drags.get(pid);
      if (d && d.node >= 0 && this.w.nodes[d.node].kind === 'key') this.releaseKey(pid);
    }
    this.drags.clear();
  }

  tryConnect(a: number, b: number): boolean {
    const why = canWeave(this.w, this.s, a, b);
    if (why !== '') {
      this.events.push({ t: 'refuse', reason: why, a });
      return false;
    }
    const t: Thread = { a, b, era: this.s.era };
    this.s.threads.push(t);
    this.moves++;
    const p = nodePos(this.w, a);
    const q = nodePos(this.w, b);
    this.events.push({ t: 'connect', a, b, len: Math.hypot(q.x - p.x, q.y - p.y) / reach(this.w, this.s) });
    this.refresh();
    return true;
  }
  removeThread(t: Thread, why: 'cut' | 'snap'): void {
    const i = this.s.threads.indexOf(t);
    if (i < 0) return;
    this.s.threads.splice(i, 1);
    if (why === 'cut') this.moves++;
    this.events.push({ t: why, a: t.a, b: t.b });
    this.refresh();
  }
  setRing(i: number, step: number): void {
    if (!this.ringFree(i)) {
      this.events.push({ t: 'ringLocked', ring: i });
      return;
    }
    this.w.rings[i].a = step;
    this.moves++;
    this.events.push({ t: 'ring', ring: i, step });
    for (const t of brokenThreads(this.w, this.s)) this.removeThread(t, 'snap');
    this.refresh();
  }
  toggleEra(): void {
    if (this.w.eras !== 2) return;
    this.cancel();
    this.s.era = this.s.era === 2 ? 1 : 2;
    this.events.push({ t: 'era', era: this.s.era });
    this.refresh();
  }
  private holdKey(pid: number, n: number): void {
    // one living hand holds one key: a new hold lets go of the previous one
    if (this.liveHold && this.liveHold.node !== n) this.events.push({ t: 'release', node: this.liveHold.node });
    this.liveHold = { pid, node: n };
    this.events.push({ t: 'hold', node: n });
    this.refresh();
  }
  private releaseKey(pid: number): void {
    if (this.liveHold && this.liveHold.pid === pid) {
      // letting go of a keystone while recording seals the echo: its last pose is the hold, so it keeps holding
      if (this.rec && this.rec.recording && this.recPid === pid && this.rec.samples.some((q) => q.down)) this.stopRecord();
      this.events.push({ t: 'release', node: this.liveHold.node });
      this.liveHold = null;
      this.refresh();
    }
  }
  toggleRecord(pid: number): void {
    if (this.rec && this.rec.recording) {
      this.stopRecord();
      return;
    }
    if (!echoReady(this.w, this.s)) return;
    this.rec = new EchoTrack();
    this.rec.start(this.time);
    this.recPid = pid;
    this.events.push({ t: 'recStart' });
  }
  private stopRecord(): void {
    if (!this.rec) return;
    this.rec.stop();
    const ok = this.rec.samples.length > 1;
    if (ok) {
      // a new echo replaces the oldest when every slot is used
      if (this.echoes.length >= Math.max(1, this.w.echoSlots)) {
        this.echoes.shift();
        this.echoClock.shift();
        this.echoPose.shift();
      }
      this.echoes.push(this.rec);
      this.echoClock.push(0);
      this.echoPose.push({ x: 0, y: 0, down: false, t: 0 });
    }
    this.events.push({ t: 'recStop', ok });
    this.rec = null;
    this.recPid = -1;
  }

  // ---------------------------------------------------------------- simulation step
  tick(dt: number): void {
    this.time += dt;
    if (this.rec && this.rec.recording) {
      const p = this.track.get(this.recPid);
      if (p) {
        // the recording hand's own tap on the memory crystal must not end up in the echo as a key hold
        if (!this.rec.add(this.time, p.x, p.y, p.down)) this.stopRecord();
      } else if (this.time > 0 && !this.rec.add(this.time, 0, 0, false)) this.stopRecord();
    }
    const echoHeld: number[] = [];
    this.echoes.forEach((e, i) => {
      this.echoClock[i] += dt;
      const o = this.echoPose[i];
      e.sample(this.echoClock[i], o as never);
      if (o.down) {
        const k = keyAt(this.w, o.x, o.y, this.pickR);
        if (k >= 0) echoHeld.push(k);
      }
    });
    const limit = holdLimit(this.w, this.s, this.echoes.length);
    const held: number[] = [];
    if (this.liveHold) held.push(this.liveHold.node);
    for (const k of echoHeld) if (held.length < limit && !held.includes(k)) held.push(k);
    const before = this.s.held.join();
    this.s.held = held;
    if (held.join() !== before) {
      for (const k of echoHeld) if (!before.split(',').includes(String(k))) this.events.push({ t: 'echoHold', node: k });
    }
    this.refresh();
  }

  /** re-evaluate energy and emit change events (power, receivers, constellation, memory latches) */
  refresh(): void {
    this.ev = evaluate(this.w, this.s);
    if (latchMemories(this.w, this.s, this.ev)) {
      this.s.latched.forEach((l, i) => l && !this.prevLatched(i) && this.events.push({ t: 'latch', node: i }));
      this.ev = evaluate(this.w, this.s);
    }
    const m = this.ev.mask[1].map((v, i) => v | this.ev.mask[0][i]);
    m.forEach((v, i) => {
      if (v && !this.prevMask[i]) this.events.push({ t: 'power', node: i });
    });
    this.ev.receiverOk.forEach((ok, i) => {
      if (this.w.nodes[i].kind === 'receiver' && ok !== this.prevRecv[i]) this.events.push({ t: 'receiver', node: i, on: ok });
    });
    this.ev.aligned.forEach((ok, i) => {
      if (ok !== this.prevAlign[i]) this.events.push({ t: 'align', socket: i, on: ok });
    });
    this.latchedSeen = this.s.latched.slice();
    this.snapshot();
  }
  private latchedSeen: boolean[] = [];
  private prevLatched(i: number): boolean {
    return this.latchedSeen[i] === true;
  }

  get liveKey(): number {
    return this.liveHold ? this.liveHold.node : -1;
  }
  get recording(): boolean {
    return !!this.rec && this.rec.recording;
  }
  get recordLeft(): number {
    return this.rec && this.rec.recording ? Math.max(0, ECHO_MAX - this.rec.length) : 0;
  }
  dragOf(pid: number): Drag | undefined {
    return this.drags.get(pid);
  }
  /** first active thread drag (for the stretched preview thread) */
  threadDrags(): Drag[] {
    const out: Drag[] = [];
    for (const d of this.drags.values()) if (d.kind === 'thread') out.push(d);
    return out;
  }

  // ---------------------------------------------------------------- assisted play
  /**
   * Perform the next hinted step through the same actions a player uses (unit tests, the e2e script and the
   * optional "weave for me" accessibility assist). Returns false when there is nothing left to do.
   */
  autoStep(): boolean {
    const h = this.hint();
    const sameEra = (t: Thread): boolean => t.era === this.s.era;
    if (h.kind === 'thread') {
      if (this.tryConnect(h.a, h.b)) return true;
      const own = this.s.threads.filter((t) => sameEra(t) && t.a === h.a);
      const inc = this.s.threads.filter((t) => sameEra(t) && t.b === h.b);
      const t = own[own.length - 1] ?? inc[inc.length - 1];
      if (!t) return false;
      this.removeThread(t, 'cut');
      return true;
    }
    if (h.kind === 'ring') {
      this.setRing(h.ring, h.step);
      return true;
    }
    if (h.kind === 'era') {
      this.toggleEra();
      return true;
    }
    if (h.kind === 'cut') {
      const t = this.s.threads.find((u) => u.a === h.a && u.b === h.b && u.era === h.era);
      if (!t) return false;
      this.removeThread(t, 'cut');
      return true;
    }
    if (h.kind === 'record' || h.kind === 'hold') {
      const p = nodePos(this.w, h.b);
      const pid = h.kind === 'record' ? 7 : 8;
      if (h.kind === 'record') this.toggleRecord(pid);
      this.trackPointer(pid, p.x, p.y, true);
      this.down(pid, p.x, p.y);
      for (let i = 0; i < 6; i++) this.tick(0.1);
      if (h.kind === 'record') {
        this.trackPointer(pid, p.x, p.y, false);
        this.up(pid, p.x, p.y);
        this.tick(0.1);
      }
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- hints
  /** The next helpful step towards the solver's solution (never random). */
  hint(): PlayHint {
    const h: PlayHint = { kind: 'none', a: -1, b: -1, era: this.s.era, ring: -1, step: 0 };
    if (this.ev.solved) return h;
    const sol = this.sol;
    if (!sol) return h;
    // rings first: geometry decides which threads can reach
    for (let i = 0; i < this.w.rings.length; i++) {
      if (this.w.rings[i].a === sol.rings[i]) continue;
      if (!this.ringFree(i)) {
        const m = this.w.rings[i].motor;
        const src = this.feederFor(m);
        if (src >= 0) return { ...h, kind: 'thread', a: src, b: m, era: this.s.era };
        return { ...h, kind: 'charge', b: m };
      }
      return { ...h, kind: 'ring', ring: i, step: sol.rings[i] };
    }
    // memory crystal must be charged before any echo
    if (sol.echoes > 0 && !echoReady(this.w, this.s)) {
      const mem = this.w.nodes.findIndex((n) => n.kind === 'memory');
      const ok = (era: Era): boolean => this.ev.mask[era - 1][mem] !== 0;
      if (mem >= 0 && !ok(1) && !ok(2)) {
        for (const era of (this.w.eras === 2 ? [this.s.era, this.s.era === 2 ? 1 : 2] : [2]) as Era[]) {
          const src = this.feederFor(mem, era);
          if (src >= 0) return era === this.s.era ? { ...h, kind: 'thread', a: src, b: mem, era } : { ...h, kind: 'era', era };
        }
        return { ...h, kind: 'charge', b: mem };
      }
    }
    const have = (t: Thread): boolean => this.w.fixed.concat(this.s.threads).some((u) => u.a === t.a && u.b === t.b && u.era === t.era);
    const missing = sol.threads.filter((t) => !have(t));
    const here = missing.find((t) => t.era === this.s.era);
    if (here) {
      const why = canWeave(this.w, this.s, here.a, here.b, here.era);
      if (why === '' || why === 'too-long') return { ...h, kind: 'thread', a: here.a, b: here.b, era: here.era };
      // something in the way: suggest cutting a woven thread that is not part of the plan
      const extra = this.s.threads.find((t) => t.era === this.s.era && !sol.threads.some((u) => u.a === t.a && u.b === t.b && u.era === t.era));
      if (extra) return { ...h, kind: 'cut', a: extra.a, b: extra.b, era: extra.era };
      return { ...h, kind: 'thread', a: here.a, b: here.b, era: here.era };
    }
    if (missing.length) return { ...h, kind: 'era', era: missing[0].era };
    const extra = this.s.threads.find((t) => !sol.threads.some((u) => u.a === t.a && u.b === t.b && u.era === t.era));
    if (extra && extra.era === this.s.era) return { ...h, kind: 'cut', a: extra.a, b: extra.b, era: extra.era };
    if (sol.held.length > LIVE_HOLDS && this.echoes.length < sol.echoes) return { ...h, kind: 'record', b: sol.held[0] };
    const needKey = sol.held.find((k) => !this.s.held.includes(k));
    if (needKey !== undefined) return { ...h, kind: 'hold', b: needKey };
    return h;
  }
  /** a powered node in `era` that could weave straight to node `to` */
  private feederFor(to: number, era: Era = this.s.era): number {
    for (let a = 0; a < this.w.nodes.length; a++) {
      if (this.ev.mask[era - 1][a] === 0 || !this.ev.exists[era - 1][a]) continue;
      if (canWeave(this.w, this.s, a, to, era) === '') return a;
    }
    // or one whose thread is busy elsewhere (the player can pull it off)
    for (let a = 0; a < this.w.nodes.length; a++) {
      if (this.ev.mask[era - 1][a] === 0 || !this.ev.exists[era - 1][a]) continue;
      const p = nodePos(this.w, a);
      const q = nodePos(this.w, to);
      const busy = this.s.threads.some((t) => t.era === era && t.a === a);
      if (busy && Math.hypot(q.x - p.x, q.y - p.y) <= reach(this.w, this.s) && OUT_CAP[this.w.nodes[a].kind] > 0) return a;
    }
    return -1;
  }
}

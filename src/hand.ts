import { Vector3 } from '@iwsdk/core';

/**
 * Hand-tracking helper: the real pinch point (midpoint of thumb tip and index
 * tip), not the wrist/palm. Joint transforms are expressed in grip space, so
 * the result is converted to world space through the grip space object.
 */
interface TipIndices {
  thumb: number;
  index: number;
  count: number;
}

// Cached per adapter, so nothing is allocated per frame.
const cache = new WeakMap<object, TipIndices>();
const a = new Vector3();

export interface HandAdapterLike {
  connected: boolean;
  gripSpace?: {
    updateWorldMatrix(updateParents: boolean, updateChildren: boolean): void;
    localToWorld(v: Vector3): Vector3;
    getWorldPosition(v: Vector3): Vector3;
  };
  jointSpaces?: { jointName?: string }[];
  jointTransforms?: Float32Array;
}

function indicesFor(ad: HandAdapterLike): TipIndices | null {
  const joints = ad.jointSpaces;
  if (!joints || joints.length === 0) return null;
  const hit = cache.get(ad);
  if (hit && hit.count === joints.length) return hit;
  let thumb = -1;
  let index = -1;
  for (let i = 0; i < joints.length; i++) {
    const n = joints[i].jointName;
    if (n === 'thumb-tip') thumb = i;
    else if (n === 'index-finger-tip') index = i;
  }
  if (thumb < 0 || index < 0) return null;
  const t = { thumb, index, count: joints.length };
  cache.set(ad, t);
  return t;
}

/**
 * Writes the world-space pinch point into `out`. Returns false when the
 * fingertip joints are not available (caller falls back to the grip pose).
 */
export function readPinchPoint(ad: HandAdapterLike, out: Vector3): boolean {
  if (!ad.connected || !ad.gripSpace || !ad.jointTransforms) return false;
  const t = indicesFor(ad);
  if (!t) return false;
  const m = ad.jointTransforms;
  if (m.length < (Math.max(t.thumb, t.index) + 1) * 16) return false;
  const ti = t.thumb * 16;
  const ii = t.index * 16;
  const x = (m[ti + 12] + m[ii + 12]) * 0.5;
  const y = (m[ti + 13] + m[ii + 13]) * 0.5;
  const z = (m[ti + 14] + m[ii + 14]) * 0.5;
  if (!Number.isFinite(x + y + z)) return false;
  // all-zero means the runtime has not filled the joints yet
  if (x === 0 && y === 0 && z === 0 && m[ti + 12] === 0 && m[ii + 12] === 0) return false;
  ad.gripSpace.updateWorldMatrix(true, false);
  a.set(x, y, z);
  ad.gripSpace.localToWorld(a);
  out.copy(a);
  return true;
}

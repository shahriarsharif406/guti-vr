/**
 * Neon Overdrive environment: the car stays at the origin and the world scrolls past it (stable cockpit reference,
 * endless-road illusion). Three zone kinds read from the track pattern: night city, speed tunnel, open highway.
 * Everything repeated is instanced and recycled by track coordinate; nothing is allocated per frame.
 */
import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Path,
  PlaneGeometry,
  Points,
  PointsMaterial,
  ShaderMaterial,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
} from '@iwsdk/core';
import { NEON } from './gsstage.js';
import { zoneAt } from './racelogic.js';
import type { Track, ZoneKind } from './racelogic.js';

const hash = (n: number): number => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const FOG_V = /* glsl */ `
  varying float vFogD;
  varying vec3 vLocal;
  uniform vec3 uOrigin;
`;
const FOG_F = /* glsl */ `
  varying float vFogD;
  varying vec3 vLocal;
  uniform vec3 uFog;
  uniform float uFogK;
  uniform float uDist;
  uniform float uTime;
  uniform float uBeat;
  uniform float uSpeed;
  uniform vec2 uTun;
  uniform float uGlow;
  vec3 fogged(vec3 c, float keep) {
    float f = 1.0 - exp(-uFogK * uFogK * vFogD * vFogD);
    return mix(c, uFog, clamp(f, 0.0, 1.0) * (1.0 - keep));
  }
  float hash1(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
  float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  vec3 palette(float s) {
    vec3 cy = vec3(0.02, 0.78, 1.0);
    vec3 mg = vec3(1.0, 0.03, 0.66);
    vec3 vi = vec3(0.25, 0.04, 1.0);
    vec3 am = vec3(1.0, 0.42, 0.03);
    vec3 em = vec3(0.01, 0.9, 0.25);
    float t = fract(s) * 5.0;
    if (t < 1.6) return cy;
    if (t < 3.1) return mg;
    if (t < 4.0) return vi;
    if (t < 4.6) return am;
    return em;
  }
`;
const INST_V = /* glsl */ `
  attribute float aSeed;
  varying float vSeed;
  varying vec3 vObj;
  varying vec3 vN;
  varying vec3 vScale;
  ${FOG_V}
  void main() {
    vSeed = aSeed;
    vObj = position;
    vN = normal;
    mat4 im = mat4(1.0);
    #ifdef USE_INSTANCING
      im = instanceMatrix;
    #endif
    vScale = vec3(length(im[0].xyz), length(im[1].xyz), length(im[2].xyz));
    vec4 wp = modelMatrix * im * vec4(position, 1.0);
    vLocal = wp.xyz - uOrigin;
    vec4 mv = viewMatrix * wp;
    vFogD = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

export interface WorldFrame {
  distance: number;
  speed: number; // m/s
  time: number;
  beat: number; // 0..1 pulse on the music beat
  progress: number; // 0..1 through the race
  boost: number; // 0..1
  intensity: number; // visual intensity setting 0..1
  cornerIn: number; // metres to the next braking point
  braking: boolean;
}

export class RaceWorld {
  readonly root = new Group();
  private readonly uni = {
    uOrigin: { value: new Vector3() },
    uFog: { value: new Color(0x0a0618) },
    uFogK: { value: 0.0075 },
    uDist: { value: 0 },
    uTime: { value: 0 },
    uBeat: { value: 0 },
    uSpeed: { value: 0 },
    uTun: { value: new Vector2(-1e6, -1e6) },
    uGlow: { value: 1 },
  };
  private readonly skyU = { uSun: { value: 0.4 }, uProgress: { value: 0 }, uRain: { value: 0 }, uCity: { value: 1 } };
  private readonly roadU = { uCorner: { value: 1e6 }, uWet: { value: 0.35 }, uBrake: { value: 0 } };
  private readonly dummy = new Object3D();
  private track!: Track;
  private rain = false;
  private buildings!: InstancedMesh;
  private bSeed!: InstancedBufferAttribute;
  private boards!: InstancedMesh;
  private boardSeed!: InstancedBufferAttribute;
  private neon!: InstancedMesh;
  private neonSeed!: InstancedBufferAttribute;
  private rings!: InstancedMesh;
  private ringSeed!: InstancedBufferAttribute;
  private skyline!: InstancedMesh;
  private shell!: Mesh;
  private portals: Group[] = [];
  private dust!: Points;
  private dustPos!: Float32Array;
  private rainLines!: LineSegments;
  private rainPos!: Float32Array;
  private overpass!: Group;
  private trafficPos!: Float32Array;
  private traffic!: Points;
  private readonly span = { a: -1e6, b: -1e6 };
  private readonly fogTarget = new Color();
  private readonly fogCity = new Color(0x0d0620);
  private readonly fogTunnel = new Color(0x020308);
  private readonly fogHighway = new Color(0x1a0a2c);
  private readonly fogLate = new Color(0x2a0a22);
  private nB = 16;
  private detail = 1;
  zone: ZoneKind = 'city';

  constructor() {
    this.root.name = 'NeonOverdriveWorld';
    this.build();
  }

  private mat(vertex: string, fragment: string, extra: Record<string, { value: unknown }> = {}, opts: Record<string, unknown> = {}): ShaderMaterial {
    return new ShaderMaterial({ uniforms: { ...this.uni, ...extra }, vertexShader: vertex, fragmentShader: fragment, ...opts });
  }

  private build(): void {
    // ---- sky dome
    const sky = new Mesh(
      new SphereGeometry(185, 32, 20),
      new ShaderMaterial({
        side: BackSide,
        depthWrite: false,
        uniforms: { ...this.skyU, uTime: this.uni.uTime, uBeat: this.uni.uBeat },
        vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: /* glsl */ `
          varying vec3 vDir; uniform float uSun; uniform float uProgress; uniform float uRain; uniform float uCity; uniform float uTime; uniform float uBeat;
          float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
          void main(){
            vec3 d = normalize(vDir);
            float y = max(d.y, 0.0);
            vec3 zen = vec3(0.004, 0.005, 0.02);
            vec3 hor = mix(vec3(0.16, 0.02, 0.30), vec3(0.42, 0.03, 0.26), uProgress);
            hor = mix(hor, vec3(0.05,0.06,0.10), uRain * 0.7);
            vec3 col = mix(hor, zen, pow(y, 0.42));
            // city glow hugging the horizon
            col += vec3(0.5, 0.05, 0.4) * exp(-y * 14.0) * 0.35 * uCity;
            col += vec3(0.0, 0.25, 0.4) * exp(-y * 30.0) * 0.3;
            // stars
            vec2 sp = vec2(atan(d.z, d.x) * 60.0, d.y * 90.0);
            vec2 cell = floor(sp);
            float st = step(0.985, h2(cell)) * smoothstep(0.5, 0.0, length(fract(sp) - 0.5)) * smoothstep(0.08, 0.4, y);
            col += vec3(0.8, 0.9, 1.0) * st * (0.6 + 0.4 * sin(uTime * 2.0 + h2(cell) * 30.0)) * (1.0 - uRain);
            // synth sun straight ahead (-z), sliced by horizontal bands
            vec3 sd = normalize(vec3(0.0, 0.16, -1.0));
            float ang = acos(clamp(dot(d, sd), -1.0, 1.0));
            float disc = smoothstep(0.34, 0.33, ang);
            float band = step(0.0, sin((d.y - 0.02) * 150.0 - uTime * 0.6)) + smoothstep(0.16, 0.3, d.y);
            vec3 sunC = mix(vec3(1.0, 0.08, 0.5), vec3(1.0, 0.62, 0.05), smoothstep(0.0, 0.42, d.y));
            col += sunC * disc * clamp(band, 0.0, 1.0) * uSun * 1.1;
            col += sunC * exp(-ang * 4.5) * 0.35 * uSun * (1.0 + 0.15 * uBeat);
            if (d.y < 0.0) col = mix(hor, vec3(0.004,0.005,0.012), clamp(-d.y * 6.0, 0.0, 1.0));
            gl_FragColor = vec4(col, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    );
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    this.root.add(sky);

    // ---- ground grid
    const ground = new Mesh(
      new PlaneGeometry(420, 260),
      this.mat(
        /* glsl */ `${FOG_V} void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vLocal = wp.xyz - uOrigin; vec4 mv = viewMatrix * wp; vFogD = -mv.z; gl_Position = projectionMatrix * mv; }`,
        /* glsl */ `${FOG_F}
          void main(){
            float s = uDist - vLocal.z;
            vec2 g = vec2(vLocal.x, s) / 6.0;
            vec2 f = abs(fract(g) - 0.5);
            float w = fwidth(g.y) * 1.5 + 0.012;
            float line = max(smoothstep(0.5 - w, 0.5, f.x + 0.0), smoothstep(0.5 - w, 0.5, f.y));
            vec3 base = vec3(0.006, 0.006, 0.016);
            vec3 col = base + vec3(0.75, 0.04, 0.6) * line * (0.35 + 0.25 * uBeat) * uGlow;
            col += vec3(0.0, 0.3, 0.5) * exp(-abs(abs(vLocal.x) - 7.2) * 0.5) * 0.25;
            gl_FragColor = vec4(fogged(col, 0.0), 1.0);
            #include <colorspace_fragment>
          }`,
      ),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.03, -100);
    this.root.add(ground);

    // ---- road
    const road = new Mesh(
      new PlaneGeometry(14, 260, 1, 1),
      this.mat(
        /* glsl */ `${FOG_V} void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vLocal = wp.xyz - uOrigin; vec4 mv = viewMatrix * wp; vFogD = -mv.z; gl_Position = projectionMatrix * mv; }`,
        /* glsl */ `${FOG_F}
          uniform float uCorner; uniform float uWet; uniform float uBrake;
          void main(){
            float s = uDist - vLocal.z;
            float x = vLocal.x;
            float ax = abs(x);
            float grain = hash2(floor(vec2(x * 9.0, s * 9.0)));
            vec3 col = vec3(0.012, 0.013, 0.02) + grain * 0.006;
            // lane dashes
            float dash = step(fract(s / 12.0), 0.42);
            float lane = smoothstep(0.09, 0.05, abs(ax - 1.85)) * dash;
            col += vec3(0.55, 0.6, 0.7) * lane * 0.6;
            // neon edge rails: cyan left, magenta right
            vec3 ec = x < 0.0 ? vec3(0.02, 0.78, 1.0) : vec3(1.0, 0.03, 0.66);
            float edge = smoothstep(0.12, 0.04, abs(ax - 5.7));
            float pulse = 0.75 + 0.25 * sin(s * 0.35 - uTime * (2.0 + uSpeed * 0.08));
            col += ec * edge * 1.6 * pulse * uGlow;
            // wet reflections: the rails and overhead light smear across the surface
            float inTun = step(uTun.x, s) * step(s, uTun.y);
            float smear = exp(-abs(ax - 5.7) * (0.55 - 0.25 * uWet));
            col += ec * smear * (0.10 + 0.22 * uWet) * (0.7 + 0.3 * grain);
            float strip = smoothstep(0.75, 1.0, sin(s * 0.628)) * inTun;
            col += mix(vec3(0.02, 0.78, 1.0), vec3(1.0, 0.03, 0.66), step(0.5, fract(s / 40.0))) * strip * (0.10 + 0.18 * uWet) * exp(-ax * 0.12);
            col += vec3(0.5, 0.04, 0.4) * (0.02 + 0.05 * uWet) * (1.0 - inTun) * exp(-ax * 0.2) * (0.6 + 0.4 * uBeat);
            // braking zone: amber chevrons on the approach, a red bar at the corner
            float toC = uCorner - s;
            float chev = step(0.0, toC) * step(toC, 150.0);
            float cv = step(fract((toC + ax * 1.2) / 14.0), 0.22) * step(ax, 5.2);
            col += vec3(1.0, 0.42, 0.03) * chev * cv * (0.25 + 0.75 * uBrake);
            col += vec3(1.0, 0.05, 0.1) * smoothstep(1.2, 0.2, abs(toC)) * step(ax, 5.6) * 1.2;
            // finish-line style checks every kilometre
            float km = smoothstep(0.6, 0.2, abs(fract(s / 1000.0 + 0.5) - 0.5) * 1000.0);
            col += vec3(0.01, 0.9, 0.25) * km * step(ax, 5.6) * 0.8;
            gl_FragColor = vec4(fogged(col, 0.0), 1.0);
            #include <colorspace_fragment>
          }`,
        this.roadU,
      ),
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0, -100);
    this.root.add(road);

    // ---- buildings (city rows, sparse on the highway)
    const box = new BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    const bGeo = box.clone();
    this.bSeed = new InstancedBufferAttribute(new Float32Array(72), 1);
    this.bSeed.setUsage(DynamicDrawUsage);
    bGeo.setAttribute('aSeed', this.bSeed);
    const buildingFrag = /* glsl */ `${FOG_F}
      varying float vSeed; varying vec3 vObj; varying vec3 vN; varying vec3 vScale;
      void main(){
        vec3 n = abs(vN);
        float u = (n.x > 0.5 ? vObj.z * vScale.z : vObj.x * vScale.x);
        float v = vObj.y * vScale.y;
        vec3 col = vec3(0.008, 0.009, 0.018);
        vec3 acc = palette(vSeed * 7.31);
        if (n.y < 0.5) {
          vec2 cell = floor(vec2(u / 2.4, v / 3.2));
          vec2 f = fract(vec2(u / 2.4, v / 3.2));
          float lit = step(0.62, hash2(cell + vSeed * 91.0));
          float flick = step(0.97, hash2(cell + floor(uTime * 0.5) + vSeed)) * 0.6;
          float win = smoothstep(0.12, 0.2, f.x) * smoothstep(0.88, 0.8, f.x) * smoothstep(0.2, 0.3, f.y) * smoothstep(0.85, 0.75, f.y);
          vec3 wc = mix(vec3(1.0, 0.75, 0.4), acc, 0.65);
          col += wc * win * max(lit - flick, 0.0) * 0.55;
          // neon trims: roof line, a vertical blade and a mid band
          float roof = smoothstep(1.4, 0.2, vScale.y - v);
          col += acc * roof * 1.5 * uGlow;
          float blade = smoothstep(0.35, 0.1, abs(u - (vSeed - 0.5) * 6.0)) * step(0.45, vSeed);
          col += palette(vSeed * 3.1 + 0.4) * blade * (0.8 + 0.4 * uBeat) * uGlow;
          float band = smoothstep(0.5, 0.1, abs(v - vScale.y * 0.62)) * step(vSeed, 0.5);
          col += acc * band * 0.9 * uGlow;
          col *= 0.35 + 0.65 * smoothstep(0.0, 6.0, v);
        } else {
          col += acc * 0.05;
        }
        gl_FragColor = vec4(fogged(col, 0.0), 1.0);
        #include <colorspace_fragment>
      }`;
    this.buildings = new InstancedMesh(bGeo, this.mat(INST_V, buildingFrag), 72);
    this.buildings.instanceMatrix.setUsage(DynamicDrawUsage);
    this.buildings.frustumCulled = false;
    this.root.add(this.buildings);

    // ---- far skyline (static ring)
    const sGeo = box.clone();
    const sSeed = new InstancedBufferAttribute(new Float32Array(56), 1);
    sGeo.setAttribute('aSeed', sSeed);
    this.skyline = new InstancedMesh(sGeo, this.mat(INST_V, buildingFrag), 56);
    for (let i = 0; i < 56; i++) {
      const a = (i / 56) * Math.PI * 2 + hash(i) * 0.08;
      const r = 120 + hash(i + 9) * 45;
      const d = this.dummy;
      d.position.set(Math.cos(a) * r, -2, Math.sin(a) * r);
      d.rotation.set(0, -a, 0);
      d.scale.set(10 + hash(i + 3) * 12, 26 + hash(i + 5) * 70 * (0.4 + 0.6 * Math.abs(Math.cos(a))), 10 + hash(i + 7) * 10);
      d.updateMatrix();
      this.skyline.setMatrixAt(i, d.matrix);
      sSeed.setX(i, hash(i + 21));
    }
    this.skyline.frustumCulled = false;
    this.root.add(this.skyline);

    // ---- animated advertisement boards (abstract glyphs, no real brands)
    const pGeo = new PlaneGeometry(1, 1);
    this.boardSeed = new InstancedBufferAttribute(new Float32Array(8), 1);
    this.boardSeed.setUsage(DynamicDrawUsage);
    pGeo.setAttribute('aSeed', this.boardSeed);
    this.boards = new InstancedMesh(
      pGeo,
      this.mat(
        INST_V,
        /* glsl */ `${FOG_F}
          varying float vSeed; varying vec3 vObj;
          void main(){
            vec2 uv = vObj.xy + 0.5;
            vec3 a = palette(vSeed * 5.7);
            vec3 b = palette(vSeed * 5.7 + 0.37);
            float kind = fract(vSeed * 13.0);
            vec3 col = vec3(0.01, 0.01, 0.03);
            if (kind < 0.34) {
              // scrolling equaliser bars
              float bx = floor(uv.x * 14.0);
              float hgt = 0.2 + 0.7 * abs(sin(uTime * (1.5 + hash1(bx + vSeed)) + bx));
              col += mix(a, b, uv.y) * step(uv.y, hgt) * step(0.15, fract(uv.x * 14.0));
            } else if (kind < 0.67) {
              // glyph ticker
              vec2 g = vec2(uv.x * 10.0 + floor(uTime * 3.0), uv.y * 4.0);
              float on = step(0.5, hash2(floor(g * vec2(3.0, 3.0)) + vSeed));
              float row = step(0.25, fract(uv.y * 4.0)) * step(fract(uv.y * 4.0), 0.85);
              col += a * on * row * step(0.1, fract(g.x)) ;
            } else {
              // concentric pulse logo
              float r = length((uv - 0.5) * vec2(1.7, 1.0));
              col += b * smoothstep(0.03, 0.0, abs(fract(r * 4.0 - uTime * 0.8) - 0.5) - 0.2) * smoothstep(0.55, 0.3, r);
              col += a * smoothstep(0.12, 0.1, r);
            }
            float frame = step(uv.x, 0.02) + step(0.98, uv.x) + step(uv.y, 0.04) + step(0.96, uv.y);
            col += a * clamp(frame, 0.0, 1.0);
            gl_FragColor = vec4(fogged(col * (0.8 + 0.2 * uBeat) * uGlow, 0.25), 1.0);
            #include <colorspace_fragment>
          }`,
        {},
        { side: DoubleSide },
      ),
      8,
    );
    this.boards.instanceMatrix.setUsage(DynamicDrawUsage);
    this.boards.frustumCulled = false;
    this.root.add(this.boards);

    // ---- neon boxes: city gates, highway lamp posts
    const nGeo = new BoxGeometry(1, 1, 1);
    this.neonSeed = new InstancedBufferAttribute(new Float32Array(64), 1);
    this.neonSeed.setUsage(DynamicDrawUsage);
    nGeo.setAttribute('aSeed', this.neonSeed);
    const neonFrag = /* glsl */ `${FOG_F}
      varying float vSeed; varying vec3 vObj;
      void main(){
        float s = uDist - vLocal.z;
        vec3 c = vSeed < 0.0 ? vec3(0.02, 0.022, 0.035) : palette(vSeed) * (1.3 + 0.5 * uBeat + 0.4 * sin(s * 0.2 - uTime * (3.0 + uSpeed * 0.1))) * uGlow;
        gl_FragColor = vec4(fogged(c, vSeed < 0.0 ? 0.0 : 0.35), 1.0);
        #include <colorspace_fragment>
      }`;
    this.neon = new InstancedMesh(nGeo, this.mat(INST_V, neonFrag), 64);
    this.neon.instanceMatrix.setUsage(DynamicDrawUsage);
    this.neon.frustumCulled = false;
    this.root.add(this.neon);

    // ---- tunnel: shell + light rings + portals
    const shellGeo = new CylinderGeometry(7.02, 7.02, 260, 28, 1, true, Math.PI / 2, Math.PI);
    shellGeo.rotateX(Math.PI / 2);
    shellGeo.rotateZ(Math.PI / 2);
    this.shell = new Mesh(
      shellGeo,
      this.mat(
        /* glsl */ `${FOG_V} void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vLocal = wp.xyz - uOrigin; vec4 mv = viewMatrix * wp; vFogD = -mv.z; gl_Position = projectionMatrix * mv; }`,
        /* glsl */ `${FOG_F}
          void main(){
            float s = uDist - vLocal.z;
            if (s < uTun.x || s > uTun.y) discard;
            float ang = atan(vLocal.y, vLocal.x);
            vec3 col = vec3(0.012, 0.014, 0.024);
            float seam = smoothstep(0.06, 0.0, abs(fract(s / 5.0) - 0.5) - 0.46);
            col += vec3(0.02, 0.03, 0.05) * seam;
            // longitudinal light strips, chasing forward faster with speed
            float chase = 0.55 + 0.45 * sin(s * 0.5 - uTime * (4.0 + uSpeed * 0.25));
            float l1 = smoothstep(0.02, 0.0, abs(ang - 0.5) - 0.012) + smoothstep(0.02, 0.0, abs(ang - 2.64) - 0.012);
            float l2 = smoothstep(0.02, 0.0, abs(ang - 1.1) - 0.008) + smoothstep(0.02, 0.0, abs(ang - 2.04) - 0.008);
            float l3 = smoothstep(0.03, 0.0, abs(ang - 1.5708) - 0.02);
            col += vec3(0.02, 0.78, 1.0) * l1 * (0.8 + 0.8 * chase) * uGlow;
            col += vec3(1.0, 0.03, 0.66) * l2 * (0.7 + 0.9 * (1.0 - chase)) * uGlow;
            col += vec3(0.9, 0.95, 1.0) * l3 * step(0.4, fract(s / 9.0)) * 0.9 * uGlow;
            // soft wash from the strips
            col += vec3(0.02, 0.2, 0.3) * exp(-abs(ang - 0.5) * 3.0) * 0.25 + vec3(0.3, 0.02, 0.2) * exp(-abs(ang - 2.04) * 3.0) * 0.2;
            gl_FragColor = vec4(fogged(col, 0.3), 1.0);
            #include <colorspace_fragment>
          }`,
        {},
        { side: BackSide },
      ),
    );
    this.shell.position.set(0, 0, -100);
    this.shell.frustumCulled = false;
    this.root.add(this.shell);

    const ringGeo = new TorusGeometry(6.85, 0.09, 5, 28, Math.PI);
    this.ringSeed = new InstancedBufferAttribute(new Float32Array(28), 1);
    this.ringSeed.setUsage(DynamicDrawUsage);
    ringGeo.setAttribute('aSeed', this.ringSeed);
    this.rings = new InstancedMesh(ringGeo, this.mat(INST_V, neonFrag), 28);
    this.rings.instanceMatrix.setUsage(DynamicDrawUsage);
    this.rings.frustumCulled = false;
    this.root.add(this.rings);

    const wallShape = new Shape();
    wallShape.moveTo(-90, 0);
    wallShape.lineTo(90, 0);
    wallShape.lineTo(90, 42);
    wallShape.lineTo(-90, 42);
    wallShape.lineTo(-90, 0);
    const hole = new Path();
    hole.moveTo(-7, 0);
    hole.absarc(0, 0, 7, Math.PI, 0, true);
    hole.lineTo(-7, 0);
    wallShape.holes.push(hole);
    const wallGeo = new ShapeGeometry(wallShape, 20);
    const wallMat = new MeshBasicMaterial({ color: 0x030408, side: DoubleSide, fog: false });
    const archGeo = new TorusGeometry(7.2, 0.22, 6, 32, Math.PI);
    for (let i = 0; i < 2; i++) {
      const g = new Group();
      g.add(new Mesh(wallGeo, wallMat));
      const arch = new Mesh(archGeo, new MeshBasicMaterial({ color: i === 0 ? NEON.cyan : NEON.magenta, fog: false }));
      arch.position.z = 0.1;
      g.add(arch);
      const arch2 = new Mesh(archGeo, new MeshBasicMaterial({ color: i === 0 ? NEON.magenta : NEON.cyan, fog: false }));
      arch2.position.z = -0.1;
      g.add(arch2);
      g.visible = false;
      this.portals.push(g);
      this.root.add(g);
    }

    // ---- overpass with distant traffic lights
    this.overpass = new Group();
    const beam = new Mesh(new BoxGeometry(160, 1.2, 5), new MeshBasicMaterial({ color: 0x04050a, fog: false }));
    beam.position.y = 11;
    this.overpass.add(beam);
    for (const x of [-9, 9, -40, 40]) {
      const leg = new Mesh(new BoxGeometry(1.4, 11, 1.4), beam.material);
      leg.position.set(x, 5.5, 0);
      this.overpass.add(leg);
    }
    const rail = new Mesh(new BoxGeometry(160, 0.12, 0.12), new MeshBasicMaterial({ color: NEON.violet, fog: false }));
    rail.position.set(0, 11.9, 2.5);
    this.overpass.add(rail);
    this.trafficPos = new Float32Array(24 * 3);
    const tg = new BufferGeometry();
    tg.setAttribute('position', new BufferAttribute(this.trafficPos, 3));
    const tcol = new Float32Array(24 * 3);
    for (let i = 0; i < 24; i++) {
      const red = i % 2 === 0;
      tcol[i * 3] = 1;
      tcol[i * 3 + 1] = red ? 0.1 : 0.95;
      tcol[i * 3 + 2] = red ? 0.15 : 0.85;
    }
    tg.setAttribute('color', new BufferAttribute(tcol, 3));
    this.traffic = new Points(tg, new PointsMaterial({ size: 0.9, vertexColors: true, fog: false, sizeAttenuation: true }));
    this.traffic.frustumCulled = false;
    this.overpass.add(this.traffic);
    this.root.add(this.overpass);

    // ---- drifting particles + rain
    const N = 360;
    this.dustPos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      this.dustPos[i * 3] = (hash(i) - 0.5) * 26;
      this.dustPos[i * 3 + 1] = 0.3 + hash(i + 50) * 7;
      this.dustPos[i * 3 + 2] = -hash(i + 99) * 110 + 12;
    }
    const dg = new BufferGeometry();
    dg.setAttribute('position', new BufferAttribute(this.dustPos, 3));
    this.dust = new Points(dg, new PointsMaterial({ color: 0x8fdcff, size: 0.07, transparent: true, opacity: 0.7, blending: AdditiveBlending, depthWrite: false, fog: false }));
    this.dust.frustumCulled = false;
    this.root.add(this.dust);

    const R = 260;
    this.rainPos = new Float32Array(R * 6);
    for (let i = 0; i < R; i++) this.seedRain(i, true);
    const rg = new BufferGeometry();
    rg.setAttribute('position', new BufferAttribute(this.rainPos, 3));
    this.rainLines = new LineSegments(rg, new LineBasicMaterial({ color: 0x9fc8ff, transparent: true, opacity: 0.35, blending: AdditiveBlending, depthWrite: false, fog: false }));
    this.rainLines.frustumCulled = false;
    this.rainLines.visible = false;
    this.root.add(this.rainLines);
  }

  private seedRain(i: number, anyY: boolean): void {
    const p = this.rainPos;
    const x = (hash(i * 3.1 + p[i * 6 + 2]) - 0.5) * 24;
    const y = anyY ? hash(i * 1.7) * 9 : 9;
    const z = -hash(i * 5.3 + p[i * 6]) * 60 + 6;
    p[i * 6] = x;
    p[i * 6 + 1] = y;
    p[i * 6 + 2] = z;
    p[i * 6 + 3] = x;
    p[i * 6 + 4] = y - 0.5;
    p[i * 6 + 5] = z;
  }

  setTrack(track: Track, rain: boolean): void {
    this.track = track;
    this.rain = rain;
    this.rainLines.visible = rain;
    this.skyU.uRain.value = rain ? 1 : 0;
  }

  /** 0 = low, 1 = medium, 2 = high: instance counts and particle budgets. */
  setDetail(level: number): void {
    this.detail = level;
    this.nB = level === 0 ? 10 : level === 1 ? 14 : 18;
    this.dust.geometry.setDrawRange(0, level === 0 ? 100 : level === 1 ? 220 : 360);
    this.rainLines.geometry.setDrawRange(0, level === 0 ? 160 : level === 1 ? 320 : 520);
    this.skyline.count = level === 0 ? 28 : 56;
  }

  setOrigin(x: number, y: number, z: number): void {
    this.root.position.set(x, y, z);
    this.uni.uOrigin.value.set(x, y, z);
  }

  private tunnelSpan(from: number, to: number): void {
    const pat = this.track.pattern;
    let total = 0;
    for (let i = 0; i < pat.length; i++) total += pat[i].len;
    let s = Math.floor(from / total) * total;
    this.span.a = -1e6;
    this.span.b = -1e6;
    for (let c = 0; c < 2; c++) {
      for (let i = 0; i < pat.length; i++) {
        const e = s + pat[i].len;
        if (pat[i].kind === 'tunnel' && e > from && s < to) {
          this.span.a = s;
          this.span.b = e;
          return;
        }
        s = e;
      }
    }
  }

  private hide(mesh: InstancedMesh, i: number): void {
    const d = this.dummy;
    d.position.set(0, -50, 0);
    d.rotation.set(0, 0, 0);
    d.scale.set(0, 0, 0);
    d.updateMatrix();
    mesh.setMatrixAt(i, d.matrix);
  }

  update(f: WorldFrame, dt: number): void {
    const u = this.uni;
    const track = this.track;
    const dist = f.distance;
    u.uDist.value = dist;
    u.uTime.value = f.time;
    u.uBeat.value = f.beat * f.intensity;
    u.uSpeed.value = f.speed;
    u.uGlow.value = 0.75 + 0.25 * f.intensity;
    const zone = zoneAt(track, dist);
    this.zone = zone;
    this.tunnelSpan(dist - 40, dist + 215);
    u.uTun.value.set(this.span.a, this.span.b);
    // living track: fog, sun and wetness drift with zone and race progress
    this.fogTarget.copy(zone === 'tunnel' ? this.fogTunnel : zone === 'highway' ? this.fogHighway : this.fogCity).lerp(this.fogLate, f.progress * 0.45);
    u.uFog.value.lerp(this.fogTarget, Math.min(1, dt * 1.5));
    const fk = (zone === 'tunnel' ? 0.011 : zone === 'highway' ? 0.0058 : 0.0078) + (this.rain ? 0.002 : 0) + f.progress * 0.0012;
    u.uFogK.value += (fk - u.uFogK.value) * Math.min(1, dt * 1.2);
    this.skyU.uSun.value += ((zone === 'highway' ? 1 : 0.35) * (0.55 + 0.45 * f.progress) - this.skyU.uSun.value) * Math.min(1, dt * 0.8);
    this.skyU.uProgress.value = f.progress;
    this.skyU.uCity.value += ((zone === 'city' ? 1 : 0.45) - this.skyU.uCity.value) * Math.min(1, dt);
    this.roadU.uWet.value += ((this.rain ? 1 : 0.3 + 0.3 * f.progress) - this.roadU.uWet.value) * Math.min(1, dt);
    this.roadU.uCorner.value = dist + f.cornerIn;
    this.roadU.uBrake.value = f.braking ? 1 : 0.35 + 0.35 * Math.sin(f.time * 9);

    const d = this.dummy;
    // ---- buildings
    {
      const sp = 15;
      const k0 = Math.floor((dist - 28) / sp);
      let n = 0;
      for (let j = 0; j < this.nB; j++) {
        const k = k0 + j;
        const s = k * sp;
        const z = -(s - dist);
        const zn = zoneAt(track, s);
        for (let side = -1; side <= 1; side += 2) {
          for (let row = 0; row < 2; row++) {
            const seed = hash(k * 4.13 + side * 1.7 + row * 7.9);
            const show = zn === 'city' || (zn === 'highway' && row === 1 && seed > 0.72);
            if (!show || (this.detail === 0 && row === 1 && seed < 0.5)) {
              this.hide(this.buildings, n);
            } else {
              const w = 9 + seed * 5;
              const h = row === 0 ? 12 + hash(k * 2.7 + side) * 26 : 38 + hash(k * 1.3 + side * 3) * 62;
              d.position.set(side * (11.5 + row * 19 + w / 2 + hash(k + side * 5 + row) * 3), 0, z);
              d.rotation.set(0, 0, 0);
              d.scale.set(w, h, 11 + hash(k * 0.7 + row) * 3);
              d.updateMatrix();
              this.buildings.setMatrixAt(n, d.matrix);
              this.bSeed.setX(n, seed);
            }
            n++;
          }
        }
      }
      this.buildings.count = n;
      this.buildings.instanceMatrix.needsUpdate = true;
      this.bSeed.needsUpdate = true;
    }
    // ---- ad boards (city)
    {
      const sp = 48;
      const k0 = Math.floor((dist - 20) / sp);
      for (let j = 0; j < 6; j++) {
        const k = k0 + j;
        const s = k * sp + 9;
        const side = k % 2 === 0 ? -1 : 1;
        if (zoneAt(track, s) !== 'city') this.hide(this.boards, j);
        else {
          const seed = hash(k * 9.7 + 2);
          d.position.set(side * 10.6, 7.5 + seed * 4, -(s - dist));
          d.rotation.set(0, -side * 0.5, 0);
          d.scale.set(8 + seed * 3, 4.2, 1);
          d.updateMatrix();
          this.boards.setMatrixAt(j, d.matrix);
          this.boardSeed.setX(j, seed);
        }
      }
      this.boards.count = 6;
      this.boards.instanceMatrix.needsUpdate = true;
      this.boardSeed.needsUpdate = true;
    }
    // ---- neon gates (city) and lamp posts (highway)
    {
      let n = 0;
      const put = (x: number, y: number, z: number, sx: number, sy: number, sz: number, seed: number): void => {
        if (n >= 64) return;
        d.position.set(x, y, z);
        d.rotation.set(0, 0, 0);
        d.scale.set(sx, sy, sz);
        d.updateMatrix();
        this.neon.setMatrixAt(n, d.matrix);
        this.neonSeed.setX(n, seed);
        n++;
      };
      const gsp = 110;
      const g0 = Math.floor((dist - 20) / gsp);
      for (let j = 0; j < 3; j++) {
        const s = (g0 + j) * gsp + 30;
        if (zoneAt(track, s) !== 'city') continue;
        const z = -(s - dist);
        const seed = hash((g0 + j) * 3.3);
        put(-8.2, 5.5, z, 0.35, 11, 0.35, seed);
        put(8.2, 5.5, z, 0.35, 11, 0.35, seed);
        put(0, 11, z, 16.8, 0.35, 0.35, seed + 0.31);
      }
      const lsp = 36;
      const l0 = Math.floor((dist - 20) / lsp);
      for (let j = 0; j < 7; j++) {
        const s = (l0 + j) * lsp + 12;
        if (zoneAt(track, s) !== 'highway') continue;
        const z = -(s - dist);
        for (let side = -1; side <= 1; side += 2) {
          put(side * 7.6, 4, z, 0.18, 8, 0.18, -1);
          put(side * 6.4, 8, z, 2.6, 0.12, 0.3, side < 0 ? 0.1 : 0.45);
        }
      }
      this.neon.count = n;
      this.neon.instanceMatrix.needsUpdate = true;
      this.neonSeed.needsUpdate = true;
    }
    // ---- tunnel rings and portals
    {
      const sp = 10;
      const k0 = Math.floor((dist - 20) / sp);
      const count = this.detail === 0 ? 16 : 24;
      for (let j = 0; j < count; j++) {
        const k = k0 + j;
        const s = k * sp;
        if (s < this.span.a + 2 || s > this.span.b - 2) this.hide(this.rings, j);
        else {
          d.position.set(0, 0, -(s - dist));
          d.rotation.set(0, 0, 0);
          d.scale.set(1, 1, 1);
          d.updateMatrix();
          this.rings.setMatrixAt(j, d.matrix);
          this.ringSeed.setX(j, k % 3 === 0 ? 0.45 : 0.1);
        }
      }
      this.rings.count = count;
      this.rings.instanceMatrix.needsUpdate = true;
      this.ringSeed.needsUpdate = true;
      const za = -(this.span.a - dist);
      const zb = -(this.span.b - dist);
      this.portals[0].visible = za < 30 && za > -200;
      this.portals[0].position.z = za;
      this.portals[1].visible = zb < 30 && zb > -200;
      this.portals[1].position.z = zb;
      this.shell.visible = this.span.a > -1e5;
    }
    // ---- overpass
    {
      const sp = 520;
      const k = Math.floor((dist + 190) / sp);
      const s = k * sp;
      const z = -(s - dist);
      this.overpass.visible = z < 25 && zoneAt(track, s) !== 'tunnel';
      this.overpass.position.z = z;
      const tp = this.trafficPos;
      for (let i = 0; i < 24; i++) {
        const dir = i % 2 === 0 ? 1 : -1;
        const x = ((((i * 13.7 + f.time * (9 + (i % 5)) * dir) % 150) + 150) % 150) - 75;
        tp[i * 3] = x;
        tp[i * 3 + 1] = 12.3;
        tp[i * 3 + 2] = dir * 1.2;
      }
      (this.traffic.geometry.attributes.position as BufferAttribute).needsUpdate = true;
    }
    // ---- particles
    {
      const p = this.dustPos;
      const mv = (f.speed + 1.5) * dt;
      const n = this.dust.geometry.drawRange.count === Infinity ? p.length / 3 : this.dust.geometry.drawRange.count;
      for (let i = 0; i < n; i++) {
        let z = p[i * 3 + 2] + mv;
        if (z > 12) z -= 122;
        p[i * 3 + 2] = z;
      }
      (this.dust.geometry.attributes.position as BufferAttribute).needsUpdate = true;
      (this.dust.material as PointsMaterial).opacity = (0.25 + 0.45 * Math.min(1, f.speed / 60)) * (0.4 + 0.6 * f.intensity);
      if (this.rain) {
        const r = this.rainPos;
        const rn = Math.min(r.length / 6, this.rainLines.geometry.drawRange.count === Infinity ? 1e9 : this.rainLines.geometry.drawRange.count / 2);
        const fall = 16 * dt;
        const len = 0.35 + Math.min(1.6, f.speed * 0.03);
        for (let i = 0; i < rn; i++) {
          let y = r[i * 6 + 1] - fall;
          let z = r[i * 6 + 2] + mv;
          if (y < 0 || z > 8) {
            this.seedRain(i, false);
            y = r[i * 6 + 1];
            z = r[i * 6 + 2] - (z > 8 ? 0 : 0);
          }
          r[i * 6 + 1] = y;
          r[i * 6 + 2] = z;
          r[i * 6 + 3] = r[i * 6];
          r[i * 6 + 4] = y - 0.25;
          r[i * 6 + 5] = z - len;
        }
        (this.rainLines.geometry.attributes.position as BufferAttribute).needsUpdate = true;
      }
    }
  }
}

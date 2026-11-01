// SHERPY 7.3 원본 엔진 — https://sherpy-simulator.vercel.app 번들(index-CRON5GK6.js)에서 그대로 추출 (2026-11-01)
// 이식본(src/lib/sherpy/world.ts) 대조용. 수정 금지.
const
  cm = {
    dogSpeed: 0.48,
    robotMax: 0.8,
    followDist: 1.6,
    reelMax: 3,
    warn: 16,
    stop: 35,
    dogMass: 15,
    pullForce: 30,
    stiffness: 550,
    steerMax: 35,
    tau: 0.2,
    noise: 0.8,
    clearance: 0.2,
  },
  vm = {
    park: { half: 3.4, curve: 0.45, obs: [{ x: -1.6, y: 6, r: 0.3 }] },
    walk: { half: 1.5, curve: 0.22, obs: [{ x: -1.15, y: 6, r: 0.22 }] },
    narrow: { half: 0.95, curve: 0.1, obs: [{ x: -0.73, y: 6, r: 0.17 }] },
    dense: {
      half: 2.6,
      curve: 0.7,
      obs: [
        { x: -1.5, y: 5, r: 0.32 },
        { x: 1.65, y: 10, r: 0.36 },
        { x: -1.35, y: 15, r: 0.25 },
      ],
    },
  },
  it = (z, J, p) => Math.max(J, Math.min(p, z)),
  me = (z) => {
    const J = it(z, 0, 1);
    return J * J * (3 - 2 * J);
  };
function zy(z, J, p) {
  const r = J[0] - z[0],
    N = J[1] - z[1],
    j = r * r + N * N,
    w = j ? it(((p.x - z[0]) * r + (p.y - z[1]) * N) / j, 0, 1) : 0;
  return Math.hypot(z[0] + w * r - p.x, z[1] + w * N - p.y) - p.r;
}
function Oy(z, J, p) {
  const r = vm[J],
    N = z,
    j = 0.04,
    w = 1e3,
    bl = [],
    R = [];
  let W = 0,
    _ = 0,
    T = 0,
    A = 0,
    G = 0,
    rl = N.followDist,
    dl = 0,
    el = N.dogSpeed,
    _l = Math.min(N.reelMax, N.followDist + 0.1),
    jl = 0,
    ut = "FOLLOW",
    U = null,
    P = _l,
    sl = 0,
    X = 0,
    k = 1 / 0;
  const lt = p === "opposite",
    Ql = lt
      ? [{ x: 0, y: 7, r: 0.52 }, ...r.obs.filter((Zl) => Zl.y > 10)]
      : r.obs;
  for (let Zl = 0; Zl <= w; Zl++) {
    const El = Zl * j,
      ct = Math.hypot(G - W, rl - _),
      $t = (G - W) / Math.max(0.001, ct),
      Hl = (rl - _) / Math.max(0.001, ct),
      x = lt
        ? 1.15 * (me((rl - 4.2) / 1.7) - me((rl - 10.5) / 2.5))
        : r.curve * (me((rl - 3.1) / 2) - me((rl - 10) / 3)),
      Q = it((x - G) * 1.6, -0.7, 0.7),
      Z = p === "pull" && El >= 12 && El < 22,
      hl = N.dogSpeed + (Z ? 0.35 : 0),
      ol = it((hl - el) * N.dogMass * 3, -85, 85) + (Z ? N.pullForce : 0),
      ht = it((Q - dl) * N.dogMass * 3, -65, 65),
      xt = Math.max(0, ct - _l),
      iu = (dl - A * Math.sin(T)) * $t + (el - A * Math.cos(T)) * Hl,
      o = xt > 0 ? N.stiffness * xt + 12 * Math.max(0, iu) : 0,
      O =
        p === "load" && El >= 14
          ? null
          : o + N.noise * (0.65 * Math.sin(17 * El) + 0.35 * Math.sin(31 * El)),
      q = p === "encoder" && El >= 14 ? P : _l,
      Y = p === "camera" && El >= 14 ? null : ct + 0.015 * Math.sin(11 * El);
    O !== null &&
      (jl += (1 - Math.exp(-j / Math.max(0.025, N.tau))) * (O - jl));
    const ll = Math.min(
        ...Ql.map((st) => Math.hypot(W - st.x, _ - st.y) - st.r - 0.23),
      ),
      tl = Math.min(...Ql.map((st) => zy([W, _], [G, rl], st))),
      il = r.half - Math.abs(W) - 0.23,
      H = r.half - Math.abs(G) - 0.15;
    p === "encoder" && El >= 14 ? sl++ : ((sl = 0), (P = q));
    const L = O === null || Y === null || sl >= 25,
      Qt = ll < N.clearance || tl < 0 || il < 0 || H < 0 || jl >= N.stop;
    if (ut !== "HOLD" && (L || Qt)) {
      (ut = "HOLD"), (U = El);
      const st =
        O === null
          ? "로드셀 신호 단절"
          : Y === null
            ? "카메라 추적 실패"
            : sl >= 25
              ? "엔코더 고착"
              : ll < N.clearance
                ? "차체 장애물 안전거리 부족"
                : tl < 0
                  ? "리드줄이 장애물에 걸림"
                  : il < 0 || H < 0
                    ? "환경 경계 이탈"
                    : "장력 정지 임계값 초과";
      R.push({ t: El, reason: st });
    }
    let Pu = Math.atan2(G - W, Math.max(0.2, rl - _));
    if (lt && El > 0 && El < 28 && _ > 3 && _ < 10) {
      const st = -1.13 * (me((_ - 3.1) / 1.4) - me((_ - 10) / 2.2));
      Pu = Math.atan2(st - W, 1);
    }
    const Ou = Math.atan2(Math.sin(Pu - T), Math.cos(Pu - T)),
      Dt = it(
        1.4 * Ou,
        (-N.steerMax * Math.PI) / 180,
        (N.steerMax * Math.PI) / 180,
      );
    let Dl = it(N.dogSpeed + 1.2 * (ct - N.followDist), 0, N.robotMax);
    jl >= N.warn && (Dl = Math.min(Dl, 0.2)),
      ut === "HOLD" && (Dl = 0),
      (A = it(A + j * (Dl > A ? 0.85 : -1.9), 0, N.robotMax)),
      Dl === 0 && A < 0.02 && (A = 0),
      (T += (A / 0.35) * Math.tan(Dt) * j),
      (W += A * Math.sin(T) * j),
      (_ += A * Math.cos(T) * j);
    const zl = (ht - o * $t - 2.2 * dl) / N.dogMass,
      Ut = (ol - o * Hl - 2.2 * el) / N.dogMass;
    (dl = it(dl + zl * j, -1.5, 1.5)),
      (el = it(el + Ut * j, -1.5, 1.5)),
      (G += dl * j),
      (rl += el * j),
      (G = it(G, -r.half + 0.16, r.half - 0.16)),
      Math.abs(G) >= r.half - 0.16 && dl * G > 0 && (dl = 0);
    const _u = Math.hypot(G - W, rl - _),
      Zt = it(_u + 0.04, 1.2, N.reelMax);
    ut === "FOLLOW"
      ? (_l += it(Zt - _l, -0.5 * j, 0.65 * j))
      : (_l += it(Zt - _l, -0.5 * j, 0)),
      (_l = it(_l, 1.2, N.reelMax)),
      (X = Math.max(X, o)),
      (k = Math.min(k, tl)),
      bl.push({
        t: El,
        robot: [W, _],
        dog: [G, rl],
        psi: T,
        rv: A,
        dogV: Math.hypot(dl, el),
        dist: _u,
        reel: _l,
        tension: o,
        filtered: jl,
        rope: tl,
        body: ll,
        mode: ut,
        encoder: q,
        camera: Y,
      });
  }
  return {
    frames: bl,
    events: R,
    peak: X,
    minRope: k,
    stopTime: U,
    obstacles: Ql,
  };
}
export { cm as DEFAULTS, vm as ENVS, Oy as simulate };

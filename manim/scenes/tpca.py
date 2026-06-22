"""Manim set-piece: tangent PCA (tPCA) on the sphere — the full pipeline.

Storyboard (per Z. Grey):
  1. Exp / Log maps over the sphere.
  2. Random UNNORMALIZED points appear in ambient space.
  3. They descend along straight radial fibers onto the sphere (normalization).
  4. Iterative Karcher-mean updates p0 over the surface until convergence
     (a short comet tail follows p0 until it settles).
  5. Draw the tangent space at the Karcher mean.
  6. Log-map arrows extend from p0 toward each surface point (true tangent
     vectors, |v| = geodesic distance — tips sit just above the surface).
  7. Construct the tPCA basis (eigenvectors of the tangent covariance).
  8. Replace the Log vectors with the two basis vectors.
  9. Draw the covariance ellipse in the tangent space.
 10. Morph the ellipse into a 2D KDE of the Log points on the tangent space.

Render (website repo root, venv active):
    USERPROFILE="$USERPROFILE" MANIM_PY=~/venv/Scripts/python.exe \
        QUALITY=l bash manim/render.sh tpca
"""

import numpy as np
from manim import (
    ThreeDScene, Sphere, ThreeDAxes, Dot3D, Arrow3D, Line3D, Circle, Square,
    ParametricFunction, TracedPath, VGroup, Text, MathTex,
    Create, FadeIn, FadeOut, GrowFromCenter, ReplacementTransform,
    MoveAlongPath, interpolate_color,
    BLUE_E, BLUE_D, YELLOW, GREEN, GREEN_B, ORANGE, RED, WHITE, GREY_B,
    DEGREES, UL,
)

R = 2.0
RNG = np.random.default_rng(7)


# ---- sphere geometry (radius R, centred at origin) ------------------------
def unit(v):
    n = np.linalg.norm(v)
    return v / n if n > 1e-12 else v


def log_map(p, q):
    """Tangent vector at p pointing to q, |v| = geodesic distance."""
    pn, qn = p / R, q / R
    d = float(np.clip(np.dot(pn, qn), -1.0, 1.0))
    th = np.arccos(d)
    if th < 1e-9:
        return np.zeros(3)
    u = unit(qn - d * pn)
    return R * th * u


def exp_map(p, v):
    """Geodesic from p with initial tangent v."""
    pn = p / R
    s = np.linalg.norm(v)
    if s < 1e-12:
        return p.copy()
    u = v / s
    return R * (np.cos(s / R) * pn + np.sin(s / R) * u)


def karcher(qs, p0, iters=7):
    p = p0.copy()
    traj = [p.copy()]
    for _ in range(iters):
        vm = np.mean([log_map(p, q) for q in qs], axis=0)
        p = exp_map(p, vm)
        traj.append(p.copy())
        if np.linalg.norm(vm) < 1e-6:
            break
    return p, traj


def tangent_basis(p):
    pn = p / R
    a = np.array([0.0, 0.0, 1.0])
    if abs(np.dot(pn, a)) > 0.9:
        a = np.array([0.0, 1.0, 0.0])
    e1 = unit(a - np.dot(a, pn) * pn)
    e2 = np.cross(pn, e1)
    return e1, e2


def rot_z_to(n):
    """3x3 rotation sending +z to unit vector n."""
    z = np.array([0.0, 0.0, 1.0])
    n = unit(n)
    v = np.cross(z, n)
    c = float(np.dot(z, n))
    if np.linalg.norm(v) < 1e-9:
        return np.eye(3) if c > 0 else np.diag([1.0, -1.0, -1.0])
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx * (1.0 / (1.0 + c))


def make_data(n=26):
    """Random ambient points (unnormalized) spread over an upper-hemisphere cap
    that faces the initial camera, so the cloud is easy to perceive and not
    hidden behind the sphere."""
    c = unit(np.array([0.30, -0.42, 1.0]))      # upper hemisphere, toward camera
    e1, e2 = tangent_basis(R * c)
    amb, sph = [], []
    rmax = 1.45                                 # tangent mag; cap half-angle ~ rmax/R = 42 deg
    for _ in range(n):
        rr = rmax * np.sqrt(RNG.uniform(0.06, 1.0))   # area-uniform fill of cap
        az = RNG.uniform(0.0, 2 * np.pi)
        v = rr * np.cos(az) * e1 + 0.72 * rr * np.sin(az) * e2   # mild anisotropy
        q = exp_map(R * c, v)
        rad = R + RNG.uniform(0.70, 1.05)        # tighter shell -> less depth overlap
        amb.append(rad * (q / R))
        sph.append(q)
    return np.array(amb), np.array(sph)


class TangentPCA(ThreeDScene):
    def construct(self):
        phi0, theta0 = 58 * DEGREES, -56 * DEGREES
        self.set_camera_orientation(phi=phi0, theta=theta0)
        axes = ThreeDAxes(x_range=[-3, 3], y_range=[-3, 3], z_range=[-3, 3])
        sphere = Sphere(radius=R, resolution=(28, 28)).set_opacity(0.10).set_color(BLUE_E)
        self.play(Create(axes), Create(sphere), run_time=1.2)

        cap = Text("Exp / Log maps", font_size=26, color=BLUE_D).to_corner(UL)
        self.add_fixed_in_frame_mobjects(cap)
        self.caption = cap

        # ---- 1. Exp / Log demo: a curved geodesic, equator -> north pole ----
        # Start near the equator and sweep toward the north pole, AZIMUTHALLY
        # OFFSET so the great circle projects as a visibly CURVED path. (A path
        # aimed straight at the observer would project to a straight line and
        # hide the map's nonlinearity.) The straight green tangent arrow vs. the
        # curving orange geodesic makes that nonlinearity explicit. Endpoints
        # chosen offline to maximize on-screen curvature while keeping the whole
        # arc on the near side (camera at phi=58, theta=-56).
        S = unit(np.array([-0.669, -0.743, 0.0]))    # on the equator, near side
        Q = unit(np.array([0.236, 0.282, 0.93]))     # near the north pole
        pe = R * S
        ve = log_map(pe, R * Q)                      # tangent; |ve| = arc length
        qe = R * Q
        pdot = Dot3D(pe, color=YELLOW, radius=0.08)
        # tangent arrow at a fixed display length (initial-velocity direction)
        tan = Arrow3D(pe, pe + 1.2 * unit(ve), color=GREEN)
        geo = ParametricFunction(lambda a: exp_map(pe, a * ve), t_range=[0, 1], color=ORANGE)
        qdot = Dot3D(qe, color=RED, radius=0.08)
        self.play(FadeIn(pdot))
        self.play(Create(tan))
        self.play(Create(geo), FadeIn(qdot), run_time=2.0)
        self.wait(0.6)
        self.play(FadeOut(VGroup(pdot, tan, geo, qdot)))

        # ---- 2. random unnormalized ambient points ----
        amb, sph = make_data(26)
        self._swap_cap("random points in ambient space", GREY_B)
        amb_dots = VGroup(*[Dot3D(x, color=GREY_B, radius=0.08) for x in amb])
        fibers = VGroup(*[Line3D(amb[i], sph[i], color=GREY_B, stroke_width=1.5)
                          for i in range(len(amb))])
        self.play(*[FadeIn(d) for d in amb_dots], run_time=1.0)

        # ---- 3. descend along radial fibers onto the sphere ----
        self._swap_cap("normalize onto the sphere (radial fibers)", GREY_B)
        for f in fibers:
            f.set_opacity(0.5)
        self.play(*[Create(f) for f in fibers], run_time=0.8)
        self.play(*[amb_dots[i].animate.move_to(sph[i]) for i in range(len(amb))], run_time=1.4)
        self.play(*[amb_dots[i].animate.set_color(GREEN_B) for i in range(len(amb))],
                  FadeOut(fibers), run_time=0.6)
        data_dots = amb_dots  # now on the sphere

        # ---- 4. Karcher-mean iteration with a comet tail ----
        self._swap_cap("Karcher mean (geodesic averaging)", ORANGE)
        p_init = R * unit(np.array([-0.7, 0.6, 0.55]))
        p_star, traj = karcher(sph, p_init, iters=7)
        kdot = Dot3D(p_init, color=ORANGE, radius=0.09)
        tail = TracedPath(kdot.get_center, stroke_color=ORANGE, stroke_width=5,
                          dissipating_time=0.7)
        self.add(tail, kdot)
        self.play(FadeIn(kdot))
        for k in range(len(traj) - 1):
            pc, vseg = traj[k], log_map(traj[k], traj[k + 1])
            if np.linalg.norm(vseg) < 1e-5:
                break
            path = ParametricFunction(lambda a, pc=pc, vs=vseg: exp_map(pc, a * vs),
                                      t_range=[0, 1])
            self.play(MoveAlongPath(kdot, path), run_time=0.6)
        self.wait(0.3)
        self.remove(tail)

        # ---- camera: look down the tangent normal for the planar phases ----
        pn = p_star / R
        phi = float(np.arccos(np.clip(pn[2], -1, 1)))
        theta = float(np.arctan2(pn[1], pn[0]))
        self.move_camera(phi=phi, theta=theta, zoom=1.25, run_time=2.0)

        e1, e2 = tangent_basis(p_star)

        # ---- 5. tangent space ----
        self._swap_cap("tangent space at the mean", WHITE)
        coords = np.array([[float(np.dot(log_map(p_star, q), e1)),
                            float(np.dot(log_map(p_star, q), e2))] for q in sph])
        rmax = float(np.max(np.hypot(coords[:, 0], coords[:, 1]))) * 1.35
        disk = Circle(radius=rmax, color=WHITE, fill_opacity=0.10, stroke_width=1.5)
        disk.apply_matrix(rot_z_to(pn))
        disk.shift(p_star)
        self.play(GrowFromCenter(disk))

        # ---- 6. Log-map arrows ----
        self._swap_cap("Log map: data into the tangent space", GREEN)
        log_arrows = VGroup()
        for q in sph:
            v = log_map(p_star, q)
            log_arrows.add(Arrow3D(p_star, p_star + v, color=GREEN, thickness=0.012))
        self.play(*[Create(a) for a in log_arrows], run_time=1.6)
        self.wait(0.4)

        # ---- 7/8. tPCA basis replaces the Log vectors ----
        self._swap_cap("tPCA basis (principal tangent directions)", YELLOW)
        cov = (coords.T @ coords) / len(coords)
        evals, evecs = np.linalg.eigh(cov)        # ascending
        order = np.argsort(evals)[::-1]
        evals, evecs = evals[order], evecs[:, order]
        k_scale = 2.1
        basis_arrows = VGroup()
        for j in range(2):
            wdir = evecs[0, j] * e1 + evecs[1, j] * e2
            length = k_scale * np.sqrt(max(evals[j], 1e-6))
            basis_arrows.add(Arrow3D(p_star, p_star + length * wdir,
                                     color=YELLOW, thickness=0.02))
        self.play(FadeOut(log_arrows), *[Create(a) for a in basis_arrows], run_time=1.3)
        self.wait(0.3)

        # ---- 9. covariance ellipse ----
        self._swap_cap("covariance ellipse", YELLOW)
        s1, s2 = k_scale * np.sqrt(max(evals[0], 1e-6)), k_scale * np.sqrt(max(evals[1], 1e-6))
        w1 = evecs[0, 0] * e1 + evecs[1, 0] * e2
        w2 = evecs[0, 1] * e1 + evecs[1, 1] * e2
        ellipse = ParametricFunction(
            lambda t: p_star + s1 * np.cos(t) * w1 + s2 * np.sin(t) * w2,
            t_range=[0, 2 * np.pi], color=YELLOW)
        self.play(Create(ellipse))
        self.wait(0.4)

        # ---- 10. morph ellipse -> 2D KDE of the Log points ----
        self._swap_cap("kernel density estimate on the tangent space", GREEN_B)
        kde = self._build_kde(p_star, e1, e2, coords, rmax, pn)
        self.play(ReplacementTransform(ellipse, kde),
                  FadeOut(basis_arrows), FadeOut(disk), run_time=1.6)
        self.wait(1.5)

    # ---- helpers ----
    def _swap_cap(self, text, color):
        # Cross-fade so exactly ONE caption is ever on screen (no stacking):
        # explicitly fade out the current caption and fade in the new one.
        new = Text(text, font_size=26, color=color).to_corner(UL)
        new.set_opacity(0)
        self.add_fixed_in_frame_mobjects(new)
        self.play(FadeOut(self.caption), FadeIn(new), run_time=0.5)
        self.caption = new

    def _build_kde(self, p0, e1, e2, coords, rmax, pn):
        M = 13
        h = 0.40 * rmax
        rot = rot_z_to(pn)
        cell = 2.0 * rmax / M
        dens = np.zeros((M, M))
        gx = np.linspace(-rmax, rmax, M)
        for ix, a in enumerate(gx):
            for iy, b in enumerate(gx):
                d = 0.0
                for (ca, cb) in coords:
                    d += np.exp(-((a - ca) ** 2 + (b - cb) ** 2) / (2 * h * h))
                dens[ix, iy] = d
        dmax = dens.max() if dens.max() > 0 else 1.0
        group = VGroup()
        for ix, a in enumerate(gx):
            for iy, b in enumerate(gx):
                t = dens[ix, iy] / dmax
                if t < 0.04:
                    continue
                sq = Square(side_length=cell)
                sq.set_stroke(width=0)
                sq.set_fill(interpolate_color(BLUE_E, GREEN_B, t), opacity=0.15 + 0.75 * t)
                sq.apply_matrix(rot)
                sq.shift(p0 + a * e1 + b * e2)
                group.add(sq)
        return group

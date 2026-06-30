"""Precompute Nystrom convergence data for the SST spectral-convergence widget.

Follows TDA-SST/matlab/Planar_Curves/demos/nystrom_demo.m: arc-length-weighted
quadrature W = (2*pi/N) * diag(1/|c'|), the weighted second moment M = C^T W C,
its eigenpairs (A = alpha eigenvectors, sigma = sqrt eigenvalues), and the dual
eigenfunctions v(s) = c(s) . A . diag(1/sigma). Two error metrics vs a refined
(N=8192) reference, for two curves:

  - Cassini oval (analytic, p1=1, p2=1.5)  -> spectral convergence
  - apple-1 boundary (periodic cubic spline through the MPEG-7 landmarks)
    -> algebraic convergence (finite smoothness of real data)

  scaleErr(N) = ||P_N - P_ref||_F           (scale operator P = A diag(sigma) A^T)
  efuncErr(N) = max_s ||v_N(s) - v_ref(s)||  (eigenfunction sup-error on a grid)

Run (website repo root, venv active; numpy + scipy):
    USERPROFILE="$USERPROFILE" ~/venvs/zgrey-github-io/Scripts/python.exe scripts/compute_nystrom_convergence.py

Output: src/assets/js/sst/widgets/_nystrom_data.js
"""

from pathlib import Path
import re
import numpy as np
from scipy.interpolate import CubicSpline

APPLE_JS = Path(__file__).resolve().parent.parent / "src/assets/js/sst/widgets/_apple.js"
OUT_JS = Path(__file__).resolve().parent.parent / "src/assets/js/sst/widgets/_nystrom_data.js"

P1, P2 = 1.0, 1.5          # Cassini params (match the MATLAB demo)
N_REF = 8192
N_GRID = sorted(set(int(round(x)) for x in np.logspace(np.log10(8), np.log10(256), 14)))
GRID_PTS = 1000            # refined grid for the eigenfunction sup-error
APPLE_OUTLINE_PTS = 240    # dense apple outline embedded for display/node placement
FLOOR = 1e-13


def cassini(t):
    r = np.sqrt(np.maximum(0, P1 * np.cos(2 * t) + np.sqrt(np.maximum(0, P2 / P1**4 - np.sin(2 * t)**2))))
    return np.column_stack([r * np.cos(t), r * np.sin(t)])


def cassini_speed(t):
    e = 1e-6
    return np.hypot(*((cassini(t + e) - cassini(t - e)).T / (2 * e)))


def load_apple_spline():
    js = APPLE_JS.read_text()
    A = np.array([[float(a), float(b)] for a, b in
                  re.findall(r"\[(-?\d+\.\d+), (-?\d+\.\d+)\]", js)])
    m = len(A)
    u = np.linspace(0, 1, m, endpoint=False)
    uu = np.append(u, 1.0)
    AA = np.vstack([A, A[:1]])
    sx = CubicSpline(uu, AA[:, 0], bc_type="periodic")
    sy = CubicSpline(uu, AA[:, 1], bc_type="periodic")
    dx, dy = sx.derivative(), sy.derivative()

    def curve(t):
        tt = (t / (2 * np.pi)) % 1.0
        return np.column_stack([sx(tt), sy(tt)])

    def speed(t):
        tt = (t / (2 * np.pi)) % 1.0
        return np.hypot(dx(tt), dy(tt)) / (2 * np.pi)

    return curve, speed


def solve(curve, speed, N):
    s = np.arange(N) * 2 * np.pi / N
    C = curve(s)
    W = (2 * np.pi / N) / np.maximum(speed(s), 1e-12)
    cm = (W[:, None] * C).sum(0) / W.sum()      # weighted centroid
    Cc = C - cm
    M = Cc.T @ (W[:, None] * Cc)
    w, V = np.linalg.eigh(M)
    idx = np.argsort(w)[::-1]
    w, V = w[idx], V[:, idx]
    sig = np.sqrt(np.maximum(w, 1e-300))
    return V, sig, cm


def efun(curve, V, sig, cm, sgrid):
    return (curve(sgrid) - cm) @ V / sig        # columns = eigenfunctions


def convergence(curve, speed):
    sgrid = np.linspace(0, 2 * np.pi, GRID_PTS, endpoint=False)
    Vr, sr, cmr = solve(curve, speed, N_REF)
    Pr = Vr @ np.diag(sr) @ Vr.T
    vref = efun(curve, Vr, sr, cmr, sgrid)
    scale, efn = [], []
    for N in N_GRID:
        V, sig, cm = solve(curve, speed, N)
        P = V @ np.diag(sig) @ V.T
        vn = efun(curve, V, sig, cm, sgrid)
        for j in range(2):                       # align eigenfunction sign
            if np.sum(vn[:, j] * vref[:, j]) < 0:
                vn[:, j] = -vn[:, j]
        scale.append(max(float(np.linalg.norm(P - Pr)), FLOOR))
        efn.append(max(float(np.max(np.linalg.norm(vn - vref, axis=1))), FLOOR))
    return scale, efn, sr[0] / sr[1]


def js_arr(a, fmt="{:.4e}"):
    return "[" + ", ".join(fmt.format(x) for x in a) + "]"


def main():
    acurve, aspeed = load_apple_spline()
    cs_scale, cs_efn, cs_an = convergence(cassini, cassini_speed)
    ap_scale, ap_efn, ap_an = convergence(acurve, aspeed)
    print(f"Cassini aniso={cs_an:.3f}  apple aniso={ap_an:.3f}")

    # dense apple outline at uniform spline parameter (for display + node placement)
    uu = np.linspace(0, 2 * np.pi, APPLE_OUTLINE_PTS, endpoint=False)
    outline = acurve(uu)
    out_rows = ",\n    ".join(f"[{x:.4f}, {y:.4f}]" for x, y in outline)

    js = (
        "/**\n"
        " * Precomputed Nystrom convergence data (scripts/compute_nystrom_convergence.py).\n"
        " * Arc-length-weighted quadrature per the TDA-SST nystrom_demo.m convention.\n"
        " *   scale: ||P_N - P_ref||_F   efunc: max_s ||v_N(s) - v_ref(s)||\n"
        " * Cassini (analytic) converges spectrally; the apple spline algebraically.\n"
        " */\n\n"
        "export const NYSTROM = {\n"
        f"  p1: {P1},\n  p2: {P2},\n"
        f"  N: {js_arr(N_GRID, '{:d}')},\n"
        "  cassini: {\n"
        f"    scale: {js_arr(cs_scale)},\n    efunc: {js_arr(cs_efn)}\n  }},\n"
        "  apple: {\n"
        f"    scale: {js_arr(ap_scale)},\n    efunc: {js_arr(ap_efn)}\n  }},\n"
        f"  appleOutline: [\n    {out_rows}\n  ]\n"
        "};\n"
    )
    OUT_JS.write_text(js, encoding="utf-8")
    print(f"wrote {OUT_JS}  (N grid: {N_GRID})")


if __name__ == "__main__":
    main()

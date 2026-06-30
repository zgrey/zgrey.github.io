"""Manim set-piece: exponential / logarithm maps on a sphere.

Cinematic stand-in for img/Fancy_exp_log_maps.eps: a tangent vector v at a base
point p is pushed onto the manifold by the geodesic Exp_p(v) reaching q; Log_p(q)
recovers v. The model planar case of the SST manifold (Gr, SPD) machinery.

Render (website repo root, venv active):
    USERPROFILE="$USERPROFILE" MANIM_PY=~/venvs/zgrey-github-io/Scripts/python.exe \
        QUALITY=l bash manim/render.sh exp_log_maps
"""

import numpy as np
from manim import (
    ThreeDScene, Sphere, ThreeDAxes, Dot3D, Arrow3D, ParametricFunction, MathTex,
    Create, FadeIn, DEGREES, BLUE_E, YELLOW, GREEN, ORANGE, RED, UL, DOWN,
)

R = 2.0


class ExpLogMaps(ThreeDScene):
    def construct(self):
        self.set_camera_orientation(phi=65 * DEGREES, theta=40 * DEGREES)
        axes = ThreeDAxes(x_range=[-3, 3], y_range=[-3, 3], z_range=[-3, 3])
        sphere = Sphere(radius=R, resolution=(28, 28)).set_opacity(0.25).set_color(BLUE_E)

        phat = np.array([0.4, 0.2, 1.0]); phat = phat / np.linalg.norm(phat)
        p = R * phat
        raw = np.array([1.0, -0.5, 0.0])
        vhat = raw - np.dot(raw, phat) * phat; vhat = vhat / np.linalg.norm(vhat)
        arc = 1.15  # geodesic arc-angle

        pdot = Dot3D(p, color=YELLOW, radius=0.07)
        tangent = Arrow3D(p, p + R * arc * vhat, color=GREEN)

        def geo(t):
            return R * (np.cos(arc * t) * phat + np.sin(arc * t) * vhat)

        geodesic = ParametricFunction(geo, t_range=[0, 1], color=ORANGE)
        qdot = Dot3D(geo(1.0), color=RED, radius=0.07)

        lab_log = MathTex(r"\mathrm{Log}_p(q)=v", color=GREEN).scale(0.7).to_corner(UL)
        lab_exp = MathTex(r"\mathrm{Exp}_p(v)=q", color=ORANGE).scale(0.7).to_corner(UL).shift(DOWN * 0.7)
        self.add_fixed_in_frame_mobjects(lab_log, lab_exp)
        lab_log.set_opacity(0); lab_exp.set_opacity(0)

        self.play(Create(axes), Create(sphere), run_time=1.5)
        self.play(FadeIn(pdot))
        self.play(Create(tangent), lab_log.animate.set_opacity(1))
        self.play(Create(geodesic), FadeIn(qdot), lab_exp.animate.set_opacity(1), run_time=2)
        self.begin_ambient_camera_rotation(rate=0.28)
        self.wait(3.5)
        self.stop_ambient_camera_rotation()

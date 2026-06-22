"""Manim set-piece: the principal fiber bundle / canonical projection.

Stand-in for img/fiber_bundle_sec.eps: points X in the total space sit on fibers
(the GL(2) orbit = scalings), and the canonical projection pi: X -> [X] collapses
each fiber to a single point on the base Gr(2,n). Scale-invariance pi(XM)=pi(X)
made visual — the undulation [X] is what survives.

Render (website repo root, venv active):
    USERPROFILE="$USERPROFILE" MANIM_PY=~/venv/Scripts/python.exe \
        QUALITY=l bash manim/render.sh fiber_bundle
"""

import numpy as np
from manim import (
    Scene, Line, DashedLine, Dot, Arrow, MathTex, Create, FadeIn, Write,
    GrowArrow, UP, DOWN, LEFT, RIGHT, GREY_B, GREY, BLUE, YELLOW, GREEN,
)


class FiberBundle(Scene):
    def construct(self):
        base = Line(LEFT * 5.2, RIGHT * 5.2).shift(DOWN * 2.7).set_color(GREY_B)
        base_lab = MathTex(r"\mathrm{Gr}(2,n)\ :\ [X]").scale(0.7).set_color(BLUE)
        base_lab.next_to(base, DOWN, buff=0.15)
        self.play(Create(base), Write(base_lab))

        pi_lab = MathTex(r"\pi:\ X \mapsto [X], \qquad \pi(XM)=\pi(X)").scale(0.7).set_color(GREEN)
        pi_lab.to_edge(UP)
        fiber_lab = MathTex(r"\text{fiber} = \{\, XM : M \in GL(2) \,\}\ \ (\text{scale})").scale(0.6).set_color(YELLOW)
        fiber_lab.next_to(pi_lab, DOWN, buff=0.2)
        self.play(Write(pi_lab), Write(fiber_lab))

        for x0 in (-3.0, 0.2, 3.2):
            b = np.array([x0, -2.7, 0.0])
            fiber = DashedLine(b, b + UP * 4.8, color=GREY)
            bp = Dot(b, color=BLUE, radius=0.07)
            self.play(Create(fiber), FadeIn(bp), run_time=0.5)
            pts = [Dot(b + UP * h, color=YELLOW, radius=0.06) for h in (1.5, 2.7, 3.9)]
            self.play(*[FadeIn(d) for d in pts], run_time=0.4)
            arrows = [Arrow(d.get_center(), b + UP * 0.15, color=GREEN, buff=0.12, stroke_width=3) for d in pts]
            self.play(*[GrowArrow(a) for a in arrows], run_time=0.7)

        self.wait(2)

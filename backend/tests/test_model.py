"""
Checks of the channel-flow model against the report.

Run from the backend folder:  python -m unittest discover -s tests
"""
import json
import os
import random
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.model import (  # noqa: E402
    CEILING, FLOOR, INLET, INLET_CEILING, INLET_FLOOR, INTERIOR, OUTLET, OUTLET_CEILING, OUTLET_FLOOR,
    ChannelFlowSolver, Params, cell_equation, cell_type,
)

NX, NY, H, NU = 80, 8, 5.0, 1.0
Q = H / (2 * NU)   # h/2 = 2.5, the factor of the report


def generic_equation(i, j, nx, ny, field, a, b, w_in, q):
    """
    Independent implementation: central formula of the report with each missing neighbour
    replaced by the boundary value (inlet W = w_in, floor S = 0, ceiling N = 0, outlet E = W).
    `field` maps (i, j) -> value for existing cells.
    """
    W = field[(i - 1, j)] if i > 0 else w_in
    S = field[(i, j - 1)] if j > 0 else 0.0
    N = field[(i, j + 1)] if j < ny - 1 else 0.0
    E = field[(i + 1, j)] if i < nx - 1 else W
    return 0.25 * (E + W + N + S - q * a * (E - W) - q * b * (N - S))


class MeshTests(unittest.TestCase):
    def test_mesh_of_the_report(self):
        s = ChannelFlowSolver(Params())
        self.assertEqual((s.nx, s.ny, s.h), (80, 8, 5.0))
        self.assertEqual(s.mesh()["unknowns"], 1280)

    def test_cells_per_type(self):
        counts = ChannelFlowSolver(Params()).mesh()["type_counts"]
        expected = {INTERIOR: 468, INLET: 6, OUTLET: 6, FLOOR: 78, CEILING: 78,
                    INLET_FLOOR: 1, INLET_CEILING: 1, OUTLET_FLOOR: 1, OUTLET_CEILING: 1}
        self.assertEqual(counts, {str(k): v for k, v in sorted(expected.items())})
        self.assertEqual(sum(counts.values()), 640)

    def test_corner_types(self):
        self.assertEqual(cell_type(0, 0, NX, NY), INLET_FLOOR)
        self.assertEqual(cell_type(0, 7, NX, NY), INLET_CEILING)
        self.assertEqual(cell_type(79, 0, NX, NY), OUTLET_FLOOR)
        self.assertEqual(cell_type(79, 7, NX, NY), OUTLET_CEILING)

    def test_block_must_divide_length_and_width(self):
        for block in (1, 2, 4, 5, 8, 10, 20, 40):
            Params(block=block)
        for block in (3, 6, 7, 16, 0):
            with self.assertRaises(ValueError):
                Params(block=block)

    def test_relaxation_parameters_are_validated(self):
        for kwargs in ({"omega": 0.0}, {"omega": 2.0}, {"omega": -1.0}, {"tol": 0.0},
                       {"initial_vx": -0.1}, {"initial_vx": 1.5}, {"sweeps_per_second": 0}, {"sweeps_per_second": 5000}):
            with self.assertRaises(ValueError):
                Params(**kwargs)


class EquationTests(unittest.TestCase):
    def test_nine_equations_match_generic_substitution(self):
        rng = random.Random(7)
        for _ in range(30):
            vx = {(i, j): rng.uniform(-1.5, 1.5) for j in range(NY) for i in range(NX)}
            vy = {(i, j): rng.uniform(-1.5, 1.5) for j in range(NY) for i in range(NX)}
            for j in range(NY):
                for i in range(NX):
                    t = cell_type(i, j, NX, NY)
                    a, b = vx[(i, j)], vy[(i, j)]
                    for field, w_in in ((vx, 1.0), (vy, 0.0)):
                        def get(di, dj):
                            return field.get((i + di, j + dj), 0.0)
                        got = cell_equation(t, Q, get(1, 0), get(-1, 0), get(0, 1), get(0, -1), a, b, w_in)
                        want = generic_equation(i, j, NX, NY, field, a, b, w_in, Q)
                        self.assertAlmostEqual(got, want, places=12, msg=f"type {t} cell ({i}, {j})")

    def test_interior_matches_report_formula(self):
        # vx(i,j) = 1/4 [E + W + N + S - (h/2) vx (E - W) - (h/2) vy (N - S)], h/2 = 2.5
        E, W, N, S, C, vy = 0.7, 0.4, 0.5, 0.3, 0.6, 0.2
        want = 0.25 * (E + W + N + S - 2.5 * C * (E - W) - 2.5 * vy * (N - S))
        self.assertAlmostEqual(cell_equation(INTERIOR, Q, E, W, N, S, C, vy, 1.0), want, places=12)

    def test_outlet_equation_does_not_use_E(self):
        # Neumann condition dv/dx = 0 through a ghost node: E = W, so the neighbour E is not an input.
        for t in (OUTLET, OUTLET_FLOOR, OUTLET_CEILING):
            base = cell_equation(t, Q, 0.1, 0.4, 0.5, 0.3, 0.6, 0.2, 1.0)
            other = cell_equation(t, Q, 99.0, 0.4, 0.5, 0.3, 0.6, 0.2, 1.0)
            self.assertEqual(base, other)

    def test_inlet_value_enters_as_west_neighbour(self):
        # vx: W = 1 ; vy: W = 0. Only w_in changes.
        with_1 = cell_equation(INLET, Q, 0.7, 123.0, 0.5, 0.3, 0.6, 0.2, 1.0)
        with_0 = cell_equation(INLET, Q, 0.7, 123.0, 0.5, 0.3, 0.6, 0.2, 0.0)
        self.assertAlmostEqual(with_1, 0.25 * (0.7 + 1.0 + 0.5 + 0.3 - 2.5 * 0.6 * (0.7 - 1.0) - 2.5 * 0.2 * (0.5 - 0.3)))
        self.assertAlmostEqual(with_0, 0.25 * (0.7 + 0.0 + 0.5 + 0.3 - 2.5 * 0.6 * (0.7 - 0.0) - 2.5 * 0.2 * (0.5 - 0.3)))


class SolverTests(unittest.TestCase):
    def solve(self, omega, max_iter=3000, initial_vx=0.0):
        s = ChannelFlowSolver(Params(omega=omega, tol=1e-6, initial_vx=initial_vx))
        for _ in range(max_iter):
            s.sweep()
            if s.converged or s.diverged:
                break
        return s

    def test_initial_guess(self):
        for initial in (0.0, 1.0):    # 1.0 is the value suggested in the report
            s = ChannelFlowSolver(Params(initial_vx=initial))
            self.assertTrue(all(v == initial for row in s.vx for v in row))
            self.assertTrue(all(v == 0.0 for row in s.vy for v in row))

    def test_solution_does_not_depend_on_initial_guess(self):
        a, b = self.solve(0.8, initial_vx=0.0), self.solve(0.8, initial_vx=1.0)
        self.assertTrue(a.converged and b.converged)
        worst = max(abs(a.vx[j][i] - b.vx[j][i]) for j in range(NY) for i in range(NX))
        self.assertLess(worst, 1e-3)

    def test_converges_with_under_relaxation(self):
        s = self.solve(0.8)
        self.assertTrue(s.converged)
        flat = [v for row in s.vx for v in row]
        self.assertGreaterEqual(min(flat), 0.0)
        self.assertLessEqual(max(flat), 1.0)
        self.assertEqual(max(abs(v) for row in s.vy for v in row), 0.0)   # all vy boundary values are 0
        # symmetric in y
        for i in range(NX):
            for j in range(NY // 2):
                self.assertAlmostEqual(s.vx[j][i], s.vx[NY - 1 - j][i], places=5)

    def test_diverged_state_is_finite_and_serializable(self):
        # Regression: a diverging run used to overflow to inf/NaN and break sample()/JSON.
        s = self.solve(1.0, initial_vx=1.0)
        self.assertTrue(s.diverged)
        iterations = s.iteration
        s.sweep()                                   # a diverged solver does not keep iterating
        self.assertEqual(s.iteration, iterations)
        json.dumps(s.sample(), allow_nan=False)

    def test_no_over_relaxation_with_this_mesh(self):
        # With h = 5 m and nu = 1 m^2/s the cell Reynolds number is 5 (> 2), and the successive
        # relaxation of the central scheme does not converge for omega >= 0.95, including omega = 1
        # and over-relaxation (omega > 1): it either diverges or keeps oscillating, depending on the
        # initial guess. This documents that behaviour.
        for omega in (1.0, 1.3):
            for initial in (0.0, 1.0):
                s = self.solve(omega, max_iter=2000, initial_vx=initial)
                self.assertFalse(s.converged, f"omega = {omega}, initial vx = {initial}")


if __name__ == "__main__":
    unittest.main()

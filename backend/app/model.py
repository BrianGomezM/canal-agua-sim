from dataclasses import dataclass
import math

# |V| [m/s] from which the flow counts as having reached a point (also used to draw the water front).
REACH_SPEED = 0.03

# A sweep that changes a value by more than this [m/s] is taken as divergence: physical
# velocities here are of order 1 m/s, and stopping early keeps the numbers finite and
# JSON-serializable instead of overflowing to inf/NaN a few sweeps later.
DIVERGENCE_LIMIT = 1.0e6

# Cell types, numbered as in the report ("Tipos de ecuacion segun la posicion en la malla").
INTERIOR = 1
INLET = 2
OUTLET = 3
FLOOR = 4
CEILING = 5
INLET_FLOOR = 6
INLET_CEILING = 7
OUTLET_FLOOR = 8
OUTLET_CEILING = 9

TYPE_NAMES = {
    INTERIOR: "Interior",
    INLET: "Entrada",
    OUTLET: "Salida",
    FLOOR: "Piso",
    CEILING: "Techo",
    INLET_FLOOR: "Esquina entrada-piso",
    INLET_CEILING: "Esquina entrada-techo",
    OUTLET_FLOOR: "Esquina salida-piso",
    OUTLET_CEILING: "Esquina salida-techo",
}


@dataclass
class Params:
    length: float = 400.0        # channel length [m] (x direction)
    width: float = 40.0          # channel width [m] (y direction)
    # Each mesh cell groups block x block original 1 m cells, so h = block [m].
    # block must divide both length and width (criterion 1 of the report).
    block: int = 5
    nu: float = 1.0              # kinematic viscosity [m^2/s] (book value)
    rho: float = 1000.0          # density [kg/m^3]; only matters when dpdx != 0
    inlet_vx: float = 1.0        # inlet velocity vx [m/s]; vy = 0 at the inlet
    # Uniform pressure gradient dP/dx [Pa/m]. The report takes constant pressure (dpdx = 0); the book's
    # solution (eq. 4.66) needs a negative gradient, which pushes the fluid towards the outlet.
    dpdx: float = 0.0
    # Relaxation factor: 1 = Gauss-Seidel, > 1 = over-relaxation, < 1 = under-relaxation.
    # With the default mesh (h = 5 m, cell Reynolds number 5) the central scheme of the report
    # diverges for omega >= 0.95, so the default is an under-relaxation factor that converges.
    omega: float = 0.8
    tol: float = 1.0e-6          # stop when the largest change in one sweep is below this
    # Initial guess for vx in every cell (vy starts at 0). The report suggests 1; starting from 0
    # shows the flow entering the channel. Both converge to the same solution (they differ by
    # about 4e-5 for tol = 1e-6).
    initial_vx: float = 0.0
    sweeps_per_second: float = 40.0   # pace of the animation: iterations computed per second of real time

    def __post_init__(self):
        if self.block <= 0 or self.length % self.block or self.width % self.block:
            raise ValueError("block must divide both length and width")
        if not 0.0 < self.omega < 2.0:
            raise ValueError("omega must be in (0, 2)")
        if not self.tol > 0.0:
            raise ValueError("tol must be positive")
        if not 0.0 <= self.initial_vx <= self.inlet_vx:
            raise ValueError("initial_vx must be between 0 and inlet_vx")
        if not 1.0 <= self.sweeps_per_second <= 1000.0:
            raise ValueError("sweeps_per_second must be between 1 and 1000")
        if not 0.05 <= self.nu <= 100.0:
            raise ValueError("nu must be between 0.05 and 100 m^2/s")
        if not 0.05 <= self.inlet_vx <= 5.0:
            raise ValueError("inlet_vx must be between 0.05 and 5 m/s")
        if not -100.0 <= self.dpdx <= 100.0:
            raise ValueError("dpdx must be between -100 and 100 Pa/m")
        if not self.rho > 0.0:
            raise ValueError("rho must be positive")


def cell_type(i, j, nx, ny):
    """Type (1..9) of cell (i, j): i = 0..nx-1 along x, j = 0..ny-1 along y (0 = floor)."""
    inlet, outlet = i == 0, i == nx - 1
    floor, ceiling = j == 0, j == ny - 1
    if inlet and floor:
        return INLET_FLOOR
    if inlet and ceiling:
        return INLET_CEILING
    if outlet and floor:
        return OUTLET_FLOOR
    if outlet and ceiling:
        return OUTLET_CEILING
    if inlet:
        return INLET
    if outlet:
        return OUTLET
    if floor:
        return FLOOR
    if ceiling:
        return CEILING
    return INTERIOR


def cell_equation(t, q, E, W, N, S, a, b, w_in, pg=0.0):
    """
    The nine cell equations of the report, for either velocity component.

    E, W, N, S are the values of the component in the neighbours (E = (i+1, j),
    W = (i-1, j), N = (i, j+1), S = (i, j-1)); a = vx(i, j) and b = vy(i, j) are the
    transporting velocities; w_in is the inlet value of the component (inlet_vx for vx,
    0 for vy); q = h / (2 nu), which is h/2 for nu = 1.

    Central differences give (report, section 3.3):
        C = 1/4 [E + W + N + S - q a (E - W) - q b (N - S) - pg]
    where pg = h^2 / (nu rho) dP/dx for the vx equation and 0 for vy (uniform pressure gradient
    along x). The report takes constant pressure, so pg = 0 and the equations are exactly its own.
    Neighbours outside the mesh are replaced by the boundary condition: inlet W = w_in,
    floor S = 0, ceiling N = 0, outlet E = W (dv/dx = 0 through a ghost node). The
    arguments of a neighbour that does not exist for type t are ignored.
    """
    if t == INTERIOR:
        return 0.25 * (E + W + N + S - q * a * (E - W) - q * b * (N - S) - pg)
    if t == INLET:
        return 0.25 * (E + w_in + N + S - q * a * (E - w_in) - q * b * (N - S) - pg)
    if t == OUTLET:
        return 0.25 * (2 * W + N + S - q * b * (N - S) - pg)
    if t == FLOOR:
        return 0.25 * (E + W + N - q * a * (E - W) - q * b * N - pg)
    if t == CEILING:
        return 0.25 * (E + W + S - q * a * (E - W) + q * b * S - pg)
    if t == INLET_FLOOR:
        return 0.25 * (E + w_in + N - q * a * (E - w_in) - q * b * N - pg)
    if t == INLET_CEILING:
        return 0.25 * (E + w_in + S - q * a * (E - w_in) + q * b * S - pg)
    if t == OUTLET_FLOOR:
        return 0.25 * (2 * W + N - q * b * N - pg)
    return 0.25 * (2 * W + S + q * b * S - pg)      # OUTLET_CEILING


class ChannelFlowSolver:
    """
    Steady 2-D incompressible channel flow (Landau & Paez, eqs. 4.60-4.61) on an
    nx x ny mesh of square cells of side h, with constant pressure (dP = 0; optionally a uniform
    gradient dP/dx, whose term is pg in `cell_equation`):

        nu (d2v/dx2 + d2v/dy2) = vx dv/dx + vy dv/dy      for v = vx and v = vy

    Derivatives use central differences (error O(h^2)); solving each cell equation for
    its central value gives the nine equations of `cell_equation`. The resulting
    nonlinear, coupled system (2 * nx * ny unknowns) is solved by successive
    relaxation (book eq. 4.63): sweep the mesh, replacing each unknown v with
    v + omega * (F - v), where F is the cell equation evaluated with the most recent
    neighbour values, until the largest change in a sweep is below `tol`.

    State is kept as lists of rows, indexed [j][i].
    """

    def __init__(self, p: Params):
        self.p = p
        self.h = float(p.block)
        self.nx = int(round(p.length / p.block))
        self.ny = int(round(p.width / p.block))
        self.types = [[cell_type(i, j, self.nx, self.ny) for i in range(self.nx)] for j in range(self.ny)]
        self.vx = [[p.initial_vx] * self.nx for _ in range(self.ny)]
        self.vy = [[0.0] * self.nx for _ in range(self.ny)]
        self.iteration = 0
        self.residual = float("inf")
        self.diverged = False

    def update_params(self, p: Params):
        # Only omega, tol and the animation pace can change on a running solver; the mesh and the
        # physics are fixed (those of the report).
        self.p.omega = p.omega
        self.p.tol = p.tol
        self.p.sweeps_per_second = p.sweeps_per_second

    @property
    def converged(self):
        return not self.diverged and self.residual < self.p.tol

    def _neighbours(self, f, i, j):
        """E, W, N, S values of field f around (i, j); 0.0 where the neighbour does not exist."""
        E = f[j][i + 1] if i < self.nx - 1 else 0.0
        W = f[j][i - 1] if i > 0 else 0.0
        N = f[j + 1][i] if j < self.ny - 1 else 0.0
        S = f[j - 1][i] if j > 0 else 0.0
        return E, W, N, S

    def sweep(self):
        """One sweep of successive relaxation over all cells. Returns the largest change."""
        if self.diverged:
            return self.residual
        p = self.p
        q = self.h / (2.0 * p.nu)
        pgx = self.h * self.h / (p.nu * p.rho) * p.dpdx       # pressure term of the vx equation
        max_r = 0.0
        for j in range(self.ny):
            for i in range(self.nx):
                t = self.types[j][i]
                # vx first, then vy, each with the most recent values (including the ones
                # just updated in this sweep).
                for f, w_in, pg in ((self.vx, p.inlet_vx, pgx), (self.vy, 0.0, 0.0)):
                    E, W, N, S = self._neighbours(f, i, j)
                    new = cell_equation(t, q, E, W, N, S, self.vx[j][i], self.vy[j][i], w_in, pg)
                    r = new - f[j][i]
                    max_r = max(max_r, abs(r))
                    f[j][i] += p.omega * r
        self.iteration += 1
        self.residual = max_r
        if not max_r < DIVERGENCE_LIMIT:                # too large, inf or NaN
            self.diverged = True
        return max_r

    def live_data(self):
        """Quantities shown while the method iterates (flows are per metre of depth, in m^2/s)."""
        h = self.h
        flow_in = sum(row[0] for row in self.vx) * h                  # through the first column of cells
        flow_out = sum(row[self.nx - 1] for row in self.vx) * h       # through the last column
        vmax = max(math.hypot(self.vx[j][i], self.vy[j][i]) for j in range(self.ny) for i in range(self.nx))
        reach = 0.0
        for i in range(self.nx - 1, -1, -1):
            if any(math.hypot(self.vx[j][i], self.vy[j][i]) >= REACH_SPEED for j in range(self.ny)):
                reach = (i + 1) * h                                   # x up to which the flow has arrived
                break
        return {"flow_in": flow_in, "flow_out": flow_out, "vmax": vmax, "reach": reach}

    def sample(self):
        return {**self.live_data(),
            "iteration": self.iteration,
            "residual": self.residual if math.isfinite(self.residual) else None,
            "converged": self.converged,
            "diverged": self.diverged,
            "omega": self.p.omega,
            "tol": self.p.tol,
            "vx": self.vx,
            "vy": self.vy,
        }

    def mesh(self):
        counts = {}
        for row in self.types:
            for t in row:
                counts[t] = counts.get(t, 0) + 1
        return {
            "nx": self.nx,
            "ny": self.ny,
            "h": self.h,
            "length": self.p.length,
            "width": self.p.width,
            "block": self.p.block,
            "nu": self.p.nu,
            "rho": self.p.rho,
            "dpdx": self.p.dpdx,
            "inlet_vx": self.p.inlet_vx,
            # Reference speed of the colour scale: the inlet speed or, with a pressure gradient, the
            # peak of the plane Poiseuille profile it would drive (-dpdx W^2 / (8 nu rho)).
            "vref": max(self.p.inlet_vx, abs(self.p.dpdx) * self.p.width ** 2 / (8 * self.p.nu * self.p.rho)),
            "types": self.types,
            "type_names": {str(k): v for k, v in TYPE_NAMES.items()},
            "type_counts": {str(k): counts[k] for k in sorted(counts)},
            "unknowns": 2 * self.nx * self.ny,
        }

from dataclasses import dataclass
import numpy as np

RHO_WATER = 1000.0
RHO_AIR = 1.225
CD_INLET = 0.85

FLOORS = {
    "concrete": {"name": "Concreto", "manning_n": 0.013},
    "asphalt": {"name": "Asfalto", "manning_n": 0.016},
    "soil": {"name": "Tierra", "manning_n": 0.030},
    "gravel": {"name": "Grava", "manning_n": 0.035},
    "smooth": {"name": "Superficie lisa", "manning_n": 0.010},
    "wood": {"name": "Madera", "manning_n": 0.012},
}

# Height of the side walls [m]. Used both to clip the depth (excess water
# "spills" out of the channel instead of piling up without limit) and by the
# frontend to draw walls of a matching height.
WALL_HEIGHT = 1.8


@dataclass
class Params:
    length: float = 400.0
    width: float = 40.0
    depth: float = 0.50
    nx: int = 160
    ny: int = 16
    gravity: float = 9.81
    pressure_kpa: float = 15.0
    water_on: bool = True
    wind_mps: float = 0.0
    wind_y_mps: float = 0.0
    rain_mm_h: float = 0.0
    sun: float = 0.0
    floor: str = "concrete"
    viscosity: float = 1.0e-4
    inlet_y: float = 20.0
    # Physical width of the hose/valve opening [m]. Widening it forces more
    # cells at the inlet, so the "valve size" control has a real hydraulic
    # effect (more cross-sectional area -> more flow), not just a cosmetic one.
    hose_diameter: float = 1.5


class ShallowWaterSimulation:
    """
    Educational 2-D depth-averaged flow model.

    It is a reduced form of the Navier-Stokes equations under shallow-water
    assumptions. The state variables are:
      h = water depth [m]
      u = depth-averaged x velocity [m/s]
      v = depth-averaged y velocity [m/s]

    The discretization uses finite differences on a rectangular grid.
    """

    def __init__(self, p: Params):
        self.p = p
        self.dx = p.length / p.nx
        self.dy = p.width / p.ny
        # Dry channel at t=0: water only appears once it flows in from the hose,
        # so it visibly spreads across the floor instead of starting pre-filled.
        self.h = np.zeros((p.ny, p.nx), dtype=np.float64)
        self.u = np.zeros_like(self.h)
        self.v = np.zeros_like(self.h)
        self.t = 0.0
        self.steps = 0
        self.overflow_rate = 0.0     # m^3/s spilled over the walls this step
        self.overflow_volume = 0.0   # cumulative m^3 spilled since t=0

    def update_params(self, p: Params):
        # Keep the numerical state but update physical/control parameters.
        self.p = p

    def inlet_velocity(self):
        if not self.p.water_on or self.p.pressure_kpa <= 0:
            return 0.0
        dp = self.p.pressure_kpa * 1000.0
        return CD_INLET * np.sqrt(2.0 * dp / RHO_WATER)

    def floor_roughness(self):
        return FLOORS.get(self.p.floor, FLOORS["concrete"])["manning_n"]

    def stable_dt(self):
        c = np.sqrt(np.maximum(self.p.gravity * self.h, 0.0))
        max_speed = float(np.max(np.abs(self.u) + np.abs(self.v) + c))
        if max_speed < 1e-8:
            return 0.20
        return min(0.20, 0.35 * min(self.dx, self.dy) / max_speed)

    @staticmethod
    def laplacian(a, dx, dy):
        out = np.zeros_like(a)
        out[1:-1, 1:-1] = (
            (a[1:-1, 2:] - 2*a[1:-1, 1:-1] + a[1:-1, :-2]) / dx**2
            + (a[2:, 1:-1] - 2*a[1:-1, 1:-1] + a[:-2, 1:-1]) / dy**2
        )
        return out

    @staticmethod
    def grad_x(a, dx):
        out = np.zeros_like(a)
        out[:, 1:-1] = (a[:, 2:] - a[:, :-2]) / (2.0 * dx)
        out[:, 0] = (a[:, 1] - a[:, 0]) / dx
        out[:, -1] = (a[:, -1] - a[:, -2]) / dx
        return out

    @staticmethod
    def grad_y(a, dy):
        out = np.zeros_like(a)
        out[1:-1, :] = (a[2:, :] - a[:-2, :]) / (2.0 * dy)
        out[0, :] = (a[1, :] - a[0, :]) / dy
        out[-1, :] = (a[-1, :] - a[-2, :]) / dy
        return out

    @staticmethod
    def upwind_x(a, vel, dx):
        """
        First-order upwind derivative of `a` in x, using the sign of the
        local transport velocity `vel` to pick the one-sided difference:

            da/dx ~= (a[i] - a[i-1]) / dx   if vel[i] >= 0  (flow from the left)
            da/dx ~= (a[i+1] - a[i]) / dx   if vel[i] <  0  (flow from the right)

        Central differencing of the nonlinear advection terms (u du/dx,
        d(hu)/dx, ...) under forward-Euler time stepping is unconditionally
        unstable (von Neumann analysis of the linearized advection equation
        gives |amplification factor| > 1 for every wavenumber, for any dt).
        That is exactly what made a concentrated jet into a dry channel blow
        up within a few hundred steps.

        A blanket Lax-Friedrichs fix (replacing each cell with the average of
        its neighbours) does stabilize it, but its implicit diffusion
        coefficient is ~dx^2/(2 dt), which for this grid/dt is on the order
        of 10-20 m^2/s -- many orders of magnitude above any physical value,
        and it smeared water sideways across the full 40 m width in a few
        seconds regardless of the actual velocity field.

        Upwinding is the standard, better-justified fix for this kind of
        scheme: expanding a[i-1] (or a[i+1]) in a Taylor series around i shows
        the upwind formula equals the true derivative plus a leading error
        term of order dx, which acts as an *added diffusion* of magnitude
        ~|vel| dx/2 -- proportional to the local flow speed, not to a fixed
        grid/timestep ratio. Where vel ~ 0 (e.g. sideways spreading driven
        only by the pressure gradient, not directly forced), the extra
        diffusion is small, so the wetting front advances at a physically
        sensible rate instead of smearing instantly across the channel.
        """
        bwd = np.empty_like(a); bwd[:, 1:] = (a[:, 1:] - a[:, :-1]) / dx; bwd[:, 0] = bwd[:, 1]
        fwd = np.empty_like(a); fwd[:, :-1] = (a[:, 1:] - a[:, :-1]) / dx; fwd[:, -1] = fwd[:, -2]
        return np.where(vel >= 0, bwd, fwd)

    @staticmethod
    def upwind_y(a, vel, dy):
        """Same as upwind_x, transporting in the y direction (see upwind_x)."""
        bwd = np.empty_like(a); bwd[1:, :] = (a[1:, :] - a[:-1, :]) / dy; bwd[0, :] = bwd[1, :]
        fwd = np.empty_like(a); fwd[:-1, :] = (a[1:, :] - a[:-1, :]) / dy; fwd[-1, :] = fwd[-2, :]
        return np.where(vel >= 0, bwd, fwd)

    def step(self):
        p = self.p
        dt = self.stable_dt()

        h0 = self.h.copy()
        u0 = self.u.copy()
        v0 = self.v.copy()

        # Hydrostatic pressure contribution: p_h = rho*g*h. Central differencing
        # is appropriate here -- it is the nonlinear advection terms below,
        # not this linear source term, that need upwinding for stability.
        ghx = p.gravity * self.grad_x(h0, self.dx)
        ghy = p.gravity * self.grad_y(h0, self.dy)

        # Upwind derivatives for the nonlinear self-advection terms (see
        # upwind_x/upwind_y docstrings).
        ux = self.upwind_x(u0, u0, self.dx)
        uy = self.upwind_y(u0, v0, self.dy)
        vx = self.upwind_x(v0, u0, self.dx)
        vy = self.upwind_y(v0, v0, self.dy)

        # Manning-type bottom friction, used as a practical channel-loss model.
        n = self.floor_roughness()
        speed = np.sqrt(u0*u0 + v0*v0)
        depth_safe = np.maximum(h0, 0.01)
        friction = p.gravity * n*n * speed / np.maximum(depth_safe, 0.02)**(4.0/3.0)

        # Wind is represented as a quadratic surface shear acceleration
        # (standard bulk drag form, tau ~ rho_air * Cd * |W| * W), independently
        # for each horizontal component so the channel can be pushed diagonally.
        # A realistic free-surface drag coefficient (~0.001-0.003) would move
        # a shallow channel by a fraction of a mm/s even in a strong wind --
        # correct, but invisible in a short live demo. CD_WIND is deliberately
        # raised well above that physical range (see README) so the effect on
        # u/v (and the surface-drift visualization) is actually observable.
        CD_WIND = 0.05
        wind_acc_x = CD_WIND * RHO_AIR / RHO_WATER * p.wind_mps * abs(p.wind_mps)
        wind_acc_y = CD_WIND * RHO_AIR / RHO_WATER * p.wind_y_mps * abs(p.wind_y_mps)
        wind_acc_field_x = wind_acc_x / np.maximum(depth_safe, 0.05)
        wind_acc_field_y = wind_acc_y / np.maximum(depth_safe, 0.05)

        # Rain is a volume source. Sun drives an evaporation sink.
        rain = p.rain_mm_h / 1000.0 / 3600.0  # mm/h -> m/s
        # NOTE: real evaporation is on the order of mm/day, which would be
        # invisible on the timescale of a live demo. This rate is deliberately
        # exaggerated (~100x) so the sun slider has a visible effect within a
        # few tens of seconds -- it is a teaching stand-in, not a physical
        # evaporation model (see README).
        evaporation = p.sun * 4.0e-5
        dh_source = rain - evaporation

        # Hose/inlet at x=0, centered in y. Its physical width (hose_diameter)
        # sets how many grid cells the inflow is forced over.
        inlet_u = self.inlet_velocity()
        inlet_j = int(np.clip(round(p.inlet_y / self.dy), 0, p.ny - 1))
        inlet_half_cells = max(0, int(round((p.hose_diameter / 2.0) / self.dy)))

        # Continuity in conservative form. The flux divergence d(hu)/dx is the
        # same kind of nonlinear conservation-law term as the momentum
        # advection above, so it gets the same upwind treatment (based on the
        # sign of the transporting velocity), which is what keeps a sharp
        # wetting front from blowing up.
        hu = h0 * u0
        hv = h0 * v0
        d_hu_dx = self.upwind_x(hu, u0, self.dx)
        d_hv_dy = self.upwind_y(hv, v0, self.dy)

        h1 = h0 + dt * (-d_hu_dx - d_hv_dy + dh_source)

        # Momentum/velocity equations (depth averaged).
        adv_u = u0 * ux + v0 * uy
        adv_v = u0 * vx + v0 * vy
        lap_u = self.laplacian(u0, self.dx, self.dy)
        lap_v = self.laplacian(v0, self.dx, self.dy)

        u1 = u0 + dt * (
            -adv_u - ghx + p.viscosity * lap_u
            - friction * u0 + wind_acc_field_x
        )
        v1 = v0 + dt * (
            -adv_v - ghy + p.viscosity * lap_v
            - friction * v0 + wind_acc_field_y
        )

        # Positivity and open outlet.
        h1 = np.maximum(h1, 0.0)

        # No-normal-flow side walls (simple reflective boundary).
        v1[0, :] = 0.0
        v1[-1, :] = 0.0

        # Inlet boundary: impose velocity across the hose's physical width.
        u1[:, 0] *= 0.98
        v1[:, 0] *= 0.98
        if p.water_on:
            j_lo = max(0, inlet_j - inlet_half_cells)
            j_hi = min(p.ny, inlet_j + inlet_half_cells + 1)
            for j in range(j_lo, j_hi):
                u1[j, 0] = inlet_u
                h1[j, 0] = max(h1[j, 0], p.depth * 0.20)

        # Damping near outlet prevents artificial reflections.
        u1[:, -1] *= 0.995
        v1[:, -1] *= 0.995

        # Overflow: water above the wall height spills out of the channel
        # instead of piling up without limit. The removed volume is tracked
        # so the frontend can show it (and, in principle, so a mass-balance
        # check could account for it as an outflow term).
        excess = np.maximum(h1 - WALL_HEIGHT, 0.0)
        self.overflow_rate = float(excess.sum() * self.dx * self.dy / dt) if dt > 0 else 0.0
        self.overflow_volume += self.overflow_rate * dt
        h1 = np.minimum(h1, WALL_HEIGHT)

        # Avoid numerical explosion in the educational visualization.
        u1 = np.clip(u1, -20.0, 20.0)
        v1 = np.clip(v1, -10.0, 10.0)
        h1 = np.clip(h1, 0.0, WALL_HEIGHT)

        self.h, self.u, self.v = h1, u1, v1
        self.t += dt
        self.steps += 1

        return dt

    def sample(self, max_nx=80, max_ny=24):
        # Stride-based downsampling for the browser.
        sx = max(1, self.p.nx // max_nx)
        sy = max(1, self.p.ny // max_ny)
        h = self.h[::sy, ::sx]
        u = self.u[::sy, ::sx]
        v = self.v[::sy, ::sx]
        speed = np.sqrt(u*u + v*v)
        pressure_kpa = RHO_WATER * self.p.gravity * h / 1000.0

        inlet_half_cells = max(0, int(round((self.p.hose_diameter / 2.0) / self.dy)))
        inlet_width = (2 * inlet_half_cells + 1) * self.dy
        inlet_u = self.inlet_velocity()

        return {
            "t": self.t,
            "dt": self.stable_dt(),
            "nx": int(h.shape[1]),
            "ny": int(h.shape[0]),
            "dx": self.dx * sx,
            "dy": self.dy * sy,
            "h": h.round(4).tolist(),
            "u": u.round(4).tolist(),
            "v": v.round(4).tolist(),
            "speed": speed.round(4).tolist(),
            "pressure_kpa": pressure_kpa.round(4).tolist(),
            "inlet_velocity": inlet_u,
            "inlet_width": inlet_width,
            "flow_rate_approx": float(inlet_u * self.p.depth * 0.20 * inlet_width),
            "overflow_rate": round(self.overflow_rate, 5),
            "overflow_volume": round(self.overflow_volume, 3),
            "wall_height": WALL_HEIGHT,
            "steps": self.steps,
        }

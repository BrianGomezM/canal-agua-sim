# Simulación numérica de un canal de agua

Proyecto educativo para **Simulación y Computación Numérica**.

## Qué contiene

- **Backend Python + FastAPI + NumPy**: solver numérico.
- **Frontend Three.js + Vite**: visualización 3D interactiva.
- Canal físico de **400 × 40 m**.
- Discretización rectangular configurable desde el backend.
- Manguera de entrada con presión y **tamaño (diámetro) regulables** — el diámetro fija cuántas celdas de la malla reciben el caudal, así que tiene efecto hidráulico real, no solo visual. Llave 3D que gira al abrir/cerrar.
- Encendido/apagado del flujo.
- Variables exógenas: gravedad, viento (X **e Y**, con partículas de deriva sobre el agua y una brújula en el panel), lluvia (con partículas cayendo), sol/evaporación (con sprite de sol + niebla ascendente) y tipo de piso (concreto, asfalto, tierra, grava, superficie lisa, **madera**), cada uno con color/textura realista.
- **Desborde real**: si la profundidad supera la altura de las paredes (`WALL_HEIGHT`), el agua sale del dominio (se resta del balance, no solo se recorta visualmente) y se muestra un aviso.
- Puntero sobre el canal para consultar posición, profundidad, velocidad, componentes `u/v` y presión hidrostática aproximada.
- `dt` adaptativo según una condición tipo CFL.
- La altura del agua se dibuja con una **exageración vertical ×3** (solo visual, no afecta la física ni los valores del inspector) porque a la escala del canal (400×40 m) los cambios de profundidad de decenas de cm son casi imperceptibles sin ella.

## Modelo matemático

El proyecto usa una **aproximación 2D de aguas someras (Saint-Venant)**, que es una reducción de las ecuaciones de Navier–Stokes bajo hipótesis de profundidad pequeña respecto de la escala horizontal.

Estado:

- `h(x,y,t)`: profundidad del agua.
- `u(x,y,t)`: velocidad media en X.
- `v(x,y,t)`: velocidad media en Y.

Continuidad:

    ∂h/∂t + ∂(hu)/∂x + ∂(hv)/∂y = R - E

Momentum, en forma educativa:

    ∂u/∂t + u∂u/∂x + v∂u/∂y
      = -g∂h/∂x + ν∇²u - F u + A_w

    ∂v/∂t + u∂v/∂x + v∂v/∂y
      = -g∂h/∂y + ν∇²v - F v

donde:

- `g`: gravedad.
- `ν`: viscosidad cinemática efectiva.
- `F`: término de resistencia del piso.
- `A_w`: aceleración superficial simplificada por viento.
- `R`: aporte de lluvia.
- `E`: evaporación educativa.

La presión hidrostática usada para consulta es:

    p ≈ ρ g h

con `ρ = 1000 kg/m³`.

### Entrada de la manguera

La presión de entrada se transforma en una velocidad aproximada mediante:

    u_in = C_d sqrt(2 Δp / ρ)

con `C_d = 0.85`.

Esto NO pretende ser un modelo detallado de una instalación hidráulica real; es una entrada parametrizada para el proyecto académico.

### Piso

El tipo de piso modifica el coeficiente de Manning `n`, que se usa en el término de resistencia:

- superficie lisa: 0.010
- concreto: 0.013
- asfalto: 0.016
- tierra: 0.030
- grava: 0.035

Estos valores son parámetros iniciales del prototipo y deben justificarse/revisarse para el contexto físico que el grupo decida modelar.

## Discretización

El dominio es:

    0 <= x <= 400
    0 <= y <= 40

Con `nx = 160`, `ny = 16`:

    Δx = 400/160 = 2.5 m
    Δy = 40/16 = 2.5 m

El término de presión hidrostática y el término viscoso (lineales/difusivos) se aproximan con diferencias finitas centradas en el interior:

    ∂f/∂x ≈ (f[i+1,j] - f[i-1,j])/(2Δx)

    ∂f/∂y ≈ (f[i,j+1] - f[i,j-1])/(2Δy)

y el laplaciano:

    ∇²f ≈ (f[i+1,j]-2f[i,j]+f[i-1,j])/Δx²
         + (f[i,j+1]-2f[i,j]+f[i,j-1])/Δy²

Los términos **no lineales de advección** (`u∂u/∂x`, `v∂u/∂y`, y la divergencia del flujo de masa `∂(hu)/∂x`, `∂(hv)/∂y`) usan en cambio **diferencias upwind de primer orden**, elegidas según el signo de la velocidad de transporte:

    ∂f/∂x ≈ (f[i,j] - f[i-1,j])/Δx   si vel ≥ 0
    ∂f/∂x ≈ (f[i+1,j] - f[i,j])/Δx   si vel < 0

Esto es necesario porque un esquema centrado (FTCS) es incondicionalmente inestable para la advección no lineal —lo comprobamos: con el canal seco y un chorro concentrado en la entrada, el esquema centrado explotaba en pocos cientos de pasos—. El upwind añade una difusión numérica de orden `Δx` (por Taylor), proporcional a la velocidad local, que estabiliza el frente de mojado sin esparcir el agua de forma no física por todo el ancho del canal. Ver `docs/modelo_matematico.md` §3.1 para el detalle.

El paso temporal se limita con una condición tipo CFL:

    Δt <= C min(Δx,Δy)/( |u| + |v| + sqrt(g h) )

con `C = 0.35` en este prototipo.

## Cómo ejecutar

### 1. Backend

Requiere Python 3.11+ recomendado.

Windows:

    cd backend
    python -m venv .venv
    .venv\Scripts\activate
    pip install -r requirements.txt
    python run.py

El solver queda en:

    http://127.0.0.1:8000

Prueba de salud:

    http://127.0.0.1:8000/api/health

### 2. Frontend

En otra terminal:

    cd frontend
    npm install
    npm run dev

Abrir la URL que indique Vite, normalmente:

    http://localhost:5173

## Arquitectura

    Three.js
       │
       │ WebSocket
       ▼
    FastAPI
       │
       ▼
    NumPy / Solver
       │
       ▼
    h,u,v, presión, dt
       │
       ▼
    Three.js actualiza la superficie 3D

## Importante para la entrega

Este prototipo prioriza que se pueda explicar la cadena:

**fenómeno físico → modelo matemático → discretización → algoritmo → implementación → visualización → análisis de error/estabilidad**

Para una versión final del curso conviene agregar:

1. Comparación de soluciones al refinar la malla.
2. Error entre mallas (`Δx`, `Δy` diferentes).
3. Registro de error por iteración/tiempo.
4. Verificación de conservación de masa.
5. Condiciones de frontera documentadas.
6. Validación contra un caso con solución conocida.
7. Gráficas de velocidad/profundidad.
8. Análisis de estabilidad y costo computacional.
9. Si el profesor exige Navier–Stokes completo, reemplazar esta reducción por un solver de Navier–Stokes 2D incomprensible con presión obtenida mediante una ecuación de Poisson.

## Nota sobre "sol" y variables exógenas

El sol no aparece directamente como una fuerza en Navier–Stokes. En este prototipo se usa para representar una tasa de evaporación. Si se desea estudiar temperatura, habría que añadir una ecuación de energía/temperatura y acoplarla al flujo.

# Flujo en un canal — Navier–Stokes 2D por diferencias finitas

Proyecto de **Simulación y Computación Numérica**. Primer avance: **discretización y mallado**.

Simula el flujo estacionario de un fluido que entra por un extremo de un canal de **400 × 40 m**,
resolviendo las ecuaciones de Navier–Stokes 2D (ecs. 4.59–4.61 de la sección 4.6 de Landau y Páez,
*Computational Problems for Physics*, CRC Press, 2018, pp. 144–147) con diferencias finitas
centradas sobre una malla fija de **80 × 8 celdas de 5 m**.

## Qué contiene

- **Backend (Python + FastAPI + NumPy)**: la malla, las 9 ecuaciones de celda y el solver de
  relajación sucesiva ([backend/app/model.py](backend/app/model.py)), más el servidor WebSocket que
  entrega el campo de velocidades a medida que el método itera ([backend/app/main.py](backend/app/main.py)).
- **Frontend (Three.js + Vite)**: dos vistas del mismo campo calculado.
  - *Mapa de calor*: una caja por celda, coloreada por |V|, vₓ, vᵧ o tipo de celda; con vectores,
    relieve y malla.
  - *Canal 3D (fluido)*: una superficie de agua que aparece donde el flujo calculado llega, con ondas
    que se desplazan según la velocidad de cada punto.
- **Pruebas** ([backend/tests/test_model.py](backend/tests/test_model.py)): comprueban la malla, las
  9 ecuaciones contra una implementación independiente y el comportamiento del solver.
- **Documentos** en [docs/](docs): modelo matemático y guía de la presentación.

> La versión anterior del proyecto (aguas someras con viento, lluvia, sol y llave) sigue en la rama
> `main`. Esta rama la reemplaza por el modelo del informe.

## Modelo

Flujo estacionario, incompresible y bidimensional, canal ancho en z, **sin obstáculos**, con presión
independiente de la densidad y **constante** (∂P/∂x = ∂P/∂y = 0):

    ν (∂²vₓ/∂x² + ∂²vₓ/∂y²) = vₓ ∂vₓ/∂x + vᵧ ∂vₓ/∂y        (4.60)
    ν (∂²vᵧ/∂x² + ∂²vᵧ/∂y²) = vₓ ∂vᵧ/∂x + vᵧ ∂vᵧ/∂y        (4.61)

con ν = 1 m²/s. La incompresibilidad (4.59) **no se impone** en esta etapa.

| Frontera | Condición |
|---|---|
| Entrada (izquierda) | vₓ = 1 m/s, vᵧ = 0 (Dirichlet) |
| Piso y techo | vₓ = vᵧ = 0 (Dirichlet) |
| Salida (derecha) | ∂v/∂x = 0 (Neumann, nodo fantasma: E = W) |

**Variables del modelo.** Con los valores del informe (ν = 1 m²/s, entrada 1 m/s, ∂P/∂x = 0) la aplicación
reproduce exactamente el planteamiento. La interfaz permite variarlos para explorar el modelo (botón
*Valores del informe* los restablece): la viscosidad ν, la velocidad de entrada y el gradiente de presión
∂P/∂x (Pa/m, ρ = 10³ kg/m³). Con ∂P/∂x ≠ 0 se añade el término de presión de (4.60) y aparece un flujo que
sí llega a la salida; con 0 desaparece y las ecuaciones son las del informe.

### Malla

Las celdas originales de 1 m se agrupan en bloques de 5 × 5 m: **80 × 8 = 640 celdas**, h = 5 m,
640 × 2 = **1 280 incógnitas** (una ecuación para vₓ y otra para vᵧ por celda). Índices i = 0…79 (x,
dirección del flujo) y j = 0…7 (y, hacia arriba; j = 0 es el piso). La malla **no se puede cambiar**
desde la interfaz ni desde la API.

### Ecuación de cada celda

Con diferencias centradas (error O(h²)) y despejando la celda central C, con vecinas
E = (i+1, j), W = (i−1, j), N = (i, j+1), S = (i, j−1), a = vₓ(i, j), b = vᵧ(i, j) y q = h/(2ν) = 2.5:

    C = ¼ [E + W + N + S − q·a·(E − W) − q·b·(N − S) − p]

con p = 0 en el informe (presión constante). Solo si se elige ∂P/∂x ≠ 0, para vₓ es
p = h²/(ν·ρ) · ∂P/∂x (para vᵧ siempre 0).

Donde a una celda de borde le falta una vecina se usa el valor de la frontera. Según qué vecinas
falten hay **9 tipos** de ecuación:

| # | Tipo | Celdas | Sustitución |
|---|---|---|---|
| 1 | Interior | 468 | ninguna |
| 2 | Entrada | 6 | W = 1 (vₓ) · W = 0 (vᵧ) |
| 3 | Salida | 6 | E = W |
| 4 | Piso | 78 | S = 0 |
| 5 | Techo | 78 | N = 0 |
| 6 | Esquina entrada–piso | 1 | W = 1 / 0, S = 0 |
| 7 | Esquina entrada–techo | 1 | W = 1 / 0, N = 0 |
| 8 | Esquina salida–piso | 1 | E = W, S = 0 |
| 9 | Esquina salida–techo | 1 | E = W, N = 0 |

Las 9 ecuaciones escritas una a una están en [docs/modelo_matematico.md](docs/modelo_matematico.md).

### Solución

El sistema es no lineal y acoplado (1 280 ecuaciones). Se resuelve por **relajación sucesiva** (ec. 4.63
del libro): se recorre la malla reemplazando cada incógnita v por v + ω·(F − v), con F la ecuación de su
tipo evaluada con los valores más recientes de las vecinas, hasta que el mayor cambio de un barrido sea
menor que la tolerancia (por defecto 10⁻⁶).

## Qué se observa (y por qué)

- **ω ≥ 0.95 no converge.** Con h = 5 m y ν = 1 m²/s el número de Reynolds de celda es 5 y, con vₓ = 1, el
  coeficiente de la vecina E en la fórmula centrada es ¼(1 − 2.5) < 0. Converge para ω ≤ 0.9 (lo más
  rápido cerca de 0.85, unas 220 iteraciones). Para ω ≥ 0.95, con el valor inicial vₓ = 1 que sugiere el
  informe diverge; con vₓ = 0 (el que usa la aplicación), entre 0.95 y 1 no converge (el residuo no baja de
  ≈ 0.5, medido en 6 000 iteraciones) y desde 1.05 diverge. El valor por defecto es **ω = 0.8**
  (273 iteraciones con vₓ = 0; 253 con vₓ = 1).
- **La solución no depende del valor inicial.** El informe sugiere partir de vₓ = 1 en todo el canal; la
  aplicación parte siempre de vₓ = 0 (se ve el flujo entrar), y con vₓ = 1 se llega a la misma solución
  (diferencia ≈ 4·10⁻⁵ con tolerancia 10⁻⁶; lo comprueba una prueba automática).
- **El flujo se frena y se apaga antes de la salida** (|V| ≥ 0.03 m/s solo hasta x ≈ 220 m). Es una
  consecuencia del planteamiento (presión constante, paredes que frenan y continuidad no impuesta): la
  solución es simétrica, con 0 ≤ vₓ ≤ 1 y vᵧ ≡ 0. No es un defecto del dibujo ni del solver.
- **La animación de arranque es el avance de las iteraciones**, no tiempo real: el modelo es estacionario.
  Cuando converge, el campo ya no cambia. El "agua", el frente, las ondas y el relieve del *Canal 3D* son
  una representación visual del campo calculado (el modelo no tiene profundidad). En el *Canal 3D* el
  agua empieza vacía y su frente avanza desde la entrada con la velocidad calculada, sea cual sea el valor
  inicial de la iteración, y se detiene donde el flujo se apaga.

## Cómo ejecutar

### 1. Backend

Requiere Python 3.11+ recomendado.

Windows:

    cd backend
    python -m venv .venv
    .venv\Scripts\activate
    pip install -r requirements.txt
    python run.py

Queda en `http://127.0.0.1:8000` (prueba: `http://127.0.0.1:8000/api/health`).

### 2. Frontend

En otra terminal:

    cd frontend
    npm install
    npm run dev

Abrir la URL que indique Vite, normalmente `http://localhost:5173`.

### 3. Pruebas

    cd backend
    python -m unittest discover -s tests

## Interfaz

- **Pausar / Reanudar y Reiniciar**: control de la iteración. Al converger o divergir, Pausar se
  desactiva y se usa Reiniciar. El estado (en marcha o en pausa) lo informa el servidor, así que el botón
  siempre coincide con lo que hace el solver.
- **Datos en vivo** (se actualizan en cada iteración): iteración, residuo, caudal de entrada y de salida
  (Σ vₓ·h en la primera y última columna, m²/s), relación salida/entrada, alcance del flujo (última
  columna con |V| ≥ 0.03 m/s), velocidad máxima y Reynolds de celda h·V/ν, además de la malla e incógnitas.
- **Modelo** (reinicia la simulación al cambiar): ν, velocidad de entrada y ∂P/∂x, con el botón
  *Valores del informe*.
- **Método**: factor de relajación ω (con una ayuda que depende del Reynolds de celda) y velocidad de la
  animación (iteraciones por segundo). La tolerancia es la del informe, 10⁻⁶, y la iteración siempre
  parte de vₓ = 0.
- **Estilo de vista** (mapa de calor o canal 3D), **Mostrar** (|V|, vₓ, vᵧ o tipo de celda), las
  opciones **Vectores**, **Relieve** y **Malla**, y **Centrar vista** (vuelve a encuadrar el canal; con el
  mouse se puede girar, acercar y desplazar, pero no pasar bajo el suelo).
- **Puntero de consulta**: al pasar el cursor por una celda se marca en amarillo y se muestran su tipo,
  su centro, la sustitución de vecinas que usa y sus velocidades, que cambian con cada iteración. Al
  abrir la aplicación muestra la celda (10, 3) y luego conserva la última celda consultada.

## Arquitectura

    Three.js  ⇄  WebSocket  ⇄  FastAPI  →  solver NumPy/Python
    (vistas)     /ws/sim       (main.py)    (model.py: malla, 9 ecuaciones, relajación)

**API HTTP**: `GET /api/health`, `GET /api/mesh` (malla y tipos de celda), `GET /api/cell-types`.

**WebSocket `/ws/sim`**:

- Cliente → servidor: `{"type": "params", "params": {omega, tol, sweeps_per_second}}` (en marcha; sobre
  una simulación divergida la reinicia), `{"type": "reset", "params": {omega, tol, sweeps_per_second,
  nu, inlet_vx, dpdx}}`, `pause`, `resume`. La malla y las dimensiones no se pueden cambiar: son las del
  informe.
- Servidor → cliente: `mesh` (dimensiones, ν, ρ, ∂P/∂x, velocidad de entrada, `vref` —velocidad de
  referencia de las escalas de color— y tipo de cada celda), `state` (iteración, residuo, si convergió o
  divergió, si está en marcha o en pausa —`running`—, `flow_in`, `flow_out`, `vmax`, `reach` y los campos
  `vx` y `vy` por celda) y `error`.

## Límites de esta etapa

- La continuidad (4.59) no se impone y, con los valores del informe, la presión es constante; por eso el
  flujo no llega a la salida (con ∂P/∂x = −2 Pa/m sí llega: alcance 400 m, unas 96 iteraciones).
- Fuera de los valores del informe (ν, entrada, ∂P/∂x) el esquema centrado puede divergir: el Reynolds
  de celda h·V/ν debe mantenerse bajo (con 5 converge ω ≤ 0.9; con ≤ 2.5 admite ω > 1; con ≥ 7.5 divergió
  en todos los casos probados).
- La solución analítica del libro (ec. 4.66) requiere ∂P/∂x ≠ 0, así que no aplica a este planteamiento (ver
  [docs/modelo_matematico.md](docs/modelo_matematico.md), §7).
- Con h = 5 m el esquema centrado no admite ω ≥ 0.95; la sobrerrelajación de la ec. 4.63 no es utilizable
  con esta malla.
- Falta el estudio de convergencia por refinamiento de malla y el error entre mallas (siguientes avances).

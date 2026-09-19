# Modelo matemático y plan de validación

Este documento acompaña al informe del primer avance (discretización y mallado). Fuente del modelo:
Landau, R. H. y Páez, M. J. (2018), *Computational Problems for Physics*, CRC Press, §4.6 «Hydrodynamics»,
pp. 144–147.

## 1. Fenómeno

Un fluido (agua) entra por el extremo izquierdo de un canal largo y plano, limitado por dos paredes (piso y
techo), y se busca la velocidad del fluido en cada punto del canal. No hay obstáculos dentro del canal.

## 2. Variables y parámetros

| Símbolo | Significado | Valor / unidad |
|---|---|---|
| x, y | posición a lo largo y a lo ancho | m |
| vₓ, vᵧ | componentes de la velocidad | m/s |
| P | presión | constante (∂P = 0) |
| ν | viscosidad cinemática | 1 m²/s (valor de trabajo del libro; no es la del agua, ≈ 10⁻⁶ m²/s) |
| ρ | densidad | 10³ kg/m³ (no interviene: con ∂P = 0 desaparece el término que la contiene) |
| L × W | dominio | 400 × 40 m |
| h | paso de la malla | 5 m |

## 3. Supuestos

- Flujo estacionario (la velocidad no cambia con el tiempo), incompresible y laminar.
- Bidimensional: canal ancho en z, se ignora la dependencia en z.
- Presión independiente de la densidad y la temperatura, y **constante** a lo largo del canal.
- Entrada uniforme vₓ = 1 m/s, vᵧ = 0; paredes con no deslizamiento; salida con ∂v/∂x = 0.

Los datos que dependen de indicaciones de clase (presión constante, entrada de 1 m/s, h = 5 m por la
agrupación en bloques) figuran en el informe como "supuestos por confirmar con la docente".

## 4. Ecuaciones

Con presión constante, las ecuaciones 4.60 y 4.61 del libro quedan:

    ν (∂²vₓ/∂x² + ∂²vₓ/∂y²) = vₓ ∂vₓ/∂x + vᵧ ∂vₓ/∂y        (4.60)
    ν (∂²vᵧ/∂x² + ∂²vᵧ/∂y²) = vₓ ∂vᵧ/∂x + vᵧ ∂vᵧ/∂y        (4.61)

junto con la condición de incompresibilidad ∂vₓ/∂x + ∂vᵧ/∂y = 0 (4.59), que **no se impone** en esta etapa.

## 5. Discretización

### 5.1 Malla

Las celdas originales de 1 m (400 × 40 = 16 000 por componente) se agrupan en bloques cuadrados de k × k.
Criterios para escoger k: (1) divide exactamente a 400 y a 40 (k = 1, 2, 4, 5, 8, 10, 20, 40); (2) celdas
cuadradas, con el mismo h en x y en y (ec. 4.62); (3) suficientes filas a lo ancho para ver el perfil de
velocidad; (4) número de ecuaciones manejable. Se eligió k = 5:

    malla 80 × 8 = 640 celdas, h = 5 m, 640 × 2 = 1 280 incógnitas

Índices i = 0…79 (x, dirección del flujo) y j = 0…7 (y, hacia arriba; j = 0 es el piso, j = 7 el techo).
Cada celda tiene cuatro vecinas: E = (i+1, j), W = (i−1, j), N = (i, j+1), S = (i, j−1). No hay anillo de
celdas fantasma: las celdas de borde son incógnitas y, donde falta una vecina, se usa el valor que impone la
condición de frontera.

### 5.2 Diferencias finitas

Por serie de Taylor, la primera y la segunda derivada centradas tienen error O(h²):

    ∂f/∂x ≈ (f[i+1,j] − f[i−1,j]) / 2h        ∂²f/∂x² ≈ (f[i+1,j] − 2f[i,j] + f[i−1,j]) / h²
    ∂f/∂y ≈ (f[i,j+1] − f[i,j−1]) / 2h        ∂²f/∂y² ≈ (f[i,j+1] − 2f[i,j] + f[i,j−1]) / h²

Al reemplazarlas en 4.60 y 4.61, multiplicar por h² y despejar la celda central C, con a = vₓ(i, j),
b = vᵧ(i, j) y q = h/(2ν) (= h/2 = 2.5):

    C = ¼ [E + W + N + S − q·a·(E − W) − q·b·(N − S) − p]

En la ecuación de vₓ, C, E, W, N y S son valores de vₓ; en la de vᵧ, valores de vᵧ. Es la ec. 4.64 del libro
con el término de presión p, que en el informe vale 0 (∂P = 0) y por eso la fórmula del informe no lo lleva.
La aplicación permite un ∂P/∂x constante como variable del modelo; entonces, solo en la ecuación de vₓ,
p = h²/(ν·ρ) · ∂P/∂x (en la de vᵧ, p = 0 porque ∂P/∂y = 0). Con ∂P/∂x = 0 se recupera exactamente el
planteamiento del informe. Las 9 ecuaciones de §5.4 llevan el mismo "− p" dentro del corchete. Los términos de corrección multiplican velocidades entre sí, así que el sistema es
**no lineal**, y la ecuación de vₓ necesita a vᵧ y viceversa (**acoplado**).

### 5.3 Condiciones de frontera

| Frontera | Tipo | Condición | La vecina que falta se reemplaza por |
|---|---|---|---|
| Entrada (i = 0) | Dirichlet | vₓ = 1, vᵧ = 0 | W = 1 (vₓ); W = 0 (vᵧ) |
| Piso (j = 0) | Dirichlet | vₓ = vᵧ = 0 | S = 0 |
| Techo (j = 7) | Dirichlet | vₓ = vᵧ = 0 | N = 0 |
| Salida (i = 79) | Neumann | ∂v/∂x = 0 | E = W |

En la salida se imagina una celda ficticia i = 80 y se aplica la diferencia centrada a ∂v/∂x = 0:
[v(80, j) − v(78, j)] / 2h = 0, es decir v(80, j) = v(78, j); como esa celda es la vecina E de la celda
i = 79, resulta E = W. Con el valor 0 de las paredes puesto en la celda ficticia, la pared queda a una
distancia h del centro de la primera fila (y no a h/2): es una aproximación de primer orden de su posición.

### 5.4 Los 9 tipos de ecuación

Con w = 1 para vₓ y w = 0 para vᵧ (valor de entrada de cada componente):

| # | Tipo | Celdas | Ecuación de celda |
|---|---|---|---|
| 1 | Interior | i = 1…78, j = 1…6 (468) | C = ¼ [E + W + N + S − q·a·(E − W) − q·b·(N − S)] |
| 2 | Entrada | i = 0, j = 1…6 (6) | C = ¼ [E + w + N + S − q·a·(E − w) − q·b·(N − S)] |
| 3 | Salida | i = 79, j = 1…6 (6) | C = ¼ [2W + N + S − q·b·(N − S)] |
| 4 | Piso | j = 0, i = 1…78 (78) | C = ¼ [E + W + N − q·a·(E − W) − q·b·N] |
| 5 | Techo | j = 7, i = 1…78 (78) | C = ¼ [E + W + S − q·a·(E − W) + q·b·S] |
| 6 | Esquina entrada–piso | (0, 0) | C = ¼ [E + w + N − q·a·(E − w) − q·b·N] |
| 7 | Esquina entrada–techo | (0, 7) | C = ¼ [E + w + S − q·a·(E − w) + q·b·S] |
| 8 | Esquina salida–piso | (79, 0) | C = ¼ [2W + N − q·b·N] |
| 9 | Esquina salida–techo | (79, 7) | C = ¼ [2W + S + q·b·S] |

Total: 468 + 6 + 6 + 78 + 78 + 4 = 640 celdas. En la salida desaparece el término convectivo en x, porque
E − W = 0. Las ecuaciones de vᵧ difieren de las de vₓ solo en el valor de entrada (w = 0). Las fórmulas están
implementadas en `cell_equation` ([backend/app/model.py](../backend/app/model.py)).

## 6. Método de solución

Relajación sucesiva (ec. 4.63 del libro), en `ChannelFlowSolver.sweep`:

1. Valor inicial de todas las velocidades: vᵧ = 0 y vₓ = 0 (el informe sugiere vₓ = 1 "por ejemplo"; con
   vₓ = 1 se llega a la misma solución, y una prueba lo comprueba).
2. Se recorre la malla; en cada celda se calcula F, el valor que da la ecuación de su tipo con los valores
   más recientes de las vecinas (primero vₓ y luego vᵧ), y se actualiza v ← v + ω·(F − v).
3. Se repite hasta que el mayor cambio de un barrido sea menor que la tolerancia (10⁻⁶ por defecto). Si un
   cambio supera 10⁶ m/s se declara divergencia.

### Comportamiento observado (malla 80 × 8, tolerancia 10⁻⁶)

| ω | valor inicial vₓ = 1 (informe) | valor inicial vₓ = 0 |
|---|---|---|
| 0.5 | converge, 519 iteraciones | converge, 546 |
| 0.8 (por defecto) | converge, 253 | converge, 273 |
| 0.9 | converge, 240 | converge, 223 |
| 0.95 | diverge (2 iteraciones) | no converge (residuo 0.47 a las 6 000) |
| 1.0 | diverge (2 iteraciones) | no converge (residuo 0.86 a las 6 000) |
| ≥ 1.05 | diverge | diverge |

Con vₓ = 1 de valor inicial, el valor más rápido probado es ω = 0.85 (222 iteraciones). **La sobrerrelajación
(ω > 1) no es utilizable con esta malla**, a diferencia de lo que sugiere el libro.

**Por qué.** En la fórmula centrada, los coeficientes de las vecinas E y W son ¼(1 − q·a) y ¼(1 + q·a). Con
q = 2.5 y a = 1 valen −0.375 y 0.875: uno es negativo, y el método deja de ser un promedio de las vecinas. Es
la condición Re_h = |a|·h/ν ≤ 2 (aquí Re_h = 5). Se cumpliría con h ≤ 2ν/|a|ₘₐₓ = 2 m (malla de 200 × 20).

### Solución obtenida

La solución convergida es simétrica respecto al eje del canal, con 0 ≤ vₓ ≤ 1 y **vᵧ ≡ 0** (todas las
condiciones de frontera de vᵧ valen 0, y vᵧ ≡ 0 es solución de su ecuación). vₓ vale 1 en el centro de la
entrada, baja hacia las paredes y **se apaga a lo largo del canal**: |V| ≥ 0.03 m/s solo hasta x ≈ 220 m de
los 400 m. Con vᵧ ≡ 0, la continuidad exigiría ∂vₓ/∂x = 0, incompatible con una entrada uniforme y unas
paredes que frenan el fluido; por eso 4.59 no se impone. Con presión constante nada empuja el fluido, así que
no llega a la salida.

### Variables del modelo (exploración fuera del informe)

Medido con ω = 0.8 y tolerancia 10⁻⁶ (ν = 1, ρ = 10³, entrada 1 m/s salvo indicación):

| ∂P/∂x (Pa/m) | Resultado |
|---|---|
| 0 (informe) | converge en 273 iteraciones, alcance 220 m, caudal de salida ≈ 0 |
| −1 | converge en 177, alcance 400 m, salida/entrada 20 % |
| −2 | converge en 96, alcance 400 m, salida/entrada 41 %, vₘₐₓ 1.033 m/s |

Datos en vivo que muestra la interfaz: caudal de entrada y de salida (Σ vₓ·h de la primera y de la última
columna, m²/s), su relación, alcance (última columna con |V| ≥ 0.03 m/s), vₘₐₓ y Re de celda h·V/ν, con V la
velocidad de referencia (`vref`: la de entrada, o el máximo del perfil de Poiseuille si ese es mayor). El
Reynolds de celda decide qué ω sirve: con 5 converge ω ≤ 0.9; con ≤ 2.5 (por ejemplo ν = 4) admite ω = 1.4;
con ≥ 7.5 divergió en todos los casos probados.

## 7. Validación

No basta con que "se vea bien". Lo que ya se comprueba (19 pruebas, `python -m unittest discover -s tests`
desde `backend`):

1. **Malla**: 80 × 8 celdas de 5 m, 1 280 incógnitas, celdas por tipo (468, 6, 6, 78, 78, 1, 1, 1, 1) y k
   válidos (los divisores de 400 y 40).
2. **Las 9 ecuaciones**: coinciden con una implementación independiente que sustituye cada vecina faltante
   por su valor de frontera, en campos aleatorios con velocidades de ambos signos.
3. **Fronteras**: la ecuación de la salida no depende de E; el valor de entrada entra como vecina W.
   El término de presión también se comprueba en las nueve (con p distinto de 0).
4. **Variables del modelo**: con ∂P/∂x = −2 el flujo llega a la salida; con ν = 4 la sobrerrelajación
   ω = 1.4 converge; los datos en vivo y `vref` (1.5 m/s para ∂P/∂x = −7.5) son los esperados; los
   parámetros fuera de rango se rechazan.
5. **Solver**: converge con ω = 0.8; la solución es simétrica, vᵧ ≡ 0 y 0 ≤ vₓ ≤ 1; no depende del valor
   inicial (diferencia < 10⁻³); para ω = 1 y 1.3 no converge; una corrida divergente sigue siendo finita y
   serializable.

**Pendiente** para los siguientes avances:

- **Solución analítica del libro (ec. 4.66).** El perfil vₓ = (3j/20)(1 − j/40) requiere un gradiente de
  presión ∂P/∂x ≠ 0, así que no es solución del planteamiento con presión constante y no sirve directamente
  para validar. Además, con ν = 1 y ρ = 10³, ese perfil tiene vₓ″ = −0.0075, y de ν·vₓ″ = (1/ρ)·∂P/∂x resulta
  ∂P/∂x = −7.5, no el −12 que imprime el libro (posible errata).
- **Refinamiento de malla**: comparar 80 × 8 con 100 × 10 y 200 × 20 (h = 4 y 2 m) y medir una magnitud
  observable (por ejemplo, hasta qué x llega el flujo).
- **Error numérico**: para una magnitud Q, E_abs = |Q_ref − Q_num| y E_rel = |Q_ref − Q_num| / |Q_ref|, con una
  referencia de malla fina o, mejor, un caso con solución conocida.
- **Costo y estabilidad**: iteraciones por malla y por ω.

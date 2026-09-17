# Modelo matemático y plan de validación

## 1. Fenómeno

Se modela agua que entra por una manguera en un canal rectangular y se desplaza a lo largo del dominio.

## 2. Variables

| Símbolo | Significado | Unidad |
|---|---|---|
| x | posición longitudinal | m |
| y | posición transversal | m |
| t | tiempo | s |
| h | profundidad | m |
| u | velocidad longitudinal | m/s |
| v | velocidad transversal | m/s |
| p | presión hidrostática aproximada | Pa |
| g | gravedad | m/s² |
| ν | viscosidad efectiva | m²/s |

## 3. Supuestos

- Agua incomprensible.
- Modelo 2D depth-averaged.
- Presión vertical aproximadamente hidrostática.
- Canal rectangular.
- Las paredes laterales impiden flujo normal.
- El extremo de salida se trata como salida abierta con amortiguación.
- La manguera se representa como una condición de entrada parametrizada.
- Viento y lluvia se modelan como términos externos simplificados.
- Canal seco en `t=0` (`h=0` en todo el dominio); el agua solo aparece al abrir la manguera.

## 3.1 Esquema numérico (importante)

Los términos **no lineales de advección** (`u ∂u/∂x`, `v ∂u/∂y`, y la divergencia
del flujo de masa `∂(hu)/∂x`, `∂(hv)/∂y`) **no** se discretizan con diferencias
centradas puras. Un esquema FTCS (Euler explícito en el tiempo, centrado en el
espacio) es **incondicionalmente inestable** para estos términos —el análisis
de von Neumann de la ecuación de advección linealizada da un factor de
amplificación `|G| > 1` para toda longitud de onda, sin importar `Δt`—. Esto se
comprobó experimentalmente: al iniciar el canal seco con un chorro
concentrado en la entrada, el esquema centrado explotaba en unos cientos de
pasos (`h` y `u` saturaban los límites de recorte).

La corrección usada es **diferencias upwind de primer orden** para esos
términos, eligiendo el lado de la diferencia según el signo de la velocidad
de transporte local:

    ∂a/∂x ≈ (a[i] - a[i-1]) / Δx   si vel ≥ 0
    ∂a/∂x ≈ (a[i+1] - a[i]) / Δx   si vel < 0

Por series de Taylor, el error de truncamiento de esta aproximación introduce
un término de difusión numérica adicional de magnitud `≈ |vel| Δx / 2`: se
sacrifica precisión de segundo orden por primero, a cambio de estabilidad, y
la difusión añadida es proporcional a la velocidad local (no a un valor fijo).
Esto es lo que permite que el frente de agua avance como una cuña que se
angosta cerca de la manguera y se abre aguas abajo, en vez de esparcirse de
forma instantánea y no física por todo el ancho del canal.

El término de presión hidrostática (`-g ∂h/∂x`, `-g ∂h/∂y`) y el término
viscoso (`ν ∇²u`, `ν ∇²v`) sí usan diferencias centradas, que son apropiadas
para términos lineales/difusivos.

## 4. Qué significa cada control

### Presión

Cambia la velocidad de entrada:

`u_in = C_d sqrt(2 Δp / ρ)`

### Gravedad

Modifica la aceleración asociada al gradiente de superficie y la velocidad de onda:

`c = sqrt(g h)`

### Viento

Agrega una aceleración superficial simplificada en X.

### Lluvia

Agrega agua al campo:

`R = lluvia / 1000 / 3600`

### Piso

Cambia la resistencia hidráulica usando `n` de Manning.

### Sol

Disminuye ligeramente la profundidad por evaporación en el prototipo.

## 5. Puntero

El frontend consulta la celda más cercana a la posición del puntero y muestra:

- coordenadas físicas;
- profundidad;
- `u`;
- `v`;
- velocidad resultante;
- presión hidrostática.

## 6. Validación sugerida

No basta con que "se vea bien".

Se deben comprobar:

1. **Conservación de masa**

   Comparar agua que entra contra cambio de almacenamiento y agua que sale.

2. **Refinamiento de malla**

   Ejecutar con, por ejemplo:

   - 80 × 8
   - 160 × 16
   - 320 × 32

   y comparar una magnitud observable.

3. **Paso temporal**

   Comparar diferentes límites CFL.

4. **Caso simple**

   Probar gravedad cero, viento cero, lluvia cero y entrada controlada para aislar errores.

5. **Sensibilidad**

   Variar una sola variable exógena a la vez y documentar su efecto.

6. **Verificación**

   Comprobar que las magnitudes permanecen finitas y que la profundidad no toma valores negativos.

## 7. Error numérico

Para una magnitud `Q`, usar:

`E_abs = |Q_ref - Q_num|`

y, si `Q_ref != 0`:

`E_rel = |Q_ref - Q_num| / |Q_ref|`

Para un estudio de convergencia, conviene usar una solución de referencia obtenida con una malla suficientemente fina o, preferiblemente, un caso con solución analítica/semianalítica conocida.

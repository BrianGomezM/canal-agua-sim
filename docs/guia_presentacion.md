# Guía corta para la presentación (4 diapositivas)

1. **Grupo e integrantes**
   Portada con el grupo y sus integrantes.

2. **Creación de la malla**
   "Pasamos del medio continuo a una cuadrícula que el computador puede resolver. Con h = 1 m serían
   400 × 40 = 16 000 ecuaciones por componente; agrupamos las celdas en bloques de 5 × 5 m y quedan
   80 × 8 = 640." Los cuatro criterios: 5 divide a 400 y a 40; celdas cuadradas (mismo h en x y en y, ec.
   4.62); 8 filas a lo ancho para ver el perfil de velocidad; 640 × 2 = 1 280 incógnitas.
   *En la demo:* activar **Malla** y pasar el cursor por las celdas.

3. **Ecuaciones 4.60 y 4.61 discretizadas**
   "Reemplazamos cada derivada por diferencias finitas centradas (serie de Taylor, error O(h²)). Al
   despejar la celda central, cada celda se calcula con sus 4 vecinas":

       C = ¼ [E + W + N + S − (h/2)·vₓ·(E − W) − (h/2)·vᵧ·(N − S)]

   Supuestos: flujo estable, presión constante, ν = 1 m²/s, h = 5 m (h/2 = 2.5). El sistema es no lineal
   y acoplado.

4. **Tipos de ecuación según la posición**
   "En los bordes falta una vecina y la reemplazamos con la condición de frontera. Salen 9 tipos: 1
   interior, 4 bordes y 4 esquinas." Entrada W = 1, piso S = 0, techo N = 0, salida E = W (∂v/∂x = 0 con
   nodo fantasma).
   *En la demo:* elegir **Mostrar → Tipo de celda**; el tooltip indica el tipo y la sustitución de cada
   celda.

## Si preguntan por la solución

Según lo indicado en clase, las técnicas para sistemas no lineales se ven después del primer parcial. El
proyecto ya incluye el solver por relajación sucesiva (ec. 4.63) para mostrar cómo se usarían las 9
ecuaciones.

## Preguntas probables

- **¿Por qué ω < 1 y no la sobrerrelajación del libro?** Con h = 5 m y ν = 1 el número de Reynolds de celda
  es 5 y un coeficiente de la fórmula centrada es negativo (¼(1 − 2.5)). Para ω ≥ 0.95 el método no
  converge; converge para ω ≤ 0.9.
- **¿Por qué se parte de vₓ = 0 y no de vₓ = 1 como sugiere el informe?** El informe lo propone "por
  ejemplo". Con vₓ = 0 se ve el flujo entrar; con vₓ = 1 todo el canal arranca a 1 m/s, incluso junto a las
  paredes, y el método lo corrige. El resultado es el mismo (diferencia ≈ 4·10⁻⁵).
- **¿La animación es el paso del tiempo?** No. El modelo es estacionario: lo que se anima son las
  iteraciones del método hasta converger.
- **¿Por qué el flujo no llega a la salida?** Con presión constante nada empuja el fluido, las paredes lo
  frenan y la continuidad (4.59) no se impone (vᵧ ≡ 0). |V| ≥ 0.03 m/s solo hasta x ≈ 220 m.
- **¿Se pueden cambiar ν, la velocidad de entrada o la presión?** Sí, como exploración: con los valores del
  informe (ν = 1, entrada 1 m/s, ∂P/∂x = 0) es exactamente el planteamiento; el botón *Valores del
  informe* los restablece. Con ∂P/∂x = −2 Pa/m el flujo sí llega a la salida (alcance 400 m, unas 96
  iteraciones). Si el Reynolds de celda h·V/ν pasa de ≈ 6, el esquema centrado puede divergir.
- **¿Qué datos se ven en vivo?** Iteración, residuo, caudal de entrada y de salida, alcance del flujo,
  velocidad máxima y Reynolds de celda; el puntero de consulta muestra tipo, sustitución y velocidades de la
  celda elegida y cómo cambian en cada iteración.
- **¿Cómo se valida?** Con 19 pruebas de las ecuaciones y del solver. La solución analítica del libro (ec.
  4.66) necesita ∂P/∂x ≠ 0, así que no aplica con presión constante; la estrategia de validación se
  define con la docente.
- **¿Por qué 80 × 8 y no una malla más fina?** Costo (16 000 → 640 ecuaciones por componente) y filas
  suficientes; con 200 × 20 se cumpliría Re de celda ≤ 2 a costa de 10 veces más celdas.

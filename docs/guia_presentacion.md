# Guía corta para explicar el proyecto

1. **Problema físico**
   "Queremos representar cómo el agua entra por una manguera y se desplaza por un canal de 400 × 40 m."

2. **Modelo**
   "No simulamos cada molécula. Abstraemos el fenómeno mediante variables de campo: profundidad y velocidades."

3. **Ecuaciones**
   "Partimos de una reducción de Navier–Stokes para aguas someras y obtenemos ecuaciones de continuidad y momentum."

4. **Discretización**
   "Dividimos el canal en celdas. Las derivadas se reemplazan por diferencias finitas."

5. **Procesamiento**
   "Python calcula las variables en cada paso temporal usando NumPy."

6. **Postprocesamiento**
   "Three.js transforma los valores calculados en una superficie 3D."

7. **Variables exógenas**
   "Gravedad, viento, lluvia y propiedades del piso modifican el modelo."

8. **Interacción**
   "El puntero permite consultar el estado de una celda."

9. **Estabilidad**
   "El paso temporal se limita mediante una condición tipo CFL."

10. **Validación**
   "No basta con visualizar: debemos estudiar conservación, refinamiento de malla y error."

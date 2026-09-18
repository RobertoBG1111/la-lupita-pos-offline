# Prompt para portar los cambios al POS oficial (la_lupita_modelorama)

> Abre Claude Code **en la carpeta `la_lupita_modelorama`** y pega el texto de abajo
> (desde "----"). Antes, ten un **respaldo** o una **rama de Supabase** para probar.

----

Vas a **portar al POS oficial (este proyecto, con Supabase)** las mejoras y correcciones
que se hicieron en la versión offline hermana. NO apliques cambios todavía: primero **lee y
proponme un plan** (usa el modo plan y ExitPlanMode). Trabaja **por bloques** y deja que yo
apruebe cada uno; después de cada bloque, dime cómo probarlo.

## Fuentes de verdad (léelas primero)
- **`../la_lupita_offline/BITACORA.md`** — lista los ~23 cambios y, para CADA uno, qué archivo se
  tocó en offline y **cómo llevarlo aquí** (incluye el SQL de columnas nuevas en §0). Es el mapa.
- **`../la_lupita_offline/app/`** — la implementación de referencia (offline, contra IndexedDB en
  `lib/datos.js` + `lib/almacen.js`).
- **Este proyecto**: `CONTEXTO.md` (esquema y triggers de Supabase), `app/lib/db.js` (capa de datos
  contra Supabase), `supabase/` (migraciones, Edge Functions), y el MCP de Supabase (para aplicar
  migraciones, ver tablas, generar tipos).

## Diferencia clave entre las dos versiones
Comparten TODO el front-end (pantallas, motor de precios, estilos). Lo único distinto es la capa de
datos: **offline = IndexedDB (`lib/datos.js`)**, **oficial = Supabase (`lib/db.js`, triggers, RPC,
Edge Functions)**. Portar = traer los cambios respetando esa frontera.

## Método (4 categorías de trabajo)
1. **Esquema (Supabase):** aplica el SQL de `BITACORA.md §0` (columnas nuevas: `turnos.fondo_inicial`,
   `presentaciones.costo`, `productos.categoria`, `productos.retornable`, `productos.tipo_envase`,
   `ventas.envases_*`/`deposito_envases`, `venta_detalle.descripcion`) y la **tabla nueva
   `movimientos_caja`**. Decide con Roberto la migración **marca → categoria**. ⚠️ **Costo:** el rol
   *cajero* NO debe ver `presentaciones.costo` → crea una vista sin esa columna para el catálogo del
   cajero (RLS filtra filas, no columnas). Hazlo en una **rama de Supabase** si es posible.
2. **Front-end COMPARTIDO (copiar casi 1:1 desde offline):** `lib/ventas.js`, `lib/estado.js`,
   `lib/escaner.js` (nuevo), y las pantallas `screens/*` que cambiaron (venta, pago, ticket, corte,
   inventario, usuarios, promociones, login, bienvenida) + las **nuevas** `screens/historial.js` y
   `screens/envases.js` (regístralas en `screens/index.js`). **OJO con los imports:** en offline las
   pantallas importan de `../lib/datos.js`; aquí deben importar de `../lib/db.js`. Cambia esos imports
   y verifica que `db.js` exporte las MISMAS funciones con las MISMAS firmas/shape de datos.
3. **Funciones nuevas en `lib/db.js` (traducir a Supabase):** `abrirTurno(fondo)`, `resumenTurno`
   (+ fondo, entradas/salidas de caja, efectivo_esperado), `resumenDia`/`detalleDia`, `listarVentas`,
   `actualizarProducto`/`actualizarPresentacion`/`agregarPresentacion`, `categoriasConocidas`,
   `actualizarPromocion`/`setPromocionPresentaciones`, `registrarMovimientoCaja`/`movimientosCajaDe`,
   y devolver `descripcion` en los detalles del corte/reportes/ticket.
4. **Lógica de negocio en la base (triggers / RPC):**
   - **Ajuste = sobrescribe** (no suma): cambiar `fn_movimiento_manual_afecta_stock` para que en
     `tipo='ajuste'` interprete `cantidad` como existencia real y calcule el delta (producto o lote).
   - **Empaques automáticos (6 piezas → precio six) y ventas genéricas (código 0):** ya viven en
     `lib/ventas.js` (front) → se copian 1:1; NO tocan la base. Pero la RPC/trigger de venta debe:
     (a) **permitir `venta_detalle.presentacion_id` NULL** con `descripcion` y **saltar inventario**
     en esas líneas; (b) **sumar el depósito de envases al total** (columnas `envases_*`).
   - **Bloqueo de stock negativo:** como última línea de defensa, que la venta rechace vender más de
     la existencia (el front ya lo bloquea, pero la base debe protegerlo también).

## NO portar
- El respaldo/importar/**"Borrar todo"** y el almacén IndexedDB (`almacen.js`) — son propios del modo
  offline. En la nube el respaldo lo da Supabase.

## Reglas de trabajo
- Primero **plan** (ExitPlanMode), no cambios directos. Trabaja **por bloques** y espera mi aprobación.
- Cambios de esquema: en **rama de Supabase** o con respaldo; nunca perder datos.
- Tras cada bloque, dime **cómo probarlo** (pantalla + pasos) y verifica que no rompa lo existente.
- Mantén los **nombres de funciones y el shape de datos** idénticos a offline, para que las pantallas
  copiadas funcionen sin más cambios que el import `datos.js → db.js`.

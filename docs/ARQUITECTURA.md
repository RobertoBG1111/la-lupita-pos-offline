# Arquitectura — La Lupita POS (offline)

Este documento explica las decisiones de diseño detrás de la versión offline y cómo se
mantiene sincronizada con el POS oficial en la nube (`la_lupita_modelorama`, sobre
Supabase). El objetivo es que el código se lea como un solo sistema con **una frontera
clara**: front-end compartido, capa de datos intercambiable.

## Contexto y objetivo

`la_lupita_offline` empezó como banco de pruebas y fue la **referencia** desde la que se
portaron ~23 mejoras al producto oficial (en producción). Después
el oficial siguió creciendo. Esta versión vuelve a **igualarlo**: replica **todas las
funciones y el catálogo real** (602 productos), pero **100 % local** — sin backend ni
credenciales — para poder abrirse y demostrarse en cualquier equipo.

## La frontera: front-end compartido, datos intercambiables

Ambas versiones comparten **todo** el front-end y el motor de precios. Lo único distinto
es de dónde salen los datos:

| Capa | Offline (este repo) | Oficial (nube) |
|------|---------------------|----------------|
| Persistencia | IndexedDB (`lib/almacen.js`) | Postgres/Supabase |
| Acceso a datos | `lib/datos.js` | `lib/db.js` |
| Lógica de negocio | JS en `datos.js` | triggers + RPC `registrar_venta` |
| Config de tienda | store `configuracion` (IndexedDB) | tabla `configuracion` |
| Usuarios | `lib/auth.js` (PBKDF2 local) | Auth + Edge Function |
| Respaldo | Exportar/Importar `.json` | Supabase |
| Sin conexión | siempre local | caché + cola de reinyección |

`lib/ventas.js` (motor de precios: promociones, combos, empaques six/cartón, venta libre) y
`lib/escaner.js` son **byte a byte idénticos** entre ambas versiones. Las pantallas
(`screens/*`) también se copian casi 1:1; el único cambio mecánico es el import de la capa
de datos: `../lib/db.js` → `../lib/datos.js`.

### Cómo se conserva la frontera

- **Misma API y mismo *shape* de retorno.** `datos.js` expone las mismas funciones y
  firmas que `db.js`, y devuelve las mismas estructuras (incluidos los "joins" anidados
  `presentaciones → productos` que en la nube producen los `select` de Supabase), para que
  las pantallas no distingan de dónde vienen los datos.
- **Stubs para lo que solo aplica en la nube.** `lib/conexion.js` y `lib/cola.js` existen
  con la misma firma que en el oficial pero son *no-ops* (offline siempre está "en línea"
  respecto a sus datos y nunca encola). Así `corte.js`, `venta.js` y `main.js` se copian
  sin editar sus imports.
- **`config-runtime.js`** mergea la config guardada SOBRE los defaults de `config.js`; en
  offline la lee de IndexedDB en vez de Supabase, pero la API (`getConfig`, `cargarConfig`,
  `aplicarTema`) es idéntica.

## Lógica de negocio reimplementada en JS

Lo que en la nube vive en Postgres, aquí vive en `datos.js`, con las mismas reglas:

- **Venta atómica** (`registrarVenta`): una transacción IndexedDB multi-store escribe
  venta, detalle y pagos; **valida que los pagos cuadren** con el total; descuenta
  inventario por línea (**FEFO** en perecederos); suma el **depósito de envases** al total;
  guarda `recibido_efectivo`/`cambio`. Las líneas sin presentación (venta libre) **no**
  tocan inventario.
- **Ajuste de inventario = sobrescribe** la existencia real contada (registra el delta neto
  para que el historial cuadre); entrada suma y merma resta.
- **Devoluciones** (`registrarDevolucion`): total o parcial, reembolso en efectivo,
  reingresa inventario salvo "dañado"; el corte descuenta las devoluciones del efectivo
  esperado y calcula ventas netas.
- **Borrado protegido** (`eliminarProductos`): un producto ya vendido no se puede borrar
  (protege el historial); los nunca vendidos se borran con presentaciones, lotes y movimientos.

## Siembra del catálogo (`lib/seed.js`)

Al primer arranque, si la base está vacía, carga:
- `data/catalogo.json` — catálogo real exportado del Supabase oficial (602 productos, 604
  presentaciones, 7 promociones, 2 combos), con sus mismos ids y columnas.
- `data/config-inicial.json` — configuración de la tienda (negocio, apariencia, envases,
  ticket, reglas, categorías).

No se siembran ventas, turnos ni usuarios: el historial arranca en cero y el primer admin
se crea desde Bienvenida. Reexportar el catálogo es un `SELECT ... json_agg` desde el
proyecto Supabase oficial.

## Verificación

- **Prueba de humo de la capa de datos** (Node + `fake-indexeddb`, sin navegador): siembra,
  venta simple, venta con envase retornable, devolución con reingreso, cortes por
  turno/día, `listarVentas.devuelto`, borrado protegido y config roundtrip.
- **Prueba en navegador**: alta del primer admin → login + fondo → venta (búsqueda, promos,
  combos, multi-ticket) → cobro con cambio → ticket → corte → inventario → configuración.

## PWA

`sw.js` precachea el *shell* completo (módulos, estilos, fuentes y el catálogo semilla) con
estrategia **network-first**: intenta la red (para no servir módulos viejos tras una
actualización) y cae al caché sin conexión. `manifest.webmanifest` la hace instalable.

# Diccionario de datos — La Lupita POS

Modelo de datos del POS. En esta versión de demostración cada **object store de IndexedDB**
equivale a una **tabla** del Postgres de producción (mismos nombres de tabla y de columna), de
modo que las pantallas y el motor de precios funcionan igual contra la nube o contra el
navegador. La definición de stores e índices vive en [`../app/lib/almacen.js`](../app/lib/almacen.js)
y las lecturas/escrituras en [`../app/lib/datos.js`](../app/lib/datos.js).

**Convenciones**

- **PK** = llave primaria (`keyPath` del store). Los `id` son UUID en texto.
- **Índices** = índices del store (para búsquedas y para la transacción de venta).
- Tipos: `uuid` (texto), `texto`, `número`, `entero`, `booleano`, `fecha-hora` (ISO 8601 /
  `timestamptz`), `fecha` (`YYYY-MM-DD`), `json`.
- `created_at` es la marca de creación (fecha-hora) presente en casi todas las tablas.

---

## Catálogo

### `productos`
Artículo del catálogo. La existencia se lleva a nivel producto (`stock_actual`); las
presentaciones son formas de venderlo (pieza, six, cartón…).

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | uuid | **PK** |
| `nombre` | texto | Nombre del artículo |
| `categoria` | texto | Categoría (ej. Corona, Sabritas). Crece sola; ver `config.CATEGORIAS` |
| `unidad_base` | texto | Unidad de la existencia (por defecto `pieza`) |
| `stock_actual` | número | Existencia actual (en unidad base) |
| `stock_minimo` | número | Umbral de alerta; se considera **bajo** si `stock_actual <= stock_minimo` |
| `activo` | booleano | Si aparece en Venta |
| `lleva_vencimiento` | booleano | Perecedero: su existencia se controla por **lotes** (FEFO) |
| `retornable` | booleano | Cobra depósito de envase retornable |
| `tipo_envase` | texto | Clave del tipo de envase (ver `configuracion.datos.ENVASES[].clave`); solo si `retornable` |
| `created_at` | fecha-hora | |

**Índices:** —  ·  **Relaciones:** 1—N con `presentaciones`, `lotes`, `movimientos_inventario`.

### `presentaciones`
Forma de vender un producto, con su precio, costo y código de barras.

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | uuid | **PK** |
| `producto_id` | uuid | → `productos.id` |
| `nombre` | texto | Ej. "Pieza", "Six", "Cartón" |
| `factor_conversion` | entero | Unidades base por presentación (pieza=1, six=6, cartón=24…) |
| `precio` | número | Precio de venta |
| `costo` | número | Costo interno (solo lo ve el admin) |
| `codigo_barras` | texto | Código único (nullable); único entre presentaciones |
| `activo` | booleano | |
| `created_at` | fecha-hora | |

**Índices:** `by_producto` (`producto_id`)  ·  **Relaciones:** N—1 con `productos`.

---

## Promociones y combos

### `promociones`
Promoción por cantidad: N unidades de una presentación por un precio (ej. 2 × $52).

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | uuid | **PK** |
| `nombre` | texto | |
| `cantidad_requerida` | entero | Unidades para que aplique |
| `precio_promocional` | número | Precio por el paquete de `cantidad_requerida` |
| `activo` | booleano | |
| `created_at` | fecha-hora | |

### `promocion_presentaciones`
Presentaciones a las que aplica una promoción (relación N—N).

| Campo | Tipo | Descripción |
|---|---|---|
| `promocion_id` | uuid | → `promociones.id` (**parte de la PK**) |
| `presentacion_id` | uuid | → `presentaciones.id` (**parte de la PK**) |

**PK compuesta:** `[promocion_id, presentacion_id]`  ·  **Índices:** `by_promocion`.

### `combos`
Paquete de varias presentaciones a un precio fijo.

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | uuid | **PK** |
| `nombre` | texto | |
| `descripcion` | texto | nullable |
| `precio_promocional` | número | Precio del combo completo |
| `activo` | booleano | |
| `created_at` | fecha-hora | |

### `combo_items`
Ingredientes de un combo.

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | uuid | **PK** |
| `combo_id` | uuid | → `combos.id` |
| `presentacion_id` | uuid | → `presentaciones.id` |
| `cantidad_requerida` | entero | Unidades de esa presentación en el combo |

**Índices:** `by_combo` (`combo_id`).

---

## Inventario

### `lotes`
Lote de un producto perecedero (control de caducidad, FEFO). Solo para productos con
`lleva_vencimiento = true`.

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | uuid | **PK** |
| `producto_id` | uuid | → `productos.id` |
| `cantidad` | número | Existencia en el lote |
| `fecha_vencimiento` | fecha | Caducidad. Estado: `vencido` (<0 d), `por_vencer` (≤30 d), `vigente` |
| `fecha_recepcion` | fecha | Cuándo entró |
| `created_at` | fecha-hora | |

**Índices:** `by_producto`  ·  La venta descuenta primero el lote que vence antes (**FEFO**).

### `movimientos_inventario`
Bitácora de todo cambio de existencia (auditoría).

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | uuid | **PK** |
| `producto_id` | uuid | → `productos.id` |
| `tipo` | enum | `entrada` · `merma` · `ajuste` · `venta` · `devolucion` |
| `cantidad` | número | Delta neto sobre la existencia (negativo si sale) |
| `motivo` | texto | nullable |
| `fecha` | fecha-hora | |
| `lote_id` | uuid | → `lotes.id` (nullable) |
| `fecha_vencimiento` | fecha | nullable (para entradas de perecederos) |

**Índices:** `by_producto`, `by_fecha`. En `ajuste`, la existencia se **sobrescribe** al valor
real contado y el movimiento guarda el delta para que el historial cuadre.

---

## Usuarios y turnos

### `perfiles`
Usuarios del sistema (cajeros y administradores). Login por nombre + contraseña, sin correo.

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | uuid | **PK** |
| `nombre` | texto | Nombre de acceso (único) |
| `rol` | enum | `admin` · `cajero` |
| `activo` | booleano | Desactivar conserva el historial (no se borra) |
| `desactivado_en` | fecha-hora | nullable |
| `salt` | texto | Sal aleatoria (base64) del hash |
| `password_hash` | texto | Hash **PBKDF2** (SHA-256, 100k iteraciones); nunca en claro |
| `created_at` | fecha-hora | |

**Índices:** `by_nombre`. *En producción, la autenticación la maneja Supabase Auth; `salt` y
`password_hash` son propios del modo local.*

### `turnos`
Turno de caja de un cajero (de apertura a cierre).

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | uuid | **PK** |
| `cajero_id` | uuid | → `perfiles.id` |
| `abierto_en` | fecha-hora | Apertura |
| `cerrado_en` | fecha-hora | Cierre (nullable mientras está activo) |
| `activo` | booleano | Turno abierto |
| `fondo_inicial` | número | Efectivo con el que abre la caja |
| `created_at` | fecha-hora | |

**Índices:** `by_cajero`.

### `movimientos_caja`
Entradas y salidas de dinero del cajón que **no** son ventas (ingresos, retiros, gastos).

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | uuid | **PK** |
| `turno_id` | uuid | → `turnos.id` (nullable) |
| `cajero_id` | uuid | → `perfiles.id` |
| `tipo` | enum | `entrada` (ingreso) · `salida` (retiro/gasto) |
| `monto` | número | > 0 |
| `motivo` | texto | nullable |
| `fecha` | fecha-hora | |
| `created_at` | fecha-hora | |

**Índices:** `by_turno`. Afectan el **efectivo esperado en cajón** del corte.

---

## Ventas

### `ventas`
Encabezado de una venta.

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | uuid | **PK** |
| `fecha` | fecha-hora | |
| `total` | número | Productos + depósito de envases |
| `cajero_id` | uuid | → `perfiles.id` |
| `turno_id` | uuid | → `turnos.id` (nullable) |
| `envases` | json | Mapa `{ clave: cantidad }` de envases cobrados |
| `deposito_envases` | número | Total cobrado por envases retornables |
| `recibido_efectivo` | número | Efectivo entregado por el cliente |
| `cambio` | número | Cambio devuelto |
| `created_at` | fecha-hora | |

**Índices:** `by_turno`, `by_fecha`.

### `venta_detalle`
Renglones (líneas) de una venta.

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | uuid | **PK** |
| `venta_id` | uuid | → `ventas.id` |
| `presentacion_id` | uuid | → `presentaciones.id` (**null** en venta libre / código 0) |
| `cantidad` | número | |
| `precio_unitario` | número | |
| `subtotal` | número | |
| `combo_id` | uuid | → `combos.id` (nullable) |
| `promocion_id` | uuid | → `promociones.id` (nullable) |
| `descripcion` | texto | Texto libre cuando no hay presentación (venta libre) |
| `created_at` | fecha-hora | |

**Índices:** `by_venta`. Las líneas sin `presentacion_id` **no** afectan inventario.

### `venta_pagos`
Pagos de una venta (una venta puede combinar métodos).

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | uuid | **PK** |
| `venta_id` | uuid | → `ventas.id` |
| `metodo_pago` | enum | `efectivo` · `tarjeta` · `transferencia` · … (según `configuracion.datos.REGLAS.metodos_pago`) |
| `monto` | número | La suma de pagos debe igualar `ventas.total` |
| `created_at` | fecha-hora | |

**Índices:** `by_venta`.

---

## Devoluciones

### `devoluciones`
Encabezado de una devolución/cancelación (reembolso siempre en efectivo).

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | uuid | **PK** |
| `venta_id` | uuid | → `ventas.id` |
| `turno_id` | uuid | → `turnos.id` (turno activo al devolver; nullable) |
| `cajero_id` | uuid | → `perfiles.id` |
| `total` | número | Monto reembolsado |
| `motivo` | texto | nullable |
| `fecha` | fecha-hora | |
| `created_at` | fecha-hora | |

**Índices:** `by_venta`, `by_fecha`. Restan del **efectivo esperado** y de las **ventas netas**.

### `devolucion_detalle`
Renglones devueltos.

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | uuid | **PK** |
| `devolucion_id` | uuid | → `devoluciones.id` |
| `venta_detalle_id` | uuid | → `venta_detalle.id` |
| `cantidad` | número | Unidades devueltas de esa línea |
| `reingresar` | booleano | `true` reingresa a inventario; `false` = dañado (no reingresa) |
| `created_at` | fecha-hora | |

**Índices:** `by_devolucion`, `by_venta_detalle`.

---

## Configuración

### `configuracion`
Fila única (`id = 1`) con la configuración de la tienda. `lib/config-runtime.js` la mergea
sobre los valores por defecto de `config.js`.

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | entero | **PK**, siempre `1` |
| `datos` | json | Blob de configuración (ver abajo) |
| `updated_at` | fecha-hora | |

**`datos` contiene:** `NEGOCIO` (identidad/ticket), `APARIENCIA` (colores del tema),
`ENVASES` (lista de `{clave, nombre, deposito}`), `TICKET` (ancho, qué mostrar, textos),
`REGLAS` (`metodos_pago`, `redondeo`, `empaques`, `permitir_generico`, `devoluciones_rol`) y
`CATEGORIAS` (semilla).

---

## Enumeraciones

| Campo | Valores |
|---|---|
| `perfiles.rol` | `admin`, `cajero` |
| `movimientos_inventario.tipo` | `entrada`, `merma`, `ajuste`, `venta`, `devolucion` |
| `movimientos_caja.tipo` | `entrada`, `salida` |
| `venta_pagos.metodo_pago` | `efectivo`, `tarjeta`, `transferencia`, … (configurable) |
| `lotes.estado` (derivado) | `vencido`, `por_vencer`, `vigente` |

## Relaciones (resumen)

```
productos 1─N presentaciones 1─N combo_items N─1 combos
productos 1─N lotes
productos 1─N movimientos_inventario  (lote_id → lotes)
promociones 1─N promocion_presentaciones N─1 presentaciones
perfiles 1─N turnos 1─N ventas 1─N venta_detalle N─1 presentaciones
ventas 1─N venta_pagos
ventas 1─N devoluciones 1─N devolucion_detalle N─1 venta_detalle
perfiles 1─N movimientos_caja N─1 turnos
configuracion (fila única)
```

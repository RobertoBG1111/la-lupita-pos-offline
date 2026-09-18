# Bitácora de correcciones — POS "La Lupita"

Registro de todas las correcciones y mejoras hechas en la versión **offline**
(`la_lupita_offline`) durante las pruebas con Roberto, con **cómo portarlas al
producto oficial** (`la_lupita_modelorama`, conectado a Supabase).

> Contexto: ambas versiones comparten pantallas, diseño y **el motor de precios
> `lib/ventas.js`, `lib/estado.js`, `lib/ui.js`, `lib/escaner.js`** (idénticos). La
> diferencia es la capa de datos: offline usa IndexedDB (`lib/datos.js` + `lib/almacen.js`);
> el oficial usa Supabase (`lib/db.js`, triggers de Postgres, RPC, Edge Functions).
> Los archivos compartidos se copian 1:1; los cambios de datos se traducen a SQL.

Última actualización: 2026-09-02.

---

## 0. Cambios de esquema (para el oficial, en Supabase)

Estas columnas nuevas hay que agregarlas en Postgres (en offline ya existen porque
IndexedDB es sin esquema fijo):

```sql
-- Fondo de caja inicial por turno
ALTER TABLE turnos       ADD COLUMN fondo_inicial numeric NOT NULL DEFAULT 0;
-- Costo por presentación (interno; NO exponer al rol cajero → usar vista sin esta columna)
ALTER TABLE presentaciones ADD COLUMN costo numeric NOT NULL DEFAULT 0;
-- Categoría del producto (reemplaza a "marca")
ALTER TABLE productos    ADD COLUMN categoria text;
-- Opción A: migrar datos de marca→categoria y luego  ALTER TABLE productos DROP COLUMN marca;
-- Opción B: dejar marca y usar categoria (el frontend ya no usa marca).
-- Envase retornable (depósito): tipo 'mega' | 'media_cuarto' (ver §19)
ALTER TABLE productos    ADD COLUMN retornable boolean NOT NULL DEFAULT false;
ALTER TABLE productos    ADD COLUMN tipo_envase text;               -- 'mega' | 'media_cuarto' | null
-- Envases cobrados en cada venta (depósito) — total = productos + deposito_envases
ALTER TABLE ventas       ADD COLUMN envases_mega integer NOT NULL DEFAULT 0;
ALTER TABLE ventas       ADD COLUMN envases_media_cuarto integer NOT NULL DEFAULT 0;
ALTER TABLE ventas       ADD COLUMN deposito_envases numeric NOT NULL DEFAULT 0;
```

⚠️ **RLS/costo:** el rol *cajero* NO debe ver `presentaciones.costo`. RLS filtra filas,
no columnas → crear una **vista** de presentaciones sin `costo` para el cajero, o
manejar el catálogo de venta desde una vista que no incluya el costo.

---

## 1. Fondo de caja inicial al abrir turno
- **Qué:** al iniciar sesión, si se abre un turno nuevo, se pide el efectivo inicial
  ("fondo de caja"). El Corte muestra **Efectivo esperado en cajón = fondo + ventas en efectivo**.
- **Offline:** `turnos.fondo_inicial`; `datos.abrirTurno(cajeroId, fondo)`; `datos.resumenTurno`
  agrega `fondo_inicial` y `efectivo_esperado`; `screens/login.js` pide el fondo con un modal;
  `screens/corte.js` muestra el bloque "Efectivo en caja".
- **Oficial:** `ALTER TABLE turnos` (ver §0). En `db.js`, `abrirTurno` inserta `fondo_inicial`;
  ajustar la vista/consulta `v_resumen_turno` para devolver `fondo_inicial` y `efectivo_esperado`.
  Copiar los cambios de `login.js` y `corte.js` (son de UI, casi idénticos).

## 2. Editar artículos (precio, costo, código, categoría, activar/desactivar, agregar presentación)
- **Qué:** botón **Editar** por producto (solo admin) → modal para cambiar nombre, categoría,
  stock mínimo, activar/desactivar el producto, y por cada presentación: nombre, **precio, costo,
  código de barras**, activa/inactiva; además **agregar** una presentación nueva.
- **Offline:** `datos.actualizarProducto`, `datos.actualizarPresentacion`, `datos.agregarPresentacion`;
  `screens/inventario.js` (`editarProductoModal`, `filaPresEdit`).
- **Oficial:** agregar en `db.js` los `update`/`insert` equivalentes (Supabase); copiar el modal de
  `inventario.js`. RLS ya permite al admin editar.

## 3. Categoría reemplaza a "Marca"
- **Qué:** el alta pide **Categoría** (no marca). Lista semilla en `config.js` (`CATEGORIAS`) y
  **crece sola**: una categoría nueva se recuerda (unión de semilla + categorías ya usadas).
- **Offline:** `config.CATEGORIAS`; `datos.categoriasConocidas()`; `productos.categoria`;
  se cambió `marca`→`categoria` en `venta.js`, `inventario.js`, `datos.js` (`presAnidada`, `crearProducto`).
- **Oficial:** ver §0 (columna). `categoriasConocidas` = `SELECT DISTINCT categoria FROM productos`
  unido con la semilla. Reemplazar usos de `marca` por `categoria` en pantallas y `db.js`.

## 4. Costo por presentación
- **Qué:** cada presentación guarda un **costo** (interno, solo admin).
- **Offline:** `presentaciones.costo`; formularios de alta/edición.
- **Oficial:** ver §0 (columna + RLS/vista sin costo para cajero).

## 5. Presentaciones opcionales (alta arranca en "solo pieza")
- **Qué:** el alta empieza solo con **pieza**; six y paquete son toggles opcionales (antes el
  paquete venía activado y salía "Paquete $0.00"). Muchos artículos se venden solo por pieza.
- **Offline/Oficial:** `screens/inventario.js` (`formAltaProducto`, `paqOn` por defecto apagado). UI 1:1.

## 6. Corte por turno + "El día de hoy"
- **Qué:** el Corte tiene interruptor **Mi turno** (cuadra caja del turno, permite cerrarlo) y
  **El día de hoy** (total del día por fecha de calendario, juntando todos los turnos). El admin ve
  toda la tienda; el cajero solo su propio día.
- **Offline:** `datos.resumenDia`, `datos.detalleDia` (límites del día en hora local vs `fecha` UTC);
  `screens/corte.js` (interruptor + dos vistas).
- **Oficial:** crear consultas/vistas equivalentes para el día (`db.js`). Copiar `corte.js`.
  (En el oficial `fecha` también es timestamptz → mismo cuidado con el día local.)

## 7. Pestaña "Tickets" (historial)
- **Qué:** nueva pantalla con **folio, fecha, cajero, piezas, total**, más recientes primero,
  toggle Hoy/Todos; **Ver** abre el detalle (qué se llevaron + pagos) y **Reimprimir** va al ticket.
  Admin ve todos; cajero solo los suyos.
- **Offline:** `screens/historial.js`; `datos.listarVentas({cajeroId, soloHoy, limite})`;
  registrada en `screens/index.js` (nav tras "Corte de caja"). Reusa `datos.ventaCompleta`.
- **Oficial:** agregar `listarVentas` en `db.js` (Supabase select con join a `perfiles` y conteo de
  `venta_detalle`); copiar `historial.js` e index.

## 8. Cobro con cambio
- **Qué:** el **efectivo puede ser mayor** al total → se calcula el **cambio**. Tarjeta y
  transferencia deben ir **exactas** (no dan cambio). Lo que se **registra** siempre suma el total
  exacto: el efectivo aplicado = total − (tarjeta+transferencia). El ticket muestra **Recibido / Cambio**.
- **Offline/Oficial:** `screens/pago.js` (UI + lógica) y `screens/ticket.js` (líneas Recibido/Cambio).
  Casi 1:1. La validación de la base (pagos == total) sigue cuadrando porque se registra el neto.

## 9. Lector de código de barras robusto (keyboard-wedge)
- **Qué:** el lector dejaba de leer al perder el foco (tras tocar un botón o al re-dibujarse un
  formulario). Ahora hay un detector que distingue la **ráfaga** del lector de la escritura humana.
  - **Venta:** captura global → agrega el producto sin importar el foco.
  - **Inventario (alta y edición):** el escaneo va al **campo de código activo** (hay varios).
- **Offline/Oficial:** nuevo módulo compartido **`lib/escaner.js`** (`montarEscaner`), usado en
  `venta.js` e `inventario.js`. Copiar 1:1 al oficial.

## 10. Respaldo y "Empezar de cero"
- **Qué:** en Usuarios (admin): **Exportar/Importar** respaldo `.json` y **Borrar todo y empezar
  de cero** (doble confirmación). Es propio del modelo offline (todo local, sin nube).
- **Offline:** `almacen.exportarTodo/importarTodo/borrarTodo`; `screens/usuarios.js`.
- **Oficial:** NO aplica igual (los datos viven en la nube). Equivalente: respaldo lo da Supabase;
  "empezar de cero" sería un script de limpieza controlado. **No portar tal cual.**

## 11. Fix "nullnull" en Corte
- **Qué:** el Corte mostraba el texto "nullnull" cuando el turno no tenía ventas (por pasar `null`
  a `.append()`). Corregido (`: null` → `: ""`).
- **Oficial:** MISMO bug heredado en `la_lupita_modelorama/app/screens/corte.js`. **Ya se creó una
  tarea** para corregirlo allá. (El helper `h()` filtra null, pero `.append()` no.)

---

## Correcciones nuevas (lote del 2026-09-02)

## 12. Categoría con autocompletado (typeahead)
- **Qué:** al escribir la categoría, va sugiriendo las conocidas (ej. "cor" → "Corona").
- **Offline/Oficial:** `screens/inventario.js` (`campoCategoria` con `<input list>` + `<datalist>`).
  UI 1:1; en el oficial las opciones salen de `SELECT DISTINCT categoria` + semilla.

## 13. Costo automático de six/cartón
- **Qué:** al capturar el **costo unitario**, el costo de six/cartón se autocompleta = costo × piezas
  (factor). Es editable: si lo escribes a mano, deja de autocalcularse.
- **Offline/Oficial:** `screens/inventario.js` (`formAltaProducto`, `recalcCostos`). UI 1:1.

## 14. Piezas sueltas → precio de six/cartón (AUTOMÁTICO + modal al escanear)
- **Qué (v2, 2026-09-02):** ahora es **automático**: al completar un empaque (6 piezas → six) se cobra
  solo al precio del empaque; el sobrante queda a precio de pieza (ej. 8 pz = 1 six + 2 piezas). Se
  quitó la leyenda "Aplicar". Además, **al escanear la pieza** de un producto que tiene six/cartón,
  aparece un **modal** "¿Cómo se lleva? (Pieza / six / cartón)" — Enter = pieza; luego con **+** se
  suman las que sean y al llegar a 6 se ajusta solo.
- **Offline/Oficial (COMPARTIDO):** `lib/ventas.js` (paso "1.5) Empaques" en `calcular`: `aplicado =
  nPosible > 0`, automático, empaque más grande primero); `screens/venta.js` (`preguntarEmpaque`
  modal en `procesarCodigo`; se eliminó la sugerencia; chip del empaque en la línea). **Copiar 1:1** —
  no toca la base: el descuento de inventario sigue siendo `cantidad × factor` de la presentación base.
  (`ventaEnCurso.paquetesAceptados` quedó sin uso; se puede eliminar.)

## 15. Ajuste de inventario = SOBRESCRIBE
- **Qué:** "ajuste" ahora **fija** la existencia al número real contado (antes solo sumaba). Para
  perecederos, fija la cantidad del **lote elegido**. El movimiento registra el **delta neto** para
  que el historial cuadre.
- **Offline:** `datos.registrarMovimiento` (rama `ajuste`: `delta = contado − actual`);
  `screens/inventario.js` (ayuda dinámica por tipo + label "Existencia real contada").
- **Oficial:** cambiar el **trigger** `fn_movimiento_manual_afecta_stock` en Postgres para que, en
  `tipo='ajuste'`, interprete `cantidad` como existencia real y calcule el delta (producto o lote).
  Copiar los textos de ayuda de `inventario.js`.

## 16. Corte por categoría (reemplaza "por presentación")
- **Qué:** en el Corte, la tabla "Por presentación" se reemplazó por **"Por categoría"** (Categoría |
  Piezas | Importe). Se mantiene "Ventas por producto" (barras).
- **Offline:** `screens/corte.js` (`desgloseProductos`); requiere `categoria` en el detalle
  (`datos.presAnidada` ya incluye `productos.categoria`).
- **Oficial:** incluir `categoria` en el join del detalle (`db.js`/vista) y copiar `corte.js`.

## 17. Teclado en el carrito (sin mouse)
- **Qué:** en Venta, la **línea activa** se manipula con teclado: **+ / −** suman/restan, **Supr**
  la quita, **↑ / ↓** cambian de línea. La línea activa se resalta; también se puede elegir con clic.
  No estorba cuando escribes en el buscador o en una cantidad. **F4** cobra, **F2** busca, **Esc** vacía.
- **Fix (2026-09-02):** el detector del lector (`lib/escaner.js`) se "comía" las teclas `+ −`. Se
  corrigió para que **solo capture caracteres alfanuméricos** (los de un código de barras), dejando
  libres `+ − = Supr` y las teclas de función. **Copiar `escaner.js` 1:1.**
- **Nota hardware:** en laptops, las teclas **F** pueden requerir **Fn** (Fn-lock). No es del programa.
- **Offline/Oficial:** `screens/venta.js` (`lineaActiva`, `ajustarActiva/quitarActiva/moverActiva`,
  `atajos`) + `lib/escaner.js`. UI 1:1.

## 18. Promociones editables
- **Qué:** botón **Editar** por promoción → modal para cambiar nombre, cantidad requerida, precio y
  **las presentaciones a las que aplica** (agregar/quitar).
- **Offline:** `datos.actualizarPromocion`, `datos.setPromocionPresentaciones`; `screens/promociones.js`
  (`editarPromoModal`).
- **Oficial:** agregar los `update`/`delete+insert` equivalentes en `db.js`; copiar el modal.

---

## 19. Envases retornables (depósito) — atado al producto (v2)
- **Qué (v2, 2026-09-02):** el **producto** se marca como **envase retornable** con su **tipo**
  (`mega`/refresco = $10, `media_cuarto` = $5) al darlo de alta o editarlo. La pantalla de envases
  **solo aparece si el carrito trae productos retornables**: muestra cuántos se llevaron (por tipo) y
  pregunta **cuántos vacíos trae** el cliente; cobra depósito **solo por los que falten** (default:
  trae todos → $0). El cargo se suma al total, sale en el ticket y no afecta inventario. Precios en
  `config.js` (`ENVASE`).
- **Offline:**
  - **Producto:** `productos.retornable` (bool) + `productos.tipo_envase` ('mega'|'media_cuarto'|null);
    `datos.crearProducto`/`actualizarProducto`; `screens/inventario.js` (toggle + select en alta y edición).
  - **Venta:** `venta.js` `irACobrar` calcula los envases requeridos por tipo (unidades base de los
    productos retornables); si hay, va a `envases`, si no, directo a `pago`.
  - **Pantalla:** `screens/envases.js` (por tipo: llevó N · vacíos que trae · a cobrar). Devuelve los
    **faltantes** `{ mega, mediaCuarto }` a `pago`.
  - **Cobro/registro:** `pago.js` suma depósito al total; `datos.registrarVenta` (param `envases`;
    total = productos + depósito; guarda `envases_mega`, `envases_media_cuarto`, `deposito_envases`);
    `datos.ventaCompleta` devuelve esos campos; `ticket.js` pinta las líneas de envase.
- **Oficial:** columnas nuevas en `productos` (`retornable`, `tipo_envase`) y en `ventas`
  (`envases_mega`, `envases_media_cuarto`, `deposito_envases`); sumar el depósito al total en la
  RPC/trigger `registrar_venta`. Copiar pantalla y UI 1:1.

## 20. Movimientos de caja (entradas/salidas de dinero)
- **Qué:** botón **💵 Caja** en Venta → registra **entradas** (ingresos) o **salidas** (retiros/gastos)
  de dinero del cajón, con **monto y motivo**. No son ventas. El corte del turno los refleja en
  **Efectivo esperado en cajón = fondo + ventas efectivo + entradas − salidas**.
- **Offline:** nuevo store `movimientos_caja` (**se subió `almacen.js` VER a 2** para crearlo sin borrar
  datos — `onupgradeneeded` crea los stores faltantes); `datos.registrarMovimientoCaja`,
  `datos.movimientosCajaDe`; `datos.resumenTurno` (suma `entradas_caja`/`salidas_caja` y ajusta
  `efectivo_esperado`); `screens/venta.js` (botón + `modalCaja`); `screens/corte.js` (líneas Entradas/
  Salidas en "Efectivo en caja").
- **Oficial:** tabla `movimientos_caja (id, turno_id, cajero_id, tipo, monto, motivo, fecha)`; incluir
  entradas/salidas en la vista/consulta del corte. Copiar UI.

## 21. Código 0 — venta genérica (artículo/servicio libre)
- **Qué:** teclear **0** en el campo Código abre un modal para cobrar algo **no catalogado**:
  **descripción + monto unitario + cantidad**. Entra como una línea normal del carrito (editable con
  + / − / Supr), suma al total y sale en el ticket. **No afecta inventario**.
- **Offline (COMPARTIDO parcial):** `lib/estado.js` (`ventaEnCurso.genericos` + métodos;
  `vacio`/`vaciar` los consideran); `lib/ventas.js` (`calcular` recibe `genericos` y agrega sus rows —
  **copiar 1:1**); `screens/venta.js` (`modalGenerico` en `procesarCodigo` cuando `code==="0"`; render
  de líneas genéricas; teclado); `datos.registrarVenta` (guarda `venta_detalle.descripcion`, y **salta
  inventario** cuando `presentacion_id` es null); `datos.ventaCompleta`/`detalleTurno`/`detalleDia`/
  `detalleEntre` (devuelven `descripcion`); `pago.js`/`ticket.js`/`historial.js`/`corte.js` (muestran
  la descripción como nombre; en corte, categoría "Venta libre").
- **Oficial:** agregar `venta_detalle.descripcion text` (nullable) y permitir `presentacion_id` NULL
  (o un producto especial "genérico"); el trigger de inventario debe **saltar** las líneas sin
  presentación. Copiar la lógica de `ventas.js`/pantallas.

## 22. Inventario agrupado por categoría (carpetas) + orden
- **Qué:** la tabla de Inventario ya no es una lista plana: los productos se agrupan en **carpetas
  plegables por categoría** (`<details>`), con conteo y aviso de "N bajo" por carpeta. Un selector
  **"Ordenar por"** reordena dentro de cada carpeta: Nombre A–Z / Z–A, Precio ↑/↓, Existencia ↑/↓
  (el precio usa la presentación base/pieza). El orden elegido se conserva entre re-renders.
- **Offline/Oficial:** `screens/inventario.js` (`ordenInv` a nivel módulo; `filaProducto`, `ordenar`,
  `precioPieza`, `pintarFolders`). UI 1:1 (solo presentación; no toca datos).

## 23. Bloqueo de venta sin existencia (control de inventario)
- **Qué (v2, 2026-09-04):** NO se puede agregar/vender más de lo que hay en existencia. Un artículo en
  **0 está BLOQUEADO** (no entra al carrito) con "⛔ … está AGOTADO. Dale entrada en Inventario…"; si
  intentas pasar de la existencia, se topa en el máximo disponible con "⛔ Solo hay N…". Aplica a clic,
  escaneo, botón +, teclado y al campo de cantidad. En el catálogo los agotados se marcan **AGOTADO**
  (chip rojo, tarjeta atenuada). (Decisión de Roberto: es control de inventario, debe **bloquear**, no
  solo avisar.)
- **Offline/Oficial:** `screens/venta.js` (`bloquearSiNoCabe`, `fijarConTope`, `baseEnCarrito`; chequeo
  de agotado en `procesarCodigo`; marca "AGOTADO" en `pintarGrid`). Compara contra `stock_actual` del
  catálogo cargado. UI 1:1. (En el oficial, además, la RPC/trigger de venta ya debería rechazar stock
  negativo como última línea de defensa.)

## Cómo portar (resumen rápido)
1. **Correr el SQL de §0** en Supabase (columnas nuevas + vista sin `costo` para cajero).
2. **Copiar 1:1** los archivos compartidos que cambiaron: `lib/ventas.js`, `lib/estado.js`,
   `lib/escaner.js`, y las pantallas `screens/*.js` (venta, pago, ticket, corte, inventario,
   usuarios, login, bienvenida, historial + registrarlo en `index.js`).
3. **Traducir a Supabase** en `lib/db.js` las funciones que en offline viven en `datos.js`:
   `abrirTurno(fondo)`, `resumenTurno`(+fondo/esperado), `resumenDia`/`detalleDia`, `listarVentas`,
   `actualizarProducto`/`actualizarPresentacion`/`agregarPresentacion`, `categoriasConocidas`,
   y el join de categoría en el detalle del corte.
4. **Cambiar el trigger** `fn_movimiento_manual_afecta_stock` para el ajuste-sobrescribe (§15).
5. **NO portar** el "Borrar todo / respaldo .json" (§10) — es propio del modelo offline.
6. Corregir el **"nullnull"** del corte oficial (§11) — ya hay tarea creada.

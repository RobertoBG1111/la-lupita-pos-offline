# La Lupita POS — Punto de venta offline (PWA)

Punto de venta web **100 % local / offline** para la tienda Modelorama **"La Lupita"**
(Tixpéhual, Yucatán). Corre como **PWA instalable** (HTML + CSS + JavaScript con módulos
ES, **sin framework ni bundler**) y guarda todo en **IndexedDB** del propio equipo: se
abre y funciona **sin internet, sin backend y sin credenciales**.

> Es la versión offline, hermana del producto oficial en la nube
> (`la_lupita_modelorama`, sobre Supabase). Comparten front-end y motor de precios; lo
> único que cambia es la **capa de datos**. Este repo demuestra el diseño, la planeación
> y el resultado: replica **todas las funciones y el catálogo real** (602 productos) del
> POS oficial, corriendo por completo en el navegador.

![Pantalla de Venta con búsqueda del catálogo real, promociones y varios tickets](docs/img/venta.png)

---

## El problema

La tienda ya tiene un POS **en la nube** (Supabase). Funciona muy bien, pero deja dos
huecos:

1. **La venta no puede depender del internet.** En el mostrador se cobra a cada rato; si el
   enlace se cae a media venta, la caja se detiene. Un POS de tienda tiene que **seguir
   cobrando aunque no haya red**, con los precios y promociones correctos.
2. **Demostrar el sistema requería levantar un backend.** Para enseñar el producto (a un
   cliente nuevo, o a un reclutador) había que tener un proyecto Supabase con credenciales y
   datos. No se podía simplemente *abrir y usar*.

El reto técnico, entonces, era: **replicar TODAS las funciones y el catálogo real del POS
oficial, pero que corra 100 % en el navegador** —sin backend, sin credenciales, sin
internet— y sin mantener dos códigos distintos que se desincronicen.

## La solución (decisiones de diseño)

- **Una sola frontera: front-end compartido, capa de datos intercambiable.** El front-end y
  el motor de precios (`lib/ventas.js`) son **idénticos** a los del POS oficial (verificado:
  byte a byte). Las pantallas se copian 1:1 y solo cambia el import de datos
  (`db.js` → `datos.js`). Así las dos versiones evolucionan juntas en vez de bifurcarse.
- **La lógica de negocio del servidor, reimplementada en el cliente.** Lo que en la nube
  vive en *triggers* y RPC de Postgres (venta atómica, validación de pagos, descuento de
  inventario con **FEFO**, ajuste que sobrescribe, devoluciones) se reescribió en JavaScript
  sobre **IndexedDB**, exponiendo la **misma API y el mismo *shape* de datos** — para que las
  pantallas no distingan de dónde vienen.
- **Lo que solo aplica en la nube se neutraliza sin tocar el front-end.** Los módulos de
  conexión/cola quedan como *stubs* no-op (offline siempre está "en línea" con sus datos).
- **El catálogo real, sembrado localmente.** Se exportó del Supabase oficial (602 productos,
  604 presentaciones, 7 promociones, 2 combos) y se carga al primer arranque, así la demo
  arranca con datos de verdad.
- **PWA instalable** para que quede como app de escritorio y funcione sin conexión.

**Resultado:** un POS que se abre con `python serve.py` (o instalándolo como app) y funciona
completo, sin nada más. El detalle de la arquitectura está en
[`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md).

---

## Cómo correrlo (30 segundos)

Es una app estática servida desde `app/`:

```bash
python serve.py
```

Abre <http://localhost:5500>. En Windows también sirve el `Abrir POS.bat`.
Al **primer arranque** siembra solo el catálogo real (productos, presentaciones,
promociones y combos) y pide crear el **primer administrador**. Después:

1. Inicia sesión (nombre + contraseña, sin correo).
2. Captura el **fondo de caja** del turno.
3. **Vende**: escanea o busca por nombre, ajusta cantidades y **Cobra (F4)**.
4. Cuadra en **Corte de caja** y cierra el turno.

Como es PWA, desde Chrome/Edge puedes **Instalar** la app (ícono de escritorio, ventana
propia) y seguir operando sin conexión.

---

## Qué hace

**Venta**
- Lector de código de barras (captura global, tipo teclado) y **buscador por nombre** con
  flechas ↑ ↓ y Enter.
- **Varios tickets abiertos a la vez** (deja uno pendiente y atiende a otro cliente · F3).
- Precios inteligentes: **promociones** (N × $X automáticas), **combos**, cobro de
  **six/cartón** al juntar piezas, y **venta libre** (código 0).
- **Envases retornables**: cobra depósito solo por los vacíos que falten.
- Operable **solo con teclado**: F2 buscar, F4 cobrar, F7/F8 caja, + / − / ↑ ↓ / Supr en el carrito.
- **Control de existencias**: no se puede vender más de lo que hay.

**Cobro y tickets**
- Efectivo con **cálculo de cambio**, tarjeta y transferencia; botón "Justo" y Enter para confirmar.
- Ticket imprimible (58/80 mm), reimpresión y **cancelación/devolución** total o parcial
  (reingresa inventario). **Caja**: entradas/salidas de dinero del cajón.

**Corte de caja** — por **turno** y por **día**: total, por método de pago, **efectivo
esperado en cajón** (fondo + ventas − salidas + entradas − devoluciones) y desglose por
producto/categoría.

**Inventario** — alta de productos y presentaciones; movimientos de **entrada / merma /
ajuste** (el ajuste *sobrescribe* la existencia real); **lotes y vencimiento (FEFO)**;
alertas de stock bajo; agrupado por categoría; borrado protegido (no borra lo ya vendido).

**Administración** — Combos, Promociones y Reportes (KPIs por rango). **Usuarios** locales
(alta / reset / desactivar, con hash PBKDF2). **Configuración por tienda**: identidad,
apariencia (colores en vivo), lista de envases, ticket y reglas (métodos de pago,
redondeo, empaques, permiso de devoluciones).

**Respaldo** — como todo vive en este equipo, hay **Exportar / Importar** respaldo `.json`
y "Empezar de cero". (En la versión de nube, el respaldo lo da Supabase.)

---

## Capturas

| Cobro con cambio | Ticket imprimible |
|---|---|
| ![Cobro](docs/img/cobro.png) | ![Ticket](docs/img/ticket.png) |

| Corte de caja (turno) | Inventario por categorías |
|---|---|
| ![Corte de caja](docs/img/corte.png) | ![Inventario](docs/img/inventario.png) |

Configuración por tienda (identidad, apariencia, envases, ticket, reglas, usuarios):

![Configuración](docs/img/configuracion.png)

---

## Arquitectura

- **Front-end**: módulos ES nativos, sin framework. Router propio, componentes con un
  helper `h()`, estilos con tokens de diseño (claro/oscuro) y fuentes vendorizadas (offline).
- **Datos**: `lib/almacen.js` (IndexedDB: un *object store* por "tabla") + `lib/datos.js`,
  que **reimplementa en JS** la lógica que en la nube vive en triggers/RPC de Postgres:
  venta atómica, afectación de inventario, FEFO, validación de pagos, ajuste que
  sobrescribe, devoluciones con reingreso, y cortes por turno/día.
- **Frontera de diseño**: el front-end y el motor de precios (`lib/ventas.js`) son
  **idénticos** a los del POS oficial; solo cambia el import de la capa de datos
  (`datos.js` ↔ `db.js`). Ver [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md).
- **Siembra**: `lib/seed.js` carga `data/catalogo.json` (catálogo real exportado del POS
  oficial) y `data/config-inicial.json` (configuración de la tienda) en el primer arranque.
- **PWA**: `sw.js` (precache network-first del shell + catálogo) y `manifest.webmanifest`.

```
app/
  index.html, main.js         arranque
  config.js                   valores por defecto de la tienda (sin claves; todo local)
  lib/                        almacen (IndexedDB), datos, auth, ventas, escaner, router,
                              ui, estado (multi-ticket), config-runtime, seed, conexion/cola (stubs)
  screens/                    venta, pago, ticket, corte, inventario, combos, promociones,
                              reportes, historial, envases, configuracion, usuarios, login, bienvenida
  data/                       catalogo.json + config-inicial.json (semilla)
  styles/                     tokens, base, ticket, fuentes locales
  sw.js, manifest.webmanifest, assets/   soporte PWA
docs/                         BITACORA + arquitectura
serve.py, Abrir POS.bat       servidor estático local (solo desarrollo)
```

---

## Seguridad y privacidad

- Todo es local: no hay red ni nube. Las contraseñas se guardan con **PBKDF2** (Web
  Crypto), nunca en claro. No hay claves de terceros en el repo.
- El riesgo del modelo offline es la pérdida del equipo → por eso el **respaldo `.json`**.

---
Sistema por **Nodo Digital** · usanodo.com

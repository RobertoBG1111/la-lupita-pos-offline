# Modelorama "La Lupita" — POS (demostración pública)

**Demostración autocontenida de un punto de venta real en producción.** El sistema real
—construido para la tienda Modelorama **"La Lupita"** (Tixpéhual, Yucatán)— corre como **PWA
sobre Supabase** (Postgres + Auth + Edge Functions) y está **en uso en el mostrador**. Este
repositorio es una **build de demostración** de ese mismo proyecto, corriendo **100 % en el
navegador** (IndexedDB, sin backend ni credenciales), para **enseñar la funcionalidad real
sin exponer ni arriesgar el POS de producción**.

> Mismo front-end y mismo motor de precios que el sistema real; lo único que cambia es la
> **capa de datos** (nube → local). Por eso la demostración es **fiel** a la funcionalidad
> real —con el **catálogo real** (602 productos)— y a la vez **no puede comprometer la
> tienda**: aquí no hay credenciales, ni datos de producción, ni backend que tocar.

![Pantalla de Venta con búsqueda del catálogo real, promociones y varios tickets](docs/img/venta.png)

---

## El problema (del proyecto real)

La tienda necesitaba un punto de venta a la altura de su operación: catálogo grande con
**códigos de barras**, control de **inventario** (lotes y caducidad / FEFO), **cortes** por
turno y por día, **promociones, combos y envases retornables**, y **varios cajeros** con
roles (admin/cajero). Con dos restricciones propias del entorno:

1. **La venta no puede detenerse si se cae el internet.** La conexión en la zona es
   intermitente; en el mostrador se cobra a cada rato. El POS **debe seguir cobrando** —con
   precios y promociones correctos— y **cuadrar las cuentas** cuando la red vuelva.
2. **Tiene que poder replicarse por tienda** (multi-sucursal) sin rehacer el sistema, y
   **proteger los datos** (cada quien ve solo lo que le toca).

## La solución (el sistema real)

- **PWA instalable sobre Supabase** (Postgres + **RLS** + Auth + Edge Functions), sin
  framework ni bundler. Se instala como app de escritorio y se hostea en Vercel.
- **La lógica de negocio crítica vive en la base** (triggers + el RPC `registrar_venta`):
  venta atómica, descuento de inventario con **FEFO**, total = suma de subtotales, validación
  de pagos y devoluciones. La app usa solo la *anon key*; la privacidad la garantiza RLS.
- **Modo sin conexión**: cachea el catálogo, **encola** las ventas descontando el stock local
  y, al volver la red, las **reinyecta sin duplicarlas**.
- **Multi-tienda** (un proyecto Supabase por sucursal) y **gestión de usuarios** por rol.

## Por qué esta versión de demostración

Enseñar el POS real —a un cliente nuevo o a un reclutador— implicaba levantar un backend con
credenciales y datos, y **cualquier prueba tocaba el sistema en producción** (la caja de una
tienda que está operando). Esta build resuelve justo eso:

- **Misma app, capa de datos intercambiada a IndexedDB.** El front-end y el motor de precios
  (`lib/ventas.js`) son **idénticos** a los de producción (verificado byte a byte); las
  pantallas solo cambian el import `db.js → datos.js`.
- **La lógica que en producción vive en el servidor, reimplementada en el cliente** con la
  **misma API y el mismo *shape* de datos** (venta atómica, FEFO, validación de pagos,
  devoluciones), para que la demostración se comporte igual que el sistema real.
- **Catálogo real sembrado** al primer arranque (exportado del proyecto de producción).

**Resultado:** cualquiera puede **abrir la app y ver funcionar el proyecto real** —con datos
reales— sin instalar nada, sin credenciales y **sin posibilidad de afectar la tienda**. El
detalle técnico está en [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md).

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

*Estas son las funciones del sistema real, todas operables en esta demostración:*

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
  **idénticos** a los del sistema en producción; solo cambia el import de la capa de datos
  (`datos.js` ↔ `db.js`). Ver [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md).
- **Siembra**: `lib/seed.js` carga `data/catalogo.json` (catálogo real exportado del proyecto
  en producción) y `data/config-inicial.json` (configuración de la tienda) en el primer arranque.
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
docs/                         arquitectura + capturas
serve.py, Abrir POS.bat       servidor estático local (solo desarrollo)
```

---

## Seguridad y privacidad

- **Esta demostración** es 100 % local: no hay red ni nube, ni claves de terceros en el repo,
  ni datos de producción. Las contraseñas se guardan con **PBKDF2** (Web Crypto), nunca en
  claro. Por diseño, no puede tocar el POS de producción.
- **El sistema en producción** protege la privacidad con **RLS** (activo en todas las tablas)
  en Supabase y contraseñas por usuario; la *service_role key* nunca sale del backend.
- El único riesgo del modo local es la pérdida del equipo → por eso el **respaldo `.json`**.

---
Sistema por **Nodo Digital** · usanodo.com

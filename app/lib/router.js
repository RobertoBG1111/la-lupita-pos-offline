// ── Router y chrome de la app — POS Modelorama "La Lupita" ──────────────────
// SPA simple: registra pantallas, controla acceso por rol y dibuja el encabezado.

import { h, limpiar, iniciales } from "./ui.js";
import { CONFIG } from "../config.js";
import { perfil, rol, salir } from "./auth.js";

const _pantallas = new Map(); // id -> def
let _actual = null;
let _root = null; // #app

/**
 * def: {
 *   id, etiqueta, titulo, roles: ['admin','cajero']|'todos',
 *   full?: bool,               // sin encabezado (bienvenida, login, ticket)
 *   enNav?: bool,              // aparece en la barra de navegación
 *   render(ctx)                // ctx = { contenido, params, ir, volver }
 * }
 */
export function registrarPantalla(def) { _pantallas.set(def.id, def); }

export function montarRouter(rootEl) { _root = rootEl; }

export function puedeVer(def) {
  if (def.roles === "todos" || !def.roles) return true;
  const r = rol();
  return !!r && def.roles.includes(r);
}

export function pantallasNav() {
  return [..._pantallas.values()].filter((d) => d.enNav && puedeVer(d));
}

export function ir(id, params = {}) {
  const def = _pantallas.get(id);
  if (!def) { console.warn("Pantalla desconocida:", id); return; }
  if (!puedeVer(def)) { console.warn("Sin acceso a:", id); return; }
  _actual = id;
  render(def, params);
}

function render(def, params) {
  limpiar(_root);
  const ctx = { params, ir, volver: () => history.length > 1 };

  if (def.full) {
    const full = h("div", { class: "pantalla-full", style: "height:100%" });
    _root.append(full);
    ctx.contenido = full;
    ejecutarRender(def, ctx, full);
    return;
  }

  _root.append(encabezado());
  const contenido = h("main", { class: "contenido" });
  _root.append(contenido);
  ctx.contenido = contenido;
  ejecutarRender(def, ctx, contenido);
}

// Ejecuta el render de una pantalla sin que un fallo deje la app en blanco:
// cualquier excepción (síncrona o de una promesa) muestra un aviso + log.
function ejecutarRender(def, ctx, contenedor) {
  const mostrarError = (e) => {
    console.error("Error al renderizar la pantalla '" + def.id + "':", e);
    try {
      limpiar(contenedor).append(h("div", { class: "glass card centrado", style: "margin:24px;padding:32px" },
        h("h3", {}, "No se pudo abrir esta pantalla"),
        h("p", { class: "tenue", style: "margin-top:8px" }, "Ocurrió un error" + (navigator.onLine ? "." : " (sin conexión).") + " Revisa la consola o reinicia la app."),
      ));
    } catch (_e) { /* noop */ }
  };
  try {
    const maybe = def.render(ctx);
    if (maybe && typeof maybe.then === "function") maybe.catch(mostrarError);
  } catch (e) { mostrarError(e); }
}

function encabezado() {
  const p = perfil();
  const nav = h("nav", {},
    ...pantallasNav().map((d) =>
      h("button", {
        class: "navbtn" + (d.id === _actual ? " activo" : ""),
        onClick: () => ir(d.id),
      }, d.etiqueta),
    ),
  );

  const chip = h("div", { class: "usuario-chip", "data-glow": "1", title: "Cambiar de usuario",
    onClick: async () => { await salir(); ir("bienvenida"); } },
    h("div", { class: "avatar" }, iniciales(p?.nombre)),
    h("div", { class: "col" },
      h("strong", {}, p?.nombre ?? "—"),
      h("small", {}, p?.rol === "admin" ? "Administrador" : "Cajero"),
    ),
  );

  return h("header", { class: "header glass" },
    h("div", { class: "marca" },
      h("img", { src: CONFIG.NEGOCIO.logo, alt: "Logo", onerror: (e) => e.target.remove() }),
      h("div", { class: "col" },
        h("span", { class: "nombre" }, `${CONFIG.NEGOCIO.nombre} · ${CONFIG.NEGOCIO.sucursal}`),
        h("span", { class: "sub" }, "Punto de venta"),
      ),
    ),
    nav,
    h("div", { class: "spacer" }),
    chip,
  );
}

export function pantallaActual() { return _actual; }

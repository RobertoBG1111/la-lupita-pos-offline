// ── Helpers de interfaz — POS Modelorama "La Lupita" ────────────────────────

/** Crea un elemento con atributos e hijos. attrs: {class, onclick, dataset, html, ...} */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "value") el.value = v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function limpiar(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

// ── Formato ──────────────────────────────────────────────────────────────────
const fMoneda = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
export const dinero = (n) => fMoneda.format(Number(n) || 0);

export function fechaHora(d = new Date()) {
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(d));
}
export function fechaCorta(d) {
  return new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(d));
}

// ── Toasts ─────────────────────────────────────────────────────────────────
export function toast(mensaje, tipo = "") {
  let cont = document.getElementById("toasts");
  if (!cont) { cont = h("div", { id: "toasts" }); document.body.append(cont); }
  const t = h("div", { class: "toast " + tipo }, mensaje);
  cont.append(t);
  setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .3s"; setTimeout(() => t.remove(), 300); }, 3200);
}
export const exito = (m) => toast(m, "ok");
export const falla = (m) => toast(m, "error");

// ── Glow del cursor sobre elementos [data-glow] ──────────────────────────────
export function activarGlow(root = document) {
  root.addEventListener("pointermove", (e) => {
    const el = e.target.closest?.("[data-glow]");
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--gx", (e.clientX - r.left) + "px");
    el.style.setProperty("--gy", (e.clientY - r.top) + "px");
  });
}

// ── Modal / confirmación simple ──────────────────────────────────────────────
export function modal(contenidoFn, { ancho = 460 } = {}) {
  const fondo = h("div", {
    class: "modal-fondo",
    style: "position:fixed;inset:0;z-index:60;display:grid;place-items:center;background:rgba(14,21,36,.35);backdrop-filter:blur(3px)",
  });
  const cerrar = () => fondo.remove();
  const caja = h("div", { class: "glass glass-fuerte card", style: `width:min(${ancho}px,92vw);max-height:88vh;overflow:auto` });
  fondo.append(caja);
  fondo.addEventListener("click", (e) => { if (e.target === fondo) cerrar(); });
  document.addEventListener("keydown", function esc(ev) { if (ev.key === "Escape") { cerrar(); document.removeEventListener("keydown", esc); } });
  contenidoFn(caja, cerrar);
  document.body.append(fondo);
  return cerrar;
}

// ── Navegación con flechas por una lista de botones (dentro de un modal) ─────
// Para elegir opciones sin mouse: ↑/↓ (o ←/→) mueven el resaltado, Enter activa
// la opción resaltada y Escape sale. Resalta con la clase .kbd-activo. NO mueve
// el foco del DOM (así Enter no dispara dos veces: solo lo maneja este handler).
// Se autolimpia cuando los botones dejan de estar en el documento. Captura en
// fase de captura + stopPropagation para no chocar con atajos de Venta ni el lector.
export function navegarConFlechas(botones, { inicial = 0, alSalir } = {}) {
  const lista = (botones || []).filter(Boolean);
  if (!lista.length) return () => {};
  let i = Math.max(0, Math.min(inicial, lista.length - 1));
  const pinta = () => lista.forEach((b, k) => b.classList.toggle("kbd-activo", k === i));
  function quitar() { document.removeEventListener("keydown", onKey, true); }
  function onKey(e) {
    if (!lista[0].isConnected) { quitar(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); i = (i + 1) % lista.length; pinta(); }
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); i = (i - 1 + lista.length) % lista.length; pinta(); }
    else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); quitar(); lista[i].click(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); quitar(); alSalir?.(); }
  }
  document.addEventListener("keydown", onKey, true);
  pinta();
  return quitar;
}

export function confirmar(mensaje, { titulo = "¿Confirmar?", okTexto = "Confirmar", peligro = false } = {}) {
  return new Promise((resolve) => {
    modal((caja, cerrar) => {
      caja.append(
        h("h3", {}, titulo),
        h("p", { class: "tenue", style: "margin:10px 0 20px" }, mensaje),
        h("div", { class: "fila entre" },
          h("button", { class: "btn btn-fantasma", onClick: () => { cerrar(); resolve(false); } }, "Cancelar"),
          h("button", { class: "btn " + (peligro ? "btn-peligro" : "btn-primario"), onClick: () => { cerrar(); resolve(true); } }, okTexto),
        ),
      );
    });
  });
}

/** Inicial(es) para el avatar del chip de usuario. */
export function iniciales(nombre = "") {
  return nombre.trim().split(/\s+/).slice(0, 2).map((p) => p[0] || "").join("").toUpperCase() || "?";
}

// ── Selector de presentaciones con buscador (para Promos y Combos) ───────────
// Reemplaza las listas largas de casillas/selects: un campo que filtra por nombre
// y una sección "Seleccionadas" siempre visible. `pres` = [{id, etiqueta, ...}].
//  - Promos:  selectorPresentaciones(pres, { iniciales: [id,...] })
//             → .seleccionadas() = [id,...]
//  - Combos:  selectorPresentaciones(pres, { conCantidad:true,
//               iniciales:[{presentacion_id,cantidad_requerida},...] })
//             → .seleccionadas() = [{presentacion_id,cantidad_requerida},...]
export function selectorPresentaciones(pres, opts = {}) {
  const conCant = !!opts.conCantidad;
  const sel = new Set();
  const cant = new Map();
  for (const it of (opts.iniciales || [])) {
    if (conCant) { sel.add(it.presentacion_id); cant.set(it.presentacion_id, Number(it.cantidad_requerida) || 1); }
    else { sel.add(it); }
  }
  const norm = (s) => (s || "").toString().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const buscador = h("input", { class: "input", type: "search", autocomplete: "off", placeholder: "Filtrar por nombre… (ej. victoria)" });
  const conteo = h("span", { class: "tenue", style: "font-size:12px;white-space:nowrap" });
  const lista = h("div", { class: "checks" });

  function filaCheck(p, enSel) {
    const cb = h("input", { type: "checkbox" });
    cb.checked = sel.has(p.id);
    cb.addEventListener("change", () => {
      if (cb.checked) { sel.add(p.id); if (conCant && !cant.has(p.id)) cant.set(p.id, 1); }
      else { sel.delete(p.id); cant.delete(p.id); }
      actualizar();
    });
    const hijos = [cb, h("span", { style: "flex:1;min-width:0" }, p.etiqueta)];
    if (conCant && enSel) {
      const q = h("input", { class: "input mono", inputmode: "numeric", value: String(cant.get(p.id) || 1),
        title: "Cantidad", style: "max-width:64px" });
      q.addEventListener("input", () => { const n = parseInt(q.value, 10); cant.set(p.id, Number.isFinite(n) && n > 0 ? n : 1); });
      hijos.push(q);
    }
    return h("label", { class: "check-fila" }, ...hijos);
  }

  function actualizar() {
    limpiar(lista);
    const q = norm(buscador.value).trim();
    const selItems = pres.filter((p) => sel.has(p.id));
    if (selItems.length) {
      lista.append(h("div", { class: "sel-titulo" }, `Seleccionadas (${selItems.length})`));
      for (const p of selItems) lista.append(filaCheck(p, true));
    }
    const pool = pres.filter((p) => !sel.has(p.id));
    const items = q ? pool.filter((p) => norm(p.etiqueta).includes(q)) : pool;
    lista.append(h("div", { class: "sel-titulo" }, q ? `Resultados (${items.length})` : `Todos (${pool.length})`));
    if (!items.length) lista.append(h("p", { class: "tenue", style: "padding:8px;font-size:12px" }, "Sin coincidencias."));
    else {
      for (const p of items.slice(0, 50)) lista.append(filaCheck(p, false));
      if (items.length > 50) lista.append(h("p", { class: "tenue", style: "padding:8px;font-size:12px" }, `Mostrando 50 de ${items.length}. Escribe para afinar la búsqueda.`));
    }
    conteo.textContent = sel.size ? `${sel.size} seleccionada(s)` : "";
  }
  buscador.addEventListener("input", actualizar);
  actualizar();

  const node = h("div", {},
    h("div", { class: "fila entre", style: "gap:8px;align-items:center;margin:6px 0" }, buscador, conteo),
    lista);
  return {
    node,
    seleccionadas() {
      if (conCant) return [...sel].map((id) => ({ presentacion_id: id, cantidad_requerida: cant.get(id) || 1 }));
      return [...sel];
    },
  };
}

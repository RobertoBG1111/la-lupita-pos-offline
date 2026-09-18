// ── Pantalla: Configuración (solo admin) ────────────────────────────────────
// Edita la configuración de la tienda (negocio, apariencia, envases, ticket,
// reglas) y la guarda en la tabla `configuracion` de Supabase. Es la base para
// comercializar el POS: cada tienda ajusta lo suyo sin tocar código.
import { h, limpiar, exito, falla } from "../lib/ui.js";
import { getConfig, fijarConfig, aplicarTema } from "../lib/config-runtime.js";
import { guardarConfig } from "../lib/datos.js";
import { montarUsuarios } from "./usuarios.js";

const clon = (x) => JSON.parse(JSON.stringify(x));
const slug = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "tipo";

// Helpers de formulario ------------------------------------------------------
const campo = (etiqueta, control) => h("div", { class: "campo", style: "margin-bottom:12px" }, h("label", {}, etiqueta), control);
const inputTxt = (val, oninput, extra = {}) => h("input", { class: "input", value: val ?? "", onInput: (e) => oninput(e.target.value), ...extra });
const inputNum = (val, oninput) => h("input", { class: "input mono", inputmode: "decimal", value: String(val ?? 0), onInput: (e) => oninput(e.target.value) });
const inputColor = (val, oninput) => h("input", { type: "color", value: val || "#000000", onInput: (e) => oninput(e.target.value), style: "width:52px;height:34px;padding:2px;border:none;background:none;cursor:pointer" });
function check(marcado, onchange, texto) {
  const box = h("input", { type: "checkbox", checked: !!marcado, onChange: (e) => onchange(e.target.checked) });
  return h("label", { class: "fila", style: "gap:8px;align-items:center;cursor:pointer;margin:6px 0" }, box, h("span", {}, texto));
}
function selectOpc(valor, opciones, onchange) {
  return h("select", { class: "input", onChange: (e) => onchange(e.target.value) },
    ...opciones.map(([v, t]) => h("option", { value: v, selected: String(v) === String(valor) ? "selected" : false }, t)));
}

export const configuracion = {
  id: "configuracion", etiqueta: "Configuración", titulo: "Configuración", roles: ["admin"], enNav: true,
  render({ contenido }) {
    // Copia de trabajo (no muta el cache hasta Guardar).
    const base = getConfig();
    const work = {
      NEGOCIO: clon(base.NEGOCIO || {}),
      APARIENCIA: clon(base.APARIENCIA || {}),
      ENVASES: clon(base.ENVASES || []),
      TICKET: clon(base.TICKET || { mostrar: {} }),
      REGLAS: clon(base.REGLAS || { metodos_pago: [] }),
    };
    if (!work.TICKET.mostrar) work.TICKET.mostrar = {};
    if (!Array.isArray(work.REGLAS.metodos_pago)) work.REGLAS.metodos_pago = [];

    const cuerpo = h("div", { class: "glass card", style: "max-width:760px" });
    const SECCIONES = [
      ["negocio", "Negocio", pintarNegocio],
      ["apariencia", "Apariencia", pintarApariencia],
      ["envases", "Envases", pintarEnvases],
      ["ticket", "Ticket", pintarTicket],
      ["reglas", "Reglas", pintarReglas],
      ["usuarios", "Usuarios", (c) => montarUsuarios(c)],
    ];
    let activa = "negocio";

    const tabs = h("div", { class: "segmented", style: "flex-wrap:wrap;margin-bottom:18px" },
      ...SECCIONES.map(([id, txt]) => h("button", { class: "seg" + (id === activa ? " activo" : ""), dataset: { tab: id },
        onClick: () => { activa = id; sincronizarTabs(); sincronizarFooter(); render(); } }, txt)));
    function sincronizarTabs() { [...tabs.children].forEach((b) => b.classList.toggle("activo", b.dataset.tab === activa)); }
    // La pestaña Usuarios se guarda al instante (sus propios botones), así que ahí
    // no aplica el botón "Guardar cambios" de la configuración: se oculta.
    function sincronizarFooter() { footer.style.display = activa === "usuarios" ? "none" : ""; }

    function render() {
      const fn = SECCIONES.find(([id]) => id === activa)[2];
      limpiar(cuerpo); fn(cuerpo);
    }

    // ── Secciones ─────────────────────────────────────────────────────────────
    function pintarNegocio(c) {
      const N = work.NEGOCIO;
      c.append(
        h("h3", { style: "margin-bottom:14px" }, "Identidad del negocio"),
        campo("Nombre", inputTxt(N.nombre, (v) => N.nombre = v)),
        campo("Sucursal", inputTxt(N.sucursal, (v) => N.sucursal = v)),
        campo("Lugar", inputTxt(N.lugar, (v) => N.lugar = v)),
        campo("Logo (ruta o URL)", inputTxt(N.logo, (v) => N.logo = v)),
        campo("Pie de ticket", inputTxt(N.pieTicket, (v) => N.pieTicket = v)),
      );
    }

    function pintarApariencia(c) {
      const A = work.APARIENCIA;
      const fila = (etiqueta, clave) => h("div", { class: "fila entre", style: "margin:8px 0;align-items:center" },
        h("span", {}, etiqueta), inputColor(A[clave], (v) => { A[clave] = v; aplicarTema({ APARIENCIA: A }); }));
      c.append(
        h("h3", { style: "margin-bottom:6px" }, "Colores"),
        h("p", { class: "tenue", style: "font-size:13px;margin:0 0 14px" }, "Los cambios se ven al instante. Se guardan al presionar Guardar."),
        fila("Acento (botones)", "acento"),
        fila("Fondo general", "fondo"),
        h("hr", { style: "border:none;border-top:1px solid var(--borde);margin:14px 0" }),
        h("p", { class: "tenue", style: "font-size:13px;margin:0 0 6px" }, "Color de la línea en Venta según su estado:"),
        fila("Con promoción", "linea_promo"),
        fila("Parte de un combo", "linea_combo"),
        fila("Agotado", "linea_agotado"),
        fila("Stock bajo", "linea_bajo"),
      );
    }

    function pintarEnvases(c) {
      c.append(
        h("h3", { style: "margin-bottom:6px" }, "Envases retornables"),
        h("p", { class: "tenue", style: "font-size:13px;margin:0 0 14px" }, "Tipos de envase con depósito. Cada producto retornable (en Inventario) apunta a uno de estos."),
      );
      const lista = h("div", { class: "col", style: "gap:10px" });
      function pintarLista() {
        limpiar(lista);
        work.ENVASES.forEach((t, i) => {
          lista.append(h("div", { class: "fila", style: "gap:10px;align-items:end" },
            h("div", { class: "campo", style: "flex:1;margin:0" }, h("label", {}, "Nombre"), inputTxt(t.nombre, (v) => t.nombre = v)),
            h("div", { class: "campo", style: "width:120px;margin:0" }, h("label", {}, "Depósito $"), inputNum(t.deposito, (v) => t.deposito = parseFloat(v) || 0)),
            h("button", { class: "btn btn-fantasma btn-mini", title: "Quitar", onClick: () => { work.ENVASES.splice(i, 1); pintarLista(); } }, "Quitar"),
          ));
        });
        if (!work.ENVASES.length) lista.append(h("p", { class: "tenue" }, "Sin tipos. Agrega al menos uno si vendes retornables."));
      }
      pintarLista();
      c.append(lista, h("button", { class: "btn btn-fantasma", style: "margin-top:12px",
        onClick: () => { work.ENVASES.push({ clave: "", nombre: "Nuevo envase", deposito: 0 }); pintarLista(); } }, "+ Agregar tipo"));
    }

    function pintarTicket(c) {
      const T = work.TICKET; const M = T.mostrar;
      c.append(
        h("h3", { style: "margin-bottom:14px" }, "Ticket"),
        campo("Ancho de impresión", selectOpc(T.ancho || "58", [["58", "58 mm (angosto)"], ["80", "80 mm (ancho)"]], (v) => T.ancho = v)),
        h("p", { class: "tenue", style: "font-size:13px;margin:6px 0" }, "Mostrar en el ticket:"),
        check(M.folio !== false, (v) => M.folio = v, "Folio"),
        check(M.hora !== false, (v) => M.hora = v, "Fecha y hora"),
        check(M.cajero !== false, (v) => M.cajero = v, "Quién atendió (cajero)"),
        check(M.deposito !== false, (v) => M.deposito = v, "Depósito de envases"),
        h("hr", { style: "border:none;border-top:1px solid var(--borde);margin:14px 0" }),
        campo("Mensaje de agradecimiento", inputTxt(T.agradecimiento, (v) => T.agradecimiento = v)),
        campo("Pie de página", inputTxt(T.pie, (v) => T.pie = v)),
      );
    }

    function pintarReglas(c) {
      const R = work.REGLAS;
      c.append(h("h3", { style: "margin-bottom:6px" }, "Métodos de pago"));
      const lista = h("div", { class: "col", style: "gap:8px" });
      function pintarMetodos() {
        limpiar(lista);
        R.metodos_pago.forEach((m, i) => {
          lista.append(h("div", { class: "fila", style: "gap:10px;align-items:center" },
            h("input", { type: "checkbox", checked: m.activo !== false, onChange: (e) => m.activo = e.target.checked }),
            inputTxt(m.etiqueta, (v) => m.etiqueta = v, { style: "flex:1" }),
            h("span", { class: "tenue mono", style: "font-size:12px;min-width:90px" }, m.id),
            m.id === "efectivo" ? null : h("button", { class: "btn btn-fantasma btn-mini", onClick: () => { R.metodos_pago.splice(i, 1); pintarMetodos(); } }, "Quitar"),
          ));
        });
      }
      pintarMetodos();
      c.append(lista, h("button", { class: "btn btn-fantasma", style: "margin:10px 0 4px",
        onClick: () => { R.metodos_pago.push({ id: "metodo_" + (R.metodos_pago.length + 1), etiqueta: "Nuevo método", activo: true }); pintarMetodos(); } }, "+ Agregar método"),
        h("hr", { style: "border:none;border-top:1px solid var(--borde);margin:16px 0" }),
        campo("Redondeo del efectivo sugerido", selectOpc(R.redondeo ?? 0, [[0, "Sin redondeo"], [0.5, "A $0.50"], [1, "A $1"]], (v) => R.redondeo = parseFloat(v))),
        campo("Empaques (six/cartón) al escanear una pieza", selectOpc(R.empaques || "preguntar", [["preguntar", "Preguntar (pieza o six)"], ["auto", "Automático (juntar 6 = six)"]], (v) => R.empaques = v)),
        campo("¿Quién puede hacer devoluciones/cancelaciones?", selectOpc(R.devoluciones_rol || "admin", [["admin", "Solo administrador"], ["cajero", "Administrador y cajero"]], (v) => R.devoluciones_rol = v)),
        check(R.permitir_generico !== false, (v) => R.permitir_generico = v, "Permitir venta libre (código 0)"),
      );
    }

    // ── Guardar / descartar ────────────────────────────────────────────────────
    const btnGuardar = h("button", { class: "btn btn-primario", onClick: guardar }, "Guardar cambios");
    async function guardar() {
      // Asigna clave a los envases nuevos (estable, única).
      const usadas = new Set();
      for (const t of work.ENVASES) {
        if (!t.clave) t.clave = slug(t.nombre);
        let k = t.clave, n = 2;
        while (usadas.has(k)) { k = t.clave + "_" + n++; }
        t.clave = k; usadas.add(k);
        t.deposito = Number(t.deposito) || 0;
      }
      // Asigna id a métodos nuevos.
      const ids = new Set();
      for (const m of work.REGLAS.metodos_pago) {
        if (!m.id || m.id.startsWith("metodo_")) m.id = slug(m.etiqueta);
        let k = m.id, n = 2; while (ids.has(k)) { k = m.id + "_" + n++; }
        m.id = k; ids.add(k);
      }
      btnGuardar.disabled = true; btnGuardar.textContent = "Guardando…";
      try {
        await guardarConfig(clon(work));
        fijarConfig(clon(work));
        aplicarTema();
        exito("Configuración guardada.");
      } catch (e) {
        console.error(e);
        falla("No se pudo guardar: " + (e.message || "error"));
      } finally {
        btnGuardar.disabled = false; btnGuardar.textContent = "Guardar cambios";
      }
    }
    function descartar() { aplicarTema(getConfig()); render(); exito("Cambios descartados."); }

    const footer = h("div", { class: "fila", style: "gap:10px;margin-top:18px;max-width:760px;justify-content:flex-end" },
      h("button", { class: "btn btn-fantasma", onClick: descartar }, "Descartar"),
      btnGuardar);

    limpiar(contenido).append(
      h("div", { class: "titulo-seccion" }, h("div", {}, h("h2", {}, "Configuración"),
        h("p", {}, "Ajustes de la tienda: identidad, colores, envases, ticket, reglas y usuarios."))),
      tabs,
      cuerpo,
      footer,
    );
    render();
    sincronizarFooter();
  },
};

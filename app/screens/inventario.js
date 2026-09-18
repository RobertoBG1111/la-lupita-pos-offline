// ── Pantalla: Inventario ────────────────────────────────────────────────────
import { h, limpiar, dinero, fechaCorta, exito, falla, modal, confirmar } from "../lib/ui.js";
import { inventario as cargarInventario, lotesDe, crearProducto, registrarMovimiento, ultimosMovimientos,
  categoriasConocidas, actualizarProducto, actualizarPresentacion, agregarPresentacion, eliminarProductos } from "../lib/datos.js";
import { esAdmin } from "../lib/auth.js";
import { montarEscaner } from "../lib/escaner.js";
import { getConfig } from "../lib/config-runtime.js";

// Opciones de tipo de envase retornable (desde la configuración de la tienda).
function opcionesTipoEnvase() {
  const tipos = getConfig().ENVASES || [];
  if (!tipos.length) return [h("option", { value: "" }, "— sin tipos configurados —")];
  return tipos.map((t) => h("option", { value: t.clave }, `${t.nombre} ($${Number(t.deposito) || 0})`));
}

const ESTADO_LOTE = { vencido: "chip-peligro", por_vencer: "chip-adv", vigente: "chip-ok" };
let ordenInv = "nombre_az"; // orden de la lista de inventario (se conserva entre re-renders)
let carpetasAbiertas = new Set(); // categorías abiertas (persisten entre repintados); por defecto TODAS cerradas

export const inventario = {
  id: "inventario", etiqueta: "Inventario", titulo: "Inventario", roles: ["admin", "cajero"], enNav: true,
  async render({ contenido }) {
    const admin = esAdmin();
    limpiar(contenido).append(h("div", { class: "cargando" }, "Cargando inventario…"));

    let data;
    try { data = await cargarInventario(); }
    catch (e) { console.error(e); limpiar(contenido).append(h("div", { class: "cargando" }, "No se pudo cargar el inventario.")); return; }
    const cats = admin ? await categoriasConocidas().catch(() => []) : [];

    let presPorProd, lotesPorProd, prodPorId;
    function indexar() {
      presPorProd = new Map();
      for (const pr of data.presentaciones) {
        if (!presPorProd.has(pr.producto_id)) presPorProd.set(pr.producto_id, []);
        presPorProd.get(pr.producto_id).push(pr);
      }
      lotesPorProd = new Map();
      for (const l of data.lotes) {
        if (!lotesPorProd.has(l.producto_id)) lotesPorProd.set(l.producto_id, []);
        lotesPorProd.get(l.producto_id).push(l);
      }
      prodPorId = new Map(data.productos.map((p) => [p.id, p]));
    }
    indexar();

    const rerender = () => inventario.render({ contenido });
    // Refresco EN SITIO tras editar/borrar: re-lee datos y re-pinta alertas y
    // carpetas SIN reconstruir toda la pantalla (conserva scroll, el lateral y qué
    // carpetas están abiertas). Evita el "reinicio" completo al guardar una edición.
    async function refrescar() {
      const cont = document.scrollingElement || document.documentElement;
      const y = cont.scrollTop;
      try { data = await cargarInventario(); indexar(); }
      catch (e) { console.error(e); return; }
      for (const id of [...seleccion]) if (!prodPorId.has(id)) seleccion.delete(id); // limpia ids borrados
      pintarAlertas(); pintarFolders(); if (admin) actualizarBarra();
      cont.scrollTop = y;
    }

    // Selección para borrado múltiple (solo admin). Se conserva entre re-pintados
    // de folders (cambio de orden); un rerender completo la limpia.
    const seleccion = new Set();

    // ── Columna principal: alertas + tabla ────────────────────────────────────
    const principal = h("div", { class: "inv-main" });

    // Alertas (se repintan tras un refresco). El aviso de stock bajo es compacto:
    // un botón que abre un modal con la lista, en vez de una lista enorme siempre visible.
    const alertasBox = h("div", { class: "inv-alertas" });
    function pintarAlertas() {
      limpiar(alertasBox);
      const lotesAlerta = data.lotes.filter((l) => l.estado !== "vigente");
      const bajos = data.productos.filter((p) => p.activo && Number(p.stock_actual) <= Number(p.stock_minimo));
      if (lotesAlerta.length) {
        alertasBox.append(h("div", { class: "glass card alerta alerta-venc" },
          h("h3", {}, "⏳ Lotes por vencer"),
          h("div", { class: "lotes-lista" }, ...lotesAlerta.map((l) => h("div", { class: "lote-fila" },
            h("span", { class: "chip " + (ESTADO_LOTE[l.estado] || "chip-tenue") }, l.estado === "vencido" ? "vencido" : "por vencer"),
            h("span", { style: "flex:1;min-width:0" }, `${l.producto} — ${Number(l.cantidad)} pz`),
            h("span", { class: "mono tenue" }, `vence ${fechaCorta(l.fecha_vencimiento)} · ${l.dias_para_vencer} d`),
          ))),
        ));
      }
      if (bajos.length) {
        alertasBox.append(h("button", { class: "aviso-bajo", onClick: () => modalBajos(bajos) },
          h("span", { class: "aviso-bajo-punto" }, "⚠️"),
          h("span", {}, `${bajos.length} artículo(s) bajos de inventario`),
          h("span", { class: "aviso-bajo-cta" }, "ver lista →"),
        ));
      }
    }
    // Modal con la lista de faltantes (se abre al tocar el aviso).
    function modalBajos(bajos) {
      const orden = bajos.slice().sort((a, b) => Number(a.stock_actual) - Number(b.stock_actual) || a.nombre.localeCompare(b.nombre));
      modal((caja, cerrar) => {
        caja.append(
          h("h3", {}, `⚠️ Artículos bajos de inventario (${orden.length})`),
          h("p", { class: "tenue", style: "margin:4px 0 12px;font-size:12px" }, "Existencia igual o por debajo del mínimo. Ordenados de menor a mayor."),
          h("div", { style: "max-height:60vh;overflow:auto" },
            h("table", { class: "tabla" },
              h("thead", {}, h("tr", {}, h("th", {}, "Producto"), h("th", {}, "Categoría"), h("th", { class: "num" }, "Existencia"), h("th", { class: "num" }, "Mínimo"))),
              h("tbody", {}, ...orden.map((p) => h("tr", {},
                h("td", {}, p.nombre),
                h("td", { class: "tenue" }, p.categoria || "—"),
                h("td", { class: "num mono" }, String(Number(p.stock_actual))),
                h("td", { class: "num mono tenue" }, String(Number(p.stock_minimo))),
              ))),
            ),
          ),
          h("div", { class: "fila", style: "justify-content:flex-end;margin-top:14px" },
            h("button", { class: "btn btn-primario", onClick: cerrar }, "Cerrar")),
        );
      }, { ancho: 560 });
    }

    // ── Productos agrupados por categoría (carpetas), con orden configurable ──
    function precioPieza(p) {
      const pres = presPorProd.get(p.id) || [];
      const base = pres.find((x) => Number(x.factor_conversion) === 1) || pres[0];
      return base ? Number(base.precio) : 0;
    }
    function ordenar(arr) {
      const a = arr.slice();
      switch (ordenInv) {
        case "nombre_za": return a.sort((x, y) => y.nombre.localeCompare(x.nombre));
        case "precio_asc": return a.sort((x, y) => precioPieza(x) - precioPieza(y));
        case "precio_desc": return a.sort((x, y) => precioPieza(y) - precioPieza(x));
        case "stock_asc": return a.sort((x, y) => Number(x.stock_actual) - Number(y.stock_actual));
        case "stock_desc": return a.sort((x, y) => Number(y.stock_actual) - Number(x.stock_actual));
        default: return a.sort((x, y) => x.nombre.localeCompare(y.nombre));
      }
    }

    // ── Barra de selección para borrado múltiple (solo admin) ─────────────────
    const conteoSel = h("strong", {});
    const barraSel = admin ? h("div", { class: "glass card", style: "display:none;position:sticky;top:8px;z-index:5;padding:12px 14px" },
      h("div", { class: "fila entre", style: "flex-wrap:wrap;gap:10px" },
        conteoSel,
        h("div", { class: "fila", style: "gap:8px" },
          h("button", { class: "btn btn-fantasma btn-mini", onClick: () => { seleccion.clear(); pintarFolders(); actualizarBarra(); } }, "Limpiar"),
          h("button", { class: "btn btn-peligro btn-mini", onClick: () => eliminarSeleccion() }, "Eliminar seleccionados"),
        ),
      )) : h("span", { style: "display:none" });
    function actualizarBarra() {
      if (!admin) return;
      const n = seleccion.size;
      barraSel.style.display = n ? "block" : "none";
      conteoSel.textContent = `${n} producto(s) seleccionado(s)`;
    }
    // Casillas "seleccionar todo" de cada carpeta: reflejan si están todos/algunos.
    let cabecerasSel = [];
    function sincronizarCabeceras() {
      for (const { cb, ids } of cabecerasSel) {
        const sel = ids.filter((id) => seleccion.has(id)).length;
        cb.checked = sel === ids.length && ids.length > 0;
        cb.indeterminate = sel > 0 && sel < ids.length;
      }
    }
    function eliminarSeleccion() {
      const prods = [...seleccion].map((id) => prodPorId.get(id)).filter(Boolean);
      if (prods.length) eliminarProductosUI(prods, refrescar);
    }

    function filaProducto(p) {
      const pres = presPorProd.get(p.id) || [];
      const codigos = pres.map((x) => x.codigo_barras).filter(Boolean);
      const bajo = Number(p.stock_actual) <= Number(p.stock_minimo);
      const tieneLoteAlerta = (lotesPorProd.get(p.id) || []).some((l) => l.estado !== "vigente");
      let cb = null;
      if (admin) {
        cb = h("input", { type: "checkbox" });
        cb.checked = seleccion.has(p.id);
        cb.addEventListener("change", () => { cb.checked ? seleccion.add(p.id) : seleccion.delete(p.id); actualizarBarra(); sincronizarCabeceras(); });
      }
      return h("tr", { class: p.activo ? "" : "inactivo" },
        admin ? h("td", { class: "num", style: "width:1%" }, cb) : "",
        h("td", {},
          h("div", { class: "fila", style: "gap:8px;flex-wrap:wrap" },
            h("strong", {}, p.nombre),
            p.lleva_vencimiento ? h("span", { class: "chip chip-tenue", title: "Lleva control de vencimiento" }, "lotes") : null,
            p.retornable ? h("span", { class: "chip chip-tenue", title: "Envase retornable" }, "envase") : null,
            tieneLoteAlerta ? h("span", { title: "Tiene lotes por vencer" }, "⏳") : null,
            !p.activo ? h("span", { class: "chip chip-tenue" }, "inactivo") : null,
          ),
          h("small", { class: "tenue" }, pres.map((x) => `${x.nombre} ${dinero(x.precio)}`).join(" · ")),
        ),
        h("td", { class: "mono" }, codigos.length ? codigos.join(", ") : "—"),
        h("td", { class: "num mono" }, `${Number(p.stock_actual)} ${p.unidad_base}`),
        h("td", {}, h("span", { class: "chip " + (bajo ? "chip-adv" : "chip-ok") }, bajo ? "bajo" : "ok")),
        admin ? h("td", { class: "num" }, h("div", { class: "fila", style: "gap:6px;justify-content:flex-end" },
          h("button", { class: "btn btn-mini", onClick: () => editarProductoModal(p, presPorProd.get(p.id) || [], cats, refrescar) }, "Editar"),
          h("button", { class: "btn btn-mini btn-peligro", title: "Eliminar producto", onClick: () => eliminarProductosUI([p], refrescar) }, "🗑"),
        )) : "",
      );
    }

    const ordenSel = h("select", { class: "select", style: "max-width:200px" },
      h("option", { value: "nombre_az" }, "Nombre A–Z"),
      h("option", { value: "nombre_za" }, "Nombre Z–A"),
      h("option", { value: "precio_asc" }, "Precio ↑"),
      h("option", { value: "precio_desc" }, "Precio ↓"),
      h("option", { value: "stock_asc" }, "Existencia ↑"),
      h("option", { value: "stock_desc" }, "Existencia ↓"),
    );
    ordenSel.value = ordenInv;
    ordenSel.addEventListener("change", () => { ordenInv = ordenSel.value; pintarFolders(); });

    const foldersBox = h("div", { class: "inv-carpetas", style: "display:flex;flex-direction:column;gap:var(--sp-3)" });
    function pintarFolders() {
      limpiar(foldersBox);
      if (!data.productos.length) {
        foldersBox.append(h("div", { class: "glass card tenue centrado", style: "padding:28px" }, "No hay productos. Da de alta el catálogo real →"));
        return;
      }
      cabecerasSel = [];
      const porCat = new Map();
      for (const p of data.productos) { const c = p.categoria || "Sin categoría"; if (!porCat.has(c)) porCat.set(c, []); porCat.get(c).push(p); }
      const cats2 = [...porCat.keys()].sort((a, b) => a.localeCompare(b));
      for (const c of cats2) {
        const prods = ordenar(porCat.get(c));
        const bajos2 = prods.filter((p) => p.activo && Number(p.stock_actual) <= Number(p.stock_minimo)).length;
        // Casilla de cabecera: selecciona/deselecciona todos los de la carpeta.
        let cabCb = null;
        if (admin) {
          const ids = prods.map((p) => p.id);
          cabCb = h("input", { type: "checkbox", title: "Seleccionar todos de esta categoría" });
          cabCb.addEventListener("change", () => { ids.forEach((id) => cabCb.checked ? seleccion.add(id) : seleccion.delete(id)); pintarFolders(); actualizarBarra(); });
          cabecerasSel.push({ cb: cabCb, ids });
        }
        const det = h("details", { class: "glass card inv-carpeta", open: carpetasAbiertas.has(c), style: "overflow-x:auto" },
          h("summary", { style: "cursor:pointer;font-weight:600;font-size:15px;padding:2px 0" },
            `📁 ${c}  `, h("span", { class: "chip chip-tenue", style: "margin-left:4px" }, `${prods.length}`),
            bajos2 ? h("span", { class: "chip chip-adv", style: "margin-left:6px" }, `${bajos2} bajo`) : null),
          h("table", { class: "tabla", style: "margin-top:10px" },
            h("thead", {}, h("tr", {}, admin ? h("th", { class: "num", style: "width:1%" }, cabCb) : "", h("th", {}, "Producto"), h("th", {}, "Códigos"), h("th", { class: "num" }, "Existencia"), h("th", {}, "Estado"), admin ? h("th", {}, "") : "")),
            h("tbody", {}, ...prods.map(filaProducto)),
          ),
        );
        // Recordar qué carpetas deja abiertas el usuario (persisten entre repintados).
        det.addEventListener("toggle", () => { det.open ? carpetasAbiertas.add(c) : carpetasAbiertas.delete(c); });
        foldersBox.append(det);
      }
      sincronizarCabeceras();
    }

    principal.append(
      alertasBox,
      h("div", { class: "fila entre", style: "margin-bottom:12px;flex-wrap:wrap;gap:10px;align-items:flex-end" },
        h("span", { class: "tenue" }, `${data.productos.length} producto(s) · ${new Set(data.productos.map((p) => p.categoria || "Sin categoría")).size} categoría(s)`),
        h("div", { class: "campo", style: "margin:0" }, h("label", { style: "font-size:11px" }, "Ordenar por"), ordenSel),
      ),
      barraSel,
      foldersBox,
    );
    pintarAlertas();
    pintarFolders();

    // ── Columna lateral: formularios (solo admin) ─────────────────────────────
    const lateral = h("aside", { class: "inv-lateral" });
    if (!admin) {
      lateral.append(h("div", { class: "glass card" },
        h("span", { class: "chip chip-tenue" }, "SOLO LECTURA"),
        h("p", { class: "tenue", style: "margin:10px 0 0;line-height:1.5" },
          "Consulta de existencias para caja. El alta de productos, los precios y los movimientos de inventario los realiza el administrador."),
      ));
    } else {
      const alta = formAltaProducto(cats, rerender);
      const mov = formMovimiento(data.productos, rerender);

      // ── Buscador de productos por nombre (info completa + editar rápido) ─────
      // Funciona como el del carrito: escribe, navega con ↑ ↓ y Enter abre el
      // artículo para editarlo. Cada resultado muestra existencia, y por cada
      // presentación su precio y costo (el costo es interno, solo admin).
      const buscarInp = h("input", { class: "input", type: "search", autocomplete: "off", placeholder: "Buscar producto por nombre…" });
      const resBox = h("div", { class: "inv-res", hidden: true });
      let resItems = [], resActivo = -1, ultimaQuery = "";
      const normb = (s) => (s || "").toString().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

      function abrirEdicion(p) {
        editarProductoModal(p, presPorProd.get(p.id) || [], cats, async () => { await refrescar(); reejecutar(); });
      }
      function reejecutar() { renderRes(ultimaQuery); }
      function marcar() { [...resBox.querySelectorAll(".inv-res-item")].forEach((el, i) => el.classList.toggle("activo", i === resActivo)); }
      function scrollActivo() { resBox.querySelectorAll(".inv-res-item")[resActivo]?.scrollIntoView({ block: "nearest" }); }

      function filaRes(x, i) {
        const p = x.p;
        const bajo = Number(p.stock_actual) <= Number(p.stock_minimo);
        return h("div", { class: "inv-res-item" + (p.activo ? "" : " inactivo") + (i === resActivo ? " activo" : ""), dataset: { i: String(i) },
          onMouseenter: () => { resActivo = i; marcar(); },
          onClick: () => abrirEdicion(p) },
          h("div", { class: "col", style: "flex:1;min-width:0;gap:2px" },
            h("strong", { class: "prod-nom" }, p.nombre),
            h("small", { class: "tenue" }, `${p.categoria || "—"}${p.activo ? "" : " · inactivo"}`)),
          h("span", { class: "chip " + (bajo ? "chip-adv" : "chip-ok"), title: "Existencia" }, `${Number(p.stock_actual)} ${p.unidad_base || ""}`),
          h("div", { class: "iri-cifras" }, ...x.pres.map((pr) => h("div", { class: "iri-cifra" },
            h("small", {}, pr.nombre),
            h("span", { class: "mono" }, dinero(pr.precio)),
            h("span", { class: "mono tenue iri-costo" }, "costo " + dinero(pr.costo))))),
          h("button", { class: "btn btn-mini", onClick: (e) => { e.stopPropagation(); abrirEdicion(p); } }, "Editar"),
        );
      }

      function renderRes(term) {
        ultimaQuery = term;
        const q = normb(term).trim();
        if (!q) { resBox.hidden = true; limpiar(resBox); resItems = []; resActivo = -1; return; }
        const hits = data.productos.map((p) => {
          const pres = presPorProd.get(p.id) || [];
          const codes = pres.map((x) => x.codigo_barras).filter(Boolean).join(" ");
          return { p, pres, texto: normb(`${p.nombre} ${p.categoria || ""} ${codes}`), nombre: normb(p.nombre) };
        }).filter((x) => x.texto.includes(q));
        hits.sort((a, b) => (b.nombre.startsWith(q) - a.nombre.startsWith(q)) || a.nombre.localeCompare(b.nombre));
        resItems = hits.slice(0, 12);
        resActivo = resItems.length ? 0 : -1;
        limpiar(resBox);
        if (!resItems.length) { resBox.append(h("p", { class: "tenue", style: "padding:12px" }, "Sin resultados.")); resBox.hidden = false; return; }
        resItems.forEach((x, i) => resBox.append(filaRes(x, i)));
        resBox.hidden = false;
      }

      buscarInp.addEventListener("input", () => renderRes(buscarInp.value));
      buscarInp.addEventListener("keydown", (e) => {
        if (resBox.hidden || !resItems.length) { if (e.key === "Escape") { buscarInp.value = ""; renderRes(""); } return; }
        if (e.key === "ArrowDown") { e.preventDefault(); resActivo = (resActivo + 1) % resItems.length; marcar(); scrollActivo(); }
        else if (e.key === "ArrowUp") { e.preventDefault(); resActivo = (resActivo - 1 + resItems.length) % resItems.length; marcar(); scrollActivo(); }
        else if (e.key === "Enter") { e.preventDefault(); const x = resItems[resActivo]; if (x) abrirEdicion(x.p); }
        else if (e.key === "Escape") { e.preventDefault(); buscarInp.value = ""; renderRes(""); }
      });

      const buscadorCard = h("div", { class: "glass card inv-buscar-card" },
        h("h3", { style: "margin-bottom:6px" }, "🔎 Buscar producto"),
        h("p", { class: "tenue", style: "margin:0 0 10px;font-size:12px;line-height:1.5" },
          "Escribe el nombre y usa ↑ ↓ + Enter (como en el carrito) para abrir y editar el artículo. Muestra existencia, precio y costo de cada presentación."),
        buscarInp, resBox);
      principal.prepend(buscadorCard);

      // Mapa código de barras → producto (de todas las presentaciones con código).
      const codigoAProducto = new Map();
      for (const pr of data.presentaciones) {
        if (pr.codigo_barras) codigoAProducto.set(String(pr.codigo_barras).trim(), pr.producto_id);
      }

      // Enruta un código escaneado o tecleado: si YA existe → salta al movimiento
      // con el producto puesto y el cursor en la cantidad; si es NUEVO → prepara el
      // alta con el código escrito y el cursor en el nombre.
      function enrutarCodigo(code) {
        code = String(code || "").trim();
        if (!code) return;
        const prodId = codigoAProducto.get(code);
        if (prodId) {
          const p = data.productos.find((x) => x.id === prodId);
          if (p && !p.activo) { falla(`"${p.nombre}" está inactivo. Actívalo para moverlo.`); return; }
          if (!mov.seleccionar(prodId)) { falla("Ese producto no está disponible para movimiento."); return; }
          mov.node.scrollIntoView({ behavior: "smooth", block: "center" });
          mov.enfocarCantidad();
          exito(`${p?.nombre ?? "Producto"} — captura la cantidad y registra`);
        } else {
          alta.ponerCodigo(code);
          alta.node.scrollIntoView({ behavior: "smooth", block: "center" });
          exito("Código nuevo — captura nombre y precio");
        }
      }

      const scanInput = h("input", { class: "input mono", autocomplete: "off", placeholder: "Escanea o teclea el código y Enter…" });
      scanInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); const v = scanInput.value; scanInput.value = ""; enrutarCodigo(v); } });
      const scanCard = h("div", { class: "glass card" },
        h("h3", { style: "margin-bottom:6px" }, "Escanear producto"),
        h("p", { class: "tenue", style: "margin:0 0 10px;font-size:12px;line-height:1.5" },
          "Pasa el lector por el código de barras. Si el artículo ya existe, te lleva al movimiento con el producto puesto; si es nuevo, prepara el alta con el código ya escrito."),
        scanInput,
      );

      // Un solo detector de lector (USB = teclado) para toda la pantalla: si el
      // foco está en un campo de código del alta, el código cae ahí; si hay un
      // modal abierto, lo maneja el modal; si no, se enruta solo.
      montarEscaner({
        vivo: () => document.body.contains(scanCard),
        onCodigo: (code) => {
          if (document.querySelector(".modal-fondo")) return; // el modal de edición tiene su propio escaneo
          const el = document.activeElement;
          if (alta.codigoInputs.includes(el)) { el.value = String(code || "").trim(); exito("Código capturado: " + code); return; }
          enrutarCodigo(code);
        },
      });

      lateral.append(scanCard, alta.node, mov.node);
      ultimosMovimientos().then((movs) => {
        lateral.append(h("div", { class: "glass card" },
          h("h3", { style: "margin-bottom:10px" }, "Últimos movimientos"),
          h("div", { class: "movs-lista" }, ...(movs.length ? movs.map((m) => h("div", { class: "mov-fila" },
            h("span", { class: "chip " + (m.tipo === "entrada" ? "chip-ok" : m.tipo === "venta" ? "chip-tenue" : "chip-adv") }, m.tipo),
            h("span", { style: "flex:1;min-width:0", class: "tenue" }, m.productos?.nombre ?? "—"),
            h("span", { class: "mono" }, (Number(m.cantidad) > 0 ? "+" : "") + Number(m.cantidad)),
          )) : [h("p", { class: "tenue" }, "Sin movimientos aún.")]))));
      }).catch(() => {});
    }

    limpiar(contenido).append(
      h("div", { class: "titulo-seccion" }, h("div", {}, h("h2", {}, "Inventario"),
        h("p", {}, admin ? "Existencias, alertas y alta de catálogo." : "Existencias y alertas (solo lectura)."))),
      h("div", { class: "inv-grid" }, principal, lateral),
    );
  },
};

// ── Formulario: Alta de producto ─────────────────────────────────────────────
function formAltaProducto(cats, onSaved) {
  const nombre = inp("Victoria Tamarindo 355ml");
  const cat = campoCategoria(cats);
  const stockMin = inp("12", "numeric");
  const stockIni = inp("0", "numeric");
  const piezaPrecio = inp("26", "decimal");
  const piezaCosto = inp("0", "decimal");
  const piezaCodigo = inp("7501…");
  // six (opcional)
  const sixOn = chk();
  const sixPrecio = inp("145", "decimal"); const sixCosto = inp("0", "decimal"); const sixCodigo = inp("7501…");
  const sixBox = h("div", { class: "sub-campos oculto" },
    campo("Precio six", sixPrecio), campo("Costo six", sixCosto), campo("Código six", sixCodigo));
  sixOn.addEventListener("change", () => { sixBox.classList.toggle("oculto", !sixOn.checked); if (sixOn.checked) recalcCostos(); });
  // paquete (opcional — por defecto APAGADO: muchos artículos se venden solo por pieza)
  const paqOn = chk(false);
  const paqNombre = inp("cartón"); const paqFactor = inp("24", "numeric");
  const paqPrecio = inp("290", "decimal"); const paqCosto = inp("0", "decimal"); const paqCodigo = inp("7501…");
  const paqBox = h("div", { class: "sub-campos oculto" },
    campo("Nombre del paquete", paqNombre), campo("Piezas por paquete", paqFactor),
    campo("Precio paquete", paqPrecio), campo("Costo paquete", paqCosto), campo("Código paquete", paqCodigo));
  paqOn.addEventListener("change", () => { paqBox.classList.toggle("oculto", !paqOn.checked); if (paqOn.checked) recalcCostos(); });

  // Costo automático: six/cartón = costo unitario × piezas. Editable: si escribes
  // el costo a mano, deja de autocalcularse para ese campo.
  let sixCostoAuto = true, paqCostoAuto = true;
  sixCosto.addEventListener("input", () => { sixCostoAuto = false; });
  paqCosto.addEventListener("input", () => { paqCostoAuto = false; });
  function recalcCostos() {
    const cu = parseFloat(piezaCosto.value);
    if (!Number.isFinite(cu)) return;
    if (sixCostoAuto) sixCosto.value = String(+(cu * 6).toFixed(2));
    const f = parseInt(paqFactor.value, 10);
    if (paqCostoAuto && Number.isFinite(f) && f > 0) paqCosto.value = String(+(cu * f).toFixed(2));
  }
  piezaCosto.addEventListener("input", recalcCostos);
  paqFactor.addEventListener("input", recalcCostos);
  // perecedero
  const perecOn = chk();
  const perecFecha = inp("", "", "date");
  const perecBox = h("div", { class: "sub-campos oculto" }, campo("Vencimiento del lote inicial", perecFecha));
  perecOn.addEventListener("change", () => perecBox.classList.toggle("oculto", !perecOn.checked));
  // envase retornable (opcional)
  const retornOn = chk();
  const tipoEnvase = h("select", { class: "select" }, ...opcionesTipoEnvase());
  const retornBox = h("div", { class: "sub-campos oculto" }, campo("Tipo de envase", tipoEnvase));
  retornOn.addEventListener("change", () => retornBox.classList.toggle("oculto", !retornOn.checked));

  // Campos de código de este formulario. El escáner central (en la pantalla) los
  // usa: si escaneas con uno de estos enfocado, el código cae ahí; si no, el
  // escaneo se enruta solo (alta si es nuevo, movimiento si ya existe).
  const codigoInputs = [piezaCodigo, sixCodigo, paqCodigo];

  const btn = h("button", { class: "btn btn-primario btn-bloque", "data-glow": "1", onClick: guardar }, "Guardar producto");

  async function guardar() {
    const n = nombre.value.trim();
    if (!n) { falla("El nombre es obligatorio."); return; }
    const categoria = cat.valor();
    if (!categoria) { falla("Elige o escribe una categoría."); return; }
    const pp = parseFloat(piezaPrecio.value);
    if (!Number.isFinite(pp) || pp < 0) { falla("Pon un precio de pieza válido."); return; }
    if (perecOn.checked && Number(stockIni.value) > 0 && !perecFecha.value) { falla("Un perecedero con stock inicial necesita la fecha de vencimiento."); return; }

    const presentaciones = [{ nombre: "pieza", factor_conversion: 1, precio: pp, costo: numeroO0(piezaCosto.value), codigo_barras: piezaCodigo.value.trim() || null }];
    if (sixOn.checked) presentaciones.push({ nombre: "six", factor_conversion: 6, precio: numeroO0(sixPrecio.value), costo: numeroO0(sixCosto.value), codigo_barras: sixCodigo.value.trim() || null });
    if (paqOn.checked) {
      const f = parseInt(paqFactor.value, 10);
      presentaciones.push({ nombre: paqNombre.value.trim() || "paquete", factor_conversion: Number.isFinite(f) && f > 0 ? f : 24, precio: numeroO0(paqPrecio.value), costo: numeroO0(paqCosto.value), codigo_barras: paqCodigo.value.trim() || null });
    }
    btn.disabled = true; btn.textContent = "Guardando…";
    try {
      const id = await crearProducto({
        nombre: n, categoria, unidad_base: "pieza",
        stock_minimo: numeroO0(stockMin.value), lleva_vencimiento: perecOn.checked,
        retornable: retornOn.checked, tipo_envase: tipoEnvase.value, presentaciones,
      });
      const ini = numeroO0(stockIni.value);
      if (ini > 0) {
        await registrarMovimiento({ producto_id: id, tipo: "entrada", cantidad: ini, motivo: "Alta de producto",
          fecha_vencimiento: perecOn.checked ? perecFecha.value : null });
      }
      exito(`${n} dado de alta`);
      onSaved();
    } catch (e) { console.error(e); falla("No se pudo guardar: " + (e.message || "error")); btn.disabled = false; btn.textContent = "Guardar producto"; }
  }

  const node = h("div", { class: "glass card" },
    h("h3", {}, "Alta de producto"),
    h("p", { class: "tenue", style: "margin:4px 0 14px;font-size:12px;line-height:1.5" },
      "Empieza con la pieza. El six y el paquete grande son opcionales: actívalos solo si ese artículo se vende así. El costo es interno (solo lo ve el administrador)."),
    h("div", { class: "grid2" },
      campo("Nombre", nombre, "span2"), campo("Categoría", cat, "span2"),
      campo("Precio pieza", piezaPrecio), campo("Costo pieza", piezaCosto),
      campo("Código pieza", piezaCodigo), campo("Stock mínimo (pz)", stockMin),
      campo("Stock inicial (pz)", stockIni, "span2")),
    h("div", { class: "toggles" },
      switchLbl("Se vende también en six (6 piezas, código propio)", sixOn), sixBox,
      switchLbl("Trae paquete grande (cartón/plancha)", paqOn), paqBox,
      switchLbl("Es perecedero / lleva control de vencimiento", perecOn), perecBox,
      switchLbl("Es envase retornable (cobra depósito si faltan vacíos)", retornOn), retornBox),
    btn,
  );

  // Handle imperativo para el escáner central: prellena el código de pieza y deja
  // el cursor en el nombre (lo primero que falta capturar de un producto nuevo).
  return {
    node,
    codigoInputs,
    ponerCodigo(code) { piezaCodigo.value = String(code || "").trim(); nombre.focus(); },
  };
}

// ── Campo de categoría con autocompletado (typeahead) ───────────────────────
// Escribes y va sugiriendo las categorías conocidas (ej. "cor" → "Corona"). Si
// escribes una nueva, se guarda al dar de alta y aparece después en las sugerencias.
let _catListaId = 0;
function campoCategoria(cats, valorActual = "") {
  const id = "cats-" + (++_catListaId);
  const dl = h("datalist", { id });
  for (const c of cats) dl.append(h("option", { value: c }));
  const inp = h("input", { class: "input", list: id, autocomplete: "off",
    placeholder: "Escribe o elige (ej. Corona)", value: valorActual || "" });
  const cont = h("div", {}, inp, dl);
  cont.valor = () => inp.value.trim();
  return cont;
}

// ── Modal: Editar producto (precio, costo, código, categoría, presentaciones) ─
function editarProductoModal(prod, presDelProducto, cats, onSaved) {
  modal((caja, cerrar) => {
    const nombre = inp(""); nombre.value = prod.nombre || "";
    const cat = campoCategoria(cats, prod.categoria || "");
    const stockMin = inp("", "numeric"); stockMin.value = String(prod.stock_minimo ?? 0);
    const activo = chk(prod.activo);
    const retornOn = chk(prod.retornable);
    const tipoEnvase = h("select", { class: "select" }, ...opcionesTipoEnvase());
    if (prod.tipo_envase) tipoEnvase.value = prod.tipo_envase;
    const retornBox = h("div", { class: "sub-campos" + (prod.retornable ? "" : " oculto") }, campo("Tipo de envase", tipoEnvase));
    retornOn.addEventListener("change", () => retornBox.classList.toggle("oculto", !retornOn.checked));

    // Filas de presentaciones existentes
    const filas = presDelProducto.map(filaPresEdit);
    const filasBox = h("div", { class: "col", style: "gap:10px" }, ...filas);

    // Agregar una presentación nueva (opcional)
    const nNombre = inp("six / cartón…"); const nFactor = inp("6", "numeric");
    const nPrecio = inp("0", "decimal"); const nCosto = inp("0", "decimal"); const nCodigo = inp("7501…");
    const nuevaBox = h("div", { class: "sub-campos oculto" },
      h("div", { class: "grid2" },
        campo("Nombre", nNombre), campo("Piezas por unidad", nFactor),
        campo("Precio", nPrecio), campo("Costo", nCosto), campo("Código de barras", nCodigo, "span2")));
    const nuevaOn = chk();
    nuevaOn.addEventListener("change", () => nuevaBox.classList.toggle("oculto", !nuevaOn.checked));

    // Lector de código de barras dentro del modal: el escaneo va al campo de código
    // en el que estés (por defecto, el de la primera presentación).
    const codigoInputs = [...filas.map((f) => f._codigo), nCodigo];
    let codigoActivo = codigoInputs[0] || nCodigo;
    for (const ci of codigoInputs) ci.addEventListener("focus", () => { codigoActivo = ci; });
    montarEscaner({
      onCodigo: (code) => { if (codigoActivo) { codigoActivo.value = code; exito("Código capturado: " + code); } },
      vivo: () => document.body.contains(caja),
    });

    const btn = h("button", { class: "btn btn-primario btn-bloque", "data-glow": "1", onClick: guardar }, "Guardar cambios");

    async function guardar() {
      const n = nombre.value.trim();
      if (!n) { falla("El nombre es obligatorio."); return; }
      const categoria = cat.valor();
      if (!categoria) { falla("Elige o escribe una categoría."); return; }
      btn.disabled = true; btn.textContent = "Guardando…";
      try {
        await actualizarProducto(prod.id, { nombre: n, categoria, stock_minimo: numeroO0(stockMin.value), retornable: retornOn.checked, tipo_envase: tipoEnvase.value, activo: activo.checked });
        for (const f of filas) {
          const d = f._get();
          if (!d.nombre) throw new Error("Cada presentación necesita un nombre.");
          await actualizarPresentacion(d.id, { nombre: d.nombre, precio: d.precio, costo: d.costo, codigo_barras: d.codigo_barras, activo: d.activo });
        }
        if (nuevaOn.checked && nNombre.value.trim()) {
          await agregarPresentacion(prod.id, { nombre: nNombre.value.trim(), factor_conversion: parseInt(nFactor.value, 10) || 1,
            precio: numeroO0(nPrecio.value), costo: numeroO0(nCosto.value), codigo_barras: nCodigo.value.trim() || null });
        }
        exito("Cambios guardados");
        cerrar(); onSaved();
      } catch (e) { console.error(e); falla("No se pudo guardar: " + (e.message || "error")); btn.disabled = false; btn.textContent = "Guardar cambios"; }
    }

    caja.append(
      h("h3", {}, "Editar producto"),
      h("p", { class: "tenue", style: "margin:4px 0 14px;font-size:12px" }, prod.lleva_vencimiento ? "Producto perecedero (con lotes)." : "Producto sin control de vencimiento."),
      h("div", { class: "grid2", style: "margin-bottom:12px" },
        campo("Nombre", nombre, "span2"), campo("Categoría", cat, "span2"), campo("Stock mínimo (pz)", stockMin)),
      switchLbl("Producto activo (visible en Venta)", activo),
      switchLbl("Es envase retornable (cobra depósito si faltan vacíos)", retornOn), retornBox,
      h("label", { style: "display:block;margin:16px 0 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--tinta-tenue)" }, "Presentaciones"),
      filasBox,
      h("div", { style: "margin-top:12px" }, switchLbl("Agregar otra presentación", nuevaOn), nuevaBox),
      h("div", { class: "fila entre", style: "margin-top:18px" },
        h("button", { class: "btn btn-peligro", onClick: () => { cerrar(); eliminarProductosUI([prod], onSaved); } }, "Eliminar producto"),
        h("div", { class: "fila", style: "gap:8px" },
          h("button", { class: "btn btn-fantasma", onClick: cerrar }, "Cancelar"), btn)),
    );
  }, { ancho: 620 });
}

// Una fila editable de presentación dentro del modal de edición.
function filaPresEdit(pr) {
  const nombre = inp(""); nombre.value = pr.nombre || "";
  const precio = inp("", "decimal"); precio.value = String(pr.precio ?? "");
  const costo = inp("", "decimal"); costo.value = String(pr.costo ?? "");
  const codigo = inp(""); codigo.value = pr.codigo_barras || "";
  const activo = chk(pr.activo);
  const fila = h("div", { class: "glass", style: "padding:12px;border-radius:12px" },
    h("div", { class: "fila entre" },
      h("strong", {}, pr.nombre),
      switchLbl("activa", activo)),
    h("small", { class: "tenue mono" }, `factor: ${Number(pr.factor_conversion)} pz`),
    h("div", { class: "grid2", style: "margin-top:8px" },
      campo("Nombre", nombre), campo("Código de barras", codigo),
      campo("Precio", precio), campo("Costo", costo)),
  );
  fila._get = () => ({ id: pr.id, nombre: nombre.value.trim(), precio: precio.value, costo: costo.value, codigo_barras: codigo.value.trim() || null, activo: activo.checked });
  fila._codigo = codigo; // para dirigir el escaneo a este campo
  return fila;
}

// ── Formulario: Movimiento manual ────────────────────────────────────────────
function formMovimiento(productos, onSaved) {
  const activos = productos.filter((p) => p.activo);
  const sel = h("select", { class: "select" }, ...activos.map((p) => h("option", { value: p.id }, p.nombre)));
  const cantidad = inp("24", "numeric");
  const motivo = inp("Compra a proveedor / botella rota");
  let tipo = "entrada";
  const tipos = ["entrada", "merma", "ajuste"];
  const btnsTipo = tipos.map((t) => h("button", { class: "seg" + (t === tipo ? " activo" : ""), onClick: () => { tipo = t; pintarSeg(); actualizarCond(); } }, t));
  const segRow = h("div", { class: "segmented" }, ...btnsTipo);
  function pintarSeg() { btnsTipo.forEach((b, i) => b.classList.toggle("activo", tipos[i] === tipo)); }

  const AYUDA_TIPO = {
    entrada: "Suma al inventario (compra o resurtido).",
    merma: "Resta del inventario (rotura, caducidad, robo).",
    ajuste: "Sobrescribe: escribe la existencia REAL contada y el stock queda en ese número.",
  };
  const ayudaTipo = h("small", { class: "tenue", style: "display:block;margin-top:6px" }, AYUDA_TIPO[tipo]);
  const labelCantidad = h("label", {}, "Cantidad en piezas");

  const fecha = inp("", "", "date");
  const fechaBox = h("div", { class: "sub-campos oculto" }, campo("Fecha de vencimiento · obligatoria", fecha),
    h("small", { class: "tenue" }, "Esta entrada crea un lote nuevo con esa fecha y esa cantidad."));
  const loteSel = h("select", { class: "select" });
  const loteBox = h("div", { class: "sub-campos oculto" }, campo("¿De qué lote?", loteSel));

  function prodPerecedero() { return activos.find((p) => p.id === sel.value)?.lleva_vencimiento; }
  async function actualizarCond() {
    ayudaTipo.textContent = AYUDA_TIPO[tipo];
    labelCantidad.textContent = tipo === "ajuste" ? "Existencia real contada (piezas)" : "Cantidad en piezas";
    const perec = prodPerecedero();
    fechaBox.classList.toggle("oculto", !(perec && tipo === "entrada"));
    const necesitaLote = perec && (tipo === "merma" || tipo === "ajuste");
    loteBox.classList.toggle("oculto", !necesitaLote);
    if (necesitaLote) {
      limpiar(loteSel).append(h("option", { value: "" }, "Cargando…"));
      try {
        const lotes = await lotesDe(sel.value);
        limpiar(loteSel).append(...(lotes.length ? lotes.map((l) => h("option", { value: l.id }, `${Number(l.cantidad)} pz · vence ${fechaCorta(l.fecha_vencimiento)}`)) : [h("option", { value: "" }, "Sin lotes con existencia")]));
      } catch { limpiar(loteSel).append(h("option", { value: "" }, "Error al cargar lotes")); }
    }
  }
  sel.addEventListener("change", actualizarCond);

  const btn = h("button", { class: "btn btn-bloque", style: "border-color:var(--ambar);color:var(--ambar-tinta)", onClick: guardar }, "Registrar movimiento");

  async function guardar() {
    const mag = parseFloat(cantidad.value);
    if (!Number.isFinite(mag) || mag <= 0) { falla("Pon una cantidad válida (en piezas)."); return; }
    const perec = prodPerecedero();
    let signo = tipo === "merma" ? -1 : 1; // ajuste y entrada positivos; merma negativo
    const fila = { producto_id: sel.value, tipo, cantidad: signo * mag, motivo: motivo.value.trim() || null };
    if (tipo === "entrada" && perec) {
      if (!fecha.value) { falla("La entrada de un perecedero necesita fecha de vencimiento."); return; }
      fila.fecha_vencimiento = fecha.value;
    }
    if ((tipo === "merma" || tipo === "ajuste") && perec) {
      if (!loteSel.value) { falla("Elige de qué lote."); return; }
      fila.lote_id = loteSel.value;
    }
    btn.disabled = true; btn.textContent = "Registrando…";
    try { await registrarMovimiento(fila); exito("Movimiento registrado"); onSaved(); }
    catch (e) { console.error(e); falla("No se pudo registrar: " + (e.message || "error")); btn.disabled = false; btn.textContent = "Registrar movimiento"; }
  }

  setTimeout(actualizarCond, 0);
  const node = h("div", { class: "glass card" },
    h("h3", { style: "margin-bottom:12px" }, "Movimiento manual"),
    campo("Producto", sel), h("div", { style: "height:10px" }),
    h("div", { class: "campo" }, h("label", {}, "Tipo"), segRow, ayudaTipo),
    h("div", { class: "campo" }, labelCantidad, cantidad), fechaBox, loteBox, campo("Motivo", motivo),
    h("div", { style: "height:10px" }), btn,
  );

  // Handles imperativos para el escáner central: elegir el producto escaneado y
  // dejar el cursor en la cantidad. Devuelve false si el producto no está activo.
  function seleccionar(productoId) {
    if (!activos.some((p) => p.id === productoId)) return false;
    sel.value = productoId;
    actualizarCond();
    return true;
  }
  function enfocarCantidad() { cantidad.focus(); cantidad.select(); }

  return { node, seleccionar, enfocarCantidad };
}

// ── Borrado de productos (individual o en lote) con confirmación ─────────────
// Un producto que ya se vendió no se puede borrar (la BD protege el historial);
// esos se conservan y se avisa que pueden desactivarse en su lugar.
async function eliminarProductosUI(prods, onDone) {
  prods = (prods || []).filter(Boolean);
  if (!prods.length) return;
  const nombres = prods.map((p) => p.nombre);
  const listado = nombres.length <= 8 ? nombres.join(", ") : nombres.slice(0, 8).join(", ") + ` y ${nombres.length - 8} más`;
  const mensaje = prods.length === 1
    ? `Se eliminará "${nombres[0]}" de forma permanente, junto con sus presentaciones, códigos de barras, lotes y movimientos. Esta acción no se puede deshacer.`
    : `Se eliminarán ${prods.length} productos de forma permanente (con sus presentaciones, códigos, lotes y movimientos): ${listado}. Esta acción no se puede deshacer.`;
  const ok = await confirmar(mensaje, {
    titulo: prods.length === 1 ? "¿Eliminar producto?" : "¿Eliminar productos?",
    okTexto: prods.length === 1 ? "Eliminar" : `Eliminar ${prods.length}`,
    peligro: true,
  });
  if (!ok) return;
  try {
    const res = await eliminarProductos(prods.map((p) => p.id));
    const nb = res.borrados?.length || 0;
    const nc = res.conservados?.length || 0;
    if (nb) exito(nb === 1 ? `"${res.borrados[0].nombre}" eliminado` : `${nb} producto(s) eliminado(s)`);
    if (nc) falla(`No se pudo eliminar ${nc} porque tiene(n) ventas registradas: ${res.conservados.map((c) => c.nombre).join(", ")}. Desactívalos en Editar para ocultarlos de Venta.`);
    if (!nb && !nc) exito("No había nada que eliminar");
    onDone && onDone();
  } catch (e) {
    console.error(e);
    falla("No se pudo eliminar: " + (e.message || "error"));
  }
}

// ── Helpers de formulario ────────────────────────────────────────────────────
function inp(ph, inputmode, type) {
  return h("input", { class: "input" + (inputmode ? " mono" : ""), type: type || "text", inputmode: inputmode || null, placeholder: ph });
}
function campo(label, control, extra) {
  return h("div", { class: "campo" + (extra === "span2" ? " span2" : "") }, h("label", {}, label), control);
}
function chk(on) { const c = h("input", { type: "checkbox" }); if (on) c.checked = true; return c; }
function switchLbl(texto, control) {
  return h("label", { class: "switch" }, control, h("span", { class: "pista" }), h("span", { style: "font-size:13px" }, texto));
}
function numeroO0(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; }

// ── Pantalla: Venta ─────────────────────────────────────────────────────────
import { h, limpiar, dinero, exito, falla, modal, confirmar, navegarConFlechas } from "../lib/ui.js";
import { catalogoVenta, turnoActivoDe, registrarMovimientoCaja, yo } from "../lib/datos.js";
import { calcular } from "../lib/ventas.js";
import { ventaEnCurso, listaTickets, indiceActivo, ticketActivo, nuevoTicket, activarTicket, cerrarTicket, renombrarTicket } from "../lib/estado.js";
import { pantallaActual } from "../lib/router.js";
import { montarEscaner } from "../lib/escaner.js";
import { getConfig } from "../lib/config-runtime.js";
import { abrirPanelTickets } from "./historial.js";

export const venta = {
  id: "venta", etiqueta: "Venta", titulo: "Venta", roles: ["admin", "cajero"], enNav: true,
  async render({ contenido, ir }) {
    limpiar(contenido).append(h("div", { class: "cargando" }, "Cargando catálogo…"));
    let cat;
    try { cat = await catalogoVenta(); }
    catch (e) { console.error(e); limpiar(contenido).append(h("div", { class: "cargando" }, "No se pudo cargar el catálogo.")); return; }

    const presById = new Map(cat.presentaciones.map((p) => [p.id, p]));
    const prodById = new Map(cat.productos.map((p) => [p.id, p]));
    // Presentaciones agrupadas por producto (para la cuadrícula).
    const porProducto = new Map();
    for (const pr of cat.presentaciones) {
      if (!porProducto.has(pr.producto_id)) porProducto.set(pr.producto_id, []);
      porProducto.get(pr.producto_id).push(pr);
    }

    // ── DOM base ──────────────────────────────────────────────────────────────
    const barcode = h("input", { class: "input", type: "text", placeholder: "Escanea o teclea un código de barras…", autocomplete: "off" });
    const buscar = h("input", { class: "input", type: "search", placeholder: "Buscar por nombre…", autocomplete: "off" });
    const buscarPop = h("div", { class: "buscador-pop", hidden: true });
    const cartBody = h("div", { class: "cart-body" });
    const cartPie = h("div", { class: "cart-pie" });
    const carpetas = h("aside", { class: "venta-der" });
    const ticketsBar = h("div", { class: "tickets-bar" });

    const barra = h("div", { class: "glass venta-barra" },
      h("div", { class: "campo", style: "flex:1" }, h("label", {}, "Código de barras"), barcode),
      h("div", { class: "campo", style: "flex:1;position:relative" }, h("label", {}, "Buscar por nombre · F2"), buscar, buscarPop),
    );
    const cart = h("aside", { class: "glass glass-fuerte cart" },
      h("div", { class: "cart-top" }, h("h2", {}, "Carrito"),
        h("div", { class: "fila", style: "gap:6px" },
          h("button", { class: "btn btn-fantasma btn-mini", title: "Ver tickets: folios y detalle de cada venta", onClick: () => abrirPanelTickets({ ir }) }, "🧾 Tickets"),
          h("button", { class: "btn btn-fantasma btn-mini", title: "Entradas/salidas de dinero del cajón · F7 entrada · F8 salida", onClick: () => modalCaja() }, "💵 Caja"),
          h("button", { class: "btn btn-fantasma", title: "Vaciar (Esc)", onClick: vaciar }, "Vaciar"))),
      cartBody, cartPie,
    );

    limpiar(contenido).append(h("div", { class: "venta-grid" }, barra, ticketsBar,
      h("div", { class: "venta-cols" }, cart, carpetas)));

    // Normaliza para comparar sin acentos ni mayúsculas.
    const norm = (s) => (s || "").toString().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

    // ── Buscador por nombre: lista desplegable (nombre + precio de venta) ──────
    let resActivo = -1; // índice resaltado en el desplegable
    let resItems = [];  // presentaciones mostradas actualmente
    const carpetasCerradas = new Set(); // carpetas colapsadas (persisten entre repintados)

    function cerrarPop() { buscarPop.hidden = true; limpiar(buscarPop); resItems = []; resActivo = -1; }

    function renderResultados(term) {
      const q = norm(term).trim();
      if (!q) { cerrarPop(); return; }
      // Coincidencia sobre presentaciones (producto + presentación + código).
      const califica = (pr) => {
        const prod = prodById.get(pr.producto_id);
        return { pr, prod, texto: norm(`${prod?.nombre ?? ""} ${pr.nombre} ${pr.codigo_barras ?? ""}`),
          nombre: norm(prod?.nombre ?? "") };
      };
      const hits = cat.presentaciones.map(califica).filter((x) => x.texto.includes(q));
      // Prioriza las que EMPIEZAN con el término (por nombre de producto).
      hits.sort((a, b) => (b.nombre.startsWith(q) - a.nombre.startsWith(q)) ||
        a.nombre.localeCompare(b.nombre));
      resItems = hits.slice(0, 12);
      resActivo = resItems.length ? 0 : -1;

      limpiar(buscarPop);
      if (!resItems.length) { buscarPop.append(h("p", { class: "tenue buscador-vacio" }, "Sin resultados.")); buscarPop.hidden = false; return; }
      resItems.forEach((x, i) => {
        const agotado = Number(x.prod?.stock_actual) <= 0;
        const bajo = Number(x.prod?.stock_actual) <= Number(x.prod?.stock_minimo);
        buscarPop.append(h("div", { class: "buscador-item" + (agotado ? " agotado" : "") + (i === resActivo ? " activo" : ""),
          dataset: { i: String(i) },
          onMouseenter: () => { resActivo = i; marcarActivo(); },
          // Selección con pointerdown (no click): ocurre ANTES del blur del buscador
          // y con preventDefault el campo no pierde el foco, así el clic del mouse en
          // la fila SÍ agrega (antes se perdía por la carrera blur→cerrarPop).
          onPointerDown: (e) => { e.preventDefault(); elegirResultado(i); } },
          h("div", { class: "col", style: "min-width:0" },
            h("strong", { class: "prod-nom" }, x.prod?.nombre ?? "?"),
            h("small", { class: "tenue bi-sub" }, x.pr.nombre),
          ),
          h("span", { class: "chip " + (agotado ? "chip-peligro" : bajo ? "chip-adv" : "chip-tenue") },
            agotado ? "AGOTADO" : `${x.prod?.stock_actual} ${x.prod?.unidad_base ?? ""}${bajo ? " · bajo" : ""}`),
          h("span", { class: "mono", style: "font-weight:500" }, dinero(x.pr.precio)),
        ));
      });
      buscarPop.hidden = false;
    }

    function marcarActivo() {
      [...buscarPop.querySelectorAll(".buscador-item")].forEach((el, i) => el.classList.toggle("activo", i === resActivo));
    }

    function elegirResultado(i) {
      const x = resItems[i]; if (!x) return;
      if (Number(x.prod?.stock_actual) <= 0) { falla(`⛔ ${x.prod?.nombre ?? "Artículo"} está AGOTADO.`); return; }
      agregarLinea(x.pr.id, 1);
      buscar.value = ""; cerrarPop(); barcode.focus();
    }

    function flash(pid) {
      const li = cartBody.querySelector(`[data-pid="${pid}"]`);
      if (li) { li.animate([{ background: "rgba(82,160,141,.25)" }, { background: "transparent" }], { duration: 500 }); }
    }

    // Línea "activa" del carrito (para manipularla con teclado: + − Supr ↑ ↓).
    let lineaActiva = null;

    // ── Recalcular y pintar el carrito ────────────────────────────────────────
    function recompute() {
      const calc = calcular(ventaEnCurso.carrito, cat, ventaEnCurso.combosAceptados, ventaEnCurso.genericos);
      pintarCarrito(calc);
      pintarCarpetas(calc);
      pintarTabs();
      return calc;
    }

    // ── Tickets múltiples: dejar ventas pendientes y seguir cobrando ──────────
    // Cada ticket es un carrito independiente (persistido en el dispositivo).
    // "Dejar pendiente" = abrir un ticket nuevo; el actual queda en la barra.
    let renombrandoId = null; // ticket cuyo nombre se edita en línea

    function totalTicket(t) {
      try { return calcular(t.carrito, cat, t.combosAceptados, t.genericos).total; }
      catch { return 0; }
    }
    function irATicket(id) {
      renombrandoId = null; activarTicket(id); lineaActiva = null; cerrarPop();
      recompute(); setTimeout(() => barcode.focus(), 20);
    }
    function crearTicket() {
      renombrandoId = null; nuevoTicket(); lineaActiva = null; cerrarPop();
      recompute(); setTimeout(() => barcode.focus(), 20);
    }
    async function cerrarTab(t) {
      const nLineas = t.carrito.length + t.genericos.length;
      if (nLineas > 0) {
        const ok = await confirmar(`El ticket "${t.nombre || "sin nombre"}" tiene ${nLineas} línea(s). ¿Cerrarlo y descartar su contenido?`,
          { titulo: "Cerrar ticket", okTexto: "Cerrar ticket", peligro: true });
        if (!ok) return;
      }
      cerrarTicket(t.id); lineaActiva = null; recompute(); setTimeout(() => barcode.focus(), 20);
    }

    function pintarTabs() {
      limpiar(ticketsBar);
      const lista = listaTickets();
      const activoIdx = indiceActivo();
      lista.forEach((t, i) => {
        const activo = i === activoIdx;
        const nLineas = t.carrito.length + t.genericos.length;

        if (renombrandoId === t.id) {
          const inp = h("input", { class: "input ticket-nombre-inp", value: t.nombre || "", placeholder: `Ticket ${i + 1}`, maxlength: "24" });
          const fin = (grabar) => { if (grabar) renombrarTicket(t.id, inp.value); renombrandoId = null; pintarTabs(); setTimeout(() => barcode.focus(), 20); };
          inp.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); fin(true); } else if (e.key === "Escape") { e.preventDefault(); fin(false); } });
          inp.addEventListener("blur", () => fin(true));
          ticketsBar.append(h("div", { class: "ticket-chip activo editando" }, inp));
          setTimeout(() => { inp.focus(); inp.select(); }, 10);
          return;
        }

        ticketsBar.append(h("div", { class: "ticket-chip" + (activo ? " activo" : "") + (nLineas ? "" : " vacio"),
          title: "Clic: abrir · doble clic: renombrar",
          onClick: () => { if (!activo) irATicket(t.id); },
          onDblclick: () => { renombrandoId = t.id; pintarTabs(); } },
          h("span", { class: "ticket-nom" }, t.nombre || `Ticket ${i + 1}`),
          h("span", { class: "ticket-meta mono" }, nLineas ? dinero(totalTicket(t)) : "vacío"),
          h("button", { class: "ticket-x", title: "Cerrar ticket", onClick: (e) => { e.stopPropagation(); cerrarTab(t); } }, "×"),
        ));
      });
      ticketsBar.append(h("button", { class: "ticket-nuevo", title: "Nuevo ticket (deja el actual pendiente) · F3", onClick: crearTicket }, "＋ Nuevo"));
    }

    // Fondo de la línea del carrito según su estado (combo/promo), + marco si activa.
    // Colores configurables desde Apariencia (variables CSS --venta-*).
    function estiloLinea(etiquetas, activa) {
      let bg = "";
      if (etiquetas.includes("combo")) bg = "background: color-mix(in srgb, var(--venta-combo) 16%, transparent);";
      else if (etiquetas.includes("promo")) bg = "background: color-mix(in srgb, var(--venta-promo) 16%, transparent);";
      const marco = activa ? "box-shadow: inset 0 0 0 2px var(--verde-dato);" : "";
      return `${bg}${marco}border-radius:10px`;
    }

    function pintarCarrito(calc) {
      limpiar(cartBody); limpiar(cartPie);
      if (ventaEnCurso.vacio) {
        cartBody.append(h("p", { class: "cart-vacio tenue" },
          "Escanea un código o busca por nombre (F2) para agregar artículos. A la derecha tienes las promociones y combos para ofrecer: tócalos para cargarlos. Con teclado: + / − suman o restan la línea activa, Supr la quita, ↑ ↓ la cambian. F7 registra entrada de dinero y F8 salida (caja). Al escanear un artículo con six te pregunta si es six (elige con ↑ ↓ y Enter); y 6 piezas se cobran solas al precio del six. ¿Otro cliente? Deja este ticket pendiente y abre otro con ＋ Nuevo (o F3) arriba: cada ticket guarda su propio carrito."));
        cartPie.append(totalYCobrar(calc, true));
        return;
      }
      // Normaliza la línea activa (si la actual ya no está, toma la última).
      const idsTodos = [...ventaEnCurso.carrito.map((x) => x.presentacion_id), ...ventaEnCurso.genericos.map((g) => g.uid)];
      if (!idsTodos.includes(lineaActiva)) lineaActiva = idsTodos[idsTodos.length - 1] ?? null;

      // Líneas del carrito (una por presentación agregada).
      // Se itera sobre una copia: un ticket persistido puede traer una presentación
      // que ya no existe en el catálogo (se editó/eliminó); esa línea se descarta.
      for (const it of [...ventaEnCurso.carrito]) {
        const pr = presById.get(it.presentacion_id);
        if (!pr) { ventaEnCurso.quitar(it.presentacion_id); continue; }
        const prod = prodById.get(pr.producto_id);
        if (!prod) { ventaEnCurso.quitar(it.presentacion_id); continue; }
        const info = calc.porPresentacion.get(it.presentacion_id);
        const etiquetas = info ? [...info.etiquetas] : [];
        const activa = it.presentacion_id === lineaActiva;
        cartBody.append(h("div", { class: "cart-linea" + (activa ? " activa" : ""), dataset: { pid: it.presentacion_id },
          style: estiloLinea(etiquetas, activa) },
          h("div", { class: "col", style: "min-width:0;flex:1;cursor:pointer", onClick: () => { lineaActiva = it.presentacion_id; recompute(); } },
            h("strong", { class: "prod-nom" }, `${prod.nombre}`),
            h("small", { class: "tenue" }, pr.nombre),
            etiquetas.length ? h("div", { class: "fila", style: "gap:6px;margin-top:4px" },
              ...etiquetas.map((e) => h("span", { class: "chip " + (e === "combo" ? "chip-adv" : "chip-ok") }, e === "combo" ? "combo" : e === "promo" ? "promo" : e))) : null,
          ),
          h("div", { class: "stepper" },
            h("button", { class: "paso", onClick: () => { ventaEnCurso.fijarCantidad(it.presentacion_id, it.cantidad - 1); recompute(); } }, "−"),
            h("input", { class: "paso-num mono", type: "text", inputmode: "numeric", value: String(it.cantidad),
              onChange: (e) => { const n = parseInt(e.target.value, 10); fijarConTope(it.presentacion_id, Number.isFinite(n) ? n : it.cantidad); } }),
            h("button", { class: "paso", onClick: () => { if (bloquearSiNoCabe(it.presentacion_id, 1)) return; ventaEnCurso.fijarCantidad(it.presentacion_id, it.cantidad + 1); recompute(); } }, "+"),
          ),
          h("div", { class: "cart-sub mono" }, dinero(info ? info.subtotalCent / 100 : 0)),
          h("button", { class: "cart-x", title: "Quitar", onClick: () => { ventaEnCurso.quitar(it.presentacion_id); recompute(); } }, "×"),
        ));
      }

      // Líneas genéricas (código 0): venta libre.
      for (const g of ventaEnCurso.genericos) {
        const activa = g.uid === lineaActiva;
        cartBody.append(h("div", { class: "cart-linea" + (activa ? " activa" : ""), dataset: { pid: g.uid },
          style: activa ? "box-shadow: inset 0 0 0 2px var(--verde-dato); border-radius:10px" : "" },
          h("div", { class: "col", style: "min-width:0;flex:1;cursor:pointer", onClick: () => { lineaActiva = g.uid; recompute(); } },
            h("strong", { class: "prod-nom" }, g.descripcion),
            h("small", { class: "tenue" }, "venta libre · código 0"),
          ),
          h("div", { class: "stepper" },
            h("button", { class: "paso", onClick: () => { ventaEnCurso.fijarCantidadGenerico(g.uid, g.cantidad - 1); recompute(); } }, "−"),
            h("input", { class: "paso-num mono", type: "text", inputmode: "numeric", value: String(g.cantidad),
              onChange: (e) => { const n = parseInt(e.target.value, 10); ventaEnCurso.fijarCantidadGenerico(g.uid, Number.isFinite(n) ? n : g.cantidad); recompute(); } }),
            h("button", { class: "paso", onClick: () => { ventaEnCurso.fijarCantidadGenerico(g.uid, g.cantidad + 1); recompute(); } }, "+"),
          ),
          h("div", { class: "cart-sub mono" }, dinero(g.precio * g.cantidad)),
          h("button", { class: "cart-x", title: "Quitar", onClick: () => { ventaEnCurso.quitarGenerico(g.uid); recompute(); } }, "×"),
        ));
      }

      // Combos sugeridos (no aceptados) y aplicados.
      const notas = h("div", { class: "cart-notas" });
      for (const c of calc.combos) {
        if (c.aplicado) {
          notas.append(h("div", { class: "nota nota-combo" },
            h("span", {}, `Combo aplicado: ${c.combo.nombre}${c.nPosible > 1 ? " ×" + c.nPosible : ""}`),
            h("button", { class: "btn btn-fantasma btn-mini", onClick: () => { ventaEnCurso.rechazarCombo(c.combo.id); recompute(); } }, "Quitar")));
        } else if (c.nPosible > 0) {
          notas.append(h("div", { class: "nota nota-sug" },
            h("span", {}, `Combo sugerido: ${c.combo.nombre} — ${dinero(c.combo.precio_promocional)}${c.nPosible > 1 ? " (×" + c.nPosible + ")" : ""}`),
            h("button", { class: "btn btn-primario btn-mini", onClick: () => { ventaEnCurso.aceptarCombo(c.combo.id); exito("Combo aplicado"); recompute(); } }, "Aplicar")));
        } else {
          // Sugerencia de upsell: con UN artículo del combo en el carrito, invitar a
          // ofrecer el combo y completar lo que falta con un toque.
          const items = cat.comboItems.filter((ci) => ci.combo_id === c.combo.id);
          const cantDe = (pid) => ventaEnCurso.carrito.filter((x) => x.presentacion_id === pid).reduce((s, x) => s + Number(x.cantidad), 0);
          const tieneAlguno = items.some((ci) => cantDe(ci.presentacion_id) >= 1);
          const faltantes = items
            .map((ci) => ({ pid: ci.presentacion_id, falta: Number(ci.cantidad_requerida) - cantDe(ci.presentacion_id) }))
            .filter((f) => f.falta > 0);
          if (tieneAlguno && faltantes.length) {
            // Nombra los DOS (o más) artículos del combo para que la leyenda se
            // entienda sola, sin importar dónde quede ni qué más haya en el carrito.
            const nombreDe = (pid) => { const pr = presById.get(pid); const prod = pr ? prodById.get(pr.producto_id) : null; return prod?.nombre ?? "artículo"; };
            const componentesTxt = items.map((ci) =>
              `${Number(ci.cantidad_requerida) > 1 ? ci.cantidad_requerida + "× " : ""}${nombreDe(ci.presentacion_id)}`).join(" + ");
            // Ahorro = precio normal de los componentes − precio de combo (solo si es positivo).
            const normal = items.reduce((s, ci) => {
              const pr = presById.get(ci.presentacion_id);
              return s + (pr ? Number(pr.precio) * Number(ci.cantidad_requerida) : 0);
            }, 0);
            const ahorro = normal - Number(c.combo.precio_promocional);
            const leyenda = `💡 Combo ${componentesTxt} por ${dinero(c.combo.precio_promocional)}`
              + (ahorro > 0 ? ` (ahorra: ${dinero(ahorro)})` : "");
            notas.append(h("div", { class: "nota nota-sug" },
              h("span", {}, leyenda),
              h("button", { class: "btn btn-primario btn-mini", onClick: () => agregarFaltantesYAplicar(c.combo.id, faltantes) }, "Agregar lo que falta")));
          }
        }
      }
      for (const pa of calc.promosAplicadas) {
        notas.append(h("div", { class: "nota nota-promo" },
          h("span", {}, `Promoción aplicada: ${pa.promo.nombre} (${pa.bundles}×)`)));
      }
      if (notas.childElementCount) cartBody.append(notas);

      cartPie.append(totalYCobrar(calc, false));
    }

    function totalYCobrar(calc, vacio) {
      const cobrar = h("button", { class: "btn btn-primario btn-lg btn-bloque", "data-glow": "1", disabled: vacio,
        onClick: () => irACobrar(calc) }, "Cobrar · F4");
      return h("div", {},
        h("div", { class: "fila entre cart-total" }, h("span", {}, "Total"), h("strong", { class: "mono" }, dinero(calc.total))),
        cobrar,
      );
    }

    function irACobrar(calc) {
      if (ventaEnCurso.vacio) { falla("El carrito está vacío"); return; }
      // ¿El carrito trae productos con envase retornable? Cuenta por tipo (clave).
      const req = {};
      let hayEnvases = 0;
      for (const it of ventaEnCurso.carrito) {
        const pr = presById.get(it.presentacion_id); if (!pr) continue;
        const prod = prodById.get(pr.producto_id);
        if (!prod?.retornable || !prod.tipo_envase) continue;
        const u = Number(it.cantidad) * Number(pr.factor_conversion);
        req[prod.tipo_envase] = (req[prod.tipo_envase] || 0) + u;
        hayEnvases += u;
      }
      // Solo pregunta por envases si hay retornables; si no, va directo al cobro.
      if (hayEnvases > 0) ir("envases", { calc, requeridos: req });
      else ir("pago", { calc });
    }

    function vaciar() { ventaEnCurso.vaciar(); recompute(); barcode.focus(); }

    // ── Movimiento de caja (entrada/salida de dinero del cajón) ────────────────
    async function modalCaja(tipoInicial = "salida") {
      let turno = null;
      try { turno = await turnoActivoDe(yo()?.id); } catch { /* sin turno */ }
      modal((caja, cerrar) => {
        let tipo = tipoInicial === "entrada" ? "entrada" : "salida";
        const tipos = [["salida", "Salida (retiro/gasto)"], ["entrada", "Entrada (ingreso)"]];
        const btns = tipos.map(([t, l]) => h("button", { class: "seg seg-" + t + (t === tipo ? " activo" : ""), onClick: () => { tipo = t; btns.forEach((b, i) => b.classList.toggle("activo", tipos[i][0] === tipo)); } }, l));
        const monto = h("input", { class: "input mono", inputmode: "decimal", placeholder: "0.00" });
        const motivo = h("input", { class: "input", placeholder: "Motivo (pago a proveedor, retiro, propina…)" });
        const btn = h("button", { class: "btn btn-primario btn-bloque", onClick: guardar }, "Registrar movimiento");
        async function guardar() {
          const m = parseFloat(monto.value);
          if (!Number.isFinite(m) || m <= 0) { falla("Pon un monto válido."); return; }
          btn.disabled = true; btn.textContent = "Guardando…";
          try {
            await registrarMovimientoCaja({ tipo, monto: m, motivo: motivo.value.trim() || null, turnoId: turno?.id ?? null });
            exito(tipo === "entrada" ? "Entrada de caja registrada" : "Salida de caja registrada");
            cerrar();
          } catch (e) { console.error(e); falla("No se pudo registrar: " + (e.message || "error")); btn.disabled = false; btn.textContent = "Registrar movimiento"; }
        }
        caja.append(
          h("h3", {}, "Movimiento de caja"),
          h("p", { class: "tenue", style: "margin:4px 0 14px;font-size:13px" }, "Entradas o salidas de dinero del cajón (no son ventas). Se reflejan en el corte del turno."),
          h("div", { class: "campo", style: "margin-bottom:12px" }, h("label", {}, "Tipo"), h("div", { class: "segmented" }, ...btns)),
          h("div", { class: "campo", style: "margin-bottom:12px" }, h("label", {}, "Monto"), monto),
          h("div", { class: "campo", style: "margin-bottom:18px" }, h("label", {}, "Motivo / descripción"), motivo),
          h("div", { class: "fila entre" }, h("button", { class: "btn btn-fantasma", onClick: cerrar }, "Cancelar"), btn),
        );
        setTimeout(() => monto.focus(), 30);
      });
    }

    // ── Código de barras ──────────────────────────────────────────────────────
    // Un lector USB funciona como teclado: "teclea" el código + Enter en el campo
    // que tenga el foco. Antes solo escuchábamos el campo "Código de barras", así
    // que el lector dejaba de servir en cuanto tocabas cualquier botón (el foco se
    // iba). Ahora capturamos a nivel de toda la pantalla (keyboard-wedge global):
    // el lector sirve sin importar dónde estés parado, y solo ignoramos los campos
    // de texto (buscador, cantidad, código manual) para no estorbar al escribir.

    function agregarLinea(presId, n = 1) {
      if (bloquearSiNoCabe(presId, n)) return; // control de inventario: no vender sin existencia
      ventaEnCurso.agregar(presId, n); lineaActiva = presId; recompute(); flash(presId);
    }

    // Unidades base de un producto ya presentes en el carrito (opcionalmente excluye una presentación).
    function baseEnCarrito(prodId, exceptoPres = null) {
      let t = 0;
      for (const it of ventaEnCurso.carrito) {
        const p2 = presById.get(it.presentacion_id);
        if (!p2 || p2.producto_id !== prodId || it.presentacion_id === exceptoPres) continue;
        t += Number(it.cantidad) * Number(p2.factor_conversion);
      }
      return t;
    }

    // Control de inventario: NO se puede vender más de lo que hay en existencia.
    // Devuelve true (y avisa) si NO cabe → la operación se bloquea.
    function bloquearSiNoCabe(presId, n = 1) {
      const pr = presById.get(presId); if (!pr) return false; // genéricos u otros: no aplica
      const prod = prodById.get(pr.producto_id); if (!prod) return false;
      const stock = Number(prod.stock_actual) || 0;
      const pedido = baseEnCarrito(prod.id) + n * Number(pr.factor_conversion);
      if (pedido <= stock) return false; // cabe
      if (stock <= 0) falla(`⛔ ${prod.nombre} está AGOTADO. Dale entrada en Inventario para poder venderlo.`);
      else falla(`⛔ Solo hay ${stock} de ${prod.nombre}; no puedes agregar más.`);
      return true; // bloquea
    }

    // Upsell de combo: agrega lo que falta para completar el combo y lo aplica.
    function agregarFaltantesYAplicar(comboId, faltantes) {
      // Verifica existencia de TODO lo faltante antes de tocar el carrito.
      for (const f of faltantes) {
        const pr = presById.get(f.pid); if (!pr) continue;
        const prod = prodById.get(pr.producto_id); if (!prod) continue;
        const stock = Number(prod.stock_actual) || 0;
        const pedido = baseEnCarrito(prod.id) + f.falta * Number(pr.factor_conversion);
        if (pedido > stock) { falla(`No hay existencia para completar el combo (${prod.nombre}).`); return; }
      }
      for (const f of faltantes) ventaEnCurso.agregar(f.pid, f.falta);
      ventaEnCurso.aceptarCombo(comboId);
      exito("Combo agregado");
      recompute();
    }

    // ── Panel derecho: carpetas de Promociones y Combos (accionables) ─────────
    const nombreProd = (pid) => { const pr = presById.get(pid); const prod = pr ? prodById.get(pr.producto_id) : null; return prod?.nombre ?? "artículo"; };

    // Carga un combo de cero: agrega TODOS sus componentes y aplica el combo.
    function ofrecerCombo(comboId) {
      const items = cat.comboItems.filter((ci) => ci.combo_id === comboId);
      if (!items.length) return;
      const faltantes = items.map((ci) => ({ pid: ci.presentacion_id, falta: Number(ci.cantidad_requerida) }));
      agregarFaltantesYAplicar(comboId, faltantes);
    }

    // Carga una promo: agrega la cantidad requerida de la 1ª presentación con existencia.
    function ofrecerPromo(promo) {
      const req = Number(promo.cantidad_requerida) || 1;
      const pids = cat.promocionPresentaciones.filter((pp) => pp.promocion_id === promo.id).map((pp) => pp.presentacion_id);
      const elegida = pids.find((pid) => {
        const pr = presById.get(pid); const prod = pr ? prodById.get(pr.producto_id) : null;
        return prod && Number(prod.stock_actual) >= req * Number(pr.factor_conversion) + baseEnCarrito(prod.id);
      });
      if (!elegida) { falla("No hay existencia para armar esta promoción."); return; }
      agregarLinea(elegida, req);
      exito("Promoción agregada");
    }

    function pintarCarpetas(calc = null) {
      const sc = carpetas.scrollTop; // conserva el scroll al reconstruir
      limpiar(carpetas);
      const combosAplic = new Set((calc?.combos || []).filter((c) => c.aplicado).map((c) => c.combo.id));
      const promosAplic = new Set((calc?.promosAplicadas || []).map((p) => p.promo.id));

      // Carpeta genérica plegable. `carpetasCerradas` recuerda el estado entre repintados.
      const carpeta = (titulo, filas) => {
        const cerrada = carpetasCerradas.has(titulo);
        const cuerpo = h("div", { class: "folder-body" }, ...(filas.length ? filas
          : [h("p", { class: "tenue folder-vacio" }, "Sin elementos.")]));
        const flecha = h("span", { class: "folder-flecha" }, "▾");
        const cab = h("button", { class: "folder-cab", onClick: () => {
          if (fold.classList.toggle("cerrada")) carpetasCerradas.add(titulo); else carpetasCerradas.delete(titulo);
        } }, h("h3", {}, `${titulo}${filas.length ? ` · ${filas.length}` : ""}`), flecha);
        const fold = h("div", { class: "folder glass" + (cerrada ? " cerrada" : "") }, cab, cuerpo);
        return fold;
      };

      // Celda de precio con el ahorro en verde (si es positivo), para ayudar a vender.
      const celdaPrecio = (precio, ahorro) => h("span", { class: "fi-precio" },
        h("span", { class: "mono", style: "font-weight:600" }, dinero(precio)),
        ahorro > 0 ? h("span", { class: "fi-ahorro" }, `ahorra ${dinero(ahorro)}`) : null);

      // Promociones
      const filasPromo = (cat.promociones || []).map((promo) => {
        const pids = cat.promocionPresentaciones.filter((pp) => pp.promocion_id === promo.id).map((pp) => pp.presentacion_id);
        const nombres = [...new Set(pids.map(nombreProd))].join(" / ") || "artículo";
        const req = Number(promo.cantidad_requerida) || 1;
        // Ahorro conservador: precio normal = cantidad requerida × la presentación más barata del grupo.
        const precios = pids.map((pid) => Number(presById.get(pid)?.precio || 0)).filter((p) => p > 0);
        const normal = precios.length ? Math.min(...precios) * req : 0;
        const ahorro = normal - Number(promo.precio_promocional);
        const aplic = promosAplic.has(promo.id);
        return h("button", { class: "folder-item" + (aplic ? " aplicado" : ""), onClick: () => ofrecerPromo(promo) },
          h("span", { style: "min-width:0" },
            h("span", { class: "fi-nom" }, promo.nombre),
            h("span", { class: "fi-desc tenue" }, `${aplic ? "✓ aplicada · " : ""}${req}× ${nombres}`)),
          celdaPrecio(promo.precio_promocional, ahorro));
      });

      // Combos
      const filasCombo = (cat.combos || []).map((combo) => {
        const items = cat.comboItems.filter((ci) => ci.combo_id === combo.id);
        const compTxt = items.map((ci) => `${Number(ci.cantidad_requerida) > 1 ? ci.cantidad_requerida + "× " : ""}${nombreProd(ci.presentacion_id)}`).join(" + ") || (combo.descripcion || "");
        // Ahorro = suma del precio normal de los componentes − precio de combo.
        const normal = items.reduce((s, ci) => s + Number(presById.get(ci.presentacion_id)?.precio || 0) * Number(ci.cantidad_requerida), 0);
        const ahorro = normal - Number(combo.precio_promocional);
        const aplic = combosAplic.has(combo.id);
        return h("button", { class: "folder-item" + (aplic ? " aplicado" : ""), onClick: () => ofrecerCombo(combo.id) },
          h("span", { style: "min-width:0" },
            h("span", { class: "fi-nom" }, combo.nombre),
            h("span", { class: "fi-desc tenue" }, `${aplic ? "✓ aplicado · " : ""}${compTxt}`)),
          celdaPrecio(combo.precio_promocional, ahorro));
      });

      carpetas.append(carpeta("Promociones", filasPromo), carpeta("Combos", filasCombo));
      carpetas.scrollTop = sc;
    }

    // Fija una cantidad exacta respetando la existencia (para el campo de cantidad).
    function fijarConTope(presId, nDeseado) {
      const pr = presById.get(presId);
      const prod = pr ? prodById.get(pr.producto_id) : null;
      if (pr && prod) {
        const stock = Number(prod.stock_actual) || 0;
        const maxUnid = Math.floor(Math.max(0, stock - baseEnCarrito(prod.id, presId)) / Number(pr.factor_conversion));
        if (nDeseado > maxUnid) { falla(`⛔ Solo puedes vender ${maxUnid} de ${prod.nombre} (existencia ${stock}).`); nDeseado = maxUnid; }
      }
      ventaEnCurso.fijarCantidad(presId, nDeseado);
      recompute();
    }

    // Al escanear una PIEZA de un producto que también tiene six/cartón, pregunta
    // cómo se lleva (pieza o empaque). Si es pieza, luego con "+" suma las que sean:
    // al llegar a 6 se cobra solo al precio del six (el sobrante, a precio de pieza).
    function preguntarEmpaque(prod, base, mayores) {
      modal((caja, cerrar) => {
        // Opciones en orden: Pieza (resaltada al abrir) y luego cada empaque mayor.
        // Se eligen con ↑ ↓ y Enter (o clic); sin depender del mouse.
        const btnPieza = h("button", { class: "btn btn-primario btn-lg btn-bloque", "data-glow": "1",
          onClick: () => { cerrar(); agregarLinea(base.id, 1); } }, `Pieza · ${dinero(base.precio)}`);
        const btnsMay = mayores.map((m) => h("button", { class: "btn btn-lg btn-bloque",
          onClick: () => { cerrar(); agregarLinea(base.id, Number(m.factor_conversion)); } },
          `${m.nombre} · ${dinero(m.precio)} (${Number(m.factor_conversion)} pz)`));
        const botones = [btnPieza, ...btnsMay];
        caja.append(
          h("h3", {}, prod?.nombre ?? "Producto"),
          h("p", { class: "tenue", style: "margin:4px 0 14px;font-size:13px" }, "¿Cómo se lleva?  ·  ↑ ↓ para elegir · Enter confirma"),
          h("div", { class: "col", style: "gap:10px" }, ...botones),
        );
        // ↑/↓ mueven el resaltado, Enter activa, Escape cierra (el propio modal
        // también cierra con Escape; navegarConFlechas se autolimpia al cerrarse).
        navegarConFlechas(botones, { inicial: 0, alSalir: cerrar });
      }, { ancho: 380 });
    }

    // Venta genérica (código 0): artículo/servicio no catalogado.
    function modalGenerico() {
      modal((caja, cerrar) => {
        const desc = h("input", { class: "input", placeholder: "Descripción (artículo o servicio)" });
        const precio = h("input", { class: "input mono", inputmode: "decimal", placeholder: "0.00" });
        const cant = h("input", { class: "input mono", inputmode: "numeric", value: "1" });
        const btn = h("button", { class: "btn btn-primario btn-bloque", onClick: guardar }, "Agregar al carrito");
        function guardar() {
          const d = desc.value.trim();
          const p = parseFloat(precio.value);
          const c = parseInt(cant.value, 10);
          if (!d) { falla("Escribe una descripción."); return; }
          if (!Number.isFinite(p) || p < 0) { falla("Pon un monto válido."); return; }
          ventaEnCurso.agregarGenerico(d, p, Number.isFinite(c) && c > 0 ? c : 1);
          lineaActiva = ventaEnCurso.genericos[ventaEnCurso.genericos.length - 1]?.uid ?? lineaActiva;
          recompute(); cerrar();
        }
        caja.append(
          h("h3", {}, "Venta genérica · código 0"),
          h("p", { class: "tenue", style: "margin:4px 0 14px;font-size:13px" }, "Para cobrar algo que no está en el catálogo: escribe la descripción y el monto unitario."),
          h("div", { class: "campo", style: "margin-bottom:12px" }, h("label", {}, "Descripción"), desc),
          h("div", { class: "grid2" },
            h("div", { class: "campo" }, h("label", {}, "Monto unitario"), precio),
            h("div", { class: "campo" }, h("label", {}, "Cantidad"), cant)),
          h("div", { class: "fila entre", style: "margin-top:16px" }, h("button", { class: "btn btn-fantasma", onClick: cerrar }, "Cancelar"), btn),
        );
        setTimeout(() => desc.focus(), 30);
      });
    }

    function procesarCodigo(code) {
      if (code === "0") { // código clave: venta libre
        if (getConfig().REGLAS?.permitir_generico === false) { falla("La venta libre (código 0) está desactivada en Configuración."); return false; }
        modalGenerico(); return true;
      }
      const pr = cat.presentaciones.find((x) => x.codigo_barras && x.codigo_barras === code);
      if (!pr) { falla("Código no encontrado: " + code); return false; }
      const prodEsc = prodById.get(pr.producto_id);
      if (Number(prodEsc?.stock_actual) <= 0) { falla(`⛔ ${prodEsc?.nombre ?? "Artículo"} está AGOTADO. Dale entrada en Inventario para venderlo.`); return false; }
      const mayores = (porProducto.get(pr.producto_id) || [])
        .filter((x) => Number(x.factor_conversion) > Number(pr.factor_conversion) && Number(x.precio) > 0)
        .sort((a, b) => a.factor_conversion - b.factor_conversion);
      // Si escaneaste la pieza y el producto tiene empaque(s) mayor(es): preguntar (o
      // en modo "auto" agregar la pieza directo; al juntar 6 el six se cobra solo).
      if (Number(pr.factor_conversion) === 1 && mayores.length && getConfig().REGLAS?.empaques !== "auto")
        preguntarEmpaque(prodById.get(pr.producto_id), pr, mayores);
      else agregarLinea(pr.id, 1);
      return true;
    }

    // Entrada manual: si alguien teclea (o escanea) directo en el campo Código.
    barcode.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const code = barcode.value.trim();
      barcode.value = "";
      if (code) procesarCodigo(code);
    });

    // Captura global del lector: detecta la ráfaga del lector (sin importar dónde
    // esté el foco) y agrega el producto. Se autolimpia al salir de Venta.
    montarEscaner({ onCodigo: procesarCodigo, vivo: () => document.body.contains(contenido) && pantallaActual() === "venta" });

    // Buscador por nombre: desplegable + navegación con teclado.
    buscar.addEventListener("input", () => renderResultados(buscar.value));
    buscar.addEventListener("focus", () => { if (buscar.value.trim()) renderResultados(buscar.value); });
    buscar.addEventListener("blur", () => setTimeout(cerrarPop, 150)); // deja pasar el click en una fila
    buscar.addEventListener("keydown", (e) => {
      if (buscarPop.hidden) return;
      if (e.key === "ArrowDown") { e.preventDefault(); if (resItems.length) { resActivo = (resActivo + 1) % resItems.length; marcarActivo(); } }
      else if (e.key === "ArrowUp") { e.preventDefault(); if (resItems.length) { resActivo = (resActivo - 1 + resItems.length) % resItems.length; marcarActivo(); } }
      else if (e.key === "Enter") { e.preventDefault(); if (resActivo >= 0) elegirResultado(resActivo); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cerrarPop(); }
    });

    // ── Manipular la línea activa con teclado (sin mouse) ─────────────────────
    const idsTodosFn = () => [...ventaEnCurso.carrito.map((x) => x.presentacion_id), ...ventaEnCurso.genericos.map((g) => g.uid)];
    function ajustarActiva(delta) {
      if (!lineaActiva) return;
      const it = ventaEnCurso.carrito.find((x) => x.presentacion_id === lineaActiva);
      if (it) { if (delta > 0 && bloquearSiNoCabe(lineaActiva, 1)) return; ventaEnCurso.fijarCantidad(lineaActiva, it.cantidad + delta); recompute(); return; }
      const g = ventaEnCurso.genericos.find((x) => x.uid === lineaActiva);
      if (g) { ventaEnCurso.fijarCantidadGenerico(lineaActiva, g.cantidad + delta); recompute(); }
    }
    function quitarActiva() {
      if (!lineaActiva) return;
      const ids = idsTodosFn();
      const idx = ids.indexOf(lineaActiva);
      if (ventaEnCurso.genericos.some((g) => g.uid === lineaActiva)) ventaEnCurso.quitarGenerico(lineaActiva);
      else ventaEnCurso.quitar(lineaActiva);
      const nuevas = idsTodosFn();
      lineaActiva = nuevas[Math.min(idx, nuevas.length - 1)] ?? null;
      recompute();
    }
    function moverActiva(delta) {
      const ids = idsTodosFn();
      if (!ids.length) return;
      let i = ids.indexOf(lineaActiva);
      if (i < 0) i = 0;
      lineaActiva = ids[(i + delta + ids.length) % ids.length];
      recompute();
    }

    // ── Atajos de teclado ─────────────────────────────────────────────────────
    function atajos(e) {
      if (!document.body.contains(contenido) || pantallaActual() !== "venta") { window.removeEventListener("keydown", atajos); return; }
      // F2/F4/Escape funcionan siempre.
      if (e.key === "F2") { e.preventDefault(); buscar.focus(); return; }
      if (e.key === "F4") { e.preventDefault(); irACobrar(recompute()); return; }
      // F7 = entrada de dinero, F8 = salida (no abrir otro si ya hay un modal).
      if (e.key === "F7") { e.preventDefault(); if (!document.querySelector(".modal-fondo")) modalCaja("entrada"); return; }
      if (e.key === "F8") { e.preventDefault(); if (!document.querySelector(".modal-fondo")) modalCaja("salida"); return; }
      if (e.key === "F3") { e.preventDefault(); if (!document.querySelector(".modal-fondo")) crearTicket(); return; }
      if (e.key === "Escape") { e.preventDefault(); vaciar(); return; }
      // Atajos del carrito: no estorbar cuando escribes en el buscador o en una cantidad.
      const t = e.target;
      if (t === buscar || (t.classList && t.classList.contains("paso-num"))) return;
      if (e.key === "+" || e.key === "=") { e.preventDefault(); ajustarActiva(1); }
      else if (e.key === "-") { e.preventDefault(); ajustarActiva(-1); }
      else if (e.key === "Delete") { e.preventDefault(); quitarActiva(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); moverActiva(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); moverActiva(-1); }
    }
    window.addEventListener("keydown", atajos);

    // ── Arranque ──────────────────────────────────────────────────────────────
    pintarCarpetas();
    recompute();
    setTimeout(() => barcode.focus(), 40);
  },
};

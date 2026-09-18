// ── Panel de Tickets (historial de ventas) ──────────────────────────────────
// Se abre como desplegable desde la pantalla de Venta (botón 🧾 Tickets), igual
// que la caja. Izquierda: lista de folios. Derecha: vista del ticket (qué se
// llevaron, total, cómo pagó, recibido y cambio) con Reimprimir y Cancelar/
// Devolver. El admin ve todos los tickets; el cajero solo los suyos.
import { h, limpiar, dinero, fechaHora, modal, exito, falla } from "../lib/ui.js";
import { listarVentas, ventaCompleta, devolucionesDeVenta, registrarDevolucion, yo } from "../lib/datos.js";
import { esAdmin } from "../lib/auth.js";
import { getConfig } from "../lib/config-runtime.js";

const ETIQUETA_PAGO = { efectivo: "Efectivo", tarjeta: "Tarjeta", transferencia: "Transferencia" };
const round2 = (n) => Math.round(Number(n) * 100) / 100;
const puedeDevolver = () => esAdmin() || getConfig().REGLAS?.devoluciones_rol === "cajero";
const folioCorto = (id) => "#" + String(id).slice(0, 8);
// Limpia un contenedor y le agrega hijos, ignorando null/false (append nativo los
// convertiría en el texto "null"; h() sí filtra, pero aquí usamos append directo).
const pon = (cont, ...kids) => limpiar(cont).append(...kids.filter((k) => k != null && k !== false));

// Abre el panel de tickets (maestro/detalle) como modal ancho sobre la Venta.
export function abrirPanelTickets({ ir }) {
  modal((caja, cerrar) => {
    let soloHoy = true;
    let ventas = [];
    let selId = null;
    const filasPorId = new Map();

    const listaScroll = h("div", { class: "tickets-lista" });
    const detalle = h("div", { class: "tickets-detalle" });

    const segHoy = h("button", { class: "seg activo", onClick: () => setPeriodo(true) }, "Hoy");
    const segTodos = h("button", { class: "seg", onClick: () => setPeriodo(false) }, "Todos");
    function setPeriodo(v) {
      if (soloHoy === v) return;
      soloHoy = v; segHoy.classList.toggle("activo", v); segTodos.classList.toggle("activo", !v); cargarLista();
    }

    async function cargarLista() {
      limpiar(listaScroll).append(h("p", { class: "tenue", style: "padding:10px" }, "Cargando…"));
      const cajeroId = esAdmin() ? null : yo()?.id; // el cajero ve solo los suyos
      try { ventas = await listarVentas({ cajeroId, soloHoy }); }
      catch (e) { console.error(e); limpiar(listaScroll).append(h("p", { class: "tenue", style: "padding:10px" }, "No se pudieron cargar los tickets.")); return; }
      filasPorId.clear();
      limpiar(listaScroll);
      if (!ventas.length) {
        listaScroll.append(h("p", { class: "tenue centrado", style: "padding:24px 10px" }, soloHoy ? "No hay tickets hoy." : "No hay tickets todavía."));
        pon(detalle,h("p", { class: "tenue centrado", style: "padding:48px 10px" }, "Sin tickets para mostrar."));
        return;
      }
      if (!ventas.some((v) => v.id === selId)) selId = ventas[0].id;
      for (const v of ventas) {
        const fila = h("button", { class: "ticket-fila" + (v.id === selId ? " activo" : ""), onClick: () => seleccionar(v.id) },
          h("div", { class: "fila entre" }, h("strong", { class: "mono" }, folioCorto(v.id)), h("span", { class: "mono" }, dinero(v.total))),
          h("div", { class: "fila entre", style: "font-size:12px;margin-top:2px;gap:8px" },
            h("span", { class: "tenue" }, fechaHora(v.fecha)),
            Number(v.devuelto) > 0
              ? h("span", { class: "chip chip-adv" }, "devuelto")
              : (esAdmin() ? h("span", { class: "tenue" }, v.cajero_nombre) : h("span", { class: "tenue mono" }, `${v.num_piezas} pz`))),
        );
        filasPorId.set(v.id, fila);
        listaScroll.append(fila);
      }
      mostrarDetalle(selId);
    }

    function seleccionar(id) {
      if (id === selId) return;
      selId = id;
      for (const [k, el] of filasPorId) el.classList.toggle("activo", k === id);
      mostrarDetalle(id);
    }

    async function mostrarDetalle(id) {
      pon(detalle,h("p", { class: "tenue", style: "padding:20px" }, "Cargando ticket…"));
      let data, yaDev;
      try { [data, yaDev] = await Promise.all([ventaCompleta(id), devolucionesDeVenta(id)]); }
      catch (e) { console.error(e); limpiar(detalle).append(h("p", { class: "tenue", style: "padding:20px" }, "No se pudo cargar el ticket.")); return; }
      if (selId !== id) return; // el usuario cambió de selección mientras cargaba
      pintarDetalle(data, yaDev);
    }

    // ── Vista del ticket seleccionado ─────────────────────────────────────────
    function pintarDetalle(data, yaDev) {
      const { venta, detalle: lineas, pagos } = data;
      pon(detalle,
        h("div", { class: "fila entre", style: "align-items:baseline;gap:10px" },
          h("h3", { style: "margin:0" }, "Ticket " + folioCorto(venta.id)),
          h("span", { class: "tenue", style: "font-size:12px" }, fechaHora(venta.fecha))),
        h("div", { class: "col", style: "gap:6px;margin-top:12px" }, ...lineas.map((d) => {
          const nom = d.presentaciones?.productos?.nombre ?? d.descripcion ?? "Producto";
          const pres = d.presentaciones?.nombre ?? "";
          const tag = d.combo_id ? " · combo" : d.promocion_id ? " · promo" : "";
          const dev = yaDev[d.id] || 0;
          return h("div", { class: "fila entre" },
            h("span", {}, `${Number(d.cantidad)}× ${nom}` + (pres ? ` · ${pres}` : "") + tag + (dev > 0 ? `  (devuelto ${dev})` : "")),
            h("span", { class: "mono" }, dinero(d.subtotal)));
        })),
        Number(venta.deposito_envases) > 0
          ? h("div", { class: "fila entre tenue", style: "margin-top:2px" }, h("span", {}, "Envases (depósito)"), h("span", { class: "mono" }, dinero(venta.deposito_envases)))
          : null,
        h("hr", { style: "border:none;border-top:1px solid rgba(14,21,36,.12);margin:12px 0" }),
        h("div", { class: "fila entre" }, h("strong", {}, "TOTAL"), h("strong", { class: "mono" }, dinero(venta.total))),
        h("div", { class: "col", style: "gap:4px;margin-top:8px" }, ...pagos.map((p) =>
          h("div", { class: "fila entre tenue" }, h("span", {}, ETIQUETA_PAGO[p.metodo_pago] || p.metodo_pago), h("span", { class: "mono" }, dinero(p.monto))))),
        Number(venta.cambio) > 0
          ? h("div", { class: "col", style: "gap:4px;margin-top:6px;padding-top:6px;border-top:1px dashed rgba(14,21,36,.14)" },
              h("div", { class: "fila entre tenue" }, h("span", {}, "Recibido en efectivo"), h("span", { class: "mono" }, dinero(venta.recibido_efectivo))),
              h("div", { class: "fila entre" }, h("span", {}, "Cambio"), h("strong", { class: "mono" }, dinero(venta.cambio))))
          : null,
        h("div", { class: "fila", style: "margin-top:18px;gap:10px;flex-wrap:wrap;justify-content:flex-end" },
          puedeDevolver() ? h("button", { class: "btn btn-peligro", onClick: () => pintarDevolucion(data, yaDev) }, "Cancelar / Devolver") : null,
          h("button", { class: "btn btn-primario", onClick: () => { cerrar(); ir("ticket", { ventaId: venta.id }); } }, "Reimprimir")),
      );
    }

    // ── Vista de devolución (total o parcial) del ticket seleccionado ─────────
    function pintarDevolucion(data, yaDev) {
      const { venta, detalle: lineas } = data;
      const estado = lineas.map((d) => {
        const dev = yaDev[d.id] || 0;
        const restante = Number(d.cantidad) - dev;
        const unit = Number(d.subtotal) / Number(d.cantidad);
        return { d, restante, unit, cant: 0, danado: false };
      });
      const hayAlgo = estado.some((e) => e.restante > 0);

      const totalEl = h("strong", { class: "mono" }, dinero(0));
      const btnConfirmar = h("button", { class: "btn btn-peligro", disabled: true, onClick: confirmar }, "Confirmar devolución");
      function recomputar() {
        const total = estado.reduce((s, e) => s + round2(e.unit * e.cant), 0);
        totalEl.textContent = dinero(total);
        btnConfirmar.disabled = !(total > 0);
      }

      function filaLinea(e) {
        const nom = e.d.presentaciones?.productos?.nombre ?? e.d.descripcion ?? "Producto";
        const pres = e.d.presentaciones?.nombre ?? "";
        const esGenerico = !e.d.presentacion_id;
        if (e.restante <= 0) {
          return h("div", { class: "fila entre", style: "opacity:.55" },
            h("span", {}, `${nom}${pres ? " · " + pres : ""}`), h("span", { class: "tenue" }, "ya devuelto"));
        }
        const inp = h("input", { class: "input mono", inputmode: "numeric", value: "0", style: "width:64px;text-align:center" });
        const set = (n) => { let v = parseInt(n, 10); if (!Number.isFinite(v) || v < 0) v = 0; if (v > e.restante) v = e.restante; e.cant = v; inp.value = String(v); recomputar(); };
        inp.addEventListener("input", () => set(inp.value));
        const menos = h("button", { class: "paso", onClick: () => set(e.cant - 1) }, "−");
        const mas = h("button", { class: "paso", onClick: () => set(e.cant + 1) }, "+");
        const chkDan = h("input", { type: "checkbox", onChange: (ev) => e.danado = ev.target.checked });
        return h("div", { class: "glass", style: "padding:10px 12px;border-radius:10px" },
          h("div", { class: "fila entre", style: "margin-bottom:6px" },
            h("span", {}, `${nom}${pres ? " · " + pres : ""}`),
            h("span", { class: "tenue" }, `de ${e.restante}`)),
          h("div", { class: "fila entre", style: "gap:10px;flex-wrap:wrap" },
            h("div", { class: "stepper" }, menos, inp, mas),
            esGenerico
              ? h("span", { class: "tenue", style: "font-size:12px" }, "venta libre · no reingresa")
              : h("label", { class: "fila", style: "gap:6px;align-items:center;font-size:12px;cursor:pointer" }, chkDan, h("span", {}, "dañado (no reingresar)")),
          ),
        );
      }

      const filas = estado.map(filaLinea);
      const btnTodo = h("button", { class: "btn btn-fantasma btn-mini", onClick: () => {
        estado.forEach((e, i) => { if (e.restante > 0) { e.cant = e.restante; const inp = filas[i].querySelector("input.mono"); if (inp) inp.value = String(e.restante); } });
        recomputar();
      } }, "Devolver todo");

      async function confirmar() {
        const dl = estado.filter((e) => e.cant > 0)
          .map((e) => ({ venta_detalle_id: e.d.id, cantidad: e.cant, reingresar: !e.danado }));
        if (!dl.length) { falla("Elige al menos una cantidad a devolver."); return; }
        btnConfirmar.disabled = true; btnConfirmar.textContent = "Procesando…";
        try {
          const res = await registrarDevolucion({ ventaId: venta.id, lineas: dl });
          exito(`Devolución registrada · reembolso ${dinero(res.total)}`);
          imprimirNotaDevolucion(venta, estado.filter((e) => e.cant > 0), res.total);
          cargarLista(); // refresca lista (marca "devuelto") y el detalle
        } catch (err) {
          console.error(err);
          falla("No se pudo registrar: " + (err.message || "error"));
          btnConfirmar.disabled = false; btnConfirmar.textContent = "Confirmar devolución";
        }
      }

      pon(detalle,
        h("h3", {}, "Cancelar / Devolver · " + folioCorto(venta.id)),
        h("p", { class: "tenue", style: "margin:4px 0 12px;font-size:13px" },
          "Elige cuánto devolver por línea. El reembolso es en efectivo y sale de la caja. El producto regresa al inventario, salvo que marques “dañado”."),
        hayAlgo ? h("div", { class: "fila", style: "justify-content:flex-end;margin-bottom:8px" }, btnTodo) : null,
        hayAlgo ? h("div", { class: "col", style: "gap:8px" }, ...filas)
          : h("p", { class: "tenue centrado", style: "padding:16px" }, "Esta venta ya fue devuelta por completo."),
        h("hr", { style: "border:none;border-top:1px solid rgba(14,21,36,.12);margin:14px 0" }),
        h("div", { class: "fila entre", style: "margin-bottom:16px" }, h("span", {}, "A reembolsar (efectivo)"), totalEl),
        h("div", { class: "fila entre", style: "gap:10px" },
          h("button", { class: "btn btn-fantasma", onClick: () => pintarDetalle(data, yaDev) }, "Volver"),
          btnConfirmar),
      );
      recomputar();
    }

    // ── Estructura del panel ──────────────────────────────────────────────────
    caja.append(
      h("div", { class: "fila entre", style: "align-items:center;gap:10px" },
        h("h3", { style: "margin:0" }, "Tickets"),
        h("button", { class: "btn btn-fantasma btn-mini", onClick: cerrar }, "Cerrar")),
      h("p", { class: "tenue", style: "margin:2px 0 12px;font-size:13px" },
        esAdmin() ? "Elige un folio a la izquierda para ver el ticket." : "Tus ventas. Elige un folio para ver el ticket."),
      h("div", { class: "segmented", style: "max-width:220px" }, segHoy, segTodos),
      h("div", { class: "tickets-grid" }, listaScroll, detalle),
    );
    cargarLista();
  }, { ancho: 960 });
}

// Pantalla registrada solo por compatibilidad de ruta; fuera del menú.
// El acceso real a los tickets es el botón 🧾 Tickets de la pantalla de Venta.
export const historial = {
  id: "historial", etiqueta: "Tickets", titulo: "Tickets", roles: ["admin", "cajero"], enNav: false,
  render({ ir }) { ir("venta"); setTimeout(() => abrirPanelTickets({ ir }), 60); },
};

// Nota de devolución imprimible (reusa el estilo del ticket).
function imprimirNotaDevolucion(venta, lineasDevueltas, total) {
  const CFG = getConfig();
  const NEG = CFG.NEGOCIO || {};
  const TK = CFG.TICKET || {};
  const nota = h("div", { class: "ticket ancho-" + (TK.ancho === "80" ? "80" : "58") },
    h("h3", {}, `${NEG.nombre || ""}${NEG.sucursal ? " · " + NEG.sucursal : ""}`),
    NEG.lugar ? h("div", { class: "t-sub" }, NEG.lugar) : null,
    h("div", { class: "t-sub" }, "NOTA DE DEVOLUCIÓN"),
    h("hr", { class: "t-sep" }),
    h("div", { class: "t-fila" }, h("span", {}, "Ticket"), h("span", {}, folioCorto(venta.id))),
    h("div", { class: "t-fila" }, h("span", {}, "Fecha"), h("span", {}, fechaHora(new Date()))),
    h("hr", { class: "t-sep" }),
    ...lineasDevueltas.map((e) => {
      const nom = e.d.presentaciones?.productos?.nombre ?? e.d.descripcion ?? "Producto";
      return h("div", { class: "t-item" },
        h("div", { class: "t-nom" }, h("span", {}, `${e.cant}× ${nom}`), h("span", {}, dinero(round2(e.unit * e.cant)))),
        h("small", {}, (e.d.presentaciones?.nombre || "") + (e.danado ? " · dañado (no reingresa)" : "")));
    }),
    h("hr", { class: "t-sep" }),
    h("div", { class: "t-fila t-total" }, h("span", {}, "REEMBOLSO"), h("span", {}, dinero(total))),
    h("div", { class: "t-pie" }, "Devolución en efectivo"),
    TK.pie ? h("div", { class: "t-pie" }, TK.pie) : null,
  );
  const wrap = h("div", { class: "ticket-wrap", id: "nota-print", style: "position:fixed;left:-9999px;top:0" }, nota);
  document.body.append(wrap);
  setTimeout(() => { window.print(); setTimeout(() => wrap.remove(), 300); }, 50);
}

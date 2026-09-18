// ── Pantalla: Ticket imprimible ─────────────────────────────────────────────
// Renderiza desde la venta normalizada que arma Pago (funciona online y offline,
// sin depender de la nube). Si solo llega un ventaId, lo reconstruye de la nube.
// La identidad del negocio, el ancho y qué se muestra salen de la configuración.
import { h, limpiar, dinero, fechaHora } from "../lib/ui.js";
import { getConfig } from "../lib/config-runtime.js";
import { ventaCompleta } from "../lib/datos.js";
import { ultimaVenta } from "../lib/estado.js";

export const ticket = {
  id: "ticket", etiqueta: "Ticket", titulo: "Ticket", roles: ["admin", "cajero"], enNav: false, full: true,
  async render({ contenido, ir, params }) {
    limpiar(contenido);
    const CFG = getConfig();
    const NEG = CFG.NEGOCIO || {};
    const TK = CFG.TICKET || {};
    const mostrar = TK.mostrar || { folio: true, hora: true, cajero: true, deposito: true };
    const etiquetaPago = (id) => (CFG.REGLAS?.metodos_pago || []).find((m) => m.id === id)?.etiqueta
      || ({ efectivo: "Efectivo", tarjeta: "Tarjeta", transferencia: "Transferencia" }[id]) || id;

    const acciones = h("div", { class: "ticket-acciones" },
      h("button", { class: "btn", onClick: () => window.print() }, "🖨️  Imprimir"),
      h("button", { class: "btn btn-primario", onClick: () => ir("venta") }, "Nueva venta"),
      h("button", { class: "btn btn-fantasma", onClick: () => ir("corte") }, "Ir al corte"),
    );

    let venta = params?.venta || null;
    if (!venta) {
      // Reconstruir desde la nube (caso: se abrió el ticket con solo un id).
      const ventaId = params?.ventaId || ultimaVenta.id;
      if (!ventaId) { contenido.append(h("div", { class: "cargando" }, "No hay venta para mostrar.")); return; }
      contenido.append(h("div", { class: "cargando" }, "Preparando ticket…"));
      try {
        const { venta: v, detalle, pagos } = await ventaCompleta(ventaId);
        venta = {
          id: v.id, fecha: v.fecha, cajeroNombre: "", total: v.total,
          lineas: detalle.map((d) => ({ cantidad: d.cantidad, nombre: d.presentaciones?.productos?.nombre ?? d.descripcion ?? "Producto",
            presentacion: d.presentaciones?.nombre ?? "", subtotal: d.subtotal, combo_id: d.combo_id, promocion_id: d.promocion_id })),
          pagos: pagos.map((p) => ({ metodo_pago: p.metodo_pago, monto: p.monto })),
          envases: v.envases || {}, deposito: v.deposito_envases ?? 0,
        };
      } catch (e) { console.error(e); limpiar(contenido).append(h("div", { class: "cargando" }, "No se pudo cargar la venta.")); return; }
    }

    // Líneas de envases retornables (depósito), por tipo configurado.
    const envaseLineas = [];
    if (mostrar.deposito !== false) {
      const infoPorClave = new Map((CFG.ENVASES || []).map((t) => [t.clave, { nombre: t.nombre, deposito: Number(t.deposito) || 0 }]));
      for (const [clave, cant] of Object.entries(venta.envases || {})) {
        const c = Number(cant) || 0; if (c <= 0) continue;
        const info = infoPorClave.get(clave) || { nombre: clave, deposito: 0 };
        envaseLineas.push(h("div", { class: "t-item" },
          h("div", { class: "t-nom" }, h("span", {}, `${c}× Envase ${info.nombre}`), h("span", {}, dinero(c * info.deposito))),
          h("small", {}, "envase retornable")));
      }
    }

    const paper = h("div", { class: "ticket ancho-" + (TK.ancho === "80" ? "80" : "58") },
      h("h3", {}, `${NEG.nombre || ""}${NEG.sucursal ? " · " + NEG.sucursal : ""}`),
      NEG.lugar ? h("div", { class: "t-sub" }, NEG.lugar) : null,
      h("hr", { class: "t-sep" }),
      mostrar.folio !== false ? h("div", { class: "t-fila" }, h("span", {}, "Folio"), h("span", {}, "#" + String(venta.id).slice(0, 8))) : null,
      mostrar.hora !== false ? h("div", { class: "t-fila" }, h("span", {}, "Fecha"), h("span", {}, fechaHora(venta.fecha))) : null,
      (mostrar.cajero !== false && venta.cajeroNombre) ? h("div", { class: "t-fila" }, h("span", {}, "Atendió"), h("span", {}, venta.cajeroNombre)) : null,
      h("hr", { class: "t-sep" }),
      ...venta.lineas.map((d) => {
        const tag = d.combo_id ? " · combo" : d.promocion_id ? " · promo" : "";
        return h("div", { class: "t-item" },
          h("div", { class: "t-nom" }, h("span", {}, `${Number(d.cantidad)}× ${d.nombre}`), h("span", {}, dinero(d.subtotal))),
          h("small", {}, (d.presentacion || "") + tag));
      }),
      ...envaseLineas,
      h("hr", { class: "t-sep" }),
      h("div", { class: "t-fila t-total" }, h("span", {}, "TOTAL"), h("span", {}, dinero(venta.total))),
      h("div", { class: "t-pagos" }, ...venta.pagos.map((p) =>
        h("div", { class: "t-fila" }, h("span", {}, etiquetaPago(p.metodo_pago)), h("span", {}, dinero(p.monto))))),
      Number(venta.cambio) > 0 ? h("div", { class: "t-pagos" },
        h("div", { class: "t-fila" }, h("span", {}, "Recibido (efectivo)"), h("span", {}, dinero(venta.recibidoEfectivo))),
        h("div", { class: "t-fila" }, h("span", {}, "Cambio"), h("span", {}, dinero(venta.cambio))),
      ) : null,
      h("hr", { class: "t-sep" }),
      TK.agradecimiento ? h("div", { class: "t-pie" }, TK.agradecimiento) : null,
      TK.pie ? h("div", { class: "t-pie" }, TK.pie) : null,
    );

    limpiar(contenido).append(h("div", { class: "ticket-wrap" }, paper, acciones));
  },
};

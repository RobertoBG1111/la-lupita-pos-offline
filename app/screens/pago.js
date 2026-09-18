// ── Pantalla: Pago / Cobro ──────────────────────────────────────────────────
// El efectivo PUEDE ser mayor al total (se calcula el cambio). Los demás métodos
// (tarjeta, transferencia, …) van exactos (no dan cambio). Lo que se REGISTRA como
// venta siempre suma el total exacto: el efectivo aplicado = total − (no-efectivo);
// el sobrante en efectivo es el cambio que se devuelve (solo operativo).
// Los métodos de pago y el redondeo del efectivo salen de la configuración.
import { h, limpiar, dinero, falla, exito } from "../lib/ui.js";
import { registrarVenta, turnoActivoDe, yo } from "../lib/datos.js";
import { ventaEnCurso, ultimaVenta } from "../lib/estado.js";
import { getConfig } from "../lib/config-runtime.js";

const esEfectivo = (id) => id === "efectivo";

export const pago = {
  id: "pago", etiqueta: "Pago", titulo: "Cobro", roles: ["admin", "cajero"], enNav: false,
  render({ contenido, ir, params }) {
    const calc = params?.calc;
    if (!calc || ventaEnCurso.vacio) { ir("venta"); return; }

    const REGLAS = getConfig().REGLAS || {};
    const METODOS = (REGLAS.metodos_pago || []).filter((m) => m.activo);
    // Salvaguarda: si no hay ninguno activo, deja al menos efectivo.
    if (!METODOS.length) METODOS.push({ id: "efectivo", etiqueta: "Efectivo", activo: true });
    const etiquetaPago = (id) => (METODOS.find((m) => m.id === id)?.etiqueta) || id;

    // Envases retornables por cobrar (vienen de la pantalla previa): { clave: cantidad }.
    const envasesMap = params?.envases && typeof params.envases === "object" ? params.envases : {};
    const depoPorClave = new Map((getConfig().ENVASES || []).map((t) => [t.clave, Number(t.deposito) || 0]));
    let depositoCent = 0;
    for (const [clave, cant] of Object.entries(envasesMap)) depositoCent += Math.round((Number(cant) || 0) * (depoPorClave.get(clave) || 0) * 100);

    const totalCent = calc.totalCentavos + depositoCent;
    const montos = {}; METODOS.forEach((m) => { montos[m.id] = 0; });
    const refsInput = {}; // método → <input> (para enfocar Efectivo al abrir)
    const cent = (v) => Math.round((Number(v) || 0) * 100);

    const filasPago = h("div", { class: "col", style: "gap:12px" });
    const resumen = h("div", {});
    const confirmar = h("button", { class: "btn btn-primario btn-lg btn-bloque", "data-glow": "1", disabled: true, onClick: cobrar }, "Confirmar cobro");

    function noEfectivoCent() { return METODOS.reduce((s, m) => s + (esEfectivo(m.id) ? 0 : cent(montos[m.id])), 0); }
    function pagadoCent() { return METODOS.reduce((s, m) => s + cent(montos[m.id]), 0); }

    function repintar() {
      const pag = pagadoCent();
      const noEfe = noEfectivoCent();
      const dif = pag - totalCent;
      const excesoTarjeta = noEfe > totalCent; // los métodos no-efectivo no pueden pasar el total

      const lineas = [];
      if (depositoCent > 0) {
        lineas.push(
          h("div", { class: "fila entre cobro-linea" }, h("span", { class: "tenue" }, "Productos"), h("span", { class: "mono" }, dinero(calc.totalCentavos / 100))),
          h("div", { class: "fila entre cobro-linea" }, h("span", { class: "tenue" }, "Envases retornables"), h("span", { class: "mono" }, dinero(depositoCent / 100))),
        );
      }
      lineas.push(
        h("div", { class: "fila entre cobro-linea" }, h("span", { class: "tenue" }, "Total a cobrar"), h("strong", { class: "mono" }, dinero(totalCent / 100))),
        h("div", { class: "fila entre cobro-linea" }, h("span", { class: "tenue" }, "Pagado"), h("span", { class: "mono" }, dinero(pag / 100))),
      );
      if (excesoTarjeta) {
        lineas.push(h("div", { class: "fila entre cobro-linea falta" }, h("span", {}, "El pago sin efectivo excede el total"), h("strong", {}, "✕")));
      } else if (dif < 0) {
        lineas.push(h("div", { class: "fila entre cobro-linea falta" }, h("span", {}, "Falta"), h("strong", { class: "mono" }, dinero(-dif / 100))));
      } else if (dif > 0) {
        lineas.push(h("div", { class: "fila entre cobro-linea cambio" }, h("span", {}, "Cambio"), h("strong", { class: "mono" }, dinero(dif / 100))));
      } else {
        lineas.push(h("div", { class: "fila entre cobro-linea cuadra" }, h("span", {}, "Cuadra exacto"), h("strong", {}, "✓")));
      }
      limpiar(resumen).append(...lineas);

      // Se activa cuando el pago cubre el total y la parte no-efectivo no lo excede.
      confirmar.disabled = !(pag >= totalCent && !excesoTarjeta);
    }

    function pintarFilas() {
      limpiar(filasPago);
      for (const m of METODOS) {
        const inp = h("input", { class: "input mono", type: "text", inputmode: "decimal", value: montos[m.id] ? String(montos[m.id]) : "", placeholder: "0.00",
          onInput: (e) => { const v = parseFloat(e.target.value.replace(",", ".")); montos[m.id] = Number.isFinite(v) && v > 0 ? v : 0; repintar(); },
          // Enter cobra directo si ya cuadra (sin tocar el mouse).
          onKeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); if (!confirmar.disabled) cobrar(); } } });
        refsInput[m.id] = inp;
        filasPago.append(h("div", { class: "campo" },
          h("label", {}, m.etiqueta),
          h("div", { class: "fila", style: "gap:8px" }, inp,
            h("button", { class: "btn btn-mini", title: "Cargar lo que falta para cuadrar el total en este método", onClick: () => {
                // Lo justo = total − lo ya escrito en los OTROS métodos.
                const otrosCent = pagadoCent() - cent(montos[m.id]);
                let restanteCent = Math.max(0, totalCent - otrosCent);
                // El efectivo puede redondearse (monedas); los demás van exactos.
                if (esEfectivo(m.id)) {
                  const paso = Math.round((Number(REGLAS.redondeo) || 0) * 100);
                  if (paso > 0) restanteCent = Math.ceil(restanteCent / paso) * paso;
                }
                montos[m.id] = restanteCent / 100; pintarFilas(); repintar();
              } }, "Justo")),
        ));
      }
    }

    async function cobrar() {
      const noEfe = noEfectivoCent();
      const pag = pagadoCent();
      if (noEfe > totalCent) { falla("El pago sin efectivo no puede exceder el total."); return; }
      if (pag < totalCent) { falla("El pago no cubre el total."); return; }
      confirmar.disabled = true; confirmar.textContent = "Cobrando…";
      try {
        let turno = null;
        try { turno = await turnoActivoDe(yo().id); } catch { /* venta sin turno */ }

        // Pagos REGISTRADOS: suman el total exacto. El efectivo aplicado es el
        // remanente tras los demás métodos; el resto del efectivo es cambio.
        const efectivoAplicadoCent = totalCent - noEfe;
        const cambioCent = pag - totalCent;
        const efectivoRecibido = Number(montos.efectivo) || 0;
        const pagos = [];
        if (efectivoAplicadoCent > 0) pagos.push({ metodo_pago: "efectivo", monto: efectivoAplicadoCent / 100 });
        for (const m of METODOS) {
          if (esEfectivo(m.id)) continue;
          if (cent(montos[m.id]) > 0) pagos.push({ metodo_pago: m.id, monto: montos[m.id] });
        }

        const res = await registrarVenta({ lineas: calc.rows, pagos, turnoId: turno?.id ?? null, envases: envasesMap,
          recibidoEfectivo: efectivoRecibido, cambio: cambioCent / 100 });

        const ventaLocal = construirVentaLocal(res.id, pagos, efectivoRecibido, cambioCent / 100);
        ultimaVenta.id = res.id;
        ventaEnCurso.vaciar();
        if (res.offline) exito("📴 Venta guardada sin conexión — se enviará al reconectar" + (cambioCent > 0 ? ` · cambio ${dinero(cambioCent / 100)}` : ""));
        else exito(cambioCent > 0 ? `Venta cobrada · cambio ${dinero(cambioCent / 100)}` : "Venta cobrada");
        ir("ticket", { venta: ventaLocal });
      } catch (e) {
        console.error(e);
        falla(e.message?.includes("pagos") ? "Se rechazó el cobro: los pagos no cuadran con el total." : ("No se pudo registrar la venta: " + (e.message || "error")));
        confirmar.disabled = false; confirmar.textContent = "Confirmar cobro";
      }
    }

    // Arma la venta normalizada para el Ticket (todo local, sin pegar a la nube).
    function construirVentaLocal(id, pagos, recibidoEfectivo, cambio) {
      const lineas = calc.rows.map((r) => {
        if (r.generico) return { cantidad: r.cantidad, nombre: r.descripcion, presentacion: "", subtotal: r.subtotal, combo_id: null, promocion_id: null };
        const pr = calc.presById.get(r.presentacion_id);
        const prod = pr ? calc.prodById.get(pr.producto_id) : null;
        return { cantidad: r.cantidad, nombre: prod?.nombre ?? "Producto", presentacion: pr?.nombre ?? "",
          subtotal: r.subtotal, combo_id: r.combo_id, promocion_id: r.promocion_id };
      });
      return { id, fecha: new Date().toISOString(), cajeroNombre: yo()?.nombre ?? "", lineas, pagos, total: totalCent / 100,
        recibidoEfectivo: Number(recibidoEfectivo) || 0, cambio: Number(cambio) || 0,
        envases: envasesMap, deposito: depositoCent / 100 };
    }

    limpiar(contenido).append(
      h("div", { class: "titulo-seccion" }, h("div", {}, h("h2", {}, "Cobro"), h("p", {}, "El efectivo puede ser mayor: se calcula el cambio. Los demás métodos van exactos."))),
      h("div", { class: "cobro-grid" },
        h("div", { class: "glass card" }, h("h3", { style: "margin-bottom:14px" }, "¿Cómo paga?"), filasPago),
        h("div", { class: "glass glass-fuerte card" }, resumen,
          h("div", { style: "margin-top:20px;display:flex;flex-direction:column;gap:10px" }, confirmar,
            h("button", { class: "btn btn-fantasma btn-bloque", onClick: () => ir("venta") }, "Volver a la venta")),
        ),
      ),
    );
    pintarFilas();
    repintar();
    // Cursor listo en Efectivo (o el primer método) para teclear lo que da el cliente.
    setTimeout(() => { (refsInput.efectivo || refsInput[METODOS[0]?.id])?.focus(); }, 50);
  },
};

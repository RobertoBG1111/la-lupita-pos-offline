// ── Pantalla: Corte de caja ─────────────────────────────────────────────────
// Dos vistas con un interruptor:
//   • Mi turno   — cuadra la caja del turno abierto (por cajero); permite cerrarlo.
//   • El día de hoy — total del día por fecha, juntando todos los turnos (admin ve
//     toda la tienda; el cajero ve solo su propio día).
import { h, limpiar, dinero, confirmar, modal, exito, falla } from "../lib/ui.js";
import { turnoActivoDe, resumenTurno, detalleTurno, cerrarTurno, resumenDia, detalleDia, yo } from "../lib/datos.js";
import { salir, perfil, esAdmin } from "../lib/auth.js";
import { estaOnline } from "../lib/conexion.js";
import { contarPendientes } from "../lib/cola.js";

const kpi = (etiq, val, sub) => h("div", { class: "glass card kpi" },
  h("div", { class: "kpi-val mono" }, val), h("div", { class: "kpi-etq" }, etiq), sub ? h("div", { class: "tenue kpi-sub" }, sub) : null);
const metodo = (etiq, val) => h("div", { class: "glass card metodo" },
  h("span", { class: "tenue" }, etiq), h("strong", { class: "mono" }, dinero(val)));

// Desglose "ventas por producto" (barras) + tabla por presentación, a partir de
// las líneas de venta. Reutilizado por ambas vistas.
function desgloseProductos(detalle) {
  const porProd = new Map(), porCat = new Map();
  for (const d of detalle) {
    const prod = d.presentaciones?.productos?.nombre ?? d.descripcion ?? "—";
    const categoria = d.presentaciones?.productos?.categoria || (d.descripcion ? "Venta libre" : "Sin categoría");
    porProd.set(prod, (porProd.get(prod) || 0) + Number(d.subtotal));
    porCat.set(categoria, { monto: (porCat.get(categoria)?.monto || 0) + Number(d.subtotal), cant: (porCat.get(categoria)?.cant || 0) + Number(d.cantidad) });
  }
  const prodOrden = [...porProd.entries()].sort((a, b) => b[1] - a[1]);
  const maxProd = prodOrden.length ? prodOrden[0][1] : 0;
  return h("div", {},
    h("h3", { class: "corte-h3" }, "Ventas por producto"),
    h("div", { class: "glass card" },
      prodOrden.length
        ? h("div", { class: "barras" }, ...prodOrden.map(([nom, monto]) =>
            h("div", { class: "barra-fila" },
              h("span", { class: "barra-nom" }, nom),
              h("div", { class: "barra-pista" }, h("div", { class: "barra-fill", style: `width:${maxProd ? (monto / maxProd * 100) : 0}%` })),
              h("span", { class: "barra-val mono" }, dinero(monto)),
            )))
        : h("p", { class: "tenue centrado", style: "padding:24px" }, "Aún no hay ventas."),
    ),
    porCat.size ? h("h3", { class: "corte-h3" }, "Por categoría") : "",
    porCat.size ? h("div", { class: "glass card", style: "overflow-x:auto" },
      h("table", { class: "tabla" },
        h("thead", {}, h("tr", {}, h("th", {}, "Categoría"), h("th", { class: "num" }, "Piezas"), h("th", { class: "num" }, "Importe"))),
        h("tbody", {}, ...[...porCat.entries()].sort((a, b) => b[1].monto - a[1].monto).map(([nom, v]) =>
          h("tr", {}, h("td", {}, nom), h("td", { class: "num mono" }, String(v.cant)), h("td", { class: "num mono" }, dinero(v.monto))))),
      ),
    ) : "",
  );
}

export const corte = {
  id: "corte", etiqueta: "Corte de caja", titulo: "Corte de caja", roles: ["admin", "cajero"], enNav: true,
  async render({ contenido, ir }) {
    let modo = "turno"; // "turno" | "dia"

    function segmentado() {
      const btnTurno = h("button", { class: "seg" + (modo === "turno" ? " activo" : ""), onClick: () => { modo = "turno"; pintar(); } }, "Mi turno");
      const btnDia = h("button", { class: "seg" + (modo === "dia" ? " activo" : ""), onClick: () => { modo = "dia"; pintar(); } }, "El día de hoy");
      return h("div", { class: "segmented", style: "max-width:360px" }, btnTurno, btnDia);
    }

    async function pintar() {
      limpiar(contenido).append(h("div", { class: "cargando" }, "Cargando corte…"));
      // Sin conexión: el corte se calcula en la nube. Avisamos (y cuántas ventas
      // quedan en espera) en vez de mostrar un error genérico.
      if (!estaOnline()) {
        const n = await contarPendientes().catch(() => 0);
        limpiar(contenido).append(
          h("div", { class: "titulo-seccion" }, h("div", {}, h("h2", {}, "Corte de caja"), h("p", {}, "No disponible sin conexión."))),
          h("div", { class: "glass card centrado", style: "padding:40px" },
            h("p", { class: "tenue", style: "font-size:15px;line-height:1.6" },
              "📴 El corte se calcula en la nube y no está disponible sin conexión." +
              (n ? ` Hay ${n} venta(s) en espera de sincronizar; al reconectar se enviarán y el corte las incluirá.` : " Reconéctate para ver el corte del turno y del día."))),
        );
        return;
      }
      try {
        const cuerpo = modo === "turno" ? await vistaTurno() : await vistaDia();
        limpiar(contenido).append(
          h("div", { class: "titulo-seccion" },
            h("div", {}, h("h2", {}, "Corte de caja"), h("p", {}, modo === "turno" ? "Cuadra la caja de tu turno." : "Total del día, juntando todos los turnos.")),
          ),
          segmentado(),
          h("div", { style: "height:16px" }),
          cuerpo,
        );
      } catch (e) {
        console.error(e);
        limpiar(contenido).append(h("div", { class: "cargando" }, "No se pudo cargar el corte."));
      }
    }

    // ── Vista: Mi turno ────────────────────────────────────────────────────────
    async function vistaTurno() {
      const turno = await turnoActivoDe(yo().id).catch(() => null);
      if (!turno) {
        return h("div", { class: "glass card centrado", style: "padding:48px" }, h("p", { class: "tenue" }, "No tienes un turno abierto."));
      }
      const [resumen, detalle] = await Promise.all([resumenTurno(turno.id), detalleTurno(turno.id)]);
      const nVentas = Number(resumen.num_ventas) || 0;
      const total = Number(resumen.total_vendido) || 0;
      const promedio = nVentas ? total / nVentas : 0;
      const devol = Number(resumen.devoluciones_total) || 0;
      // Ventas netas = bruto − devoluciones. OJO: puede ser 0 legítimamente (todo devuelto),
      // así que NO usar `|| total` (0 es falsy y caería al bruto).
      const netas = resumen.ventas_netas != null ? Number(resumen.ventas_netas) : total - devol;

      async function hacerCierre() {
        const ok = await confirmar(
          `Vas a cerrar tu turno. Vendiste ${dinero(total)} en ${nVentas} venta(s). Después tendrás que iniciar sesión de nuevo.`,
          { titulo: "Cerrar turno", okTexto: "Cerrar turno" });
        if (!ok) return;
        try { await cerrarTurno(turno.id); }
        catch (e) { console.error(e); falla("No se pudo cerrar el turno."); return; }
        const nombre = perfil()?.nombre ?? "";
        await salir();
        modal((caja, cerrar) => {
          caja.append(
            h("h3", {}, "Turno cerrado"),
            h("p", { style: "margin:12px 0 4px;font-size:17px" }, `Vendiste ${dinero(total)} en ${nVentas} venta(s).`),
            h("p", { class: "tenue", style: "margin:0 0 20px" }, `¡Gracias, ${nombre}!`),
            h("button", { class: "btn btn-primario btn-bloque", onClick: () => { cerrar(); ir("bienvenida"); } }, "Aceptar"),
          );
        });
      }

      return h("div", {},
        h("div", { class: "fila entre", style: "margin-bottom:16px" },
          h("p", { class: "tenue" }, `Turno abierto · ${perfil()?.nombre ?? ""}`),
          h("button", { class: "btn btn-peligro", "data-glow": "1", onClick: hacerCierre }, "Cerrar turno"),
        ),
        h("div", { class: "kpi-grid" },
          kpi("Total vendido", dinero(total)),
          kpi("Ventas", String(nVentas)),
          kpi("Ticket promedio", dinero(promedio)),
        ),
        h("h3", { class: "corte-h3" }, "Por método de pago"),
        h("div", { class: "metodo-grid" },
          metodo("Efectivo", resumen.total_efectivo),
          metodo("Tarjeta", resumen.total_tarjeta),
          metodo("Transferencia", resumen.total_transferencia),
        ),
        h("h3", { class: "corte-h3" }, "Efectivo en caja"),
        h("div", { class: "metodo-grid" },
          metodo("Fondo inicial", Number(resumen.fondo_inicial) || 0),
          metodo("Ventas en efectivo", resumen.total_efectivo),
          metodo("Entradas de caja", Number(resumen.entradas_caja) || 0),
          metodo("Salidas de caja", Number(resumen.salidas_caja) || 0),
          metodo("Devoluciones", Number(resumen.devoluciones_total) || 0),
          metodo("Esperado en cajón", Number(resumen.efectivo_esperado) || 0),
        ),
        devol > 0 ? h("p", { class: "tenue", style: "margin-top:10px" },
          `Ventas netas (menos devoluciones): ${dinero(netas)}`) : null,
        desgloseProductos(detalle),
      );
    }

    // ── Vista: El día de hoy ─────────────────────────────────────────────────────
    async function vistaDia() {
      const soloYo = esAdmin() ? null : yo()?.id; // el cajero ve solo su propio día
      const [resumen, detalle] = await Promise.all([
        resumenDia({ cajeroId: soloYo }), detalleDia({ cajeroId: soloYo }),
      ]);
      const nVentas = Number(resumen.num_ventas) || 0;
      const total = Number(resumen.total_vendido) || 0;
      const promedio = nVentas ? total / nVentas : 0;
      const devol = Number(resumen.devoluciones_total) || 0;
      const netas = resumen.ventas_netas != null ? Number(resumen.ventas_netas) : total - devol;
      const alcance = esAdmin() ? "Toda la tienda, todos los turnos de hoy." : "Solo tus ventas de hoy.";

      return h("div", {},
        h("p", { class: "tenue", style: "margin-bottom:16px" }, `${alcance} · ${resumen.num_turnos} turno(s)`),
        h("div", { class: "kpi-grid" },
          kpi("Total del día", dinero(total)),
          kpi("Ventas", String(nVentas)),
          kpi("Ticket promedio", dinero(promedio)),
        ),
        h("h3", { class: "corte-h3" }, "Por método de pago"),
        h("div", { class: "metodo-grid" },
          metodo("Efectivo", resumen.total_efectivo),
          metodo("Tarjeta", resumen.total_tarjeta),
          metodo("Transferencia", resumen.total_transferencia),
        ),
        devol > 0 ? h("div", {},
          h("h3", { class: "corte-h3" }, "Devoluciones"),
          h("div", { class: "metodo-grid" },
            metodo("Devuelto (efectivo)", devol),
            metodo("Ventas netas", netas),
          )) : null,
        desgloseProductos(detalle),
      );
    }

    pintar();
  },
};

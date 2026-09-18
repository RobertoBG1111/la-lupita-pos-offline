// ── Pantalla: Reportes (solo admin) ─────────────────────────────────────────
import { h, limpiar, dinero } from "../lib/ui.js";
import { ventasEntre, detalleEntre, inventario } from "../lib/datos.js";

const DIA = 86400000;

export const reportes = {
  id: "reportes", etiqueta: "Reportes", titulo: "Reportes", roles: ["admin"], enNav: true,
  async render({ contenido }) {
    limpiar(contenido).append(h("div", { class: "cargando" }, "Cargando reportes…"));

    const ahora = new Date();
    const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1).toISOString();
    const hace14 = new Date(Date.now() - 14 * DIA).toISOString();

    let ventasMes, ventas14, detMes, inv;
    try {
      [ventasMes, ventas14, detMes, inv] = await Promise.all([
        ventasEntre(inicioMes, ahora.toISOString()),
        ventasEntre(hace14, ahora.toISOString()),
        detalleEntre(inicioMes, ahora.toISOString()),
        inventario(),
      ]);
    } catch (e) { console.error(e); limpiar(contenido).append(h("div", { class: "cargando" }, "No se pudieron cargar los reportes.")); return; }

    const totalMes = ventasMes.reduce((s, v) => s + Number(v.total), 0);
    const nMes = ventasMes.length;
    const prom = nMes ? totalMes / nMes : 0;

    // Tendencia 14 días (por día)
    const porDia = new Map();
    for (let i = 13; i >= 0; i--) { const d = new Date(Date.now() - i * DIA); porDia.set(fkey(d), 0); }
    for (const v of ventas14) { const k = fkey(new Date(v.fecha)); if (porDia.has(k)) porDia.set(k, porDia.get(k) + Number(v.total)); }
    const dias = [...porDia.entries()];
    const maxDia = Math.max(1, ...dias.map(([, v]) => v));

    // Ventas por producto (mes)
    const porProd = new Map();
    for (const d of detMes) { const nom = d.presentaciones?.productos?.nombre ?? "—"; porProd.set(nom, (porProd.get(nom) || 0) + Number(d.subtotal)); }
    const prodOrden = [...porProd.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    const maxProd = prodOrden.length ? prodOrden[0][1] : 1;

    // Alertas "para decidir esta semana"
    const bajos = inv.productos.filter((p) => p.activo && Number(p.stock_actual) <= Number(p.stock_minimo));
    const lotesAlerta = (inv.lotes || []).filter((l) => l.estado !== "vigente");

    limpiar(contenido).append(
      h("div", { class: "titulo-seccion" }, h("div", {}, h("h2", {}, "Reportes"), h("p", {}, "Resumen del mes y señales para decidir."))),
      h("div", { class: "kpi-grid" },
        kpi("Vendido este mes", dinero(totalMes)),
        kpi("Ventas del mes", String(nMes)),
        kpi("Ticket promedio", dinero(prom)),
      ),
      h("h3", { class: "corte-h3" }, "Tendencia · últimos 14 días"),
      h("div", { class: "glass card" }, h("div", { class: "spark" }, ...dias.map(([k, v]) =>
        h("div", { class: "spark-col", title: `${k}: ${dinero(v)}` },
          h("div", { class: "spark-fill", style: `height:${Math.round(v / maxDia * 100)}%` }),
          h("span", { class: "spark-x" }, k.slice(5)))))),
      h("h3", { class: "corte-h3" }, "Ventas por producto (mes)"),
      h("div", { class: "glass card" },
        prodOrden.length ? h("div", { class: "barras" }, ...prodOrden.map(([nom, monto]) =>
          h("div", { class: "barra-fila" },
            h("span", { class: "barra-nom" }, nom),
            h("div", { class: "barra-pista" }, h("div", { class: "barra-fill", style: `width:${Math.round(monto / maxProd * 100)}%` })),
            h("span", { class: "barra-val mono" }, dinero(monto)))))
          : h("p", { class: "tenue centrado", style: "padding:24px" }, "Sin ventas este mes.")),
      h("h3", { class: "corte-h3" }, "Para decidir esta semana"),
      h("div", { class: "glass card decidir" },
        ...(bajos.length || lotesAlerta.length ? [
          ...lotesAlerta.map((l) => h("div", { class: "decidir-fila" },
            h("span", { class: "chip " + (l.estado === "vencido" ? "chip-peligro" : "chip-adv") }, l.estado === "vencido" ? "vencido" : "por vencer"),
            h("span", {}, `${l.producto}: ${Number(l.cantidad)} pz, vence en ${l.dias_para_vencer} día(s) — remátalo.`))),
          ...bajos.map((b) => h("div", { class: "decidir-fila" },
            h("span", { class: "chip chip-adv" }, "stock bajo"),
            h("span", {}, `${b.nombre}: quedan ${Number(b.stock_actual)} — conviene resurtir.`))),
        ] : [h("p", { class: "tenue centrado", style: "padding:16px" }, "Todo en orden: sin stock bajo ni lotes por vencer.")]),
      ),
    );
  },
};

function kpi(etiq, val) { return h("div", { class: "glass card kpi" }, h("div", { class: "kpi-val mono" }, val), h("div", { class: "kpi-etq" }, etiq)); }
function fkey(d) { return d.toISOString().slice(0, 10); }

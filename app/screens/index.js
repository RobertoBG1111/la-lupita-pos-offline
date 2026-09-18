// ── Registro de pantallas ───────────────────────────────────────────────────
// Orden = orden en la barra de navegación.
// bienvenida y usuarios son las del oficial (Supabase / Edge Function); el resto
// se portó del offline.
import { bienvenida } from "./bienvenida.js";
import { login } from "./login.js";
import { venta } from "./venta.js";
import { envases } from "./envases.js";
import { pago } from "./pago.js";
import { ticket } from "./ticket.js";
import { corte } from "./corte.js";
import { historial } from "./historial.js";
import { inventario } from "./inventario.js";
import { combos } from "./combos.js";
import { promociones } from "./promociones.js";
import { reportes } from "./reportes.js";
import { usuarios } from "./usuarios.js";
import { configuracion } from "./configuracion.js";

export const pantallas = [
  bienvenida,
  login,
  // Núcleo operativo
  venta,
  envases,
  pago,
  ticket,
  corte,
  historial,
  inventario,
  // Administración — solo admin
  combos,
  promociones,
  reportes,
  usuarios,
  configuracion,
];

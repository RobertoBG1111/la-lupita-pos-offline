// ── Estado de la venta en curso (en memoria + persistido en el dispositivo) ──
// Ahora hay VARIOS tickets abiertos a la vez: puedes dejar una venta pendiente
// (parquearla) y seguir cobrando a otro cliente en un ticket nuevo. Cada ticket
// tiene su propio carrito, genéricos y combos aceptados. `ventaEnCurso` es la
// MISMA API de antes, pero delega en el ticket ACTIVO (getters), así el resto de
// la app (venta.js, pago.js) sigue funcionando sin cambios de fondo.
//
// Persistencia: la lista de tickets se guarda en localStorage tras cada cambio,
// para que los tickets pendientes sobrevivan una recarga o cierre de la PWA.
// (Es por dispositivo/origen; cada tienda es su propio dominio, así que no se
// mezclan entre tiendas.) Si localStorage falla, se sigue en memoria.

const _uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

const CLAVE = "modelorama-pos-tickets";

function _crear(nombre = "") {
  return { id: _uid(), nombre, carrito: [], genericos: [], combosAceptados: new Set(), paquetesAceptados: new Set() };
}

// ── Persistencia ─────────────────────────────────────────────────────────────
function _serializar() {
  return {
    idx: _idx,
    lista: _lista.map((t) => ({
      id: t.id, nombre: t.nombre || "",
      carrito: t.carrito, genericos: t.genericos,
      combos: [...t.combosAceptados], paquetes: [...t.paquetesAceptados],
    })),
  };
}
function guardar() {
  try { localStorage.setItem(CLAVE, JSON.stringify(_serializar())); } catch (_e) { /* sin almacenamiento: solo memoria */ }
}
function _cargar() {
  try {
    const raw = localStorage.getItem(CLAVE);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || !Array.isArray(d.lista) || !d.lista.length) return null;
    const lista = d.lista.map((t) => ({
      id: t.id || _uid(), nombre: t.nombre || "",
      carrito: Array.isArray(t.carrito) ? t.carrito : [],
      genericos: Array.isArray(t.genericos) ? t.genericos : [],
      combosAceptados: new Set(Array.isArray(t.combos) ? t.combos : []),
      paquetesAceptados: new Set(Array.isArray(t.paquetes) ? t.paquetes : []),
    }));
    const idx = Math.min(Math.max(0, parseInt(d.idx, 10) || 0), lista.length - 1);
    return { lista, idx };
  } catch (_e) { return null; }
}

let _lista, _idx;
{
  const prev = _cargar();
  if (prev) { _lista = prev.lista; _idx = prev.idx; }
  else { _lista = [_crear()]; _idx = 0; }
}

// ── Tickets (lista, activo, crear, cambiar, cerrar, renombrar) ───────────────
export function ticketActivo() { return _lista[_idx]; }
export function listaTickets() { return _lista; }
export function indiceActivo() { return _idx; }

/** Crea un ticket nuevo y lo deja activo. Devuelve el ticket. */
export function nuevoTicket() {
  _lista.push(_crear());
  _idx = _lista.length - 1;
  guardar();
  return ticketActivo();
}

/** Activa un ticket por id (no hace nada si no existe). */
export function activarTicket(id) {
  const i = _lista.findIndex((t) => t.id === id);
  if (i >= 0) { _idx = i; guardar(); }
}

/** Cierra (elimina) un ticket. Siempre queda al menos uno. */
export function cerrarTicket(id) {
  const i = _lista.findIndex((t) => t.id === id);
  if (i < 0) return;
  _lista.splice(i, 1);
  if (!_lista.length) _lista.push(_crear());
  // Mantén el índice apuntando a un ticket válido, tendiendo al vecino izquierdo.
  if (i < _idx) _idx--;
  _idx = Math.min(_idx, _lista.length - 1);
  guardar();
}

/** Renombra un ticket (etiqueta libre; vacío = vuelve a "Ticket N"). */
export function renombrarTicket(id, nombre) {
  const t = _lista.find((x) => x.id === id);
  if (t) { t.nombre = (nombre || "").trim(); guardar(); }
}

export const ventaEnCurso = {
  // Vista del ticket activo (getters: siempre reflejan el ticket en curso).
  get carrito() { return ticketActivo().carrito; },
  get genericos() { return ticketActivo().genericos; },
  get combosAceptados() { return ticketActivo().combosAceptados; },
  get paquetesAceptados() { return ticketActivo().paquetesAceptados; },

  // ── Ventas genéricas (código 0): artículo/servicio no catalogado ──
  agregarGenerico(descripcion, precio, cantidad = 1) {
    ticketActivo().genericos.push({ uid: _uid(), descripcion: descripcion || "Venta", precio: Number(precio) || 0, cantidad: Math.max(1, Number(cantidad) || 1) });
    guardar();
  },
  fijarCantidadGenerico(uid, n) {
    const g = ticketActivo().genericos.find((x) => x.uid === uid);
    if (!g) return;
    if (n <= 0) this.quitarGenerico(uid); else { g.cantidad = n; guardar(); }
  },
  quitarGenerico(uid) { const t = ticketActivo(); t.genericos = t.genericos.filter((x) => x.uid !== uid); guardar(); },

  agregar(presentacion_id, n = 1) {
    const it = ticketActivo().carrito.find((x) => x.presentacion_id === presentacion_id);
    if (it) it.cantidad += n;
    else ticketActivo().carrito.push({ presentacion_id, cantidad: n });
    guardar();
  },
  fijarCantidad(presentacion_id, n) {
    const t = ticketActivo();
    const it = t.carrito.find((x) => x.presentacion_id === presentacion_id);
    if (!it) { if (n > 0) { t.carrito.push({ presentacion_id, cantidad: n }); guardar(); } return; }
    if (n <= 0) this.quitar(presentacion_id);
    else { it.cantidad = n; guardar(); }
  },
  quitar(presentacion_id) {
    const t = ticketActivo();
    t.carrito = t.carrito.filter((x) => x.presentacion_id !== presentacion_id);
    // Si al quitar deja de haber suficientes para un combo aceptado, se recalcula solo.
    guardar();
  },

  // Combos aceptados (pasa por aquí para que se persista, no mutando el Set directo).
  aceptarCombo(comboId) { ticketActivo().combosAceptados.add(comboId); guardar(); },
  rechazarCombo(comboId) { ticketActivo().combosAceptados.delete(comboId); guardar(); },

  vaciar() {
    const t = ticketActivo();
    t.carrito = []; t.genericos = []; t.combosAceptados = new Set(); t.paquetesAceptados = new Set();
    guardar();
  },
  get vacio() { const t = ticketActivo(); return t.carrito.length === 0 && t.genericos.length === 0; },
};

// Última venta cobrada (para el Ticket).
export const ultimaVenta = { id: null };

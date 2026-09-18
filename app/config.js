// ── Configuración — POS "La Lupita" (versión 100% local / offline) ──────────
// Esta versión NO usa nube: todos los datos viven en IndexedDB de esta máquina.
// No hay claves de Supabase ni correo interno.
//
// Estos son los VALORES POR DEFECTO. La configuración real de la tienda vive en el
// store `configuracion` de IndexedDB y se edita desde la pantalla Configuración.
// En el arranque, `lib/config-runtime.js` mergea lo guardado SOBRE estos defaults,
// así la app nunca se rompe si falta una clave.

export const CONFIG = {
  // ── Identidad del negocio (encabezado, ticket) ─────────────────────────────
  NEGOCIO: {
    nombre: "Modelorama",
    sucursal: "La Lupita",
    lugar: "Tixpéhual, Yucatán",
    logo: "assets/logo.png",
    pieTicket: "sistema por Nodo · usanodo.com",
  },

  // Envases retornables: LISTA editable. Cada tipo = { clave, nombre, deposito }.
  // `clave` es el identificador estable que guarda cada producto en tipo_envase.
  ENVASES: [
    { clave: "refresco_grande", nombre: "Refresco grande", deposito: 8 },
    { clave: "individual",      nombre: "Refresco individual", deposito: 5 },
    { clave: "mega",            nombre: "Mega / misil", deposito: 10 },
    { clave: "media_cuarto",    nombre: "Media / cuarto", deposito: 5 },
  ],

  // Apariencia: acento y fondo generales + color de la LÍNEA del carrito según su
  // estado en Venta. El admin los cambia y se aplican al vuelo (aplicarTema).
  APARIENCIA: {
    acento:        "#DB984C", // botones primarios (var --ambar)
    fondo:         "#D1DEEB", // fondo general (var --fondo)
    linea_promo:   "#52A08D", // línea con promoción aplicada
    linea_combo:   "#fbff00", // línea que forma parte de un combo
    linea_agotado: "#C56A4E", // producto agotado
    linea_bajo:    "#C79A3A", // stock bajo
  },

  // Ticket / impresión.
  TICKET: {
    ancho: "58", // "58" | "80" (mm)
    mostrar: { folio: true, hora: true, cajero: true, deposito: true },
    agradecimiento: "¡Gracias por su compra!",
    pie: "sistema por Nodo · usanodo.com",
  },

  // Reglas de venta.
  REGLAS: {
    metodos_pago: [
      { id: "efectivo",      etiqueta: "Efectivo",      activo: true },
      { id: "tarjeta",       etiqueta: "Tarjeta",       activo: true },
      { id: "transferencia", etiqueta: "Transferencia", activo: true },
    ],
    redondeo: 0,           // 0 | 0.5 | 1 — redondeo del efectivo sugerido ("Justo")
    empaques: "preguntar", // "preguntar" (modal pieza/six) | "auto" (el six se cobra solo al juntar 6)
    permitir_generico: true, // habilita la venta libre con código 0
    devoluciones_rol: "admin", // "admin" | "cajero" — quién puede cancelar/devolver
  },

  // Categorías semilla para clasificar artículos. La lista CRECE sola: cualquier
  // categoría nueva que se escriba al dar de alta un producto se recuerda y aparece
  // después en el desplegable (ver datos.js → categoriasConocidas).
  CATEGORIAS: [
    "Corona", "Coca Cola", "Pepsi", "Tequila", "Ron", "Whisky", "Mezcal", "Vodka",
    "Cigarros", "Botana regional", "Bebidas alcohólicas", "Bebidas Energéticas",
    "Sabritas", "Barcel", "Gamesa", "Leo", "Abarrote",
  ],
};

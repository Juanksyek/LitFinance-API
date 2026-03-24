// ─── Constantes y patrones del pipeline OCR ───────────────────────────────────

import { DetectedStore, TicketKind } from './ocr.types';

// ─── Tiendas conocidas ───────────────────────────────────────────────────────

export const KNOWN_STORES: Array<{ patterns: RegExp[]; name: string; defaultCategory: string }> = [
  // Fast food / restaurantes
  { patterns: [/carls?\s*j\.?r/i, /carl['\u2019]?s\s*j/i], name: "Carl's Jr", defaultCategory: 'restaurante' },
  { patterns: [/mc\s*donald/i], name: "McDonald's", defaultCategory: 'restaurante' },
  { patterns: [/burger\s*king/i], name: 'Burger King', defaultCategory: 'restaurante' },
  { patterns: [/subway/i], name: 'Subway', defaultCategory: 'restaurante' },
  { patterns: [/starbucks/i], name: 'Starbucks', defaultCategory: 'restaurante' },
  { patterns: [/dominos?/i, /domino['\u2019]?s/i], name: "Domino's", defaultCategory: 'restaurante' },
  { patterns: [/pizza\s*hut/i], name: 'Pizza Hut', defaultCategory: 'restaurante' },
  { patterns: [/little\s*caesars?/i], name: "Little Caesars", defaultCategory: 'restaurante' },
  { patterns: [/\bkfc\b/i, /kentucky/i], name: 'KFC', defaultCategory: 'restaurante' },
  { patterns: [/chili['\u2019]?s/i], name: "Chili's", defaultCategory: 'restaurante' },
  { patterns: [/applebee/i], name: "Applebee's", defaultCategory: 'restaurante' },
  { patterns: [/\bvips\b/i], name: 'Vips', defaultCategory: 'restaurante' },
  { patterns: [/sanborns/i], name: 'Sanborns', defaultCategory: 'restaurante' },
  { patterns: [/\btoks\b/i], name: 'Toks', defaultCategory: 'restaurante' },
  { patterns: [/wings/i], name: 'Wings', defaultCategory: 'restaurante' },
  { patterns: [/popeyes/i], name: 'Popeyes', defaultCategory: 'restaurante' },
  // Supermercados
  { patterns: [/walmart/i, /wal\s*mart/i], name: 'Walmart', defaultCategory: 'supermercado' },
  { patterns: [/soriana/i], name: 'Soriana', defaultCategory: 'supermercado' },
  { patterns: [/chedraui/i], name: 'Chedraui', defaultCategory: 'supermercado' },
  { patterns: [/bodega\s*aurrer/i], name: 'Bodega Aurrera', defaultCategory: 'supermercado' },
  { patterns: [/\bheb\b/i, /h[-\s]?e[-\s]?b/i], name: 'HEB', defaultCategory: 'supermercado' },
  { patterns: [/costco/i], name: 'Costco', defaultCategory: 'supermercado' },
  { patterns: [/sam['\u2019]?s\s*club/i, /\bsams\b/i], name: "Sam's Club", defaultCategory: 'supermercado' },
  { patterns: [/la\s*comer\b/i], name: 'La Comer', defaultCategory: 'supermercado' },
  { patterns: [/superama/i], name: 'Superama', defaultCategory: 'supermercado' },
  { patterns: [/alsuper/i], name: 'Alsuper', defaultCategory: 'supermercado' },
  { patterns: [/\bsmart\b/i], name: 'Smart', defaultCategory: 'supermercado' },
  // Conveniencia
  { patterns: [/oxxo/i], name: 'OXXO', defaultCategory: 'alimentos' },
  { patterns: [/7[-\s]?eleven/i, /seven\s*eleven/i], name: '7-Eleven', defaultCategory: 'alimentos' },
  { patterns: [/circle\s*k/i], name: 'Circle K', defaultCategory: 'alimentos' },
  // Farmacias
  { patterns: [/farmacias?\s*guadalajara/i], name: 'Farmacias Guadalajara', defaultCategory: 'farmacia' },
  { patterns: [/benavides/i], name: 'Farmacia Benavides', defaultCategory: 'farmacia' },
  { patterns: [/farmacias?\s*similares/i], name: 'Farmacias Similares', defaultCategory: 'farmacia' },
  { patterns: [/san\s*pablo/i], name: 'Farmacia San Pablo', defaultCategory: 'farmacia' },
  { patterns: [/del\s*ahorro/i], name: 'Farmacia del Ahorro', defaultCategory: 'farmacia' },
  // Departamentales / especialidad
  { patterns: [/liverpool/i], name: 'Liverpool', defaultCategory: 'ropa' },
  { patterns: [/palacio\s*de\s*hierro/i], name: 'Palacio de Hierro', defaultCategory: 'ropa' },
  { patterns: [/home\s*depot/i], name: 'Home Depot', defaultCategory: 'hogar' },
  { patterns: [/office\s*depot/i, /office\s*max/i], name: 'Office Depot', defaultCategory: 'educacion' },
  { patterns: [/best\s*buy/i], name: 'Best Buy', defaultCategory: 'tecnologia' },
  { patterns: [/cin[e\u00e9]polis/i], name: 'Cinépolis', defaultCategory: 'entretenimiento' },
  { patterns: [/cinemex/i], name: 'Cinemex', defaultCategory: 'entretenimiento' },
  // Gasolineras
  { patterns: [/pemex/i], name: 'PEMEX', defaultCategory: 'transporte' },
  { patterns: [/\bshell\b/i], name: 'Shell', defaultCategory: 'transporte' },
];

// ─── Líneas a excluir (meta/pago/referencia/dirección) ──────────────────────

export const EXCLUDE_PATTERNS: RegExp[] = [
  /afiliaci[oó]n\s*:/i,
  /autorizaci[oó]n\s*:/i,
  /^aid\s*:/i,
  /^arqc\s*:/i,
  /^tda\s*#/i,
  /^te\s*#/i,
  /^tr\s*#/i,
  /^tc\s*#/i,
  /^ts\s*#/i,
  /^op\s*#/i,
  /^store\s*#/i,
  /^sucursal\s*#/i,
  /^chk\b/i,
  /^check\s*#/i,
  /^\d{4,6}\s+[A-Z][a-z]+\s*$/,
  /^cuenta\s*[*:]/i,
  /importe\s*:/i,
  /art[ií]culos?\s+comprados/i,
  /precios?\s+bajos/i,
  /marca\s+al\s+\d/i,
  /^www\./i,
  /^https?:\/\//i,
  /\bbit\.ly\//i,
  /r\.?f\.?c\.?\s/i,
  /\brfc[\s.:]/i,
  /r[eé]gimen\s+fiscal/i,
  /personas?\s+morales?/i,
  /personas?\s+f[ií]sicas?/i,
  /gracias\s+por/i,
  /aviso\s+de\s+privacidad/i,
  /venta\s+en\s+l[ií]nea/i,
  /activa\s+tus/i,
  /beneficios/i,
  /^¿?(c[oó]mo\s+te\s+atendimos?|necesitas?\s+ayuda)/i,
  /pesos?\s+\d+\/100/i,
  /^m\.?\s*n\.?\s*$/i,
  /^unidad\s+/i,
  /^av\.\s/i,
  /^col\.\s/i,
  /^c\.p\.\s/i,
  /nueva\s+wal\s*mart/i,
  /^s\s+de\s+r\.?\s*l/i,
  /^s\.?\s*a\.?\s*de\s*c\.?\s*v/i,
  /^articulo\s+cant/i,
  /^cant\.?\s+total/i,
  /tarjeta\s*:/i,
  /^visa\s+(deb|cred)/i,
  /^mastercard/i,
  /^american\s+express/i,
  /consulta\s+(nuestro|tu|nues)/i,
  /^\*{2,}/,
  /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i,
  /precios?\s+sujetos?/i,
  /^nextengo|acayucan|azcapotzalco/i,
  /^azcap/i,
  /debit[oa]/i,
  /^debi[td]/i,
  /^pagado\b/i,
  /\bfin\s*(de\s*)?combo\b/i,
  /^star\s+tapat/i,
  /nota\s+de\s+pago/i,
  /revise\s+su/i,
  /ticket\s+estar/i,
  /dia\s+ultimo/i,
  /cualquier\s+duda/i,
  /enviar\s+un?\s+correo/i,
  /para\s+facturar/i,
  /facturar\s+(ingrese|despues)/i,
  /^#\s*ticket/i,
  /^fecha\s+ticket/i,
  /tiene\s+hasta/i,
  /general\s+de\s+ley/i,
  /^urban\s+center/i,
  /^\d{2,3}[xX]\s*$/,
  /^local\s+/i,
  /^niv\.?\s*\d/i,
];

// ─── Líneas de total/impuesto: no son items ─────────────────────────────────

export const TOTAL_PATTERNS: RegExp[] = [
  /^sub\s*total\b/i,
  /^total\b/i,
  /^iva\b/i,
  /^i\.?\s*v\.?\s*a\.?\b/i,
  /^ieps\b/i,
  /^impuesto/i,
  /^cambio\b/i,
  /^efectivo\b/i,
  /^pago\b/i,
  /^pagado\b/i,
  /^saldo\b/i,
  /^descuento\b/i,
  /^t\.\s*debito/i,
];

// ─── Encabezados de sección con categoría ───────────────────────────────────

export const SECTION_PATTERNS: Array<{ pattern: RegExp; categoria: string }> = [
  { pattern: /abarrotes?\s*(procesados?)?/i, categoria: 'alimentos' },
  { pattern: /carnes?/i, categoria: 'alimentos' },
  { pattern: /l[aá]cteos?/i, categoria: 'alimentos' },
  { pattern: /bebidas?/i, categoria: 'alimentos' },
  { pattern: /frutas?\s*y\s*verduras?/i, categoria: 'alimentos' },
  { pattern: /panaderia/i, categoria: 'alimentos' },
  { pattern: /jardineria/i, categoria: 'hogar' },
  { pattern: /ferreteria/i, categoria: 'hogar' },
  { pattern: /papeles?\s+dom[eé]sticos?/i, categoria: 'higiene' },
  { pattern: /limpieza/i, categoria: 'higiene' },
  { pattern: /cosm[eé]ticos?|belleza/i, categoria: 'higiene' },
  { pattern: /farmacia/i, categoria: 'farmacia' },
  { pattern: /ropa\s*[-–]*/i, categoria: 'ropa' },
  { pattern: /electr[oó]n/i, categoria: 'tecnologia' },
  { pattern: /mascotas?/i, categoria: 'mascotas' },
  { pattern: /comedor/i, categoria: 'restaurante' },
  { pattern: /cocina/i, categoria: 'restaurante' },
  { pattern: /barra/i, categoria: 'restaurante' },
];

// ─── Clasificación del tipo de ticket ───────────────────────────────────────

export const TICKET_KIND_HINTS: Array<{ kind: TicketKind; patterns: RegExp[] }> = [
  {
    kind: 'restaurante',
    patterns: [
      /combo|restaurant|restaurante|comensal|mesero|propina|orden|consumo|hamburguesa|pizza|taco|cafe/i,
      /carl'?s|mcdonald|burger king|starbucks|domino|kfc|subway|little caesars/i,
    ],
  },
  {
    kind: 'supermercado',
    patterns: [
      /walmart|soriana|chedraui|costco|sam'?s|heb|superama|la comer|bodega aurrera|art[ií]culos comprados/i,
      /abarrotes|frutas|verduras|l[aá]cteos|panader[ií]a/i,
    ],
  },
  {
    kind: 'farmacia',
    patterns: [
      /farmacia|medicina|medicamento|receta|similares|benavides|guadalajara|san pablo|del ahorro/i,
    ],
  },
  {
    kind: 'gasolinera',
    patterns: [
      /pemex|shell|bp|litros|combustible|magna|premium|diesel|despacho/i,
    ],
  },
  {
    kind: 'departamental',
    patterns: [
      /liverpool|palacio de hierro|zara|h&m|sears|departamental/i,
    ],
  },
  {
    kind: 'conveniencia',
    patterns: [
      /oxxo|7-eleven|seven eleven|circle k|tienda de conveniencia/i,
    ],
  },
  {
    kind: 'servicios',
    patterns: [
      /internet|telefon[ií]a|servicio|mantenimiento|suscripci[oó]n/i,
    ],
  },
];

// ─── Keywords de categorización de artículos ────────────────────────────────

export const CATEGORY_KEYWORDS: Record<string, string[]> = {
  alimentos: [
    'leche', 'pan', 'huevo', 'queso', 'pollo', 'carne', 'res', 'cerdo', 'pescado',
    'arroz', 'frijol', 'tortilla', 'fruta', 'verdura', 'manzana', 'plátano', 'banana',
    'tomate', 'jitomate', 'cebolla', 'papa', 'cereal', 'yogur', 'yogurt',
    'atún', 'tuna', 'jamón', 'salchicha', 'aceite', 'azúcar', 'sal', 'harina',
    'galleta', 'chocolate', 'café', 'refresco', 'soda', 'coca', 'pepsi', 'agua',
    'jugo', 'cerveza', 'vino', 'snack', 'botana', 'chip', 'doritos', 'sabritas',
    'helado', 'mantequilla', 'crema', 'mayonesa', 'salsa', 'pasta', 'spaghetti',
    'sopa', 'maruchan', 'avena', 'granola', 'lechuga', 'zanahoria',
    'limón', 'naranja', 'sandwich', 'hamburguesa', 'pizza', 'taco', 'burrito',
    'comida', 'alimento', 'grocery', 'food', 'meal', 'drink', 'bebida',
  ],
  farmacia: [
    'medicina', 'medicamento', 'pastilla', 'tableta', 'jarabe', 'aspirina',
    'paracetamol', 'ibuprofeno', 'vitamina', 'suplemento', 'curita', 'vendaje',
    'alcohol', 'gel antibacterial', 'farmacia', 'receta', 'antibiótico',
    'analgésico', 'antigripal',
  ],
  higiene: [
    'jabón', 'shampoo', 'champú', 'acondicionador', 'pasta dental', 'cepillo',
    'desodorante', 'papel higiénico', 'toalla', 'servilleta', 'pañuelo',
    'rastrillo', 'rasuradora', 'crema', 'loción', 'protector solar',
    'pañal', 'toalla sanitaria', 'tampón',
  ],
  hogar: [
    'detergente', 'cloro', 'limpiador', 'escoba', 'trapeador', 'balde',
    'foco', 'bombilla', 'pila', 'batería', 'extensión', 'cable',
    'bolsa basura', 'plato', 'vaso', 'cuchara', 'tenedor', 'olla', 'sartén',
    'toalla', 'cortina', 'almohada', 'sábana', 'mueble',
    'herramienta', 'martillo', 'clavo', 'tornillo', 'pintura',
  ],
  transporte: [
    'gasolina', 'gas', 'diesel', 'uber', 'didi', 'taxi', 'metro', 'autobús',
    'estacionamiento', 'parking', 'peaje', 'caseta', 'aceite motor',
    'llanta', 'neumático', 'refacción', 'lavado auto',
  ],
  entretenimiento: [
    'cine', 'película', 'netflix', 'spotify', 'disney', 'suscripción',
    'juego', 'videojuego', 'boleto', 'ticket', 'entrada', 'concierto',
    'teatro', 'parque', 'museo', 'libro', 'revista',
  ],
  ropa: [
    'camisa', 'playera', 'camiseta', 'pantalón', 'jean', 'short', 'falda',
    'vestido', 'zapato', 'tenis', 'bota', 'sandalia', 'calcetín',
    'ropa interior', 'boxer', 'chamarra', 'chaqueta', 'suéter',
    'abrigo', 'gorra', 'cinturón', 'bolsa', 'mochila',
  ],
  educacion: [
    'cuaderno', 'libreta', 'lápiz', 'pluma', 'bolígrafo', 'borrador',
    'regla', 'calculadora', 'mochila', 'uniforme', 'colegiatura',
    'curso', 'clase', 'taller', 'textbook', 'papelería', 'impresión', 'copia',
  ],
  servicios: [
    'luz', 'electricidad', 'agua', 'gas natural', 'internet', 'teléfono',
    'celular', 'cable', 'renta', 'alquiler', 'seguro', 'póliza',
    'mantenimiento', 'reparación', 'servicio', 'suscripción', 'membresía',
    'gym', 'gimnasio', 'lavandería', 'tintorería',
  ],
  restaurante: [
    'propina', 'mesero', 'servicio mesa', 'comensales', 'buffet',
    'restaurante', 'café', 'cafetería', 'bar', 'cantina',
    'fondita', 'taquería', 'pizzería', 'sushi', 'mariscos',
  ],
  mascotas: [
    'croqueta', 'alimento mascota', 'veterinario',
    'collar', 'correa', 'arena gato', 'juguete mascota',
    'perro', 'gato', 'mascota',
  ],
  tecnologia: [
    'celular', 'teléfono', 'smartphone', 'tablet', 'laptop', 'computadora',
    'monitor', 'teclado', 'mouse', 'audífono', 'bocina',
    'usb', 'cargador', 'funda', 'impresora', 'tinta',
  ],
};

export const STORE_CATEGORY_HINTS: Record<string, string> = {
  'walmart': 'alimentos', 'soriana': 'alimentos', 'chedraui': 'alimentos',
  'bodega aurrera': 'alimentos', 'heb': 'alimentos', 'costco': 'alimentos',
  'sam\'s': 'alimentos', 'sams club': 'alimentos', 'oxxo': 'alimentos',
  '7-eleven': 'alimentos', 'seven eleven': 'alimentos', 'circle k': 'alimentos',
  'la comer': 'alimentos', 'superama': 'alimentos', 'alsuper': 'alimentos',
  'ley': 'alimentos', 'smart': 'alimentos',
  'farmacias guadalajara': 'farmacia', 'farmacia benavides': 'farmacia',
  'farmacias similares': 'farmacia', 'farmacia san pablo': 'farmacia',
  'farmacia del ahorro': 'farmacia',
  'liverpool': 'ropa', 'palacio de hierro': 'ropa', 'zara': 'ropa',
  'h&m': 'ropa', 'c&a': 'ropa',
  'home depot': 'hogar', 'lowes': 'hogar',
  'cinépolis': 'entretenimiento', 'cinemex': 'entretenimiento',
  'starbucks': 'restaurante', 'mcdonalds': 'restaurante', 'burger king': 'restaurante',
  'subway': 'restaurante', 'dominos': 'restaurante', 'kfc': 'restaurante',
  'pemex': 'transporte', 'shell': 'transporte',
  'office depot': 'educacion', 'office max': 'educacion',
  'petco': 'mascotas', 'best buy': 'tecnologia',
  'telmex': 'servicios', 'telcel': 'servicios', 'at&t': 'servicios',
  'amazon': 'tecnologia', 'mercado libre': 'tecnologia',
};

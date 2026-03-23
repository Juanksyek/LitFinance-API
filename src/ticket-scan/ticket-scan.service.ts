import {
  Injectable, Logger, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import axios from 'axios';
import * as FormData from 'form-data';
import { TicketScan, TicketScanDocument, TicketItem } from './schemas/ticket-scan.schema';
import {
  CreateTicketFromOcrDto,
  CreateTicketManualDto,
  ConfirmTicketDto,
  TicketItemDto,
} from './dto/ticket-scan.dto';
import { TransactionsService } from '../transactions/transactions.service';
import { UserService } from '../user/user.service';
import { generateUniqueId } from '../utils/generate-id';
import { DashboardVersionService } from '../user/services/dashboard-version.service';

// ─── Categorización inteligente de artículos ───────────────────

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  alimentos: [
    'leche', 'pan', 'huevo', 'queso', 'pollo', 'carne', 'res', 'cerdo', 'pescado',
    'arroz', 'frijol', 'tortilla', 'fruta', 'verdura', 'manzana', 'plátano', 'banana',
    'tomate', 'jitomate', 'cebolla', 'papa', 'papa frita', 'cereal', 'yogur', 'yogurt',
    'atún', 'tuna', 'jamón', 'salchicha', 'aceite', 'azúcar', 'sal', 'harina',
    'galleta', 'chocolate', 'café', 'refresco', 'soda', 'coca', 'pepsi', 'agua',
    'jugo', 'cerveza', 'vino', 'snack', 'botana', 'chip', 'doritos', 'sabritas',
    'helado', 'mantequilla', 'crema', 'mayonesa', 'salsa', 'pasta', 'spaghetti',
    'sopa', 'maruchan', 'noodle', 'avena', 'granola', 'lechuga', 'zanahoria',
    'limón', 'naranja', 'sandwich', 'hamburguesa', 'pizza', 'taco', 'burrito',
    'comida', 'alimento', 'grocery', 'food', 'meal', 'drink', 'bebida',
  ],
  farmacia: [
    'medicina', 'medicamento', 'pastilla', 'tableta', 'jarabe', 'aspirina',
    'paracetamol', 'ibuprofeno', 'vitamina', 'suplemento', 'curita', 'vendaje',
    'alcohol', 'gel antibacterial', 'farmacia', 'receta', 'antibiótico',
    'analgésico', 'antigripal', 'pharmacy', 'medicine', 'drug',
  ],
  higiene: [
    'jabón', 'shampoo', 'champú', 'acondicionador', 'pasta dental', 'cepillo',
    'desodorante', 'papel higiénico', 'toalla', 'servilleta', 'pañuelo', 'tissue',
    'rastrillo', 'rasuradora', 'crema', 'loción', 'protector solar', 'bloqueador',
    'pañal', 'toalla sanitaria', 'tampón',
  ],
  hogar: [
    'detergente', 'cloro', 'limpiador', 'escoba', 'trapeador', 'balde',
    'foco', 'bombilla', 'pila', 'batería', 'extensión', 'cable', 'enchufe',
    'bolsa basura', 'plato', 'vaso', 'cuchara', 'tenedor', 'olla', 'sartén',
    'toalla', 'cortina', 'almohada', 'sábana', 'colchón', 'mueble',
    'herramienta', 'martillo', 'clavo', 'tornillo', 'pintura',
  ],
  transporte: [
    'gasolina', 'gas', 'diesel', 'uber', 'didi', 'taxi', 'metro', 'autobús',
    'bus', 'camión', 'estacionamiento', 'parking', 'peaje', 'caseta', 'aceite motor',
    'llanta', 'neumático', 'refacción', 'autopart', 'lavado auto',
    'fuel', 'gasoline', 'transport', 'ride',
  ],
  entretenimiento: [
    'cine', 'película', 'netflix', 'spotify', 'disney', 'suscripción',
    'juego', 'videojuego', 'game', 'boleto', 'ticket', 'entrada', 'concierto',
    'teatro', 'parque', 'museo', 'libro', 'revista', 'periódico',
    'streaming', 'entretenimiento', 'diversión', 'hobby',
  ],
  ropa: [
    'camisa', 'playera', 'camiseta', 'pantalón', 'jean', 'short', 'falda',
    'vestido', 'zapato', 'tenis', 'bota', 'sandalia', 'calcetín', 'media',
    'ropa interior', 'boxer', 'brasier', 'chamarra', 'chaqueta', 'suéter',
    'abrigo', 'gorra', 'sombrero', 'cinturón', 'bolsa', 'mochila',
    'clothing', 'shirt', 'pants', 'shoes', 'dress',
  ],
  educacion: [
    'cuaderno', 'libreta', 'lápiz', 'pluma', 'bolígrafo', 'borrador',
    'regla', 'calculadora', 'mochila', 'uniforme', 'colegiatura', 'matrícula',
    'curso', 'clase', 'taller', 'libro', 'textbook', 'school', 'education',
    'papelería', 'impresión', 'copia', 'folder', 'carpeta',
  ],
  servicios: [
    'luz', 'electricidad', 'agua', 'gas natural', 'internet', 'teléfono',
    'celular', 'cable', 'renta', 'alquiler', 'seguro', 'póliza',
    'mantenimiento', 'reparación', 'servicio', 'suscripción', 'membresía',
    'gym', 'gimnasio', 'lavandería', 'tintorería', 'peluquería', 'barbería',
    'utility', 'service', 'bill', 'rent', 'insurance',
  ],
  restaurante: [
    'propina', 'mesero', 'servicio mesa', 'comensales', 'buffet',
    'restaurante', 'restaurant', 'café', 'cafetería', 'bar', 'cantina',
    'fondita', 'taquería', 'pizzería', 'sushi', 'mariscos',
  ],
  mascotas: [
    'croqueta', 'alimento mascota', 'pet food', 'veterinario', 'vacuna mascota',
    'collar', 'correa', 'arena gato', 'pecera', 'juguete mascota',
    'perro', 'gato', 'mascota', 'pet',
  ],
  tecnologia: [
    'celular', 'teléfono', 'smartphone', 'tablet', 'laptop', 'computadora',
    'monitor', 'teclado', 'mouse', 'audífono', 'auricular', 'bocina',
    'usb', 'cargador', 'funda', 'protector pantalla', 'impresora', 'tinta',
    'tech', 'electronic', 'gadget',
  ],
};

// Tiendas conocidas → categoría predominante (mapeo genérico)
const STORE_CATEGORY_HINTS: Record<string, string> = {
  'walmart': 'alimentos',
  'soriana': 'alimentos',
  'chedraui': 'alimentos',
  'bodega aurrera': 'alimentos',
  'heb': 'alimentos',
  'costco': 'alimentos',
  'sam\'s': 'alimentos',
  'sams club': 'alimentos',
  'oxxo': 'alimentos',
  '7-eleven': 'alimentos',
  'seven eleven': 'alimentos',
  'circle k': 'alimentos',
  'la comer': 'alimentos',
  'comercial mexicana': 'alimentos',
  'superama': 'alimentos',
  'alsuper': 'alimentos',
  'ley': 'alimentos',
  'smart': 'alimentos',
  'farmacias guadalajara': 'farmacia',
  'farmacia benavides': 'farmacia',
  'farmacias similares': 'farmacia',
  'farmacia san pablo': 'farmacia',
  'farmacia del ahorro': 'farmacia',
  'liverpool': 'ropa',
  'palacio de hierro': 'ropa',
  'zara': 'ropa',
  'h&m': 'ropa',
  'c&a': 'ropa',
  'shein': 'ropa',
  'home depot': 'hogar',
  'lowes': 'hogar',
  'sodimac': 'hogar',
  'cinépolis': 'entretenimiento',
  'cinemex': 'entretenimiento',
  'starbucks': 'restaurante',
  'mcdonalds': 'restaurante',
  'burger king': 'restaurante',
  'subway': 'restaurante',
  'dominos': 'restaurante',
  'pizza hut': 'restaurante',
  'kfc': 'restaurante',
  'pemex': 'transporte',
  'shell': 'transporte',
  'bp': 'transporte',
  'office depot': 'educacion',
  'office max': 'educacion',
  'papelería': 'educacion',
  'petco': 'mascotas',
  'best buy': 'tecnologia',
  'radioshack': 'tecnologia',
  'telmex': 'servicios',
  'telcel': 'servicios',
  'at&t': 'servicios',
  'izzi': 'servicios',
  'totalplay': 'servicios',
  'amazon': 'tecnologia',
  'mercado libre': 'tecnologia',
};

@Injectable()
export class TicketScanService {
  private readonly logger = new Logger(TicketScanService.name);

  constructor(
    @InjectModel(TicketScan.name) private readonly ticketModel: Model<TicketScanDocument>,
    private readonly transactionsService: TransactionsService,
    private readonly userService: UserService,
    private readonly dashboardVersionService: DashboardVersionService,
  ) {}

  // ─── Categorización inteligente ──────────────────────────────

  categorizeItem(itemName: string, storeName?: string): { categoria: string; confianza: number } {
    const normalized = itemName.toLowerCase().trim();

    // 1. Buscar match directo por keywords del artículo
    let bestCategory = 'otros';
    let bestScore = 0;

    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      for (const kw of keywords) {
        if (normalized.includes(kw)) {
          const score = kw.length / normalized.length; // Cuanto más del nombre cubre el keyword, mejor
          if (score > bestScore) {
            bestScore = score;
            bestCategory = category;
          }
        }
      }
    }

    if (bestScore > 0) {
      return { categoria: bestCategory, confianza: Math.min(bestScore + 0.3, 0.95) };
    }

    // 2. Fallback: usar la tienda como pista
    if (storeName) {
      const storeNorm = storeName.toLowerCase().trim();
      for (const [storeKey, cat] of Object.entries(STORE_CATEGORY_HINTS)) {
        if (storeNorm.includes(storeKey)) {
          return { categoria: cat, confianza: 0.5 };
        }
      }
    }

    return { categoria: 'otros', confianza: 0.1 };
  }

  categorizeItems(items: TicketItemDto[], storeName?: string): TicketItem[] {
    return items.map((item) => {
      const existing = item.categoria && item.categoria !== 'otros';
      const { categoria, confianza } = existing
        ? { categoria: item.categoria!, confianza: item.confianza ?? 1 }
        : this.categorizeItem(item.nombre, storeName);
      return {
        nombre: item.nombre,
        cantidad: item.cantidad,
        precioUnitario: item.precioUnitario,
        subtotal: item.subtotal,
        categoria,
        confianza,
      };
    });
  }

  buildCategorySummary(items: TicketItem[]): Record<string, number> {
    const summary: Record<string, number> = {};
    for (const item of items) {
      const cat = item.categoria ?? 'otros';
      summary[cat] = (summary[cat] ?? 0) + item.subtotal;
    }
    return summary;
  }

  // ─── Procesamiento OCR (parsing del texto extraído) ──────────
  // El frontend envía la imagen en base64 y opcionalmente utiliza
  // un servicio de OCR en el dispositivo (Google ML Kit / Apple Vision).
  // El backend recibe el texto crudo o, en su defecto, solo la imagen
  // para almacenarla y un payload manual.

  parseOcrText(raw: string): {
    tienda: string;
    direccionTienda: string;
    fechaCompra: string;
    items: TicketItemDto[];
    subtotal: number;
    impuestos: number;
    descuentos: number;
    propina: number;
    total: number;
    metodoPago: string;
  } {
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
    const fullText = lines.join('\n');

    // ─── Patrones de líneas a EXCLUIR (sección de pago, referencias, etc.) ──────
    // Estas líneas nunca son artículos: son datos de pago, autorización, dirección.
    const EXCLUDE_LINE: RegExp[] = [
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
      /^cuenta\s*[*:]/i,
      /importe\s*:/i,
      /art[ií]culos?\s+comprados/i,
      /precios?\s+bajos/i,
      /marca\s+al\s+\d/i,            // "MARCA AL 800 925 6278..."
      /^www\./i,
      /^https?:\/\//i,
      /r\.?f\.?c\.?\s/i,
      /\brfc\b/i,
      /r[eé]gimen\s+fiscal/i,
      /personas?\s+morales?/i,
      /personas?\s+f[ií]sicas?/i,
      /gracias\s+por/i,
      /aviso\s+de\s+privacidad/i,
      /venta\s+en\s+l[ií]nea/i,
      /activa\s+tus/i,
      /beneficios/i,
      /^¿?(c[oó]mo\s+te\s+atendimos?|necesitas?\s+ayuda)/i,
      /pesos?\s+\d+\/100/i,           // "TRESCIENTOS OCHENTA Y DOS PESOS 00/100"
      /^m\.?\s*n\.?\s*$/i,            // "M.N."
      /^unidad\s+/i,
      /^av\.\s/i,                     // Av. (dirección)
      /^col\.\s/i,                    // Col. (colonia)
      /^c\.p\.\s/i,
      /nueva\s+wal\s*mart/i,
      /^s\s+de\s+r\.?\s*l/i,
      /^articulo\s+cant/i,            // Encabezado de columnas "ARTICULO  CANT.  TOTAL"
      /^cant\.?\s+total/i,
      /tarjeta\s*:/i,
      /^visa\s+(deb|cred)/i,
      /^mastercard/i,
      /^american\s+express/i,
      /consulta\s+(nuestro|tu|nues)/i,
      /^\*{2,}/,                      // "** 73 I" (número de cuenta enmascarado)
      /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i,  // emails
      /precios?\s+sujetos?/i,
      /^nextengo|acayucan|azcapotzalco/i,
      /^azcap/i,
      /debit[oa]/i,
      /^debi[td]/i,
    ];

    // ─── Líneas de total/impuesto: actualizar variables, no crear items ────────
    const TOTAL_LINE: RegExp[] = [
      /^sub\s*total\b/i,
      /^total\b/i,
      /^iva\b/i,
      /^i\.?\s*v\.?\s*a\.?\b/i,
      /^ieps\b/i,
      /^impuesto/i,
      /^cambio\b/i,
      /^efectivo\b/i,
      /^pago\b/i,
      /^saldo\b/i,
      /^descuento\b/i,
    ];

    // ─── Encabezados de sección con pista de categoría ─────────────────────────
    const SECTIONS: Array<{ pattern: RegExp; categoria: string }> = [
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
    ];

    // ─── Nombre de tienda ────────────────────────────────────────────────────────
    let tienda = 'Tienda desconocida';
    let direccionTienda = '';
    for (let idx = 0; idx < Math.min(6, lines.length); idx++) {
      const l = lines[idx];
      if (l.length >= 3 && !/^\d/.test(l) && !l.includes(':') && !/^[A-Z]{1,3}$/.test(l)) {
        tienda = l.substring(0, 120);
        break;
      }
    }

    // ─── Fecha ───────────────────────────────────────────────────────────────────
    let fechaCompra = new Date().toISOString();
    const dateRegex = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})/;
    for (const line of lines) {
      const m = line.match(dateRegex);
      if (m) {
        try {
          const d = this.parseTicketDate(m[1]);
          if (d) { fechaCompra = d.toISOString(); break; }
        } catch { /* ignore */ }
      }
    }

    // ─── Extracción de artículos ─────────────────────────────────────────────────
    const items: TicketItemDto[] = [];
    let currentCategory: string | undefined;

    // Prefijo de código de barras: 10-13 dígitos al inicio
    const barcodeRe = /^\d{10,13}\s+/;

    // Formato Walmart: "NOMBRE  PRECIO_UNIT x CANT  TOTAL[T/C/A/M]"
    // T=gravado, C=cero, A=exento, M=medicamento exento
    const itemWithQtyRe = /^(.+?)\s{2,}(\d+\.?\d*)\s+[xX×]\s+(\d+)\s+(\d+\.?\d*)[TCAM]?\s*$/;

    // Formato simple: "NOMBRE  TOTAL[T/C/A/M]"  (2+ espacios antes del precio)
    const itemSimpleRe = /^(.+?)\s{2,}(\d+\.?\d*)[TCAM]?\s*$/;

    // Línea de continuación con qty: "PRECIO_UNIT x CANT  TOTAL[T/C/A/M]"
    const contWithQtyRe = /^(\d+\.?\d*)\s+[xX×]\s+(\d+)\s+(\d+\.?\d*)[TCAM]?\s*$/;

    // Línea de continuación solo precio: "TOTAL[T/C/A/M]" (solo número al inicio)
    const contPriceRe = /^(\d+\.?\d*)[TCAM]?\s*$/;

    let pendingName: string | null = null; // nombre esperando línea de precio

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.length < 2) { pendingName = null; continue; }

      // Separadores → limpiar nombre pendiente
      if (/^[-=*\.★]{3,}/.test(line)) { pendingName = null; continue; }

      // ¿Es encabezado de sección?
      const secMatch = SECTIONS.find((s) => s.pattern.test(line));
      if (secMatch) {
        currentCategory = secMatch.categoria;
        pendingName = null;
        continue;
      }
      // Encabezado de sección sin categoría conocida (ej. "JARDINERIA-----")
      if (/^[A-ZÁÉÍÓÚÑ\s]{4,}[-─]{3,}/.test(line) || /^[A-ZÁÉÍÓÚÑ\s]{4,}\s*-{3,}/.test(line)) {
        pendingName = null;
        continue;
      }

      // Excluir líneas de pago/referencia/dirección
      if (EXCLUDE_LINE.some((r) => r.test(line))) { pendingName = null; continue; }

      // Excluir líneas de totales
      if (TOTAL_LINE.some((r) => r.test(line))) { pendingName = null; continue; }

      // ─── ¿Hay nombre pendiente? Intentar como línea de continuación ──────────
      if (pendingName) {
        const m = line.match(contWithQtyRe);
        if (m) {
          const unitPrice = this.parseAmount(m[1]);
          const qty = parseInt(m[2], 10);
          const subtotal = this.parseAmount(m[3]);
          if (subtotal > 0 && subtotal <= 99_999) {
            items.push({
              nombre: pendingName, cantidad: qty,
              precioUnitario: unitPrice, subtotal,
              categoria: currentCategory ?? 'otros', confianza: 0,
            });
          }
          pendingName = null;
          continue;
        }
        const mp = line.match(contPriceRe);
        if (mp) {
          const subtotal = this.parseAmount(mp[1]);
          if (subtotal > 0 && subtotal <= 99_999) {
            items.push({
              nombre: pendingName, cantidad: 1,
              precioUnitario: subtotal, subtotal,
              categoria: currentCategory ?? 'otros', confianza: 0,
            });
          }
          pendingName = null;
          continue;
        }
        pendingName = null; // la siguiente línea no fue continuación
      }

      // ─── Parsear línea de artículo ────────────────────────────────────────────
      // Remover código de barras si lo hay
      const cleanLine = line.replace(barcodeRe, '');

      // Formato 1: "NOMBRE  PRECIO_UNIT x CANT  TOTAL"
      const m1 = cleanLine.match(itemWithQtyRe);
      if (m1) {
        const nombre = m1[1].trim();
        const unitPrice = this.parseAmount(m1[2]);
        const qty = parseInt(m1[3], 10);
        const subtotal = this.parseAmount(m1[4]);
        if (this.isValidItemName(nombre) && subtotal > 0 && subtotal <= 99_999) {
          items.push({ nombre, cantidad: qty, precioUnitario: unitPrice, subtotal, categoria: currentCategory ?? 'otros', confianza: 0 });
          continue;
        }
      }

      // Formato 2: "NOMBRE  TOTAL[T/C/A/M]" (precio al final, 2+ espacios)
      const m2 = cleanLine.match(itemSimpleRe);
      if (m2) {
        const nombre = m2[1].trim();
        const subtotal = this.parseAmount(m2[2]);
        if (this.isValidItemName(nombre) && subtotal > 0 && subtotal <= 99_999) {
          items.push({ nombre, cantidad: 1, precioUnitario: subtotal, subtotal, categoria: currentCategory ?? 'otros', confianza: 0 });
          continue;
        }
      }

      // Formato 3: Solo código de barras + nombre (el precio viene en la siguiente línea)
      if (barcodeRe.test(line)) {
        const nameOnly = cleanLine.trim();
        if (nameOnly.length > 2 && this.isValidItemName(nameOnly)) {
          pendingName = nameOnly;
        }
        continue;
      }
    }

    // ─── Extracción de totales ────────────────────────────────────────────────────
    // "TOTAL  $  382.00" → usar [^\d]* para saltar espacios y símbolos entre keyword y número
    let total = 0;
    let subtotal = 0;
    let impuestos = 0;

    const extractAmount = (regex: RegExp, text: string): number => {
      const m = text.match(regex);
      return m ? this.parseAmount(m[1]) : 0;
    };

    // Buscar TOTAL (sin SUB antes) y SUBTOTAL por separado
    total = extractAmount(/\btotal\b[^\d]{0,25}([\d,]+\.?\d*)/i, fullText);
    subtotal = extractAmount(/\bsubtotal\b[^\d]{0,25}([\d,]+\.?\d*)/i, fullText);

    // Sumar IVA + IEPS como impuestos
    const iva = extractAmount(/\biva\b[^\d]{0,30}([\d,]+\.?\d*)/i, fullText);
    const ieps = extractAmount(/\bieps\b[^\d]{0,30}([\d,]+\.?\d*)/i, fullText);
    impuestos = Math.round((iva + ieps) * 100) / 100;

    // Fallbacks
    if (subtotal === 0 && items.length > 0) {
      subtotal = items.reduce((s, item) => s + item.subtotal, 0);
    }
    if (total === 0) total = subtotal + impuestos;
    // Si el total parseado <= suma de items no tiene sentido, usar suma de items + impuestos
    if (total < subtotal) total = subtotal + impuestos;

    // ─── Método de pago ───────────────────────────────────────────────────────────
    let metodoPago = '';
    const payL = fullText.toLowerCase();
    if (payL.includes('efectivo') || payL.includes('cash')) metodoPago = 'efectivo';
    else if (payL.includes('tarjeta') || payL.includes('visa') || payL.includes('mastercard') || payL.includes('card')) metodoPago = 'tarjeta';
    else if (payL.includes('transferencia') || payL.includes('spei')) metodoPago = 'transferencia';

    return {
      tienda: tienda.substring(0, 120),
      direccionTienda: direccionTienda.substring(0, 200),
      fechaCompra,
      items,
      subtotal: Math.round(subtotal * 100) / 100,
      impuestos,
      descuentos: 0,
      propina: 0,
      total: Math.round(total * 100) / 100,
      metodoPago,
    };
  }

  /** Valida que el nombre de un artículo sea meaningful (no es un número ni una línea de continuación) */
  private isValidItemName(name: string): boolean {
    if (!name || name.length < 2) return false;
    // Solo dígitos → es un código, no un nombre
    if (/^\d+\.?\d*$/.test(name)) return false;
    // Empieza con número seguido de x/× → es una línea de qty, no nombre
    if (/^\d+\.?\d*\s*[xX×]/.test(name)) return false;
    // Solo caracteres especiales
    if (/^[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ]+$/.test(name)) return false;
    // Palabras clave de pago/referencia que no deben ser artículos
    if (/\b(total|subtotal|iva|ieps|cambio|efectivo|tarjeta|importe|afiliaci[oó]n|autorizaci[oó]n)\b/i.test(name)) return false;
    return true;
  }

  private parseAmount(str: string): number {
    return Number(str.replace(/,/g, '')) || 0;
  }

  // ─── Llamada a OCR.space ─────────────────────────────────────

  private async callOcrSpace(base64Image: string, mimeType = 'image/jpeg'): Promise<string> {
    const apiKey = process.env.OCR_SPACE_API_KEY;
    if (!apiKey) {
      this.logger.warn('OCR_SPACE_API_KEY no configurada — saltando OCR externo');
      return '';
    }

    try {
      const form = new FormData();
      form.append('base64Image', `data:${mimeType};base64,${base64Image}`);
      form.append('language', 'spa');
      form.append('OCREngine', '2');
      form.append('scale', 'true');
      form.append('isTable', 'false');

      const response = await axios.post<{
        ParsedResults?: Array<{ ParsedText: string }>;
        IsErroredOnProcessing?: boolean;
      }>(
        'https://api.ocr.space/parse/image',
        form,
        {
          headers: {
            ...form.getHeaders(),
            apikey: apiKey,
          },
          timeout: 30_000,
        },
      );

      const parsed = response.data?.ParsedResults?.[0]?.ParsedText ?? '';
      this.logger.log(`OCR.space extrajo ${parsed.length} caracteres`);
      return parsed;
    } catch (err: any) {
      this.logger.error(`Error al llamar OCR.space: ${err?.message}`);
      return '';
    }
  }

  private parseTicketDate(str: string): Date | null {
    // DD/MM/YYYY or DD-MM-YYYY
    let match = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (match) {
      const day = Number(match[1]);
      const month = Number(match[2]) - 1;
      let year = Number(match[3]);
      if (year < 100) year += 2000;
      return new Date(year, month, day, 12, 0, 0);
    }
    // YYYY-MM-DD
    match = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (match) {
      return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0);
    }
    return null;
  }

  // ─── Crear ticket desde OCR ──────────────────────────────────

  async createFromOcr(userId: string, dto: CreateTicketFromOcrDto, clientOcrText?: string) {
    const user = await this.userService.getProfile(userId);
    const moneda = dto.moneda || user.monedaPrincipal || 'MXN';

    // 1. Obtener texto OCR: prioridad → texto del cliente → llamar OCR.space
    let ocrText = clientOcrText ?? dto.ocrTexto ?? '';
    if (ocrText.trim().length < 10 && dto.imagenBase64) {
      ocrText = await this.callOcrSpace(
        dto.imagenBase64,
        dto.imagenMimeType ?? 'image/jpeg',
      );
    }

    // 2. Parsear el texto extraído
    let parsed: ReturnType<typeof this.parseOcrText> | null = null;

    if (ocrText.trim().length > 10) {
      parsed = this.parseOcrText(ocrText);
    }

    const ticketId = await generateUniqueId(this.ticketModel, 'ticketId');

    const items = parsed ? this.categorizeItems(parsed.items, parsed.tienda) : [];
    const resumenCategorias = this.buildCategorySummary(items);

    const ticket = await this.ticketModel.create({
      ticketId,
      userId,
      tienda: parsed?.tienda ?? 'Por confirmar',
      direccionTienda: parsed?.direccionTienda ?? '',
      fechaCompra: parsed?.fechaCompra ? new Date(parsed.fechaCompra) : new Date(),
      items,
      subtotal: parsed?.subtotal ?? 0,
      impuestos: parsed?.impuestos ?? 0,
      descuentos: parsed?.descuentos ?? 0,
      propina: parsed?.propina ?? 0,
      total: parsed?.total ?? 0,
      moneda,
      metodoPago: parsed?.metodoPago ?? '',
      estado: 'review',
      confirmado: false,
      imagenBase64: dto.imagenBase64,
      imagenMimeType: dto.imagenMimeType ?? 'image/jpeg',
      ocrTextoRaw: ocrText ?? '',
      resumenCategorias,
      cuentaId: dto.cuentaId ?? undefined,
      subCuentaId: dto.subCuentaId ?? undefined,
    });

    // Si autoConfirm y tenemos datos válidos, crear transacción inmediatamente
    if (dto.autoConfirm && parsed && parsed.total > 0) {
      return this.confirmAndCharge(userId, ticketId);
    }

    return {
      message: 'Ticket procesado. Revisa los datos y confirma para aplicar el cargo.',
      ticket: this.formatTicketResponse(ticket),
    };
  }

  // ─── Crear ticket manual ─────────────────────────────────────

  async createManual(userId: string, dto: CreateTicketManualDto) {
    const user = await this.userService.getProfile(userId);
    const moneda = dto.moneda || user.monedaPrincipal || 'MXN';
    const ticketId = await generateUniqueId(this.ticketModel, 'ticketId');

    const items = this.categorizeItems(dto.items, dto.tienda);
    const resumenCategorias = this.buildCategorySummary(items);

    const ticket = await this.ticketModel.create({
      ticketId,
      userId,
      tienda: dto.tienda,
      direccionTienda: dto.direccionTienda ?? '',
      fechaCompra: new Date(dto.fechaCompra),
      items,
      subtotal: dto.subtotal,
      impuestos: dto.impuestos ?? 0,
      descuentos: dto.descuentos ?? 0,
      propina: dto.propina ?? 0,
      total: dto.total,
      moneda,
      metodoPago: dto.metodoPago ?? '',
      estado: 'review',
      confirmado: false,
      imagenBase64: dto.imagenBase64 ?? undefined,
      imagenMimeType: dto.imagenMimeType ?? undefined,
      notas: dto.notas ?? '',
      resumenCategorias,
      cuentaId: dto.cuentaId ?? undefined,
      subCuentaId: dto.subCuentaId ?? undefined,
    });

    return {
      message: 'Ticket creado. Confirma para aplicar el cargo.',
      ticket: this.formatTicketResponse(ticket),
    };
  }

  // ─── Confirmar y aplicar cargo ───────────────────────────────

  async confirmAndCharge(userId: string, ticketId: string, edits?: ConfirmTicketDto) {
    const ticket = await this.ticketModel.findOne({ ticketId, userId });
    if (!ticket) throw new NotFoundException('Ticket no encontrado');
    if (ticket.confirmado) throw new BadRequestException('Este ticket ya fue confirmado');
    if (ticket.estado === 'cancelled') throw new BadRequestException('Este ticket fue cancelado');

    // Aplicar ediciones del usuario antes de confirmar
    if (edits) {
      if (edits.tienda) ticket.tienda = edits.tienda;
      if (edits.fechaCompra) ticket.fechaCompra = new Date(edits.fechaCompra);
      if (edits.items) {
        ticket.items = this.categorizeItems(edits.items, ticket.tienda);
        ticket.resumenCategorias = this.buildCategorySummary(ticket.items);
      }
      if (edits.subtotal !== undefined) ticket.subtotal = edits.subtotal;
      if (edits.impuestos !== undefined) ticket.impuestos = edits.impuestos;
      if (edits.descuentos !== undefined) ticket.descuentos = edits.descuentos;
      if (edits.propina !== undefined) ticket.propina = edits.propina;
      if (edits.total !== undefined) ticket.total = edits.total;
      if (edits.moneda) ticket.moneda = edits.moneda;
      if (edits.metodoPago) ticket.metodoPago = edits.metodoPago;
      if (edits.cuentaId) ticket.cuentaId = edits.cuentaId;
      if (edits.subCuentaId) ticket.subCuentaId = edits.subCuentaId;
      if (edits.notas) ticket.notas = edits.notas;
    }

    if (ticket.total <= 0) {
      throw new BadRequestException('El total del ticket debe ser mayor a 0 para crear una transacción');
    }

    // Crear transacción de egreso — el concepto es el nombre de la tienda/comercio del ticket
    const txResult = await this.transactionsService.crear(
      {
        tipo: 'egreso',
        monto: ticket.total,
        moneda: ticket.moneda,
        concepto: `Compra en ${ticket.tienda}`,
        motivo: `Ticket #${ticket.ticketId} — ${ticket.tienda}`,
        cuentaId: ticket.cuentaId ?? undefined,
        subCuentaId: ticket.subCuentaId ?? undefined,
        afectaCuenta: true,
        fecha: ticket.fechaCompra.toISOString(),
      },
      userId,
    );

    // Actualizar ticket con la transacción generada
    ticket.transaccionId = (txResult.transaccion as any).transaccionId;
    ticket.estado = 'completed';
    ticket.confirmado = true;
    await ticket.save();

    await this.dashboardVersionService.touchDashboard(userId, 'ticket_scan.confirm');

    return {
      message: 'Ticket confirmado y cargo aplicado automáticamente.',
      ticket: this.formatTicketResponse(ticket),
      transaccion: txResult.transaccion,
    };
  }

  // ─── Listar tickets del usuario ──────────────────────────────

  async list(userId: string, filters?: {
    estado?: string;
    tienda?: string;
    desde?: string;
    hasta?: string;
    page?: number;
    limit?: number;
  }) {
    const query: any = { userId };

    if (filters?.estado) query.estado = filters.estado;
    if (filters?.tienda) {
      query.tienda = { $regex: filters.tienda, $options: 'i' };
    }
    if (filters?.desde || filters?.hasta) {
      query.fechaCompra = {};
      if (filters.desde) query.fechaCompra.$gte = new Date(filters.desde);
      if (filters.hasta) query.fechaCompra.$lte = new Date(filters.hasta);
    }

    const page = Math.max(1, filters?.page ?? 1);
    const limit = Math.min(50, Math.max(1, filters?.limit ?? 20));
    const skip = (page - 1) * limit;

    const [tickets, total] = await Promise.all([
      this.ticketModel
        .find(query)
        .select('-imagenBase64 -ocrTextoRaw') // No enviar imagen en listado
        .sort({ fechaCompra: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.ticketModel.countDocuments(query),
    ]);

    return {
      total,
      page,
      limit,
      data: tickets,
    };
  }

  // ─── Detalle de un ticket ────────────────────────────────────

  async getById(userId: string, ticketId: string, includeImage = false) {
    const select = includeImage ? '' : '-imagenBase64';
    const ticket = await this.ticketModel
      .findOne({ ticketId, userId })
      .select(select)
      .lean();

    if (!ticket) throw new NotFoundException('Ticket no encontrado');
    return ticket;
  }

  // ─── Obtener imagen del ticket ───────────────────────────────

  async getImage(userId: string, ticketId: string) {
    const ticket = await this.ticketModel
      .findOne({ ticketId, userId })
      .select('imagenBase64 imagenMimeType')
      .lean();

    if (!ticket) throw new NotFoundException('Ticket no encontrado');
    if (!ticket.imagenBase64) throw new NotFoundException('Este ticket no tiene imagen guardada');

    return {
      imagenBase64: ticket.imagenBase64,
      mimeType: ticket.imagenMimeType ?? 'image/jpeg',
    };
  }

  // ─── Cancelar ticket ────────────────────────────────────────

  async cancel(userId: string, ticketId: string) {
    const ticket = await this.ticketModel.findOne({ ticketId, userId });
    if (!ticket) throw new NotFoundException('Ticket no encontrado');
    if (ticket.estado === 'cancelled') throw new BadRequestException('Ya está cancelado');

    // Si ya tenía transacción, advertir (la transacción no se revierte automáticamente)
    const hadTransaction = !!ticket.transaccionId;

    ticket.estado = 'cancelled';
    await ticket.save();

    await this.dashboardVersionService.touchDashboard(userId, 'ticket_scan.cancel');

    return {
      message: hadTransaction
        ? 'Ticket cancelado. Nota: la transacción asociada NO fue revertida automáticamente. Si deseas revertirla, elimínala manualmente.'
        : 'Ticket cancelado.',
      ticketId,
      transaccionIdAsociada: ticket.transaccionId ?? null,
    };
  }

  // ─── Analytics: resumen de tickets ───────────────────────────

  async getTicketAnalytics(userId: string, desde?: string, hasta?: string) {
    const query: any = { userId, estado: 'completed' };
    if (desde || hasta) {
      query.fechaCompra = {};
      if (desde) query.fechaCompra.$gte = new Date(desde);
      if (hasta) query.fechaCompra.$lte = new Date(hasta);
    }

    const [
      totalTickets,
      byStore,
      byCategory,
      totalGastado,
    ] = await Promise.all([
      this.ticketModel.countDocuments(query),

      this.ticketModel.aggregate([
        { $match: query },
        { $group: { _id: '$tienda', count: { $sum: 1 }, total: { $sum: '$total' } } },
        { $sort: { total: -1 } },
        { $limit: 20 },
      ]).exec(),

      this.ticketModel.aggregate([
        { $match: query },
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.categoria',
            count: { $sum: '$items.cantidad' },
            total: { $sum: '$items.subtotal' },
          },
        },
        { $sort: { total: -1 } },
      ]).exec(),

      this.ticketModel.aggregate([
        { $match: query },
        { $group: { _id: null, total: { $sum: '$total' } } },
      ]).exec(),
    ]);

    return {
      totalTickets,
      totalGastado: totalGastado[0]?.total ?? 0,
      porTienda: byStore.map((s: any) => ({
        tienda: s._id,
        tickets: s.count,
        total: s.total,
      })),
      porCategoria: byCategory.map((c: any) => ({
        categoria: c._id ?? 'otros',
        articulos: c.count,
        total: c.total,
      })),
    };
  }

  // ─── Re-categorizar (si usuario edita nombre del item) ───────

  async recategorizeTicket(userId: string, ticketId: string) {
    const ticket = await this.ticketModel.findOne({ ticketId, userId });
    if (!ticket) throw new NotFoundException('Ticket no encontrado');

    ticket.items = this.categorizeItems(ticket.items as any, ticket.tienda);
    ticket.resumenCategorias = this.buildCategorySummary(ticket.items as any);
    await ticket.save();

    return this.formatTicketResponse(ticket);
  }

  // ─── Formatear respuesta (sin imagen en base64) ──────────────

  private formatTicketResponse(ticket: any) {
    const t = ticket.toObject ? ticket.toObject() : ticket;
    const { imagenBase64, ocrTextoRaw, ...rest } = t;
    return {
      ...rest,
      hasImage: !!imagenBase64,
    };
  }
}

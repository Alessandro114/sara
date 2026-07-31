// ═══════════════════════════════════════════════════
// SCALA WhatsApp Bot — Property Listing Handler
// ═══════════════════════════════════════════════════
// Detects property listings from text, images, and documents,
// extracts structured data via LLM, and saves to PropertyOS DB.
// ═══════════════════════════════════════════════════

import { pool } from '../config.js';
import { chatChain, type ChatMsg } from '../lib/ai-providers.js';
import { getAdminUserId } from '../crm-sync.js';
import pino from 'pino';
import { redactPhone } from '../lib/phone-utils.js';

const log = pino({ name: 'property-listing', level: 'info' });

// ═══════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════

export interface PropertyListing {
    title: string;
    property_type: string | null;   // appartamento, villa, ufficio, negozio, terreno, etc.
    address: string | null;
    city: string | null;
    province: string | null;
    price: number | null;
    surface_sqm: number | null;
    rooms: number | null;
    bathrooms: number | null;
    floor: number | null;           // -1 for piano terra
    features: string[];             // terrazzo, garage, cantina, ascensore, etc.
    description: string | null;
    energy_class: string | null;
    photos: string[];               // media URLs
    status: 'draft' | 'active';
    source: 'whatsapp_sara';
}

// ═══════════════════════════════════════════════════
// Detection: is this message about a property listing?
// ═══════════════════════════════════════════════════

// Price patterns: €xxx.xxx or xxx.xxx€ or 180.000 or 180000
const PRICE_RE = /(?:€\s*\d[\d.,]*|\d[\d.,]*\s*€|\d{2,3}[.,]\d{3}(?:[.,]\d{3})?(?:\s*(?:euro|eur))?)/i;

// Surface patterns: XXmq, XX m², XX m2, XX metri quadri
const SURFACE_RE = /\b\d+\s*(?:mq|m²|m2|metri\s*quadr[i]?)\b/i;

// Property type keywords
const PROPERTY_TYPES_RE = /\b(trilocale|bilocale|monolocale|quadrilocale|pentalocare|attico|mansarda|villa|villetta|appartamento|ufficio|negozio|terreno|loft|rustico|casale|cascina|palazzo|box|garage|magazzino|capannone|locale\s*commerciale)\b/i;

// Address patterns
const ADDRESS_RE = /\b(via|corso|piazza|piazzale|viale|vicolo|largo|lungomare|contrada|strada|loc(?:alita)?\.?)\s+[A-ZÀ-Ú][a-zà-ú]+/i;

// Immobiliare keywords
const REALESTATE_KEYWORDS_RE = /\b(immobile|annuncio|proprietà|vendita|affitto|locazione|classe\s*energetica|piano\s*(?:terra|\d+)|balcone|terrazzo|cantina|ascensore|riscaldamento|condizionamento|posto\s*auto|box\s*auto|giardino|cortile|camera|bagno|cucina|soggiorno|ingresso)\b/i;

/**
 * Detect if a text message is about a property listing.
 * Requires at least 2 of the following signals:
 * - price pattern
 * - surface pattern (mq/m²)
 * - property type keyword
 * - address pattern
 * - real estate keywords (2+ matches)
 */
export function isPropertyListing(text: string): boolean {
    if (!text || text.length < 15) return false;

    let signals = 0;

    if (PRICE_RE.test(text)) signals++;
    if (SURFACE_RE.test(text)) signals++;
    if (PROPERTY_TYPES_RE.test(text)) signals++;
    if (ADDRESS_RE.test(text)) signals++;

    // Count real estate keyword hits
    const kwMatches = text.match(new RegExp(REALESTATE_KEYWORDS_RE.source, 'gi'));
    if (kwMatches && kwMatches.length >= 2) signals++;

    // Explicit "nuovo immobile" / "inserisci immobile" trigger
    if (/\b(nuovo\s+immobile|inserisci\s+immobile|aggiungi\s+immobile|salva\s+immobile|new\s+listing|add\s+listing|save\s+listing)\b/i.test(text)) {
        signals += 2; // strong signal
    }

    return signals >= 2;
}

/**
 * Detect if OCR/vision text from an image looks like a property listing.
 * More lenient than text detection since images are often listing sheets.
 */
export function isPropertyImage(ocrOrVisionText: string, caption?: string): boolean {
    if (!ocrOrVisionText) return false;

    // If caption explicitly mentions property/immobile
    if (caption && /\b(immobile|proprietà|annuncio|listing|property|appartamento|casa|villa)\b/i.test(caption)) {
        return true;
    }

    // Check the OCR text with lower threshold
    let signals = 0;
    if (PRICE_RE.test(ocrOrVisionText)) signals++;
    if (SURFACE_RE.test(ocrOrVisionText)) signals++;
    if (PROPERTY_TYPES_RE.test(ocrOrVisionText)) signals++;

    const kwMatches = ocrOrVisionText.match(new RegExp(REALESTATE_KEYWORDS_RE.source, 'gi'));
    if (kwMatches && kwMatches.length >= 3) signals++;

    return signals >= 2;
}

// ═══════════════════════════════════════════════════
// LLM Extraction
// ═══════════════════════════════════════════════════

const EXTRACTION_PROMPT = `You are a real estate data extraction assistant. Extract property listing data from the text below and return ONLY valid JSON (no markdown, no explanation).

Return this exact JSON structure:
{
  "title": "short descriptive title (e.g. 'Trilocale Via Roma 15, Gaeta')",
  "property_type": "one of: appartamento, villa, ufficio, negozio, terreno, casa, attico, loft, rustico, magazzino, altro",
  "address": "street address if found",
  "city": "city name",
  "province": "province abbreviation (e.g. LT, RM, MI) or full name",
  "price": 180000,
  "surface_sqm": 80,
  "rooms": 3,
  "bathrooms": 1,
  "floor": 2,
  "features": ["terrazzo", "garage", "cantina", "ascensore"],
  "description": "brief description of the property",
  "energy_class": "A-G or null"
}

Rules:
- price must be a number without currency symbols (180000 not "€180.000")
- surface_sqm must be a number
- floor: use -1 for "piano terra", null if unknown
- features: array of strings, empty array if none mentioned
- If a field cannot be determined from the text, set it to null
- property_type must be one of the listed values, default to "altro" if unclear

Text to extract from:
`;

/**
 * Extract listing data from a text message using LLM.
 */
export async function extractListingFromText(text: string): Promise<PropertyListing | null> {
    try {
        const messages: ChatMsg[] = [
            { role: 'system', content: EXTRACTION_PROMPT },
            { role: 'user', content: text },
        ];

        const result = await chatChain(messages, 800);
        return parseLLMResponse(result.text);
    } catch (err: any) {
        log.error({ err: err.message }, 'LLM extraction from text failed');
        return null;
    }
}

/**
 * Extract listing data from OCR/vision text (image or document).
 */
export async function extractListingFromImage(ocrText: string, imageUrl?: string): Promise<PropertyListing | null> {
    try {
        const messages: ChatMsg[] = [
            { role: 'system', content: EXTRACTION_PROMPT },
            { role: 'user', content: `[Extracted from property listing image/document]\n\n${ocrText}` },
        ];

        const result = await chatChain(messages, 800);
        const listing = parseLLMResponse(result.text);
        if (listing && imageUrl) {
            listing.photos = [imageUrl];
        }
        return listing;
    } catch (err: any) {
        log.error({ err: err.message }, 'LLM extraction from image failed');
        return null;
    }
}

/**
 * Parse LLM JSON response into PropertyListing.
 */
function parseLLMResponse(rawText: string): PropertyListing | null {
    try {
        // Strip markdown code fences if present
        let cleaned = rawText.trim();
        cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
        cleaned = cleaned.trim();

        // Find the first { and last }
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start === -1 || end === -1) return null;

        const json = JSON.parse(cleaned.substring(start, end + 1));

        // Validate and normalize
        const listing: PropertyListing = {
            title: json.title || 'Immobile senza titolo',
            property_type: normalizePropertyType(json.property_type),
            address: json.address || null,
            city: json.city || null,
            province: json.province || null,
            price: typeof json.price === 'number' ? json.price : parsePrice(json.price),
            surface_sqm: typeof json.surface_sqm === 'number' ? json.surface_sqm : parseFloat(json.surface_sqm) || null,
            rooms: typeof json.rooms === 'number' ? json.rooms : parseInt(json.rooms) || null,
            bathrooms: typeof json.bathrooms === 'number' ? json.bathrooms : parseInt(json.bathrooms) || null,
            floor: json.floor === -1 ? -1 : (typeof json.floor === 'number' ? json.floor : null),
            features: Array.isArray(json.features) ? json.features.filter((f: any) => typeof f === 'string') : [],
            description: json.description || null,
            energy_class: json.energy_class || null,
            photos: [],
            status: 'draft',
            source: 'whatsapp_sara',
        };

        return listing;
    } catch (err: any) {
        log.error({ err: err.message, raw: rawText.substring(0, 200) }, 'Failed to parse LLM listing response');
        return null;
    }
}

function normalizePropertyType(raw: string | null): string | null {
    if (!raw) return null;
    const lower = raw.toLowerCase().trim();
    const valid = ['appartamento', 'villa', 'ufficio', 'negozio', 'terreno', 'casa', 'attico', 'loft', 'rustico', 'magazzino', 'altro'];
    if (valid.includes(lower)) return lower;

    // Map common aliases
    const aliases: Record<string, string> = {
        trilocale: 'appartamento',
        bilocale: 'appartamento',
        monolocale: 'appartamento',
        quadrilocale: 'appartamento',
        mansarda: 'attico',
        villetta: 'villa',
        casale: 'rustico',
        cascina: 'rustico',
        capannone: 'magazzino',
        'locale commerciale': 'negozio',
    };
    return aliases[lower] || 'altro';
}

function parsePrice(raw: any): number | null {
    if (!raw) return null;
    const str = String(raw).replace(/[€$\s]/g, '').replace(/\./g, '').replace(',', '.');
    const num = parseFloat(str);
    return isNaN(num) ? null : num;
}

// ═══════════════════════════════════════════════════
// Database: save listing to PropertyOS
// ═══════════════════════════════════════════════════

/**
 * Save a property listing to the database.
 * Returns the listing ID on success, null on failure.
 */
export async function saveListingToDatabase(listing: PropertyListing, userId: string): Promise<string | null> {
    try {
        const result = await pool.query(`
            INSERT INTO property_listings (
                user_id, title, property_type, address, city, province,
                price, surface_sqm, rooms, bathrooms, floor,
                features, description, energy_class, photos,
                status, source, created_at, updated_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6,
                $7, $8, $9, $10, $11,
                $12, $13, $14, $15,
                $16, $17, NOW(), NOW()
            )
            RETURNING id
        `, [
            userId,
            listing.title,
            listing.property_type,
            listing.address,
            listing.city,
            listing.province,
            listing.price,
            listing.surface_sqm,
            listing.rooms,
            listing.bathrooms,
            listing.floor,
            listing.features,
            listing.description,
            listing.energy_class,
            listing.photos,
            listing.status,
            listing.source,
        ]);

        const id = result.rows[0]?.id;
        log.info({ id, title: listing.title, city: listing.city, price: listing.price }, 'property listing saved');
        return id;
    } catch (err: any) {
        log.error({ err: err.message, title: listing.title }, 'failed to save property listing');
        return null;
    }
}

// ═══════════════════════════════════════════════════
// High-level: detect + extract + save (called from handlers)
// ═══════════════════════════════════════════════════

/**
 * Process a property listing from text.
 * Returns a user-facing confirmation message, or null if not a listing / failed.
 */
export async function processPropertyListingFromText(
    text: string,
    phone: string,
    session: any,
): Promise<string | null> {
    if (!isPropertyListing(text)) return null;

    console.log(`[PROPERTY] ${redactPhone(phone)}: Property listing detected in text`);

    const listing = await extractListingFromText(text);
    if (!listing) {
        console.log(`[PROPERTY] ${redactPhone(phone)}: LLM extraction failed`);
        return null;
    }

    // Resolve user_id: prefer session's scala_user_id, fall back to admin
    const userId = session?.scala_user_id || await getAdminUserId();
    if (!userId) {
        log.warn({ phone }, 'no user_id available for property listing');
        return null;
    }

    const listingId = await saveListingToDatabase(listing, userId);
    if (!listingId) return null;

    // Build confirmation message (multilingual)
    const lang = session?.user_language || 'it';
    return buildConfirmationMessage(listing, lang);
}

/**
 * Process a property listing from image OCR/vision text.
 * Returns a user-facing confirmation message, or null if not a listing / failed.
 */
export async function processPropertyListingFromImage(
    ocrText: string,
    phone: string,
    session: any,
    imageUrl?: string,
    caption?: string,
): Promise<string | null> {
    if (!isPropertyImage(ocrText, caption)) return null;

    console.log(`[PROPERTY] ${redactPhone(phone)}: Property listing detected in image`);

    const listing = await extractListingFromImage(ocrText, imageUrl);
    if (!listing) {
        console.log(`[PROPERTY] ${redactPhone(phone)}: LLM extraction from image failed`);
        return null;
    }

    const userId = session?.scala_user_id || await getAdminUserId();
    if (!userId) {
        log.warn({ phone }, 'no user_id available for property listing');
        return null;
    }

    const listingId = await saveListingToDatabase(listing, userId);
    if (!listingId) return null;

    const lang = session?.user_language || 'it';
    return buildConfirmationMessage(listing, lang);
}

/**
 * Process a property listing from document text (PDF).
 * Returns a user-facing confirmation message, or null if not a listing / failed.
 */
export async function processPropertyListingFromDocument(
    extractedText: string,
    phone: string,
    session: any,
    filename?: string,
): Promise<string | null> {
    // For documents, use a lower detection threshold — PDFs sent to SARA
    // in the immobiliare sector are very likely property-related.
    const isImmobSector = session?.sector === 'immobiliare';
    if (!isImmobSector && !isPropertyListing(extractedText)) return null;

    console.log(`[PROPERTY] ${redactPhone(phone)}: Property listing detected in document "${filename || 'unknown'}"`);

    const listing = await extractListingFromText(extractedText);
    if (!listing) {
        console.log(`[PROPERTY] ${redactPhone(phone)}: LLM extraction from document failed`);
        return null;
    }

    const userId = session?.scala_user_id || await getAdminUserId();
    if (!userId) {
        log.warn({ phone }, 'no user_id available for property listing');
        return null;
    }

    const listingId = await saveListingToDatabase(listing, userId);
    if (!listingId) return null;

    const lang = session?.user_language || 'it';
    return buildConfirmationMessage(listing, lang);
}

// ═══════════════════════════════════════════════════
// Confirmation messages
// ═══════════════════════════════════════════════════

function buildConfirmationMessage(listing: PropertyListing, lang: string): string {
    const priceStr = listing.price
        ? `€${listing.price.toLocaleString('it-IT')}`
        : '(prezzo non indicato)';
    const locationStr = [listing.address, listing.city].filter(Boolean).join(', ') || '(indirizzo non indicato)';

    const templates: Record<string, string> = {
        it: `Ho salvato l'immobile: ${listing.title} - ${priceStr} - ${locationStr}. Lo trovi in PropertyOS nella sezione Immobili.`,
        en: `I saved the property: ${listing.title} - ${priceStr} - ${locationStr}. You can find it in PropertyOS under Listings.`,
        es: `He guardado el inmueble: ${listing.title} - ${priceStr} - ${locationStr}. Lo encontraras en PropertyOS en la seccion Inmuebles.`,
        pt: `Salvei o imovel: ${listing.title} - ${priceStr} - ${locationStr}. Voce pode encontra-lo no PropertyOS na secao Imoveis.`,
    };

    return templates[lang] || templates.it;
}

#!/usr/bin/env node
// ═══════════════════════════════════════════════════
// SARA RAG KB — Ortofrutticoli B2B (Wholesale Produce)
// Multilingual: IT/EN/ES/PT/DE
// Run: cd /home/ale/whatsapp-bot && node scripts/load-kb-ortofrutticoli.mjs
// ═══════════════════════════════════════════════════
import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const { embedChain } = await import('../dist/lib/ai-providers.js');

const SECTOR = 'ortofrutticolo';

const KB = [
  // ═══════════════════════════════════════════════════
  // ITALIANO — 15 documents
  // ═══════════════════════════════════════════════════
  { t: 'Catalogo prodotti ortofrutticoli', q: 'Che prodotti vendete?',
    a: `Offriamo una gamma completa di prodotti ortofrutticoli B2B: frutta fresca di stagione (agrumi, mele, pere, pesche, uva, kiwi, fragole), verdura fresca (insalate, pomodori, zucchine, melanzane, peperoni, carote, patate, cipolle), frutta esotica (avocado, mango, papaya, ananas, lime, passion fruit), IV gamma (insalate lavate e pronte, verdure tagliate, mix pronti), V gamma (verdure cotte sottovuoto), prodotti biologici certificati, erbe aromatiche fresche (basilico, prezzemolo, rosmarino, salvia). Consegna quotidiana con catena del freddo garantita.` },

  { t: 'Frutta di stagione disponibile', q: 'Che frutta avete di stagione?',
    a: `La disponibilità varia per stagione. Primavera: fragole, ciliegie, nespole, albicocche. Estate: pesche, meloni, angurie, susine, fichi, uva. Autunno: mele, pere, cachi, melograni, castagne, uva da tavola. Inverno: agrumi (arance, mandarini, limoni, pompelmi), kiwi, mele, pere. Tutto l'anno: banane, mele, limoni, ananas. Prodotti esotici disponibili tutto l'anno tramite importazione diretta. Listino aggiornato settimanalmente in base al mercato.` },

  { t: 'Verdure e ortaggi disponibili', q: 'Che verdure avete?',
    a: `Verdura fresca disponibile tutto l'anno con variazioni stagionali. Sempre disponibili: insalate (iceberg, romana, gentile, rucola, valeriana), pomodori (ciliegino, cuore di bue, datterino, San Marzano), zucchine, carote, patate, cipolle, aglio. Stagionali: carciofi (inverno-primavera), asparagi (primavera), fagiolini, melanzane, peperoni (estate), zucca, cavoli, broccoli, cime di rapa (autunno-inverno), funghi. IV gamma: buste lavate pronte all'uso per ristorazione e GDO.` },

  { t: 'Prodotti biologici certificati', q: 'Avete prodotti bio?',
    a: `Sì, linea biologica certificata con marchio UE (foglia verde). Frutta bio: mele, pere, agrumi, kiwi, banane, fragole. Verdura bio: insalate, pomodori, zucchine, carote, patate, cipolle, broccoli, spinaci. Certificazione secondo Reg. UE 2018/848. Tracciabilità completa dal campo al cliente. Disponibilità soggetta a stagionalità. Supplemento bio mediamente +20-40% rispetto al convenzionale. Fornitura per GDO, ristorazione biologica, mense scolastiche e aziendali.` },

  { t: 'IV e V gamma pronta all\'uso', q: 'Avete prodotti di IV gamma?',
    a: `Sì, linea completa IV gamma (prodotti lavati, tagliati, pronti all'uso) e V gamma (cotti sottovuoto). IV gamma: insalate miste, rucola, spinacino, julienne di carote, cubetti di zucca, striscioline di peperoni, mix per wok, insalatone complete. V gamma: patate cotte, verdure grigliate, legumi cotti, minestrone pronto. Shelf life IV gamma: 5-7 giorni a 4°C. Ideali per ristorazione, catering, mense, hotel. Confezioni da 500g a 5kg. Personalizzazione mix su richiesta per grandi volumi.` },

  { t: 'Ordini e quantitativi minimi', q: 'Come posso ordinare? Qual è il minimo d\'ordine?',
    a: `Ordini via WhatsApp, telefono, email o piattaforma B2B online. Ordine minimo: 1 bancale misto (circa 200-300 kg) per consegna gratuita. Per ordini sotto il minimo, contributo trasporto da concordare. Cut-off ordini: entro le 16:00 per consegna il giorno successivo (H+1). Ordini urgenti mattutini valutati caso per caso. Listino prezzi aggiornato settimanalmente. Possibilità di ordini ricorrenti programmati (standing order) per clienti abituali.` },

  { t: 'Prezzi e listino', q: 'Quanto costano i prodotti? Avete un listino?',
    a: `I prezzi dei prodotti ortofrutticoli variano quotidianamente in base al mercato all'ingrosso, alla stagionalità e alla disponibilità. Inviamo il listino aggiornato settimanalmente via WhatsApp o email. Sconti volume: -5% sopra i 500 kg/settimana, -10% sopra i 1.000 kg/settimana, -15% per contratti annuali programmati. Prezzi franco magazzino o franco destino (consegna inclusa sopra il minimo d'ordine). Pagamento: 30-60 giorni fine mese per clienti accreditati.` },

  { t: 'Consegna e logistica', q: 'Come funziona la consegna?',
    a: `Consegna quotidiana con mezzi refrigerati (0-4°C per ortofrutta, 8-12°C per prodotti tropicali). Copertura: zona locale e regionale. Consegna H+1 (ordine oggi, consegna domani). Fasce orarie: 5:00-7:00 (mercati/grossisti), 7:00-12:00 (ristorazione/GDO), personalizzabili. Catena del freddo tracciata con data logger. Imballo: casse riutilizzabili (IFCO/Euro Pool), cartone monouso su richiesta. Documenti: DDT con lotto e tracciabilità, certificati qualità su richiesta.` },

  { t: 'Qualità e certificazioni', q: 'Che certificazioni avete?',
    a: `Certificazioni attive: GLOBALG.A.P. (buone pratiche agricole), BRC (sicurezza alimentare), IFS Food (standard internazionale), Biologico UE (Reg. 2018/848), HACCP (autocontrollo igienico-sanitario). Tracciabilità completa Reg. CE 178/2002: dal campo al cliente in max 4 ore. Controllo qualità in ingresso: Brix (dolcezza), calibro, maturazione, difetti. Laboratorio analisi residui pesticidi. Gestione recall e ritiro prodotto secondo procedure certificate.` },

  { t: 'Condizioni di pagamento', q: 'Come si paga? Che condizioni offrite?',
    a: `Nuovi clienti: pagamento anticipato o alla consegna per i primi 3 ordini. Clienti accreditati (con referenze commerciali): 30 giorni fine mese, 60 giorni fine mese, o RIBA 30/60 giorni. Bonifico bancario, RIBA, SEPA Direct Debit. Nessun assegno. Per contratti annuali: condizioni preferenziali concordate. In caso di ritardo pagamento: sospensione forniture dopo 15 giorni oltre scadenza. Fatturazione elettronica SDI obbligatoria.` },

  { t: 'Resi e reclami qualità', q: 'Come funzionano i resi?',
    a: `Reclami qualità entro 24 ore dalla consegna con foto del prodotto e DDT. Verifica immediata dal nostro reparto qualità. Se il reclamo è fondato: nota di credito o sostituzione prodotto nella consegna successiva. Resi per merce non conforme: ritiro a nostro carico. Non accettiamo resi per ordini errati del cliente oltre le 2 ore dalla consegna. Per prodotti deperibili, la verifica visiva alla consegna è fondamentale: segnalare anomalie al corriere sul DDT.` },

  { t: 'Clienti target B2B', q: 'A chi vendete?',
    a: `Serviamo esclusivamente clienti B2B: ristoranti, hotel, mense aziendali e scolastiche, catering, bar e gastronomie, GDO (supermercati e discount), negozi specializzati (fruttivendoli, botteghe), grossisti secondari, trasformatori (succhi, conserve, surgelati), e-commerce food. Non vendiamo al dettaglio ai privati. Per diventare cliente: inviare P.IVA, visura camerale, referenze commerciali. Attivazione account in 48h lavorative.` },

  { t: 'Frutta esotica e importazione', q: 'Avete frutta esotica?',
    a: `Sì, linea completa frutta esotica da importazione diretta e distributori certificati: avocado (Hass Perù/Messico/Spagna), mango (Kent, Tommy Atkins), papaya, ananas (Costa Rica, Ghana), passion fruit, lime, cocco, litchi (stagionale), dragon fruit, guava, carambola, platano. Disponibilità tutto l'anno con variazioni di origine. Maturazione controllata in magazzino climatizzato. Calibri e gradi di maturazione selezionabili. Shelf life garantita per HoReCa.` },

  { t: 'Prodotti per ristorazione', q: 'Avete prodotti specifici per ristoranti?',
    a: `Sì, linea dedicata HoReCa: IV gamma tagliata pronta per cucina (julienne, brunoise, chiffonade), erbe aromatiche fresche in vasetto, micro-greens e germogli, fiori edibili, finger lime, agrumi ornamentali, frutta per cocktail bar (lime, limoni, frutti di bosco). Pack dedicati: cassette piccole da 3-5 kg per ristoranti, consegna anche 6 giorni su 7. Consulenza per menu stagionale su richiesta. Campioni gratuiti per nuovi prodotti.` },

  { t: 'Sostenibilità e packaging', q: 'Usate imballaggi sostenibili?',
    a: `Impegno sostenibilità: casse riutilizzabili IFCO/Euro Pool System (circuito chiuso, lavaggio e sanificazione certificata), riduzione plastica monouso del 60%, film compostabili per IV gamma, cartone FSC per export. Prodotti KM0 e filiera corta quando disponibili. Certificazione Carbon Footprint in corso. Collaborazione con banchi alimentari per invenduto ancora commestibile. Report sostenibilità annuale disponibile per clienti GDO.` },

  // ═══════════════════════════════════════════════════
  // ENGLISH — 10 documents
  // ═══════════════════════════════════════════════════
  { t: 'Product catalogue — fresh produce B2B', q: 'What products do you sell?',
    a: `We offer a full range of B2B fresh produce: seasonal fruit (citrus, apples, pears, stone fruit, grapes, kiwi, strawberries), fresh vegetables (lettuce, tomatoes, courgettes, aubergines, peppers, carrots, potatoes, onions), exotic fruit (avocado, mango, papaya, pineapple, lime, passion fruit), ready-to-eat (washed salads, cut vegetables, stir-fry mixes), cooked vacuum-packed vegetables, certified organic produce, fresh herbs (basil, parsley, rosemary, sage). Daily delivery with guaranteed cold chain.` },

  { t: 'How to order — wholesale produce', q: 'How can I place an order?',
    a: `Orders via WhatsApp, phone, email or our B2B online platform. Minimum order: 1 mixed pallet (approx. 200-300 kg) for free delivery. For smaller orders, a delivery surcharge applies. Order cut-off: 4:00 PM for next-day delivery (D+1). Updated weekly price list sent via WhatsApp or email. Standing orders available for regular customers. Volume discounts: -5% above 500 kg/week, -10% above 1,000 kg/week, -15% for annual contracts.` },

  { t: 'Delivery and logistics', q: 'How does delivery work?',
    a: `Daily delivery with refrigerated vehicles (0-4°C for produce, 8-12°C for tropical). Local and regional coverage. D+1 delivery (order today, delivered tomorrow). Time slots: 5-7 AM (markets/wholesalers), 7 AM-12 PM (restaurants/retail), customisable. Cold chain tracked with data loggers. Packaging: reusable crates (IFCO/Euro Pool) or single-use cardboard. Documents: delivery note with batch and traceability, quality certificates on request.` },

  { t: 'Quality and certifications', q: 'What certifications do you have?',
    a: `Active certifications: GLOBALG.A.P. (good agricultural practices), BRC (food safety), IFS Food (international standard), EU Organic (Reg. 2018/848), HACCP (hygiene self-control). Full traceability per EC Reg. 178/2002: field to customer in max 4 hours. Incoming quality control: Brix (sweetness), calibre, ripeness, defects. Pesticide residue lab testing. Product recall management per certified procedures.` },

  { t: 'Payment terms — B2B', q: 'What are the payment terms?',
    a: `New customers: payment in advance or on delivery for the first 3 orders. Accredited customers (with trade references): 30 days end of month, 60 days end of month, or SEPA Direct Debit. Bank transfer, SEPA DD accepted. No cheques. Annual contracts: preferential terms by agreement. Late payment: supply suspended 15 days past due date. Electronic invoicing mandatory.` },

  { t: 'Seasonal fruit availability', q: 'What fruit is in season?',
    a: `Seasonal availability varies. Spring: strawberries, cherries, apricots. Summer: peaches, melons, watermelons, plums, figs, grapes. Autumn: apples, pears, persimmons, pomegranates, chestnuts. Winter: citrus (oranges, mandarins, lemons, grapefruit), kiwi, apples, pears. Year-round: bananas, apples, lemons, pineapple. Exotic produce available year-round via direct import. Price list updated weekly based on market conditions.` },

  { t: 'B2B target customers', q: 'Who do you sell to?',
    a: `We serve B2B customers exclusively: restaurants, hotels, corporate and school canteens, catering companies, bars and delis, retail chains (supermarkets and discount stores), specialist shops (greengrocers, farm shops), secondary wholesalers, food processors (juices, preserves, frozen), food e-commerce. No retail sales to private consumers. To become a customer: send your VAT number, company registration, and trade references. Account activation within 48 business hours.` },

  { t: 'Exotic fruit and imports', q: 'Do you have exotic fruit?',
    a: `Yes, full exotic fruit range from direct import and certified distributors: avocado (Hass from Peru/Mexico/Spain), mango (Kent, Tommy Atkins), papaya, pineapple (Costa Rica, Ghana), passion fruit, lime, coconut, lychee (seasonal), dragon fruit, guava, starfruit, plantain. Year-round availability with origin variations. Controlled ripening in climate-managed warehouse. Selectable calibres and ripeness levels. Guaranteed shelf life for HoReCa.` },

  { t: 'Returns and quality claims', q: 'How do returns work?',
    a: `Quality claims within 24 hours of delivery with product photos and delivery note. Immediate verification by our quality department. If claim is valid: credit note or product replacement on next delivery. Returns for non-conforming goods: collection at our expense. We do not accept returns for customer ordering errors beyond 2 hours from delivery. For perishable products, visual inspection on delivery is essential: report anomalies to the driver on the delivery note.` },

  { t: 'HoReCa products for restaurants', q: 'Do you have products for restaurants?',
    a: `Yes, dedicated HoReCa line: ready-to-cook cut vegetables (julienne, brunoise, chiffonade), fresh herbs in pots, micro-greens and sprouts, edible flowers, finger lime, ornamental citrus, cocktail bar fruit (limes, lemons, berries). Dedicated packs: small crates 3-5 kg for restaurants, delivery up to 6 days a week. Seasonal menu consulting on request. Free samples for new products.` },

  // ═══════════════════════════════════════════════════
  // ESPAÑOL — 8 documents
  // ═══════════════════════════════════════════════════
  { t: 'Catálogo de productos hortofrutícolas', q: '¿Qué productos venden?',
    a: `Ofrecemos una gama completa de productos hortofrutícolas B2B: fruta fresca de temporada (cítricos, manzanas, peras, melocotones, uva, kiwi, fresas), verdura fresca (lechugas, tomates, calabacines, berenjenas, pimientos, zanahorias, patatas, cebollas), fruta exótica (aguacate, mango, papaya, piña, lima, maracuyá), IV gama (ensaladas lavadas listas para consumir, verduras cortadas, mezclas preparadas), V gama (verduras cocidas al vacío), productos ecológicos certificados, hierbas aromáticas frescas. Entrega diaria con cadena de frío garantizada.` },

  { t: 'Cómo hacer pedidos — mayorista', q: '¿Cómo puedo hacer un pedido?',
    a: `Pedidos por WhatsApp, teléfono, email o plataforma B2B online. Pedido mínimo: 1 palé mixto (aprox. 200-300 kg) para envío gratuito. Para pedidos menores, contribución de transporte a acordar. Hora límite de pedido: antes de las 16:00 para entrega al día siguiente (D+1). Lista de precios actualizada semanalmente. Pedidos recurrentes programados (standing order) para clientes habituales. Descuentos por volumen: -5% más de 500 kg/semana, -10% más de 1.000 kg/semana.` },

  { t: 'Entrega y logística', q: '¿Cómo funciona la entrega?',
    a: `Entrega diaria con vehículos refrigerados (0-4°C para frutas y verduras, 8-12°C para tropicales). Cobertura local y regional. Entrega D+1 (pedido hoy, entrega mañana). Franjas horarias: 5:00-7:00 (mercados/mayoristas), 7:00-12:00 (restauración/distribución). Cadena de frío trazada con data logger. Embalaje: cajas reutilizables (IFCO/Euro Pool), cartón desechable bajo pedido. Documentos: albarán con lote y trazabilidad.` },

  { t: 'Calidad y certificaciones', q: '¿Qué certificaciones tienen?',
    a: `Certificaciones activas: GLOBALG.A.P. (buenas prácticas agrícolas), BRC (seguridad alimentaria), IFS Food (estándar internacional), Ecológico UE (Reg. 2018/848), APPCC/HACCP (autocontrol higiénico-sanitario). Trazabilidad completa según Reg. CE 178/2002: del campo al cliente en máx. 4 horas. Control de calidad en recepción: Brix (dulzor), calibre, maduración, defectos. Análisis de residuos de pesticidas en laboratorio.` },

  { t: 'Condiciones de pago', q: '¿Cuáles son las condiciones de pago?',
    a: `Nuevos clientes: pago anticipado o contra entrega para los primeros 3 pedidos. Clientes acreditados (con referencias comerciales): 30 días fin de mes, 60 días fin de mes, o domiciliación bancaria SEPA. Transferencia bancaria, SEPA DD. Sin cheques. Contratos anuales: condiciones preferenciales. Retraso en el pago: suspensión de suministro 15 días después del vencimiento. Facturación electrónica obligatoria.` },

  { t: 'Fruta de temporada', q: '¿Qué fruta tienen de temporada?',
    a: `La disponibilidad varía por temporada. Primavera: fresas, cerezas, albaricoques. Verano: melocotones, melones, sandías, ciruelas, higos, uva. Otoño: manzanas, peras, caquis, granadas, castañas. Invierno: cítricos (naranjas, mandarinas, limones, pomelos), kiwi, manzanas, peras. Todo el año: plátanos, manzanas, limones, piña. Productos exóticos disponibles todo el año por importación directa. Lista de precios actualizada semanalmente.` },

  { t: 'Productos para restauración', q: '¿Tienen productos para restaurantes?',
    a: `Sí, línea dedicada HoReCa: IV gama cortada lista para cocinar (juliana, brunoise), hierbas aromáticas frescas en maceta, micro-greens y germinados, flores comestibles, cítricos ornamentales, fruta para coctelería (limas, limones, frutos del bosque). Packs dedicados: cajas pequeñas de 3-5 kg para restaurantes, entrega hasta 6 días a la semana. Asesoramiento de menú estacional bajo pedido. Muestras gratuitas de nuevos productos.` },

  { t: 'Devoluciones y reclamaciones', q: '¿Cómo funcionan las devoluciones?',
    a: `Reclamaciones de calidad dentro de las 24 horas desde la entrega con fotos del producto y albarán. Verificación inmediata por nuestro departamento de calidad. Si la reclamación es válida: nota de crédito o sustitución del producto en la siguiente entrega. Devoluciones por mercancía no conforme: recogida a nuestro cargo. No aceptamos devoluciones por errores de pedido del cliente pasadas 2 horas desde la entrega.` },

  // ═══════════════════════════════════════════════════
  // PORTUGUÊS — 6 documents
  // ═══════════════════════════════════════════════════
  { t: 'Catálogo de produtos hortifrutícolas', q: 'Que produtos vocês vendem?',
    a: `Oferecemos uma gama completa de produtos hortifrutícolas B2B: frutas frescas da estação (cítricos, maçãs, peras, pêssegos, uvas, kiwi, morangos), verduras e legumes frescos (alfaces, tomates, abobrinhas, berinjelas, pimentões, cenouras, batatas, cebolas), frutas exóticas (abacate, manga, mamão, abacaxi, limão, maracujá), IV gama (saladas lavadas prontas para consumo, vegetais cortados, misturas prontas), V gama (vegetais cozidos a vácuo), produtos orgânicos certificados, ervas aromáticas frescas. Entrega diária com cadeia de frio garantida.` },

  { t: 'Como fazer pedidos — atacado', q: 'Como posso fazer um pedido?',
    a: `Pedidos por WhatsApp, telefone, email ou plataforma B2B online. Pedido mínimo: 1 palete misto (aprox. 200-300 kg) para entrega gratuita. Para pedidos menores, contribuição de transporte a combinar. Horário limite: até as 16:00 para entrega no dia seguinte (D+1). Lista de preços atualizada semanalmente. Pedidos recorrentes programados para clientes habituais. Descontos por volume: -5% acima de 500 kg/semana, -10% acima de 1.000 kg/semana.` },

  { t: 'Entrega e logística', q: 'Como funciona a entrega?',
    a: `Entrega diária com veículos refrigerados (0-4°C para hortifrúti, 8-12°C para tropicais). Cobertura local e regional. Entrega D+1 (pedido hoje, entrega amanhã). Faixas horárias: 5:00-7:00 (mercados/atacadistas), 7:00-12:00 (restauração/distribuição). Cadeia de frio rastreada com data logger. Embalagem: caixas reutilizáveis (IFCO/Euro Pool), papelão descartável sob pedido. Documentos: nota de entrega com lote e rastreabilidade.` },

  { t: 'Qualidade e certificações', q: 'Que certificações vocês têm?',
    a: `Certificações ativas: GLOBALG.A.P. (boas práticas agrícolas), BRC (segurança alimentar), IFS Food (padrão internacional), Orgânico UE (Reg. 2018/848), APPCC/HACCP (autocontrole higiênico-sanitário). Rastreabilidade completa conforme Reg. CE 178/2002: do campo ao cliente em máx. 4 horas. Controle de qualidade na recepção: Brix (doçura), calibre, maturação, defeitos. Análise laboratorial de resíduos de pesticidas.` },

  { t: 'Condições de pagamento', q: 'Quais são as condições de pagamento?',
    a: `Novos clientes: pagamento antecipado ou na entrega para os primeiros 3 pedidos. Clientes credenciados (com referências comerciais): 30 dias fim de mês, 60 dias fim de mês, ou débito direto SEPA. Transferência bancária, SEPA DD aceitos. Sem cheques. Contratos anuais: condições preferenciais por acordo. Atraso no pagamento: suspensão de fornecimento 15 dias após o vencimento. Faturação eletrónica obrigatória.` },

  { t: 'Frutas da estação', q: 'Que frutas vocês têm da estação?',
    a: `A disponibilidade varia por estação. Primavera: morangos, cerejas, damascos. Verão: pêssegos, melões, melancias, ameixas, figos, uvas. Outono: maçãs, peras, caquis, romãs, castanhas. Inverno: cítricos (laranjas, tangerinas, limões, toranjas), kiwi, maçãs, peras. O ano todo: bananas, maçãs, limões, abacaxi. Frutas exóticas disponíveis o ano todo por importação direta. Lista de preços atualizada semanalmente conforme o mercado.` },

  // ═══════════════════════════════════════════════════
  // DEUTSCH — 6 documents
  // ═══════════════════════════════════════════════════
  { t: 'Produktkatalog — Obst und Gemüse Großhandel', q: 'Welche Produkte verkaufen Sie?',
    a: `Wir bieten ein vollständiges B2B-Sortiment an Obst und Gemüse: saisonales Frischobst (Zitrusfrüchte, Äpfel, Birnen, Pfirsiche, Trauben, Kiwi, Erdbeeren), frisches Gemüse (Salate, Tomaten, Zucchini, Auberginen, Paprika, Karotten, Kartoffeln, Zwiebeln), exotische Früchte (Avocado, Mango, Papaya, Ananas, Limette, Passionsfrucht), Convenience-Produkte (gewaschene Salate, geschnittenes Gemüse, fertige Mischungen), vakuumgegartes Gemüse, zertifizierte Bio-Produkte, frische Kräuter (Basilikum, Petersilie, Rosmarin, Salbei). Tägliche Lieferung mit garantierter Kühlkette.` },

  { t: 'Bestellungen und Mindestmengen', q: 'Wie kann ich bestellen? Was ist die Mindestbestellmenge?',
    a: `Bestellungen per WhatsApp, Telefon, E-Mail oder über unsere B2B-Online-Plattform. Mindestbestellmenge: 1 gemischte Palette (ca. 200-300 kg) für kostenlose Lieferung. Bei kleineren Bestellungen fällt ein Transportzuschlag an. Bestellschluss: 16:00 Uhr für Lieferung am nächsten Tag (D+1). Preisliste wird wöchentlich aktualisiert. Daueraufträge für Stammkunden möglich. Mengenrabatte: -5% ab 500 kg/Woche, -10% ab 1.000 kg/Woche, -15% bei Jahresverträgen.` },

  { t: 'Lieferung und Logistik', q: 'Wie funktioniert die Lieferung?',
    a: `Tägliche Lieferung mit Kühlfahrzeugen (0-4°C für Obst und Gemüse, 8-12°C für tropische Produkte). Lokale und regionale Abdeckung. D+1-Lieferung (heute bestellt, morgen geliefert). Zeitfenster: 5:00-7:00 (Märkte/Großhändler), 7:00-12:00 (Gastronomie/Einzelhandel), individuell anpassbar. Kühlkette überwacht mit Datenloggern. Verpackung: Mehrwegkisten (IFCO/Euro Pool) oder Einweg-Kartons. Dokumente: Lieferschein mit Charge und Rückverfolgbarkeit.` },

  { t: 'Qualität und Zertifizierungen', q: 'Welche Zertifizierungen haben Sie?',
    a: `Aktive Zertifizierungen: GLOBALG.A.P. (gute Agrarpraxis), BRC (Lebensmittelsicherheit), IFS Food (internationaler Standard), EU-Bio (Verordnung 2018/848), HACCP (Eigenkontrolle Hygiene). Vollständige Rückverfolgbarkeit gemäß EG-Verordnung 178/2002: vom Feld zum Kunden in max. 4 Stunden. Wareneingangskontrolle: Brix (Süße), Kaliber, Reifegrad, Mängel. Laboranalyse von Pestizidrückständen. Produktrückrufmanagement nach zertifizierten Verfahren.` },

  { t: 'Zahlungsbedingungen', q: 'Welche Zahlungsbedingungen bieten Sie?',
    a: `Neukunden: Vorauskasse oder Zahlung bei Lieferung für die ersten 3 Bestellungen. Akkreditierte Kunden (mit Handelsreferenzen): 30 Tage Monatsende, 60 Tage Monatsende oder SEPA-Lastschrift. Banküberweisung, SEPA-Lastschrift akzeptiert. Keine Schecks. Jahresverträge: Vorzugskonditionen nach Vereinbarung. Zahlungsverzug: Lieferaussetzung 15 Tage nach Fälligkeitsdatum. Elektronische Rechnungsstellung obligatorisch.` },

  { t: 'Saisonales Obst', q: 'Welches Obst haben Sie in der Saison?',
    a: `Die Verfügbarkeit variiert saisonbedingt. Frühling: Erdbeeren, Kirschen, Aprikosen. Sommer: Pfirsiche, Melonen, Wassermelonen, Pflaumen, Feigen, Trauben. Herbst: Äpfel, Birnen, Kakis, Granatäpfel, Kastanien. Winter: Zitrusfrüchte (Orangen, Mandarinen, Zitronen, Grapefruits), Kiwi, Äpfel, Birnen. Ganzjährig: Bananen, Äpfel, Zitronen, Ananas. Exotische Früchte ganzjährig über Direktimport verfügbar. Preisliste wird wöchentlich marktbasiert aktualisiert.` },
];

async function loadOrtofrutticoli() {
  console.log('═══ Loading Ortofrutticoli B2B KB ═══');

  // Check and clear existing
  const existing = await pool.query('SELECT COUNT(*) FROM wa_rag_documents WHERE sector = $1', [SECTOR]);
  const count = parseInt(existing.rows[0].count);
  if (count > 0) {
    await pool.query('DELETE FROM wa_rag_documents WHERE sector = $1', [SECTOR]);
    console.log(`  Cleared ${count} existing docs`);
  }

  let ok = 0, fail = 0;
  for (const item of KB) {
    try {
      const content = `D: ${item.q}\nR: ${item.a}`;
      const { vector } = await embedChain(content);
      await pool.query(
        'INSERT INTO wa_rag_documents (sector, title, content, embedding) VALUES ($1, $2, $3, $4)',
        [SECTOR, item.t, content, JSON.stringify(vector)]
      );
      ok++;
      console.log(`  ✅ ${item.t} (${content.length} chars)`);
    } catch (e) {
      fail++;
      console.error(`  ❌ ${item.t}: ${e.message}`);
    }
  }

  console.log(`\n═══ DONE: ${ok} loaded, ${fail} failed (total ${KB.length}) ═══`);

  // Show final state
  const final = await pool.query('SELECT sector, COUNT(*) as cnt FROM wa_rag_documents WHERE sector = $1 GROUP BY sector', [SECTOR]);
  if (final.rows.length > 0) {
    console.log(`  ${SECTOR}: ${final.rows[0].cnt} documents in RAG`);
  }

  await pool.end();
}

loadOrtofrutticoli().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});

const http = require('http');
const https = require('https');
const fs = require('fs');
require('dotenv').config();

const GROQ_KEY = process.env.GROQ_API_KEY;
const CEREBRAS_KEY = process.env.CEREBRAS_API_KEY || '';
const SAMBANOVA_KEY = process.env.SAMBANOVA_API_KEY || '';
const SESSION = 'sara';
const PORT = 3008;

// COMPACT system prompt (~3K chars instead of 15K = 5x less tokens = no rate limit)
const SYSTEM = `Sei SARA, assistente AI di S.C.A.L.A. AI OS (get-scala.com) — il Sistema Operativo AI per le imprese.

PREZZI (CITA SEMPRE il numero esatto):
• GROWTH €97/mese (€970/anno) — tutti i moduli, 5 verticali, 6 utenti, trial 14gg gratis
• SCALE €197/mese (€1970/anno) — TUTTI i 19 verticali, utenti illimitati, SARA WhatsApp 24/7
• SOLO SARA €9,90/mese — solo assistente WhatsApp per freelance, senza piattaforma
• Enterprise custom (da €2.000/mese)

REGOLE FERREE:
- SARA WhatsApp è SOLO in Scale. MAI prometterla su Growth.
- Trial: 14 giorni SOLO su Growth. Nessun trial su Scale.
- Se qualcuno dice "Growth costa €49": CORREGGI → costa €97/mese.
- MAI dire €149/€298/€49. I prezzi sopra sono gli UNICI corretti.
- 19 verticali: DineOS (ristoranti/pizzerie/bar), TravelOS (hotel/B&B/turismo), PropertyOS (immobiliare), BeautyOS (parrucchieri/estetiste), PraxisOS (dentisti/studi medici/legali), MotorOS (concessionarie/officine), WellnessOS (palestre/yoga), CleanOS (pulizie), ShopOS (negozi/ecommerce), AgencyOS (agenzie marketing), StudioOS (studi creativi), NetworkOS (reti vendita), DermalyOS (medicina estetica), FranchiseOS, ProjectOS, ReputationOS, LandIQ, AdOS, ServiceOS.
- SAP: SCALA è complementare, MAI sostituto.

COME RISPONDERE:
- Come un consulente umano esperto: caldo, empatico, professionale. MAI robotico.
- Max 3-4 frasi, brevi e incisive. 1-2 emoji max.
- Fai domande di scoperta: "qual è la sfida principale?", "quanti clienti gestisci al mese?", "come gestisci le prenotazioni oggi?"
- Rispondi nella LINGUA del messaggio (IT→IT, EN→EN, ES→ES, DE→DE).
- Se non sai: "ottima domanda, ti metto in contatto col team per una risposta precisa — contact@get-scala.com"
- NON prendere prenotazioni reali (tavoli, hotel). Se chiedono di prenotare: "il nostro modulo [DineOS/TravelOS] automatizza proprio questo per il tuo locale!"
- NON inventare feature che non esistono.`;

const processed = new Set();
const conversations = new Map();

function callLLM(host, path, key, model, messages) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ model, messages, max_tokens:350, temperature:0.6 });
        const req = https.request({method:'POST', hostname:host, path,
            headers:{'Authorization':'Bearer '+key,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)},
            timeout:25000}, res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>{
            try{const t=JSON.parse(d).choices[0].message.content.trim(); if(t) resolve(t); else reject('empty');}
            catch(e){reject(d.substring(0,100))}});});
        req.on('error',reject); req.write(body); req.end();
    });
}

async function askAI(messages) {
    // Chain: Groq (fast) → Cerebras → SambaNova → graceful fallback
    const providers = [
        { host:'api.groq.com', path:'/openai/v1/chat/completions', key:GROQ_KEY, model:'llama-3.3-70b-versatile', name:'Groq' },
    ];
    if (CEREBRAS_KEY) providers.push({ host:'api.cerebras.ai', path:'/v1/chat/completions', key:CEREBRAS_KEY, model:'llama-3.3-70b', name:'Cerebras' });
    if (SAMBANOVA_KEY) providers.push({ host:'api.sambanova.ai', path:'/v1/chat/completions', key:SAMBANOVA_KEY, model:'Meta-Llama-3.3-70B-Instruct', name:'SambaNova' });
    
    for (const p of providers) {
        try {
            const r = await callLLM(p.host, p.path, p.key, p.model, messages);
            console.log(`[AI] ${p.name} OK`);
            return r;
        } catch(e) { console.log(`[AI] ${p.name} failed: ${String(e).substring(0,60)}`); }
    }
    return 'Ti rispondo a brevissimo, scrivimi pure la tua domanda!';
}

function guardPrices(t) {
    return t.replace(/€\s*49\b/g,'€97').replace(/€\s*149\b/g,'€97').replace(/€\s*298\b/g,'€197');
}

function wahaPost(path, body) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const req = http.request({ method:'POST', hostname:'127.0.0.1', port:3004,
            path, headers:{'X-Api-Key': process.env.WAHA_API_KEY || 'CHANGE_ME','Content-Type':'application/json','Content-Length':Buffer.byteLength(data)},
            timeout:15000 }, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{try{resolve(JSON.parse(d))}catch{resolve(d)}}); });
        req.on('error',reject); req.write(data); req.end();
    });
}

async function handleMessage(chatId, text, pushName, msgId) {
    if (!text || text.length < 1) return;
    if (chatId.includes('@g.us') || chatId.includes('@broadcast') || chatId.includes('@newsletter')) return;
    const key = `${msgId}:${chatId}`;
    if (processed.has(key)) return;
    processed.add(key);
    if (processed.size > 500) { const f = processed.values().next().value; processed.delete(f); }
    
    console.log(`[MSG] ${pushName||chatId}: ${text.substring(0,60)}`);
    if (!conversations.has(chatId)) conversations.set(chatId, []);
    const h = conversations.get(chatId);
    h.push({ role:'user', content:text });
    while (h.length > 10) h.shift();
    
    const response = await askAI([{ role:'system', content:SYSTEM }, ...h]);
    const safe = guardPrices(response);
    h.push({ role:'assistant', content:safe });
    
    const delay = 1500 + Math.random() * 2000;
    await new Promise(r => setTimeout(r, delay));
    console.log(`[REPLY] (${Math.round(delay)}ms) → ${safe.substring(0,80)}`);
    await wahaPost('/api/sendText', { session:SESSION, chatId, text:safe });
}

const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/webhook') {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', async () => {
            res.writeHead(200); res.end('ok');
            try {
                const evt = JSON.parse(body);
                if (evt.event === 'message' && evt.payload && evt.payload.body && !evt.payload.fromMe) {
                    await handleMessage(evt.payload.from, evt.payload.body, evt.payload.pushName||'', evt.payload.id||'');
                }
            } catch(e) { console.error('[WEBHOOK]', e.message); }
        });
    } else { res.writeHead(200); res.end('ok'); }
});
server.listen(PORT, '0.0.0.0', () => console.log(`[BRIDGE] SARA :${PORT} | prompt ${SYSTEM.length}c | chain: Groq${CEREBRAS_KEY?'→Cerebras':''}${SAMBANOVA_KEY?'→SambaNova':''}`));

// === RATE LIMIT MONITOR + TELEGRAM ALERT ===
let msgCount1min = 0;
let alertSent = false;
setInterval(() => {
    if (msgCount1min > 50 && !alertSent) {
        // Alert via Telegram
        const https = require('https');
        const text = `⚠️ SARA RATE LIMIT ALERT\n\n${msgCount1min} msg/min — vicini al limite free tier!\n\nGroq free: ~30 req/min\nChain totale: ~80 req/min\n\n👉 Attiva Groq paid ($5/mese) per 10x capacità:\nhttps://console.groq.com/settings/billing`;
        const tgBody = JSON.stringify({chat_id: '${TG_CHAT}', text, parse_mode: 'HTML'});
        // Read Telegram token from env
        try {
            const tgToken = require('fs').readFileSync('process.env.TELEGRAM_CREDENTIALS_PATH || './.credentials/telegram.env'','utf8').match(/BOT_TOKEN=(.+)/)?.[1]?.trim();
            if (tgToken) {
                const req = https.request({method:'POST',hostname:'api.telegram.org',path:`/bot${tgToken}/sendMessage`,
                    headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(tgBody)}}, ()=>{});
                req.write(tgBody); req.end();
            }
        } catch(e) {}
        alertSent = true;
        console.log(`[ALERT] ${msgCount1min} msg/min — rate limit warning sent`);
    }
    msgCount1min = 0;
    if (msgCount1min === 0) alertSent = false;
}, 60000);

// Incrementa il contatore in handleMessage (hook)
const _origHandle = handleMessage;
handleMessage = async function(...args) {
    msgCount1min++;
    return _origHandle(...args);
};

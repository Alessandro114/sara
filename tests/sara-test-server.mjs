// Throwaway test server for the SARA hallucination Playwright test.
// Loads the REAL getAIResponse + guardPlanPrices from dist, serves a minimal
// chat page + /chat endpoint on port 3099. Does NOT touch the live WA process.
import http from 'http';
import fs from 'fs';
process.chdir('/home/ale/whatsapp-bot');
for (const line of fs.readFileSync('./.env', 'utf8').split('\n')) {
  if (!line || line.startsWith('#') || !line.includes('=')) continue;
  const i = line.indexOf('='); const k = line.slice(0, i).trim();
  if (!(k in process.env)) process.env[k] = line.slice(i + 1).trim();
}
const { getAIResponse } = await import('/home/ale/whatsapp-bot/dist/ai.js');
const { guardPlanPrices } = await import('/home/ale/whatsapp-bot/dist/humanize.js');

const HTML = `<!doctype html><html><head><meta charset="utf-8"><title>SARA selftest</title></head>
<body style="font-family:sans-serif;max-width:560px;margin:40px auto">
<div id="log" style="border:1px solid #ccc;padding:12px;min-height:120px;white-space:pre-wrap"></div>
<input id="msg" style="width:75%;padding:8px"><button id="send" style="padding:8px 14px">Invia</button>
<script>
const log=document.getElementById('log');
function add(cls,t){const d=document.createElement('div');d.className=cls;d.textContent=t;log.appendChild(d);}
async function send(){
  const m=document.getElementById('msg').value; add('usr','👤 '+m);
  const r=await fetch('/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:m,sector:'general'})});
  const j=await r.json(); add('sara-reply','🤖 '+j.response);
}
document.getElementById('send').onclick=send;
</script></body></html>`;

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(HTML); }
  if (req.method === 'POST' && req.url === '/chat') {
    let body = ''; req.on('data', c => body += c); req.on('end', async () => {
      try {
        const { message, sector } = JSON.parse(body || '{}');
        const ai = guardPlanPrices(await getAIResponse(message, { sector: sector || 'general', messages_count: 0 }));
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ response: ai }));
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }
  res.writeHead(404); res.end();
});
server.listen(3099, '127.0.0.1', () => console.log('TEST-WIDGET-READY'));

#!/usr/bin/env node
import 'dotenv/config';
import { readFileSync } from 'fs';
import { storeInRAG } from '../ai.js';
import { initDB } from '../db.js';

async function main() {
    await initDB();
    const file = readFileSync(process.env.HP_KB_PATH || './data/sara-kb-immobiliare.md', 'utf-8');
    const sections = file.split(/^## /m).filter(s => s.trim());

    let stored = 0;
    for (const section of sections) {
        const subsections = section.split(/^### /m);

        if (subsections.length > 1) {
            for (let i = 1; i < subsections.length; i++) {
                const subLines = subsections[i].trim().split('\n');
                const subTitle = subLines[0].trim();
                const content = subsections[i].trim();
                try {
                    await storeInRAG(content, 'immobiliare', 'hp-kb|' + subTitle);
                    stored++;
                    console.log(`[${stored}] Stored: ${subTitle} (${content.length} chars)`);
                } catch (e: any) {
                    console.error('Error:', subTitle, e.message?.substring(0, 80));
                }
            }
        } else {
            const lines = section.trim().split('\n');
            const title = lines[0].replace(/^§\s*\d+\s*—\s*/, '').trim();
            try {
                await storeInRAG(section.trim(), 'immobiliare', 'hp-kb|' + title);
                stored++;
                console.log(`[${stored}] Stored: ${title} (${section.trim().length} chars)`);
            } catch (e: any) {
                console.error('Error:', title, e.message?.substring(0, 80));
            }
        }
    }
    console.log(`\nTotal stored: ${stored}`);
    process.exit(0);
}
main().catch(e => { console.error('Fatal:', e); process.exit(1); });

// tavily.ts — Web search via Tavily API (Enterprise-only feature)
// Docs: https://docs.tavily.com/docs/rest-api/api-reference
// Free tier: 1000 queries/month

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || '';
const TAVILY_URL = 'https://api.tavily.com/search';

export interface TavilyResult {
    title: string;
    url: string;
    content: string;
    score: number;
}

export interface TavilyResponse {
    query: string;
    results: TavilyResult[];
    answer?: string;
}

/**
 * Search the web via Tavily. Returns null if:
 * - planTier is not 'enterprise'
 * - TAVILY_API_KEY not configured
 * - request fails
 */
export async function tavilySearch(
    query: string,
    planTier: string | undefined | null,
    maxResults = 3,
): Promise<TavilyResponse | null> {
    if (planTier?.toLowerCase() !== 'enterprise') {
        return null;
    }
    if (!TAVILY_API_KEY) {
        console.warn('[TAVILY] TAVILY_API_KEY not configured — skipping web search');
        return null;
    }

    try {
        const res = await fetch(TAVILY_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${TAVILY_API_KEY}`,
            },
            body: JSON.stringify({
                query,
                max_results: maxResults,
                search_depth: 'basic',
                include_answer: true,
                include_raw_content: false,
            }),
            signal: AbortSignal.timeout(8000),
        });

        if (!res.ok) {
            console.error(`[TAVILY] HTTP ${res.status} for query "${query.substring(0, 60)}"`);
            return null;
        }

        const data = await res.json() as any;
        const results: TavilyResult[] = (data.results || []).map((r: any) => ({
            title: r.title || '',
            url: r.url || '',
            content: (r.content || '').substring(0, 400),
            score: r.score || 0,
        }));

        console.log(`[TAVILY] query="${query.substring(0, 60)}" → ${results.length} results`);
        return { query, results, answer: data.answer };
    } catch (err: any) {
        console.error('[TAVILY] search error:', err.message);
        return null;
    }
}

/**
 * Format Tavily results as a string to inject into the LLM context.
 */
export function formatTavilyContext(resp: TavilyResponse): string {
    const lines: string[] = ['[WEB SEARCH RESULTS — use only if relevant]'];
    if (resp.answer) {
        lines.push(`Sintesi: ${resp.answer}`);
    }
    for (const r of resp.results) {
        lines.push(`• ${r.title}: ${r.content}`);
    }
    return lines.join('\n');
}

/**
 * Detect if a question likely benefits from a web search.
 * Avoids wasting Tavily quota on conversational/FAQ messages.
 */
export function shouldWebSearch(question: string): boolean {
    const triggers = [
        /notizie|novit[àa]|recente|ultimo|oggi|aggiornament/i,
        /news|latest|recent|current|update|today/i,
        /prezzo.*attuale|quotazione|mercato.*oggi/i,
        /normativa|legge|decreto|regolamento|gdpr|compliance/i,
        /concorrente|competitor|confronta|versus|vs\b/i,
        /trend|statistica|report|ricerca di mercato/i,
    ];
    return triggers.some(r => r.test(question));
}

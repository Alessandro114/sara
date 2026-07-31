// ═══════════════════════════════════════════════════════════
// bm25-search.ts — BM25 text scoring for hybrid retrieval
// ═══════════════════════════════════════════════════════════
// Implements BM25 (Okapi BM25) scoring algorithm for text ranking.
// Used alongside vector search for hybrid retrieval:
//   final_score = α × vector_score + (1-α) × bm25_score
// BM25 excels at exact keyword matching (names, codes, prices)
// while vectors capture semantic similarity.

import { pool } from '../config.js';

const BM25_K1 = 1.2;   // term frequency saturation
const BM25_B = 0.75;    // document length normalization
const HYBRID_ALPHA = 0.6; // weight for vector score (0.6 vector + 0.4 BM25)

const STOPWORDS = new Set([
    'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'uno', 'una', 'di', 'del', 'dello',
    'della', 'dei', 'degli', 'delle', 'a', 'al', 'allo', 'alla', 'ai', 'agli',
    'alle', 'da', 'dal', 'dallo', 'dalla', 'dai', 'dagli', 'dalle', 'in', 'nel',
    'nello', 'nella', 'nei', 'negli', 'nelle', 'con', 'su', 'sul', 'sullo', 'sulla',
    'sui', 'sugli', 'sulle', 'per', 'tra', 'fra', 'e', 'o', 'ma', 'se', 'che',
    'non', 'più', 'anche', 'come', 'dove', 'quando', 'cosa', 'chi', 'quanto',
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'about',
    'el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'en', 'con', 'por',
    'para', 'que', 'es', 'son', 'como', 'donde', 'cuando',
    'o', 'os', 'as', 'um', 'uma', 'do', 'da', 'dos', 'das', 'em', 'com',
    'por', 'para', 'que', 'como', 'onde', 'quando',
]);

function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .replace(/[^\w\sàèéìòùáéíóúãõçñü]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

// Compute term frequency (TF) for a document
function computeTF(tokens: string[]): Map<string, number> {
    const tf = new Map<string, number>();
    for (const t of tokens) {
        tf.set(t, (tf.get(t) || 0) + 1);
    }
    return tf;
}

// BM25 score for a single document against a query
function bm25Score(
    queryTokens: string[],
    docTokens: string[],
    docTF: Map<string, number>,
    avgDocLen: number,
    totalDocs: number,
    docFrequencies: Map<string, number>
): number {
    const docLen = docTokens.length;
    let score = 0;

    for (const term of queryTokens) {
        const tf = docTF.get(term) || 0;
        if (tf === 0) continue;

        const df = docFrequencies.get(term) || 0;
        // IDF with smoothing
        const idf = Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1);

        // BM25 TF normalization
        const tfNorm = (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * (docLen / avgDocLen)));

        score += idf * tfNorm;
    }

    return score;
}

export interface HybridMatch {
    id: string;
    title: string;
    content: string;
    vectorScore: number;
    bm25Score: number;
    hybridScore: number;
}

// Hybrid search: combine BM25 + vector similarity
export async function hybridSearch(
    question: string,
    sector: string,
    embedding: number[] | null,
    limit = 3
): Promise<HybridMatch[]> {
    const queryTokens = tokenize(question);
    if (queryTokens.length === 0 && !embedding) return [];

    try {
        // Fetch candidate docs for this sector
        const docsResult = await pool.query(
            `SELECT id, title, content${embedding ? ', 1-(embedding<=>$2::vector) as vec_sim' : ', 0 as vec_sim'}
             FROM wa_rag_documents
             WHERE (sector = $1 OR sector = 'general')
             ${embedding ? 'ORDER BY embedding<=>$2::vector LIMIT 20' : 'LIMIT 50'}`,
            embedding ? [sector, `[${embedding.join(',')}]`] : [sector]
        );

        if (docsResult.rows.length === 0) return [];

        // Pre-compute document frequencies for IDF
        const allDocTokens: Array<{ id: string; title: string; content: string; tokens: string[]; tf: Map<string, number>; vecSim: number }> = [];
        const docFrequencies = new Map<string, number>();
        let totalTokens = 0;

        for (const doc of docsResult.rows) {
            const combined = `${doc.title} ${doc.title} ${doc.title} ${doc.content}`; // title weighted 3x
            const tokens = tokenize(combined);
            const tf = computeTF(tokens);
            totalTokens += tokens.length;

            // Count document frequency
            const seenTerms = new Set(tokens);
            for (const term of Array.from(seenTerms)) {
                docFrequencies.set(term, (docFrequencies.get(term) || 0) + 1);
            }

            allDocTokens.push({
                id: doc.id,
                title: doc.title,
                content: doc.content,
                tokens,
                tf,
                vecSim: Number(doc.vec_sim) || 0,
            });
        }

        const avgDocLen = totalTokens / allDocTokens.length;
        const totalDocs = allDocTokens.length;

        // Score each document
        const scored: HybridMatch[] = allDocTokens.map(doc => {
            const bm25 = queryTokens.length > 0
                ? bm25Score(queryTokens, doc.tokens, doc.tf, avgDocLen, totalDocs, docFrequencies)
                : 0;

            // Normalize BM25 to 0-1 range (approximate)
            const maxBm25 = queryTokens.length * 5; // rough upper bound
            const bm25Normalized = Math.min(1, bm25 / Math.max(maxBm25, 1));

            const hybrid = embedding
                ? HYBRID_ALPHA * doc.vecSim + (1 - HYBRID_ALPHA) * bm25Normalized
                : bm25Normalized;

            return {
                id: doc.id,
                title: doc.title,
                content: doc.content,
                vectorScore: doc.vecSim,
                bm25Score: bm25Normalized,
                hybridScore: hybrid,
            };
        });

        scored.sort((a, b) => b.hybridScore - a.hybridScore);

        const topResults = scored.slice(0, limit);

        if (topResults.length > 0) {
            console.log(`[BM25-HYBRID] sector=${sector}, query="${question.substring(0, 40)}..." → top: "${topResults[0].title}" (hybrid=${topResults[0].hybridScore.toFixed(3)}, vec=${topResults[0].vectorScore.toFixed(3)}, bm25=${topResults[0].bm25Score.toFixed(3)})`);
        }

        return topResults;
    } catch (err: any) {
        console.error('[BM25-HYBRID] Search error:', err.message);
        return [];
    }
}

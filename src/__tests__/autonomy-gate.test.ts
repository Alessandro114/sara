// autonomy-gate.ts risk decisions (issue #3). Run: npx tsx src/__tests__/autonomy-gate.test.ts
import assert from 'node:assert/strict';
import { shouldQueueAgenticAction } from '../lib/autonomy-gate.js';

const risks = ['low', 'medium', 'high', 'critical'] as const;
const expected: Record<number, boolean[]> = {
    0: [false, false, false, false], // OFF: never queue
    1: [true, true, true, true],     // OBSERVE: always queue
    2: [false, true, true, true],    // SEMI-AUTO: only low runs
    3: [false, false, true, true],   // FULL-AUTO: high/critical queue
};
for (const [level, row] of Object.entries(expected)) {
    risks.forEach((r, i) => assert.equal(shouldQueueAgenticAction(Number(level) as 0 | 1 | 2 | 3, r), row[i], `level ${level} risk ${r}`));
}
assert.equal(shouldQueueAgenticAction(9 as any, 'low'), true, 'unknown level queues');
console.log('autonomy-gate tests passed');

// tsc compiles TypeScript and ignores everything else, so the prompt JSON
// files would never reach dist/ and the built bot would start with an empty
// prompt directory. This copies them after compilation.
import { cpSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const from = join(root, 'src', 'prompts');
const to = join(root, 'dist', 'prompts');

if (!existsSync(from)) {
    console.error(`[copy-prompts] missing ${from}`);
    process.exit(1);
}
cpSync(from, to, { recursive: true });
console.log(`[copy-prompts] ${readdirSync(to).length} file(s) -> dist/prompts`);

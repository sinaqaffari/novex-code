import path from 'node:path';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--output' || !path.isAbsolute(args[1])) throw new Error('Provide --output followed by an absolute path to a new file.');
if (!process.env.BUILDER_DATA_FILE?.trim()) throw new Error('Set BUILDER_DATA_FILE to the exact migrated local builder file.');
const { exportPostgresBuilder } = await import('../src/lib/builder/store.ts');
await exportPostgresBuilder(args[1]);
console.log(`A private point-in-time builder backup was written to ${args[1]}. No existing file was overwritten.`);

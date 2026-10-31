import path from 'node:path';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--output' || !path.isAbsolute(args[1])) throw new Error('Provide --output followed by an absolute path to a new file.');
if (!process.env.COMMERCE_DB_FILE?.trim()) throw new Error('Set COMMERCE_DB_FILE to the exact migrated local store file.');
const { exportPostgresCommerce } = await import('../src/lib/commerce/db.ts');
await exportPostgresCommerce(args[1]);
console.log(`A private point-in-time commerce backup was written to ${args[1]}. No existing file was overwritten.`);

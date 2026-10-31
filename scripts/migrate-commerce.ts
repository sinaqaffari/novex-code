// Explicit offline operation. The source is retained byte-for-byte.
if (!process.argv.includes('--confirm-offline')) {
	throw new Error('Stop all app instances and back up their data, then pass --confirm-offline.');
}
if (!process.env.COMMERCE_DB_FILE?.trim()) {
	throw new Error('Set COMMERCE_DB_FILE to the exact local store file before migrating.');
}
const options = process.argv.slice(2);
if (options.some((item) => !['--confirm-offline', '--allow-empty'].includes(item))) throw new Error('Unknown migration option.');
const { migrateCommerceToPostgres, DB_FILE } = await import('../src/lib/commerce/db.ts');
await migrateCommerceToPostgres({ allowEmpty: options.includes('--allow-empty') });
console.log(`Commerce migration completed for ${DB_FILE}. The original file was not modified.`);
console.log('Start the app with the same COMMERCE_DB_FILE and NOVEX_COMMERCE_STORE=postgres. Keep the marker and original file with your backups.');

export {};

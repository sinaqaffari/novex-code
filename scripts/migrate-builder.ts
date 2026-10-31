// Explicit offline operation. The source is retained byte-for-byte.
if (!process.argv.includes('--confirm-offline')) {
	throw new Error('Stop all app instances and back up their data, then pass --confirm-offline.');
}
if (!process.env.BUILDER_DATA_FILE?.trim()) {
	throw new Error('Set BUILDER_DATA_FILE to the exact local builder file before migrating.');
}
const options = process.argv.slice(2);
if (options.some((item) => !['--confirm-offline', '--allow-empty'].includes(item))) throw new Error('Unknown migration option.');
const { migrateBuilderToPostgres, builderDatabasePath } = await import('../src/lib/builder/store.ts');
await migrateBuilderToPostgres({ allowEmpty: options.includes('--allow-empty') });
console.log(`Builder migration completed for ${builderDatabasePath()}. The original file was not modified.`);
console.log('Start the app with the same BUILDER_DATA_FILE and NOVEX_BUILDER_STORE=postgres. Keep the marker and original file with your backups.');

export {};

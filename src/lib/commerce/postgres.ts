import { commerceSnapshotClient } from '../backend/commerce.ts';
import { assertFileStoreNotMigrated, exportSnapshotFile, migrateSnapshotFile, readSnapshotStore, writeSnapshotStore, type StoreMarker } from '../backend/snapshot-store.ts';

export { assertFileStoreNotMigrated };
export const readPostgresCommerce = (file: string) => readSnapshotStore(file, commerceSnapshotClient);
export const writePostgresCommerce = (marker: StoreMarker, revision: number, raw: unknown) => writeSnapshotStore(marker, revision, raw, commerceSnapshotClient);
export const migrateCommerceFile = (file: string, empty: unknown, validate: (raw: unknown) => void, allowEmpty: boolean) => migrateSnapshotFile(file, empty, validate, allowEmpty, commerceSnapshotClient);
export const exportCommerceFile = (file: string, destination: string, validate: (raw: unknown) => void) => exportSnapshotFile(file, destination, validate, commerceSnapshotClient);

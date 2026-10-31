import { createSnapshotClient, type RemoteSnapshot } from './versioned-client.ts';

export type RemoteCommerceSnapshot = RemoteSnapshot;
export const commerceSnapshotClient = createSnapshotClient('/v1/commerce');
export const getCommerceSnapshot = commerceSnapshotClient.get;
export const bootstrapCommerce = commerceSnapshotClient.bootstrap;
export const updateCommerceSnapshot = commerceSnapshotClient.update;

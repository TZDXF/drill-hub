import { randomUUID } from 'node:crypto';
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export const baseRecord = () => {
  const timestamp = now();
  return { id: id(), createdAt: timestamp, updatedAt: timestamp, revision: 1 };
};

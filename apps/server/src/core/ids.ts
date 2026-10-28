import { randomBytes } from 'node:crypto';
export const id = () => randomBytes(12).toString('base64url');
export const now = () => new Date().toISOString();
export const baseRecord = () => {
  const timestamp = now();
  return { id: id(), createdAt: timestamp, updatedAt: timestamp, revision: 1 };
};

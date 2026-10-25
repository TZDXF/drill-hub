import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = dirname(fileURLToPath(import.meta.resolve('#server-root/package.json')));
export const workspaceRoot = dirname(dirname(serverRoot));

export function workspacePath(...segments: string[]): string {
  return resolve(workspaceRoot, ...segments);
}

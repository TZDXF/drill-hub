import { lookup } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import { Agent } from 'undici';
import type { LookupFunction } from 'node:net';

const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
] as const)
  blocked.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['::', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const)
  blocked.addSubnet(address, prefix, 'ipv6');

export function isPublicProviderAddress(address: string): boolean {
  const family = isIP(address);
  if (!family) return false;
  // Only globally routable IPv6 unicast; reject mapped/transition and special ranges.
  if (family === 6 && !/^[23][0-9a-f]{3}:/i.test(address)) return false;
  return !blocked.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

export class ProviderNetworkError extends Error {
  constructor() {
    super('Provider address is forbidden');
  }
}

export function assertProviderHost(url: URL, allowPrivate: boolean): void {
  if (allowPrivate) return;
  const host = url.hostname
    .replace(/^\[|\]$/g, '')
    .toLowerCase()
    .replace(/\.$/, '');
  if (
    host === 'localhost' ||
    /\.(localhost|internal|local)$/.test(host) ||
    ['metadata', 'metadata.google.internal', 'instance-data', 'metadata.azure.internal'].includes(
      host,
    ) ||
    (isIP(host) && !isPublicProviderAddress(host))
  )
    throw new ProviderNetworkError();
}

/** The vetted DNS results are passed directly to connect: no second, rebindable lookup. */
export const publicProviderLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(error, '', 4);
    if (!addresses.length || addresses.some(({ address }) => !isPublicProviderAddress(address))) {
      return callback(new ProviderNetworkError(), '', 4);
    }
    const family = typeof options === 'object' ? options.family : options;
    const candidates =
      family === 4 || family === 6 ? addresses.filter((a) => a.family === family) : addresses;
    if (!candidates.length) return callback(new ProviderNetworkError(), '', 4);
    if (typeof options === 'object' && options.all) callback(null, candidates);
    else callback(null, candidates[0]!.address, candidates[0]!.family);
  });
};

// Shared connection pools are process-wide, just like the default fetch dispatcher.
export const publicProviderDispatcher = new Agent({ connect: { lookup: publicProviderLookup } });

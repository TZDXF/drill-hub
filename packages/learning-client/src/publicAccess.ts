let memoryToken = '';

/**
 * Read the temporary answer-link secret from the URL fragment. Keeping it in memory
 * also covers client-side route changes; hard refreshes retain the fragment in the URL.
 */
export function captureAnswerLinkToken(hash: string): string {
  const value = hash.replace(/^#/, '');
  const token = value.includes('#') ? value.slice(value.lastIndexOf('#') + 1) : value;
  if (/^[A-Za-z0-9_-]{32,200}$/.test(token)) memoryToken = token;
  return memoryToken;
}

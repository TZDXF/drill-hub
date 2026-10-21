import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('同站不同端口页面不能读取会话或 CSRF，也不能创建 Agent 令牌', async ({ page, context }) => {
  await login(page);
  const base = new URL(page.url()).origin;
  const csrfResponse = await page.request.get(base + '/api/v1/auth/csrf');
  expect(csrfResponse.ok()).toBe(true);
  const csrf = (await csrfResponse.json()).data.csrfToken as string;
  const beforeResponse = await page.request.get(base + '/api/v1/me/agent-tokens');
  expect(beforeResponse.ok()).toBe(true);
  const before = (await beforeResponse.json()).data;
  const attacker = new URL(base);
  attacker.port = '4180';
  await context.route(attacker.origin + '/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>isolated origin probe</title>',
    }),
  );
  const probe = await context.newPage();
  try {
    await probe.goto(attacker.origin);
    const results = await probe.evaluate(
      async ({ base, csrf }) => {
        const readable: boolean[] = [];
        for (const path of ['/api/v1/me', '/api/v1/auth/csrf']) {
          try {
            await (await fetch(base + path, { credentials: 'include' })).json();
            readable.push(true);
          } catch {
            readable.push(false);
          }
        }
        try {
          await fetch(base + '/api/v1/me/agent-tokens', {
            method: 'POST',
            credentials: 'include',
            headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
            body: JSON.stringify({ name: 'forbidden-browser-probe', scopes: ['read'] }),
          });
          readable.push(true);
        } catch {
          readable.push(false);
        }
        return readable;
      },
      { base, csrf },
    );
    expect(results).toEqual([false, false, false]);
    const after = await page.request.get(base + '/api/v1/me/agent-tokens');
    expect((await after.json()).data).toEqual(before);
    expect((await page.request.get(base + '/api/v1/me')).ok()).toBe(true);
  } finally {
    await probe.close();
  }
});

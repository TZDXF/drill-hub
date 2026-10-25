import { expect, test } from '@playwright/test';
import { login } from '#e2e/helpers';

test('任意来源可跨域读取会话并写入，但仍要求登录和 CSRF', async ({ page, context }) => {
  await login(page);
  const base = new URL(page.url()).origin;
  const otherOrigin = new URL(base);
  otherOrigin.port = '4180';
  // 明确授权测试来源访问回环网络，避免浏览器网络权限遮蔽服务端 CORS 行为。
  await context.grantPermissions(['local-network-access'], { origin: otherOrigin.origin });
  await context.route(otherOrigin.origin + '/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>cross-origin policy probe</title>',
    }),
  );
  const probe = await context.newPage();
  try {
    await probe.goto(otherOrigin.origin);
    const results = await probe.evaluate(async (base) => {
      const me = await fetch(base + '/api/v1/me', { credentials: 'include' });
      const user = (await me.json()).data;
      const csrfResponse = await fetch(base + '/api/v1/auth/csrf', { credentials: 'include' });
      const csrf = (await csrfResponse.json()).data.csrfToken;
      const payload = JSON.stringify({
        expectedRevision: user.revision,
        displayName: user.displayName,
      });
      const missingCsrf = await fetch(base + '/api/v1/me', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: payload,
      });
      const validCsrf = await fetch(base + '/api/v1/me', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
        body: payload,
      });
      const anonymous = await fetch(base + '/api/v1/me', { credentials: 'omit' });
      return {
        me: me.status,
        csrf: csrfResponse.status,
        missingCsrf: missingCsrf.status,
        validCsrf: validCsrf.status,
        anonymous: anonymous.status,
      };
    }, base);
    expect(results).toEqual({
      me: 200,
      csrf: 200,
      missingCsrf: 403,
      validCsrf: 200,
      anonymous: 401,
    });
    expect((await page.request.get(base + '/api/v1/me')).ok()).toBe(true);
  } finally {
    await probe.close();
  }
});

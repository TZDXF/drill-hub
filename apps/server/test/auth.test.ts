import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '#server/app.js';
import { createUser } from '#server/modules/auth/index.js';
import { SecretVault } from '#server/core/security.js';
const ADMIN = 'test_admin';
const PASSWORD = 'Test-only-password-42!';
let app: FastifyInstance;
async function login(username = ADMIN, password = PASSWORD, channel: 'web' | 'mobile' = 'web') {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/' + channel + '/login',
    payload: { username, password },
  });
  const value = response.json().data;
  const cookie = response.cookies.map((c) => c.name + '=' + c.value).join('; ');
  return { response, value, headers: { cookie, 'x-csrf-token': value?.csrfToken ?? '' } };
}
beforeEach(async () => {
  app = await createApp({
    databasePath: ':memory:',
    encryptionKey: 'a'.repeat(64),
    startWorkers: false,
    bootstrapAdmin: { username: ADMIN, password: PASSWORD },
  });
});
afterEach(async () => {
  await app.close();
});
describe('accounts, sessions and scope boundaries', () => {
  it('publishes a stable server identity without configuration secrets', async () => {
    const first = await app.inject('/api/v1/server-info');
    const second = await app.inject('/api/v1/server-info');
    expect(first.statusCode).toBe(200);
    expect(first.json().data.service).toBe('drill-hub');
    expect(first.json().data.instanceId).toBe(second.json().data.instanceId);
    expect(first.body).not.toContain('encryptedApiKey');
    expect(first.json().meta.serverTime).toBeTruthy();
  });
  it('updates the display name with revision checks and rejects removed preferences', async () => {
    const session = await login();
    const initial = await app.inject({ url: '/api/v1/me', headers: session.headers });
    const user = initial.json().data;
    expect(user).not.toHaveProperty('timezone');
    expect(user).not.toHaveProperty('autoSubmitPracticeAnswers');
    for (const removed of [{ timezone: 'Asia/Shanghai' }, { autoSubmitPracticeAnswers: true }]) {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/me',
        headers: session.headers,
        payload: { expectedRevision: user.revision, ...removed },
      });
      expect(response.statusCode).toBe(422);
    }
    const saved = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: session.headers,
      payload: { expectedRevision: user.revision, displayName: '更新后的名称' },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data.displayName).toBe('更新后的名称');
    const conflict = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: session.headers,
      payload: { expectedRevision: user.revision, displayName: '冲突写入' },
    });
    expect(conflict.statusCode).toBe(409);
    const relogin = await login(ADMIN, PASSWORD, 'mobile');
    expect(relogin.value.user.displayName).toBe('更新后的名称');
  });
  it('requires login and uses generic credential errors', async () => {
    expect((await app.inject('/api/v1/me')).statusCode).toBe(401);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/web/login',
      payload: { username: ADMIN, password: 'wrong' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('INVALID_CREDENTIALS');
  });
  it.each([
    ['http://study.example.org', false],
    ['https://study.example.org', true],
  ] as const)(
    'marks the web cookie Secure only for HTTPS deployments (%s)',
    async (publicUrl, secure) => {
      const deployment = await createApp({
        databasePath: ':memory:',
        encryptionKey: 'a'.repeat(64),
        startWorkers: false,
        production: true,
        publicUrl,
        bootstrapAdmin: { username: ADMIN, password: PASSWORD },
      });
      try {
        const response = await deployment.inject({
          method: 'POST',
          url: '/api/v1/auth/web/login',
          payload: { username: ADMIN, password: PASSWORD },
        });
        expect(response.statusCode).toBe(200);
        const header = response.headers['set-cookie'];
        const value = Array.isArray(header) ? header.join('\n') : (header ?? '');
        expect(/;\s*Secure(?:;|$)/i.test(value)).toBe(secure);
      } finally {
        await deployment.close();
      }
    },
  );

  it('does not expose password hashes and requires CSRF for Cookie writes', async () => {
    const session = await login();
    expect(session.response.statusCode).toBe(200);
    expect(session.value.user.passwordHash).toBeUndefined();
    const rejected = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: { cookie: session.headers.cookie },
      payload: { username: 'new_user', password: PASSWORD },
    });
    expect(rejected.statusCode).toBe(403);
    const csrf = await app.inject({ url: '/api/v1/auth/csrf', headers: session.headers });
    expect(csrf.json().data.csrfToken).toBe(session.value.csrfToken);
  });
  it('requires only four password characters and has no upper length limit', async () => {
    const admin = await login();
    const tooShort = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: admin.headers,
      payload: { username: 'short_password', password: '123' },
    });
    expect(tooShort.statusCode).toBe(422);
    expect(tooShort.json().error.code).toBe('INVALID_PASSWORD');
    const shortPassword = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: admin.headers,
      payload: { username: 'four_char_password', password: '1234' },
    });
    expect(shortPassword.statusCode).toBe(200);
    expect((await login('four_char_password', '1234')).response.statusCode).toBe(200);
    const longPassword = 'x'.repeat(513);
    const longPasswordUser = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: admin.headers,
      payload: { username: 'long_password', password: longPassword },
    });
    expect(longPasswordUser.statusCode).toBe(200);
    expect((await login('long_password', longPassword)).response.statusCode).toBe(200);
  });
  it('allows new accounts to sign in without changing their password', async () => {
    const admin = await login();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: admin.headers,
      payload: { username: 'learner_one', password: PASSWORD },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().data.mustChangePassword).toBe(false);
    const session = await login('learner_one');
    expect((await app.inject({ url: '/api/v1/topics', headers: session.headers })).statusCode).toBe(
      200,
    );
    const changed = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me/password',
      headers: session.headers,
      payload: { currentPassword: PASSWORD, newPassword: 'Changed-only-password-42!' },
    });
    expect(changed.statusCode).toBe(200);
    expect((await app.inject({ url: '/api/v1/me', headers: session.headers })).statusCode).toBe(
      401,
    );
    const updated = await login('learner_one', 'Changed-only-password-42!');
    expect(updated.value.user.mustChangePassword).toBe(false);
  });
  it('does not force a password change after an administrator reset', async () => {
    const admin = await login();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: admin.headers,
      payload: { username: 'reset_without_forced_change', password: PASSWORD },
    });
    const reset = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users/' + created.json().data.id + '/reset-password',
      headers: admin.headers,
      payload: {},
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json().data.user.mustChangePassword).toBe(false);
    const session = await login('reset_without_forced_change', reset.json().data.temporaryPassword);
    expect((await app.inject({ url: '/api/v1/topics', headers: session.headers })).statusCode).toBe(
      200,
    );
  });
  it('does not block accounts carrying a legacy password-change flag', async () => {
    const user = await createUser(app.ctx.db, {
      username: 'legacy_password_flag',
      password: PASSWORD,
      mustChangePassword: true,
    });
    const session = await login(user.username);
    expect((await app.inject({ url: '/api/v1/topics', headers: session.headers })).statusCode).toBe(
      200,
    );
  });
  it('keeps administrators and users on separate management permissions', async () => {
    await createUser(app.ctx.db, {
      username: 'ordinary_user',
      password: PASSWORD,
      mustChangePassword: false,
    });
    const ordinary = await login('ordinary_user');
    expect(
      (await app.inject({ url: '/api/v1/admin/users', headers: ordinary.headers })).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ url: '/api/v1/admin/model-connections', headers: ordinary.headers }))
        .statusCode,
    ).toBe(403);
  });
  it('checks Agent scopes, hides token hashes, and enforces revocation', async () => {
    const admin = await login();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/me/agent-tokens',
      headers: admin.headers,
      payload: { name: 'Read-only test token', scopes: ['read'] },
    });
    expect(response.statusCode).toBe(200);
    const token = response.json().data;
    expect(token.token).toMatch(/^dhk\./);
    expect(token.secretHash).toBeUndefined();
    expect(token.encryptedSecret).toBeUndefined();
    expect(token).not.toHaveProperty('revokedAt');

    const otherUser = await createUser(app.ctx.db, {
      username: 'another_agent_owner',
      password: PASSWORD,
      mustChangePassword: false,
    });
    expect(otherUser.username).toBe('another_agent_owner');
    const other = await login('another_agent_owner');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/me/agent-tokens/' + token.id + '/reveal',
          headers: other.headers,
        })
      ).statusCode,
    ).toBe(404);

    const forbiddenRevoke = await app.inject({
      method: 'POST',
      url: '/api/v1/me/agent-tokens/' + token.id + '/revoke',
      headers: other.headers,
    });
    expect(forbiddenRevoke.statusCode).toBe(404);
    expect(await app.ctx.db.get('agentTokens', token.id)).toBeDefined();

    const revealed = await app.inject({
      method: 'POST',
      url: '/api/v1/me/agent-tokens/' + token.id + '/reveal',
      headers: admin.headers,
    });
    expect(revealed.statusCode).toBe(200);
    expect(revealed.json().data.token).toBe(token.token);
    const listWithSecret = await app.inject({
      url: '/api/v1/me/agent-tokens',
      headers: admin.headers,
    });
    expect(listWithSecret.statusCode).toBe(200);
    expect(listWithSecret.body).not.toContain(token.token);
    expect(listWithSecret.body).not.toContain('encryptedSecret');
    expect(
      (
        await app.inject({
          url: '/api/v1/agent/topics',
          headers: { authorization: 'Bearer ' + token.token },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/agent/topics',
          headers: { authorization: 'Bearer ' + token.token },
          payload: { title: 'forbidden', goalText: '' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/me/agent-tokens/' + token.id + '/revoke',
          headers: admin.headers,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          url: '/api/v1/agent/topics',
          headers: { authorization: 'Bearer ' + token.token },
        })
      ).statusCode,
    ).toBe(401);
    const revealRevoked = await app.inject({
      method: 'POST',
      url: '/api/v1/me/agent-tokens/' + token.id + '/reveal',
      headers: admin.headers,
    });
    expect(revealRevoked.statusCode).toBe(404);
    expect(revealRevoked.json().error.code).toBe('NOT_FOUND');
    expect(await app.ctx.db.get('agentTokens', token.id)).toBeUndefined();
    const repeatedRevoke = await app.inject({
      method: 'POST',
      url: '/api/v1/me/agent-tokens/' + token.id + '/revoke',
      headers: admin.headers,
    });
    expect(repeatedRevoke.statusCode).toBe(404);
    const audit = await app.ctx.db.list('auditLogs', { resourceId: token.id });
    expect(audit.filter((event) => event.action === 'agent_token.revoked')).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain(token.token);
    const list = await app.inject({ url: '/api/v1/me/agent-tokens', headers: admin.headers });
    expect(list.body).not.toContain(token.token);
    expect(list.json().data).toEqual([]);
  });
  it('updates token scopes immediately without replacing the secret and rejects stale revisions', async () => {
    const session = await login();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/me/agent-tokens',
      headers: session.headers,
      payload: { name: 'Editable token', scopes: ['read'], expiresAt: '2030-01-01T00:00:00Z' },
    });
    const token = created.json().data;
    const before = await app.ctx.db.get('agentTokens', token.id);
    const agentHeaders = { authorization: 'Bearer ' + token.token };
    const update = (expectedRevision: number, scopes: string[]) =>
      app.inject({
        method: 'PATCH',
        url: '/api/v1/me/agent-tokens/' + token.id,
        headers: session.headers,
        payload: { expectedRevision, scopes },
      });
    const saved = await update(token.revision, ['read', 'content:write']);
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data).toMatchObject({
      id: token.id,
      name: token.name,
      prefix: token.prefix,
      expiresAt: token.expiresAt,
      scopes: ['read', 'content:write'],
      revision: token.revision + 1,
    });
    for (const field of ['token', 'secretHash', 'encryptedSecret', 'ownerId'])
      expect(saved.json().data).not.toHaveProperty(field);
    const after = await app.ctx.db.get('agentTokens', token.id);
    expect(after?.secretHash === before?.secretHash).toBe(true);
    expect(after?.encryptedSecret === before?.encryptedSecret).toBe(true);
    const stale = await update(token.revision, ['archive:write']);
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('VERSION_CONFLICT');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/agent/topics',
          headers: agentHeaders,
          payload: { title: 'New scope works', goalText: '' },
        })
      ).statusCode,
    ).toBe(201);
    // Agent activity updates lastUsedAt and the record revision, so edit the current version.
    const current = await app.ctx.db.get('agentTokens', token.id);
    expect((await update(current!.revision, ['read'])).statusCode).toBe(200);
    const forbidden = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/topics',
      headers: agentHeaders,
      payload: { title: 'Removed scope no longer works', goalText: '' },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().error.code).toBe('SCOPE_REQUIRED');
    expect(
      (await app.inject({ url: '/api/v1/agent/topics', headers: agentHeaders })).statusCode,
    ).toBe(200);
    const audit = await app.ctx.db.list('auditLogs', { resourceId: token.id });
    const changes = audit.filter((event) => event.action === 'agent_token.scopes_updated');
    expect(changes).toHaveLength(2);
    expect(changes.map((event) => event.summary)).toEqual(
      expect.arrayContaining([
        { previousScopes: ['read'], scopes: ['read', 'content:write'] },
        { previousScopes: ['read', 'content:write'], scopes: ['read'] },
      ]),
    );
    expect(JSON.stringify(audit).includes(token.token)).toBe(false);
    const list = await app.inject({ url: '/api/v1/me/agent-tokens', headers: session.headers });
    expect(list.json().data[0].scopes).toEqual(['read']);
  });
  it('validates edited scopes and only accepts scopes plus a valid expected revision', async () => {
    const session = await login();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/me/agent-tokens',
      headers: session.headers,
      payload: { name: 'Validation token', scopes: ['read'] },
    });
    const token = created.json().data;
    const invalidBodies = [
      ...[undefined, null, [], 'read', ['read', 'read'], ['admin'], [1], ['read', {}]].map(
        (scopes) => ({ scopes, expectedRevision: token.revision }),
      ),
      ...[undefined, null, '1', 0, 1.5].map((expectedRevision) => ({
        scopes: ['read'],
        expectedRevision,
      })),
      ...['name', 'expiresAt', 'ownerId', 'secretHash', 'encryptedSecret', 'token', 'revision'].map(
        (field) => ({ scopes: ['read'], expectedRevision: token.revision, [field]: 'forbidden' }),
      ),
    ];
    for (const payload of invalidBodies) {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/me/agent-tokens/' + token.id,
        headers: session.headers,
        payload,
      });
      expect(response.statusCode).toBe(422);
    }
    expect(await app.ctx.db.get('agentTokens', token.id)).toMatchObject({
      scopes: ['read'],
      revision: token.revision,
    });
    expect(await app.ctx.db.list('auditLogs', { action: 'agent_token.scopes_updated' })).toEqual(
      [],
    );
  });
  it('limits scope editing to the owner user session including administrators and CSRF checks', async () => {
    const admin = await login();
    await createUser(app.ctx.db, { username: 'scope_owner', password: PASSWORD });
    const owner = await login('scope_owner');
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/me/agent-tokens',
      headers: owner.headers,
      payload: { name: 'Owned token', scopes: ['read'] },
    });
    const token = created.json().data;
    const url = '/api/v1/me/agent-tokens/' + token.id;
    const payload = { scopes: ['content:write'], expectedRevision: token.revision };
    for (const [headers, status] of [
      [admin.headers, 404],
      [{ authorization: 'Bearer ' + token.token }, 401],
      [{ cookie: owner.headers.cookie }, 403],
    ] as const) {
      expect((await app.inject({ method: 'PATCH', url, headers, payload })).statusCode).toBe(
        status,
      );
    }
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/v1/me/agent-tokens/missing',
          headers: owner.headers,
          payload,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'PATCH', url, headers: owner.headers, payload })).statusCode,
    ).toBe(200);
    await app.inject({ method: 'POST', url: url + '/revoke', headers: owner.headers });
    expect(
      (await app.inject({ method: 'PATCH', url, headers: owner.headers, payload })).statusCode,
    ).toBe(404);
  });
  it('rolls back edited scopes if the audit cannot be saved', async () => {
    const session = await login();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/me/agent-tokens',
      headers: session.headers,
      payload: { name: 'Atomic scope update', scopes: ['read'] },
    });
    const token = created.json().data;
    const audit = vi
      .spyOn(app.ctx, 'audit')
      .mockRejectedValueOnce(new Error('Synthetic audit failure'));
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/me/agent-tokens/' + token.id,
        headers: session.headers,
        payload: { scopes: ['content:write'], expectedRevision: token.revision },
      });
      expect(response.statusCode).toBe(500);
      expect(await app.ctx.db.get('agentTokens', token.id)).toMatchObject({
        scopes: ['read'],
        revision: token.revision,
      });
    } finally {
      audit.mockRestore();
    }
  });
  it('rolls back token deletion when recording the security audit fails', async () => {
    const admin = await login();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/me/agent-tokens',
      headers: admin.headers,
      payload: { name: 'Audit rollback token', scopes: ['read'] },
    });
    expect(created.statusCode).toBe(200);
    const token = created.json().data;
    const audit = vi.spyOn(app.ctx, 'audit').mockRejectedValueOnce(new Error('Audit failed'));
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/me/agent-tokens/' + token.id + '/revoke',
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(500);
      expect(await app.ctx.db.get('agentTokens', token.id)).toBeDefined();
      expect(
        (await app.ctx.db.list('auditLogs', { resourceId: token.id })).map((event) => event.action),
      ).toEqual(['agent_token.created']);
    } finally {
      audit.mockRestore();
    }
  });
  it.each(['change-password', 'reset-password', 'disable'] as const)(
    'deletes all user Agent tokens on %s without affecting another owner',
    async (operation) => {
      const admin = await login();
      const user = await createUser(app.ctx.db, {
        username: 'credentials_owner',
        password: PASSWORD,
        mustChangePassword: false,
      });
      const learner = await login(user.username);
      const issued = [];
      for (const headers of [learner.headers, learner.headers, admin.headers]) {
        const response = await app.inject({
          method: 'POST',
          url: '/api/v1/me/agent-tokens',
          headers,
          payload: { name: 'Credential lifecycle token', scopes: ['read'] },
        });
        expect(response.statusCode).toBe(200);
        issued.push(response.json().data);
      }
      const response = await app.inject(
        operation === 'change-password'
          ? {
              method: 'PATCH',
              url: '/api/v1/me/password',
              headers: learner.headers,
              payload: { currentPassword: PASSWORD, newPassword: 'Changed-test-password-42!' },
            }
          : operation === 'reset-password'
            ? {
                method: 'POST',
                url: '/api/v1/admin/users/' + user.id + '/reset-password',
                headers: admin.headers,
                payload: { password: 'Reset-test-password-42!' },
              }
            : {
                method: 'PATCH',
                url: '/api/v1/admin/users/' + user.id + '/status',
                headers: admin.headers,
                payload: { status: 'disabled', expectedRevision: user.revision },
              },
      );
      expect(response.statusCode).toBe(200);
      expect(await app.ctx.db.list('agentTokens', { ownerId: user.id })).toEqual([]);
      for (const token of issued.slice(0, 2)) {
        expect(await app.ctx.db.get('agentTokens', token.id)).toBeUndefined();
        expect(
          (
            await app.inject({
              url: '/api/v1/agent/topics',
              headers: { authorization: 'Bearer ' + token.token },
            })
          ).statusCode,
        ).toBe(401);
      }
      expect(await app.ctx.db.get('agentTokens', issued[2].id)).toBeDefined();
      expect(
        (
          await app.inject({
            url: '/api/v1/agent/topics',
            headers: { authorization: 'Bearer ' + issued[2].token },
          })
        ).statusCode,
      ).toBe(200);
    },
  );
  it('rotates mobile refresh credentials and detects replay', async () => {
    const first = await login(ADMIN, PASSWORD, 'mobile');
    expect(first.response.cookies).toHaveLength(0);
    const refreshed = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mobile/refresh',
      payload: { refreshToken: first.value.refreshToken },
    });
    expect(refreshed.statusCode).toBe(200);
    const second = refreshed.json().data;
    expect(second.refreshToken).not.toBe(first.value.refreshToken);
    expect(
      (
        await app.inject({
          url: '/api/v1/me',
          headers: { authorization: 'Bearer ' + first.value.accessToken },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          url: '/api/v1/me',
          headers: { authorization: 'Bearer ' + second.accessToken },
        })
      ).statusCode,
    ).toBe(200);
    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mobile/refresh',
      payload: { refreshToken: first.value.refreshToken },
    });
    expect(replay.statusCode).toBe(401);
    expect(
      (
        await app.inject({
          url: '/api/v1/me',
          headers: { authorization: 'Bearer ' + second.accessToken },
        })
      ).statusCode,
    ).toBe(401);
  });
  it('revokes credentials when disabling a user and blocks self-disable', async () => {
    const admin = await login();
    const user = await createUser(app.ctx.db, {
      username: 'disabled_user',
      password: PASSWORD,
      mustChangePassword: false,
    });
    const learner = await login(user.username);
    const disabled = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/users/' + user.id + '/status',
      headers: admin.headers,
      payload: { status: 'disabled', expectedRevision: user.revision },
    });
    expect(disabled.statusCode).toBe(200);
    expect((await app.inject({ url: '/api/v1/me', headers: learner.headers })).statusCode).toBe(
      401,
    );
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/v1/admin/users/' + admin.value.user.id + '/status',
          headers: admin.headers,
          payload: { status: 'disabled' },
        })
      ).statusCode,
    ).toBe(409);
  });
  it('accepts arbitrary browser origins for web login', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/web/login',
      headers: { origin: 'https://untrusted.invalid' },
      payload: { username: ADMIN, password: PASSWORD },
    });
    expect(response.statusCode).toBe(200);
  });
  it('allows cross-origin web writes when CSRF is valid', async () => {
    const session = await login();
    const current = await app.inject({ url: '/api/v1/me', headers: session.headers });
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: { ...session.headers, origin: 'https://untrusted.invalid' },
      payload: {
        expectedRevision: current.json().data.revision,
        displayName: '跨域写入测试',
      },
    });
    expect(response.statusCode).toBe(200);
  });
  it('accepts LAN origins through a proxy', async () => {
    const origin = 'http://192.168.1.20:5173';
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/auth/web/login',
      headers: { origin, 'access-control-request-method': 'POST' },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe(origin);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/web/login',
      headers: { origin, host: '127.0.0.1:3000' },
      payload: { username: ADMIN, password: PASSWORD },
    });
    expect(response.statusCode).toBe(200);
  });
  it('encrypts model secrets with authenticated encryption', () => {
    const vault = new SecretVault('a'.repeat(64));
    const encrypted = vault.encrypt('a-synthetic-key');
    expect(encrypted).not.toContain('a-synthetic-key');
    expect(vault.decrypt(encrypted)).toBe('a-synthetic-key');
    expect(() => new SecretVault('b'.repeat(64)).decrypt(encrypted)).toThrow(
      '无法解密服务端凭据，请联系管理员检查主密钥',
    );
  });
});

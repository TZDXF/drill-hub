import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Extract } from 'unzip-stream';
import { expect, test } from '@playwright/test';
import { AGENT_SCOPES } from '@drill-hub/contracts';
import { login } from '#e2e/helpers';

const copiedTextKey = '__drillHubCopiedHelp';

test('授权页提供简明接入说明，复制内容包含服务器配置和 Skill 地址', async ({ page }, testInfo) => {
  await page.addInitScript((key) => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        async writeText(text: string) {
          Reflect.set(window, key, text);
        },
      },
    });
  }, copiedTextKey);
  await login(page);
  await page.goto('/settings/agent-tokens');
  const serverUrl = new URL(page.url()).origin;
  const help = page.getByRole('region', { name: 'Agent 接入', exact: true });
  await expect(help).toBeVisible();
  await expect(help).toContainText('创建令牌并配置到 Agent 的安全环境');
  await expect(help.getByRole('button')).toHaveCount(1);
  await expect(help.getByRole('textbox')).toHaveCount(0);
  await expect(help.getByText('配置示例与接入验证', { exact: true })).toHaveCount(0);
  await expect(page.getByText('最小权限原则', { exact: true })).toHaveCount(0);

  await help.getByRole('button', { name: '复制 Agent 接入说明', exact: true }).click();
  await expect(
    page.locator('.app-toast').filter({ hasText: 'Agent 接入说明已复制' }),
  ).toBeVisible();
  const instructions = await page.evaluate(
    (key) => Reflect.get(window, key) as string,
    copiedTextKey,
  );
  expect(instructions).toContain(`服务器公开地址：${serverUrl}`);
  expect(instructions).toContain(`${serverUrl}/api/v1/agent/capabilities`);
  expect(instructions).toContain(`${serverUrl}/downloads/drill-hub-skill.zip`);
  expect(instructions).toContain('Authorization: Bearer <AGENT_TOKEN>');
  expect(instructions).toContain('DRILL_HUB_AGENT_TOKEN');
  expect(instructions).not.toContain('dhk.');

  const download = await page.request.get(`${serverUrl}/downloads/drill-hub-skill.zip`);
  expect(download.ok()).toBeTruthy();
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'drill-hub-skill-'));
  try {
    const archivePath = join(temporaryDirectory, 'drill-hub-skill.zip');
    await writeFile(archivePath, await download.body());
    expect((await readFile(archivePath)).subarray(0, 2).toString()).toBe('PK');
    await pipeline(createReadStream(archivePath), Extract({ path: temporaryDirectory }));
    const files = await readdir(join(temporaryDirectory, 'drill-hub'), { recursive: true });
    expect(files).toContain('SKILL.md');
    expect(files).toContain(join('references', 'api.md'));
    expect(files).toContain(join('references', 'resources', 'questions.md'));
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  const widths = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(widths.content).toBeLessThanOrEqual(widths.viewport);
  await page.screenshot({ path: testInfo.outputPath('agent-setup-help.png'), fullPage: true });
});

test('授权列表可复制有效令牌密钥', async ({ page }, testInfo) => {
  await page.addInitScript((key) => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        async writeText(text: string) {
          Reflect.set(window, key, text);
        },
      },
    });
  }, copiedTextKey);
  await login(page);
  await page.goto('/settings/agent-tokens');

  await page.getByRole('button', { name: '新建令牌', exact: true }).click();
  const createDialog = page.getByRole('dialog', { name: '新建 Agent 令牌' });
  const tokenName = `E2E 列表复制令牌 ${testInfo.project.name}`;
  await createDialog.getByLabel('令牌名称').fill(tokenName);
  await createDialog.getByRole('button', { name: '创建令牌', exact: true }).click();

  const secretDialog = page.getByRole('dialog', { name: '保存 Agent 令牌' });
  await expect(secretDialog).toBeVisible();
  const token = (await secretDialog.locator('code').textContent())?.trim() ?? '';
  expect(token).toMatch(/^dhk\./);
  await page.keyboard.press('Escape');
  await expect(secretDialog).toBeHidden();

  const row = page.getByRole('row', { name: new RegExp(tokenName) });
  await expect(row.getByRole('button', { name: '复制密钥', exact: true })).toBeVisible();
  await row.getByRole('button', { name: '复制密钥', exact: true }).click();
  await expect(page.locator('.app-toast').filter({ hasText: '令牌已复制' })).toBeVisible();
  expect(await page.evaluate((key) => Reflect.get(window, key) as string, copiedTextKey)).toBe(
    token,
  );
});

test('剪贴板 API 不可用时回退到选区复制', async ({ page }) => {
  await page.addInitScript((key) => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(Document.prototype, 'execCommand', {
      configurable: true,
      value(command: string) {
        const activeElement = document.activeElement;
        if (command !== 'copy' || !(activeElement instanceof HTMLTextAreaElement)) return false;
        Reflect.set(window, key, activeElement.value);
        return true;
      },
    });
  }, copiedTextKey);
  await login(page);
  await page.goto('/settings/agent-tokens');
  const help = page.getByRole('region', { name: 'Agent 接入', exact: true });
  await help.getByRole('button', { name: '复制 Agent 接入说明', exact: true }).click();
  await expect(
    page.locator('.app-toast').filter({ hasText: 'Agent 接入说明已复制' }),
  ).toBeVisible();
  const instructions = await page.evaluate(
    (key) => Reflect.get(window, key) as string,
    copiedTextKey,
  );
  expect(instructions).toContain('DRILL_HUB_AGENT_TOKEN');
  expect(instructions).toContain('<AGENT_TOKEN>');
});

test('新建令牌默认折叠并勾选全部权限，可展开调整并保存', async ({ page }, testInfo) => {
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: viewport?.width ?? 1280, height: 600 });
  await login(page);
  await page.goto('/settings/agent-tokens');
  await page.getByRole('button', { name: '新建令牌', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建 Agent 令牌' });
  const tokenName = `E2E 权限折叠 ${testInfo.project.name}`;
  await dialog.getByLabel('令牌名称').fill(tokenName);
  const trigger = dialog.getByRole('button', { name: /^权限范围/ });
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toContainText(`已选 ${AGENT_SCOPES.length}/${AGENT_SCOPES.length} 项`);
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath('agent-create-collapsed.png'),
    fullPage: true,
  });
  await trigger.click();
  await expect(dialog.getByRole('checkbox', { checked: true })).toHaveCount(AGENT_SCOPES.length);
  const read = dialog.getByRole('checkbox', { name: /^read / });
  await read.uncheck();
  await expect(trigger).toContainText(`已选 ${AGENT_SCOPES.length - 1}/${AGENT_SCOPES.length} 项`);
  const archiveScope = dialog.getByRole('checkbox', { name: /^archive:write / });
  await archiveScope.scrollIntoViewIfNeeded();
  await expect(archiveScope).toBeInViewport();
  await expect(archiveScope).toBeChecked();
  const createButton = dialog.getByRole('button', { name: '创建令牌', exact: true });
  await expect(createButton).toBeInViewport();
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith('/me/agent-tokens') && response.request().method() === 'POST',
  );
  await createButton.click();
  const createdResponse = await created;
  expect(createdResponse.request().postDataJSON()).toMatchObject({
    scopes: AGENT_SCOPES.filter((scope) => scope !== 'read'),
    expiresAt: null,
  });
  const secretDialog = page.getByRole('dialog', { name: '保存 Agent 令牌' });
  await expect(secretDialog).toBeVisible();
  await secretDialog.getByRole('button', { name: '关闭', exact: true }).last().click();
  await page.reload();
  const tokenRow = page.getByRole('row').filter({ hasText: tokenName });
  await expect(tokenRow.getByText('archive:write', { exact: true })).toBeVisible();
  await expect(tokenRow.getByText('read', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '新建令牌', exact: true }).click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();
  await expect(dialog.getByRole('checkbox', { checked: true })).toHaveCount(AGENT_SCOPES.length);
  for (const checkbox of await dialog.getByRole('checkbox').all()) await checkbox.uncheck();
  await expect(createButton).toBeDisabled();
});

test('撤销令牌会直接删除记录，刷新后不保留历史行', async ({ page }, testInfo) => {
  await login(page);
  await page.goto('/settings/agent-tokens');
  await page.getByRole('button', { name: '新建令牌', exact: true }).click();
  const createDialog = page.getByRole('dialog', { name: '新建 Agent 令牌' });
  const tokenName = `E2E 撤销删除令牌 ${testInfo.project.name}`;
  await createDialog.getByLabel('令牌名称').fill(tokenName);
  await createDialog.getByRole('button', { name: '创建令牌', exact: true }).click();
  const secretDialog = page.getByRole('dialog', { name: '保存 Agent 令牌' });
  await expect(secretDialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(secretDialog).toBeHidden();

  const row = page.getByRole('row').filter({ hasText: tokenName });
  await row.getByRole('button', { name: '撤销', exact: true }).click();
  const revokeDialog = page.getByRole('dialog', { name: '撤销 Agent 令牌？' });
  await expect(revokeDialog).toContainText('永久删除');
  await revokeDialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(row).toBeVisible();

  await row.getByRole('button', { name: '撤销', exact: true }).click();
  await revokeDialog.getByRole('button', { name: '撤销并删除', exact: true }).click();
  await expect(
    page.locator('.app-toast').filter({ hasText: 'Agent 令牌已撤销并删除' }),
  ).toBeVisible();
  await expect(row).toHaveCount(0);
  const refreshedList = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/me/agent-tokens') && response.request().method() === 'GET',
  );
  await page.reload();
  const response = await refreshedList;
  expect(response.status()).toBe(200);
  expect((await response.json()).data).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ name: tokenName })]),
  );
  await expect(row).toHaveCount(0);
});

test('已有令牌支持编辑权限、取消修改并在刷新后保留权限', async ({ page }, testInfo) => {
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: viewport?.width ?? 1280, height: 600 });
  await login(page);
  await page.goto('/settings/agent-tokens');
  await page.getByRole('button', { name: '新建令牌', exact: true }).click();
  const createDialog = page.getByRole('dialog', { name: '新建 Agent 令牌' });
  const tokenName = `E2E 编辑权限 ${testInfo.project.name}`;
  await createDialog.getByLabel('令牌名称').fill(tokenName);
  await createDialog.getByRole('button', { name: /^权限范围/ }).click();
  for (const scope of AGENT_SCOPES.filter((scope) => scope !== 'read')) {
    await createDialog.getByRole('checkbox', { name: new RegExp(`^${scope} `) }).uncheck();
  }
  await createDialog.getByRole('button', { name: '创建令牌', exact: true }).click();
  const secretDialog = page.getByRole('dialog', { name: '保存 Agent 令牌' });
  await expect(secretDialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(secretDialog).toBeHidden();

  const row = page.getByRole('row').filter({ hasText: tokenName });
  const dialog = page.getByRole('dialog', { name: '编辑 Agent 令牌权限' });
  await row.getByRole('button', { name: '编辑权限', exact: true }).click();
  await expect(dialog).toContainText(tokenName);
  await expect(dialog).toContainText('原密钥、名称和有效期保持不变');
  await expect(dialog.getByRole('checkbox')).toHaveCount(AGENT_SCOPES.length);
  const read = dialog.getByRole('checkbox', { name: /^read / });
  const content = dialog.getByRole('checkbox', { name: /^content:write / });
  const archive = dialog.getByRole('checkbox', { name: /^archive:write / });
  await expect(read).toBeChecked();
  await expect(content).not.toBeChecked();
  await content.check();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(row.getByText('content:write', { exact: true })).toHaveCount(0);

  await row.getByRole('button', { name: '编辑权限', exact: true }).click();
  await expect(content).not.toBeChecked();
  await read.uncheck();
  const save = dialog.getByRole('button', { name: '保存权限', exact: true });
  await expect(save).toBeDisabled();
  await read.check();
  await content.check();
  await archive.check();
  await expect(save).toBeEnabled();
  await expect(save).toBeInViewport();
  await save.click();
  await expect(dialog).toBeHidden();
  await expect(
    page.locator('.app-toast').filter({ hasText: 'Agent 令牌权限已更新' }),
  ).toBeVisible();
  await expect(row.getByText('content:write', { exact: true })).toBeVisible();
  await expect(row.getByText('archive:write', { exact: true })).toBeVisible();
  await page.reload();
  await expect(row.getByText('archive:write', { exact: true })).toBeVisible();

  await row.getByRole('button', { name: '编辑权限', exact: true }).click();
  await expect(content).toBeChecked();
  await expect(archive).toBeChecked();
  await content.uncheck();
  await archive.uncheck();
  await save.click();
  await expect(dialog).toBeHidden();
  await expect(row.getByText('read', { exact: true })).toBeVisible();
  await expect(row.getByText('content:write', { exact: true })).toHaveCount(0);
  await expect(row.getByText('archive:write', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(row.getByText('read', { exact: true })).toBeVisible();
  await expect(row.getByText('content:write', { exact: true })).toHaveCount(0);
});

test('Reka 日期时间选择支持月份切换、键盘输入时分、清空并保存到期时间', async ({
  page,
}, testInfo) => {
  await login(page);
  await page.goto('/settings/agent-tokens');
  await page.getByRole('button', { name: '新建令牌', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建 Agent 令牌' });
  await dialog.getByLabel('令牌名称').fill(`E2E 到期时间 ${testInfo.project.name}`);
  // Reka retains an invisible native input for form integration, not for date selection.
  await expect(
    dialog.locator('input[type="datetime-local"]:not([aria-hidden="true"])'),
  ).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '清空日期时间' })).toHaveCount(0);
  const openCalendar = dialog.getByRole('button', { name: '选择日期时间', exact: true });
  await openCalendar.click();
  const calendar = page.getByRole('dialog', { name: '选择日期时间', exact: true });
  await expect(calendar).toBeVisible();
  await calendar.getByRole('button', { name: '下个月', exact: true }).click();
  const day = calendar
    .locator('[data-reka-calendar-cell-trigger]:not([data-outside-view])')
    .filter({ hasText: /^15$/ });
  await expect(day).toBeInViewport();
  const selectedDate = (await day.getAttribute('data-value'))!.slice(0, 10);
  await page.screenshot({ path: testInfo.outputPath('agent-expiry-calendar.png'), fullPage: true });
  await day.click();
  await expect(calendar).toBeHidden();
  await expect(dialog).toBeVisible();
  const hour = dialog.locator('[data-reka-date-field-segment="hour"]');
  const minute = dialog.locator('[data-reka-date-field-segment="minute"]');
  await hour.focus();
  await hour.press('1');
  await hour.press('4');
  await minute.focus();
  await minute.press('3');
  await minute.press('0');
  await expect(hour).toHaveText('14');
  await expect(minute).toHaveText('30');
  await openCalendar.click();
  await expect(calendar).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(calendar).toBeHidden();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '清空日期时间' }).click();
  await expect(hour).toHaveAttribute('data-placeholder');
  await expect(minute).toHaveAttribute('data-placeholder');
  await expect(dialog.getByRole('button', { name: '清空日期时间' })).toHaveCount(0);
  await openCalendar.click();
  await calendar
    .locator(`[data-reka-calendar-cell-trigger][data-value^="${selectedDate}"]`)
    .click();
  await hour.focus();
  await hour.press('1');
  await hour.press('4');
  await minute.focus();
  await minute.press('3');
  await minute.press('0');
  const expectedExpiry = await page.evaluate(
    (date) => new Date(`${date}T14:30:00`).toISOString(),
    selectedDate,
  );
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith('/me/agent-tokens') && response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: '创建令牌', exact: true }).click();
  const response = await created;
  expect(response.request().postDataJSON()).toMatchObject({
    scopes: [...AGENT_SCOPES],
    expiresAt: expectedExpiry,
  });
  expect(response.ok()).toBeTruthy();
  const secretDialog = page.getByRole('dialog', { name: '保存 Agent 令牌' });
  await expect(secretDialog).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '新建令牌', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '清空日期时间' })).toHaveCount(0);
  await expect(hour).toHaveAttribute('data-placeholder');
});

test('复制接入说明失败时才展示可手动复制的内容', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    Object.defineProperty(Document.prototype, 'execCommand', {
      configurable: true,
      value: () => false,
    });
  });
  await login(page);
  await page.goto('/settings/agent-tokens');
  const help = page.getByRole('region', { name: 'Agent 接入', exact: true });
  await expect(help.getByRole('textbox')).toHaveCount(0);
  await help.getByRole('button', { name: '复制 Agent 接入说明', exact: true }).click();
  await expect(help.getByRole('textbox', { name: 'Agent 接入说明', exact: true })).toHaveValue(
    /DRILL_HUB_AGENT_TOKEN/,
  );
});

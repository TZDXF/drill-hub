import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Extract } from 'unzip-stream';
import { expect, test } from '@playwright/test';
import { AGENT_SCOPES } from '@drill-hub/contracts';
import { login } from './helpers';

const copiedTextKey = '__drillHubCopiedHelp';

test('授权页提供当前服务器配置、Skill 指引和最小权限预设', async ({ page }, testInfo) => {
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
  const help = page.getByRole('region', { name: 'Agent 配置帮助' });
  await expect(help).toBeVisible();
  const skillDownload = help.getByRole('link', {
    name: '下载 Drill Hub Skill（ZIP）',
    exact: true,
  });
  await expect(skillDownload).toHaveAttribute('href', `${serverUrl}/downloads/drill-hub-skill.zip`);
  await expect(help.getByText('drill-hub/', { exact: true })).toBeVisible();
  await expect(
    help.locator('.agent-setup-addresses').getByText(serverUrl, { exact: true }),
  ).toBeVisible();

  await help.getByRole('button', { name: '复制 Agent 接入说明', exact: true }).click();
  await expect(
    page.locator('.app-toast').filter({ hasText: 'Agent 接入说明已复制' }),
  ).toBeVisible();
  const instructions = await page.evaluate(
    (key) => Reflect.get(window, key) as string,
    copiedTextKey,
  );
  expect(instructions).toContain(`${serverUrl}/api/v1/agent/capabilities`);
  expect(instructions).toContain(`${serverUrl}/downloads/drill-hub-skill.zip`);
  expect(instructions).toContain('Authorization: Bearer <AGENT_TOKEN>');
  expect(instructions).not.toContain('dhk.');

  const [download] = await Promise.all([page.waitForEvent('download'), skillDownload.click()]);
  expect(download.suggestedFilename()).toBe('drill-hub-skill.zip');
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'drill-hub-skill-'));
  try {
    const archivePath = join(temporaryDirectory, 'drill-hub-skill.zip');
    await download.saveAs(archivePath);
    expect((await readFile(archivePath)).subarray(0, 2).toString()).toBe('PK');
    await pipeline(createReadStream(archivePath), Extract({ path: temporaryDirectory }));
    const files = await readdir(join(temporaryDirectory, 'drill-hub'), { recursive: true });
    expect(files).toContain('SKILL.md');
    expect(files).toContain(join('references', 'api.md'));
    expect(files).toContain(join('references', 'resources', 'questions.md'));
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  await help.getByText('配置示例与接入验证', { exact: true }).click();
  await expect(help.getByLabel('验证请求示例')).toContainText(
    'Authorization: Bearer <AGENT_TOKEN>',
  );
  await help.getByRole('button', { name: '复制环境变量示例', exact: true }).click();
  await expect(page.locator('.app-toast').filter({ hasText: '环境变量示例已复制' })).toBeVisible();
  const environment = await page.evaluate(
    (key) => Reflect.get(window, key) as string,
    copiedTextKey,
  );
  expect(environment).toBe(
    `DRILL_HUB_SERVER_URL="${serverUrl}"\nDRILL_HUB_AGENT_TOKEN="<AGENT_TOKEN>"`,
  );

  await help.getByText('各项权限与安全说明', { exact: true }).click();
  await expect(
    help.getByText('仅对 external_rubric 题提交逐项等级与证据，不允许自由改分。'),
  ).toBeVisible();
  const widths = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(widths.content).toBeLessThanOrEqual(widths.viewport);
  await page.screenshot({ path: testInfo.outputPath('agent-setup-help.png'), fullPage: true });

  await help.getByRole('button', { name: '按学习规划权限新建令牌', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建 Agent 令牌' });
  await expect(dialog.getByRole('checkbox', { name: /^read / })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: /^content:write / })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: /^assessment:write / })).toBeChecked();
  for (const scope of ['attempt:write', 'grading:request', 'grade:write', 'archive:write']) {
    await expect(
      dialog.getByRole('checkbox', { name: new RegExp(`^${scope} `) }),
    ).not.toBeChecked();
  }
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await help.getByRole('button', { name: '按只读权限新建令牌', exact: true }).click();
  await expect(dialog.getByRole('checkbox', { checked: true })).toHaveCount(1);
  await expect(dialog.getByRole('checkbox', { name: /^read / })).toBeChecked();
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
  const help = page.getByRole('region', { name: 'Agent 配置帮助' });
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
  await help.getByText('配置示例与接入验证', { exact: true }).click();
  await help.getByText('查看可复制的 Agent 接入说明', { exact: true }).click();
  await expect(help.getByLabel('Agent 接入说明', { exact: true })).toContainText(
    'DRILL_HUB_AGENT_TOKEN',
  );
  await expect(help.getByLabel('Agent 接入说明', { exact: true })).toContainText('<AGENT_TOKEN>');
});

test('新建令牌可滚动选择归档权限并保存', async ({ page }, testInfo) => {
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: viewport?.width ?? 1280, height: 600 });
  await login(page);
  await page.goto('/settings/agent-tokens');
  await page.getByRole('button', { name: '新建令牌', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建 Agent 令牌' });
  const tokenName = `E2E 归档权限 ${testInfo.project.name}`;
  await dialog.getByLabel('令牌名称').fill(tokenName);
  await expect(dialog.getByRole('checkbox')).toHaveCount(AGENT_SCOPES.length);
  const archiveScope = dialog.getByRole('checkbox', { name: /^archive:write / });
  const scrollViewport = dialog.locator('.dialog-body__viewport');
  const size = await scrollViewport.evaluate((element) => ({
    height: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(size.scrollHeight).toBeGreaterThan(size.height);
  await scrollViewport.hover();
  await page.mouse.wheel(0, 1000);
  await expect(archiveScope).toBeInViewport();
  await archiveScope.check();
  await expect(archiveScope).toBeChecked();
  const createButton = dialog.getByRole('button', { name: '创建令牌', exact: true });
  await expect(createButton).toBeInViewport();
  await createButton.click();
  const secretDialog = page.getByRole('dialog', { name: '保存 Agent 令牌' });
  await expect(secretDialog).toBeVisible();
  await secretDialog.getByRole('button', { name: '关闭', exact: true }).last().click();
  await page.reload();
  const tokenRow = page.getByRole('row').filter({ hasText: tokenName });
  await expect(tokenRow.getByText('archive:write', { exact: true })).toBeVisible();
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

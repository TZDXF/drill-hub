import { expect, test } from '@playwright/test';
import { login } from '#e2e/helpers';

const scenarios = [
  {
    tab: '搜索服务',
    title: '搜索服务',
    createTitle: '新建搜索服务',
    editTitle: '编辑搜索服务',
    endpoint: 'search-providers',
    fields: { 显示名称: '测试搜索服务', 'API Key': 'e2e-placeholder' },
    editLabel: '显示名称',
    editValue: '更新搜索服务',
    payload: { displayName: '测试搜索服务', kind: 'tavily' },
    editPayload: { displayName: '更新搜索服务' },
  },
  {
    tab: 'MCP 服务器',
    title: 'MCP 服务器',
    createTitle: '新建 MCP 服务器',
    editTitle: '编辑 MCP 服务器',
    endpoint: 'mcp-servers',
    fields: { 名称: 'test-mcp', Command: 'test-command' },
    editLabel: 'Command',
    editValue: 'updated-command',
    payload: { name: 'test-mcp', command: 'test-command', transport: 'stdio' },
    editPayload: { command: 'updated-command' },
  },
  {
    tab: 'Skills',
    title: 'Skill',
    createTitle: '新建 Skill',
    editTitle: '编辑 Skill',
    endpoint: 'assistant-skills',
    fields: { 名称: 'test-skill', '描述（何时使用）': '测试描述', 指令内容: '测试指令' },
    editLabel: '指令内容',
    editValue: '更新指令',
    payload: { name: 'test-skill', description: '测试描述', content: '测试指令' },
    editPayload: { content: '更新指令' },
  },
];

for (const scenario of scenarios) {
  test(`助手设置：${scenario.title} 弹窗独占挂载并提交对应接口`, async ({ page }) => {
    await login(page);
    const records: Record<string, Record<string, unknown>[]> = {
      'search-providers': [],
      'mcp-servers': [],
      'assistant-skills': [],
    };
    const writes: { method: string; path: string; body: Record<string, unknown> }[] = [];
    await page.route('**/api/v1/admin/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const [, endpoint] = path.split('/admin/');
      const [resource, resourceId] = (endpoint ?? '').split('/');
      const items = records[resource ?? ''];
      if (!items) return route.continue();
      if (request.method() === 'GET') {
        const data = resourceId ? items.find((item) => item.id === resourceId) : items;
        return route.fulfill({ json: { data } });
      }
      const body = request.postDataJSON() as Record<string, unknown>;
      writes.push({ method: request.method(), path, body });
      const record = { ...body, id: resourceId ?? 'test-record', revision: 1 };
      items.splice(0, items.length, record);
      return route.fulfill({ json: { data: record } });
    });

    await page.goto('/admin/settings/assistant');
    await page.getByRole('tab', { name: scenario.tab, exact: true }).click();
    const create = page.getByRole('button', { name: '新建', exact: true });
    const dialogs = page.getByRole('dialog', { includeHidden: true });
    const overlays = page.locator('.dialog-overlay');
    await create.click();
    await expect(dialogs).toHaveCount(1);
    await expect(overlays).toHaveCount(1);
    await dialogs.getByRole('button', { name: '取消', exact: true }).click();
    await expect(dialogs).toHaveCount(0);
    await expect(overlays).toHaveCount(0);
    expect(writes).toHaveLength(0);

    await create.click();
    await expect(dialogs).toHaveCount(1);
    await expect(overlays).toHaveCount(1);
    await expect(dialogs).toHaveAccessibleName(scenario.createTitle);
    for (const [label, value] of Object.entries(scenario.fields)) {
      await dialogs.getByLabel(label, { exact: true }).fill(value);
    }
    await dialogs.getByRole('button', { name: '保存', exact: true }).click();
    await expect(dialogs).toHaveCount(0);
    await expect(overlays).toHaveCount(0);
    expect(writes).toEqual([
      {
        method: 'POST',
        path: `/api/v1/admin/${scenario.endpoint}`,
        body: expect.objectContaining(scenario.payload),
      },
    ]);

    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await expect(dialogs).toHaveCount(1);
    await expect(overlays).toHaveCount(1);
    await expect(dialogs).toHaveAccessibleName(scenario.editTitle);
    await dialogs.getByLabel(scenario.editLabel, { exact: true }).fill(scenario.editValue);
    await dialogs.getByRole('button', { name: '保存', exact: true }).click();
    await expect(dialogs).toHaveCount(0);
    await expect(overlays).toHaveCount(0);
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual({
      method: 'PATCH',
      path: `/api/v1/admin/${scenario.endpoint}/test-record`,
      body: expect.objectContaining({ expectedRevision: 1, ...scenario.editPayload }),
    });
  });
}

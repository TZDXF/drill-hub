import { expect, test, type Page } from '@playwright/test';
import { testCredentials } from '#e2e/helpers';

async function login(page: Page) {
  const credentials = testCredentials();
  await page.goto('/login');
  await page.getByLabel('用户名').fill(credentials.username);
  await page.getByLabel('密码').fill(credentials.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: /继续向前$/ })).toBeVisible();
}

async function gotoAgents(page: Page) {
  const width = page.viewportSize()?.width ?? 1280;
  if (width <= 780) {
    await page.goto('/settings');
    await page.getByRole('link', { name: '学习智能体' }).click();
  } else {
    await page.locator('.sidebar-nav a[href="/agents"]').click();
  }
  await expect(page).toHaveURL(/\/agents$/);
  // 顶栏标题与页面标题同名，直接限定 h1。
  await expect(page.locator('h1')).toHaveText('学习智能体');
}

test.describe('学习智能体', () => {
  test('从科学方法预设创建、编辑，并在助手面板中选用', async ({ page }, testInfo) => {
    // 桌面与移动项目共用同一隔离服务，用项目名生成唯一名称避免相互干扰。
    const agentName = `费曼教练-${testInfo.project.name}`;
    const renamed = `${agentName}·改`;
    await login(page);
    await gotoAgents(page);

    // 预设回填表单后保存（真实服务端）。
    const presetCard = page.locator('.agent-card--preset', { hasText: '费曼教练' });
    await presetCard.getByRole('button', { name: '用这个预设' }).click();
    const dialog = page.getByRole('dialog', { name: '创建学习智能体' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('#agent-name')).toHaveValue('费曼教练');
    await expect(dialog.locator('.agent-tag.is-active')).toHaveText(['费曼讲解', '循序渐进']);
    await dialog.locator('#agent-name').fill(agentName);
    await dialog.getByTestId('agents-save').click();
    await expect(dialog).toBeHidden();
    const card = page
      .locator('.agent-card:not(.agent-card--preset)', { hasText: agentName })
      .first();
    await expect(card).toBeVisible();

    // 编辑名称与补充指令。
    await card.getByRole('button', { name: '编辑' }).click();
    const editDialog = page.getByRole('dialog', { name: '编辑学习智能体' });
    await expect(editDialog).toBeVisible();
    await expect(editDialog.locator('#agent-instructions')).not.toBeEmpty();
    await editDialog.locator('#agent-name').fill(renamed);
    await editDialog.getByTestId('agents-save').click();
    await expect(editDialog).toBeHidden();
    await expect(page.locator('.agent-card', { hasText: renamed }).first()).toBeVisible();

    // 助手面板的选择器列出智能体，选中后作为当前会话的智能体。
    if ((page.viewportSize()?.width ?? 1280) <= 780) await page.goto('/assistant');
    else await page.getByTestId('assistant-toggle').click();
    const agentTrigger = page.getByTestId('assistant-agent-select');
    await expect(agentTrigger).toBeVisible();
    await agentTrigger.click();
    const menu = page.getByRole('menu');
    const option = menu.getByTestId('assistant-agent-option').filter({ hasText: renamed });
    await expect(option).toHaveCount(1);
    await option.click();
    await expect(agentTrigger).toContainText(renamed);
    await agentTrigger.click();
    await expect(menu.getByRole('menuitemradio', { checked: true })).toContainText(renamed);
    await page.keyboard.press('Escape');
  });

  test('未配置模型时 AI 生成给出可见错误，归档后才能删除', async ({ page }) => {
    await login(page);
    await gotoAgents(page);

    // AI 生成草稿：E2E 服务端未配置模型，必须以可见错误结束。
    await page.getByTestId('agents-ai-create').click();
    const aiDialog = page.getByRole('dialog', { name: 'AI 帮我创建智能体' });
    await expect(aiDialog).toBeVisible();
    await aiDialog.locator('#agent-ai-description').fill('我喜欢刷题，希望有人陪练');
    await aiDialog.getByTestId('agents-ai-generate').click();
    await expect(aiDialog.locator('[role="alert"]')).toContainText('尚未配置', { timeout: 15000 });
    await aiDialog.getByRole('button', { name: '取消', exact: true }).click();

    // 手动创建一个用于归档删除流程的智能体。
    await page.getByTestId('agents-create').click();
    const dialog = page.getByRole('dialog', { name: '创建学习智能体' });
    await dialog.locator('#agent-name').fill('待归档智能体');
    await dialog.getByTestId('agents-save').click();
    const card = page.locator('.agent-card', { hasText: '待归档智能体' }).first();
    await expect(card).toBeVisible();
    await expect(card.getByRole('button', { name: '删除' })).toBeDisabled();

    // 归档后从"使用中"消失，切到"全部"可见并可删除。
    await card.getByRole('button', { name: '归档' }).click();
    await expect(card).toHaveCount(0);
    await page.locator('#agents-filter').click();
    await page.getByRole('option', { name: '全部' }).click();
    const archivedCard = page.locator('.agent-card', { hasText: '待归档智能体' }).first();
    await expect(archivedCard).toBeVisible();
    await expect(archivedCard.getByRole('button', { name: '删除' })).toBeEnabled();

    await archivedCard.getByRole('button', { name: '删除' }).click();
    const confirmDialog = page.getByRole('dialog', { name: '删除学习智能体' });
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', { name: '取消', exact: true }).click();
    await expect(confirmDialog).toBeHidden();
    await archivedCard.getByRole('button', { name: '删除' }).click();
    await confirmDialog.getByRole('button', { name: '确认', exact: true }).click();
    await expect(confirmDialog).toBeHidden();
    await expect(page.locator('.agent-card', { hasText: '待归档智能体' })).toHaveCount(0);
  });
});

import { expect, test } from '@playwright/test';
import { login } from '#e2e/helpers';

test.describe('学习助手位置记忆', () => {
  for (const position of ['left', 'right'] as const) {
    test(`刷新后恢复${position === 'left' ? '左' : '右'}侧栏和宽度`, async ({ page, isMobile }) => {
      test.skip(isMobile, '手机端助手始终全屏覆盖');
      await login(page);
      await page.goto('/assistant');
      await page.getByTestId('assistant-position-trigger').click();
      await page.getByTestId(`assistant-position-${position}`).click();
      const handle = page.getByTestId('assistant-dock-resize');
      await handle.press('Home');
      await handle.press(position === 'left' ? 'ArrowRight' : 'ArrowLeft');
      await expect(handle).toHaveAttribute('aria-valuenow', '330');

      await page.reload();
      await expect(page.getByTestId('assistant-panel')).toBeVisible();
      await expect(handle).toHaveAttribute('aria-valuenow', '330');
      if (position === 'right')
        await expect(page.locator('.app-layout')).toHaveClass(/app-layout--assistant-right/);
      else await expect(page.locator('.app-layout')).not.toHaveClass(/app-layout--assistant-right/);
    });
  }

  test('刷新后恢复浮窗坐标和大小，小屏幕不覆盖保存的桌面位置', async ({ page, isMobile }) => {
    test.skip(isMobile, '手机端助手始终全屏覆盖');
    await login(page);
    await page.goto('/assistant');
    await page.getByTestId('assistant-position-trigger').click();
    await page.getByTestId('assistant-position-floating').click();
    const pane = page.getByTestId('assistant-pane');
    const header = (await page.getByTestId('assistant-floating-drag-handle').boundingBox())!;
    await page.mouse.move(header.x + 60, header.y + header.height / 2);
    await page.mouse.down();
    await page.mouse.move(header.x - 40, header.y + header.height / 2 - 30, { steps: 5 });
    await page.mouse.up();
    await page.getByTestId('assistant-resize-top-left').press('ArrowLeft');
    const saved = (await pane.boundingBox())!;

    await page.reload();
    await expect(pane).toHaveClass(/assistant-pane--floating/);
    await expect.poll(() => pane.boundingBox()).toEqual(saved);
    await page.setViewportSize({ width: 390, height: 800 });
    await page.reload();
    await expect(page.getByTestId('assistant-panel')).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.reload();
    await expect.poll(() => pane.boundingBox()).toEqual(saved);

    await page.setViewportSize({ width: 800, height: 600 });
    await page.reload();
    await expect(pane).toBeVisible();
    const clamped = (await pane.boundingBox())!;
    expect(clamped.x).toBeGreaterThanOrEqual(8);
    expect(clamped.y).toBeGreaterThanOrEqual(8);
    expect(clamped.x + clamped.width).toBeLessThanOrEqual(792);
    expect(clamped.y + clamped.height).toBeLessThanOrEqual(592);
  });
});

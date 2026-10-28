import { describe, expect, it } from 'vitest';
import {
  clampFloatingRect,
  moveFloatingRect,
  resizeFloatingRect,
} from '#learning-client/assistant/floating';

describe('助手浮窗几何计算', () => {
  it('拖动时始终保留在可视区域内', () => {
    const rect = { x: 700, y: 200, width: 400, height: 500 };
    expect(moveFloatingRect(rect, 300, -500, 1280, 800)).toEqual({
      x: 872,
      y: 8,
      width: 400,
      height: 500,
    });
  });

  it('从左侧和顶部调整大小并保持右下角不动', () => {
    const rect = { x: 600, y: 180, width: 400, height: 500 };
    expect(resizeFloatingRect(rect, 'top-left', 80, 60, 1280, 800)).toEqual({
      x: 680,
      y: 240,
      width: 320,
      height: 440,
    });
  });

  it('缩到最小尺寸后不会越过固定的右下角', () => {
    const rect = { x: 600, y: 180, width: 400, height: 500 };
    expect(resizeFloatingRect(rect, 'left', 600, 0, 1280, 800)).toEqual({
      x: 680,
      y: 180,
      width: 320,
      height: 500,
    });
  });

  it('视口变小时同步收紧尺寸和位置', () => {
    expect(clampFloatingRect({ x: 600, y: 500, width: 900, height: 700 }, 800, 600)).toEqual({
      x: 8,
      y: 8,
      width: 784,
      height: 584,
    });
  });

  it('顶部放大到达边界时保持右下角固定', () => {
    const rect = { x: 600, y: 26, width: 400, height: 500 };
    expect(resizeFloatingRect(rect, 'top-left', -40, -30, 1280, 720)).toEqual({
      x: 560,
      y: 8,
      width: 440,
      height: 518,
    });
  });
});

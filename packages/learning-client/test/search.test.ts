import { describe, expect, it } from 'vitest';
import { createListSearch, highlightParts, matchRanges } from '#learning-client/search';

describe('搜索高亮', () => {
  it('保留原文大小写，并高亮中文和重复出现的完整关键词', () => {
    expect(highlightParts('MVCC 与 mvcc；MVCC', ' mvcc ')).toEqual([
      { text: 'MVCC', highlighted: true },
      { text: ' 与 ', highlighted: false },
      { text: 'mvcc', highlighted: true },
      { text: '；', highlighted: false },
      { text: 'MVCC', highlighted: true },
    ]);
    expect(
      highlightParts('并发控制与并发控制', '并发控制').filter((part) => part.highlighted),
    ).toHaveLength(2);
  });

  it('将正则符号和 HTML 当作普通文字，支持长关键词及 Unicode 位置', () => {
    for (const query of ['C++', '[a.b]*', '<img onerror=alert(1)>', '学习'.repeat(40)]) {
      const text = `🙂İ ${query} 尾部`;
      const parts = highlightParts(text, query);
      expect(parts.map((part) => part.text).join('')).toBe(text);
      expect(parts.filter((part) => part.highlighted)).toEqual([
        { text: query, highlighted: true },
      ]);
    }
    expect(highlightParts('不匹配的原文', 'nothing')).toEqual([
      { text: '不匹配的原文', highlighted: false },
    ]);
    expect(highlightParts('原文', '   ')).toEqual([{ text: '原文', highlighted: false }]);
  });

  it('正确处理 Fuse 包含末位的范围、重叠范围与字段不匹配', () => {
    expect(
      highlightParts('abcdef', '', [
        [3, 4],
        [1, 3],
      ]),
    ).toEqual([
      { text: 'a', highlighted: false },
      { text: 'bcde', highlighted: true },
      { text: 'f', highlighted: false },
    ]);
    expect(matchRanges(undefined, 'title')).toEqual([]);
    expect(highlightParts('保留原文', '原文', [])).toEqual([
      { text: '保留原文', highlighted: false },
    ]);
  });
});

describe('本地列表模糊搜索', () => {
  it('容忍拼写错误，搜索目标中的较后文字，返回可用的高亮范围', () => {
    const search = createListSearch(
      [
        { title: 'JavaScript Patterns', goalText: '掌握常用模式' },
        { title: '数据库', goalText: `${'背景。'.repeat(60)}并发控制` },
        { title: 'Rust 入门', goalText: '所有权' },
      ],
      ['title', 'goalText'],
    );
    const [match] = search.search('Javscript');
    expect(match.item.title).toBe('JavaScript Patterns');
    const parts = highlightParts(match.item.title, '', matchRanges(match.matches, 'title'));
    expect(parts.some((part) => part.highlighted)).toBe(true);
    expect(parts.map((part) => part.text).join('')).toBe(match.item.title);
    expect(search.search('并发控制').map(({ item }) => item.title)).toEqual(['数据库']);
    expect(search.search('数').map(({ item }) => item.title)).toEqual(['数据库']);
    expect(search.search('完全不存在的关键词')).toEqual([]);
  });
});

<script setup lang="ts">
// Adapted from AI Elements Vue's MessageResponse (Apache-2.0; see #learning-client/components/ai-elements/LICENSE).
// 仅保留 Markdown 渲染；代码高亮、KaTeX、Mermaid 与信息图扩展全部使用本地依赖，不走 CDN。
import type { HTMLAttributes } from 'vue';
import type { PreviewerConfig } from 'vue-stream-markdown';
import { computed, useSlots } from 'vue';
import { beautifulMermaid } from '@stream-markdown/beautiful-mermaid';
import { code } from '@stream-markdown/code';
import { math } from '@stream-markdown/math';
import { mermaid } from '@stream-markdown/mermaid';
import { Markdown } from 'vue-stream-markdown';
import 'katex/dist/katex.min.css';
import 'vue-stream-markdown/index.css';
import InfographicPreview from '#learning-client/components/infographic/InfographicPreview.vue';

const props = defineProps<{
  content?: string;
  class?: HTMLAttributes['class'];
}>();

const slots = useSlots();
const slotContent = computed(() => {
  const nodes = slots.default?.();
  if (!Array.isArray(nodes)) return undefined;
  let text = '';
  for (const node of nodes) {
    if (typeof node.children === 'string') text += node.children;
  }
  return text || undefined;
});
const md = computed(() => slotContent.value ?? props.content ?? '');

// 不传 cdnOptions：扩展只从本地依赖加载。Mermaid 内容来自外部 Agent，使用 strict 安全级别。
// beautiful-mermaid 会在输出的 SVG 中内嵌 Google Fonts @import；剥离该引用并改用系统字体，保持离线渲染。
const beautifulMermaidExtension = beautifulMermaid({ config: { font: 'system-ui' } });
const offlineBeautifulMermaid = {
  ...beautifulMermaidExtension,
  render: async (input: Parameters<typeof beautifulMermaidExtension.render>[0]) => {
    const result = await beautifulMermaidExtension.render(input);
    if (result.svg) result.svg = result.svg.replace(/@import\s+url\([^)]*\)\s*;?/g, '');
    return result;
  },
};

const extensions = {
  code: code(),
  math: math(),
  mermaid: mermaid({ config: { securityLevel: 'strict' } }),
  beautifulMermaid: offlineBeautifulMermaid,
};

// 内容不可信：禁用原始 HTML 预览；```infographic 代码块由本地适配组件通过 @antv/infographic 渲染。
const previewers = {
  components: {
    html: false,
    infographic: InfographicPreview,
  },
} as unknown as PreviewerConfig;
</script>

<template>
  <Markdown
    :content="md"
    :class="props.class"
    :extensions="extensions"
    :previewers="previewers"
    v-bind="$attrs"
  />
</template>

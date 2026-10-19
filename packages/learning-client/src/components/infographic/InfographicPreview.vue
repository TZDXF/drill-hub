<script setup lang="ts">
// vue-stream-markdown 自定义代码块预览组件：渲染 ```infographic 代码块（AntV Infographic DSL）。
// 引擎体积较大，按需动态导入本地依赖。项目要求离线可用：
// - 引擎默认从 antv CDN 注入 Web 字体，这里在渲染前清空字体远程地址，改用系统字体回退；
// - DSL 中的 icon/illus 会触发外部图标服务请求，渲染前直接剥离这些字段。
import { onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

interface InfographicCodeNode {
  value: string;
  lang?: string | null;
  meta?: string;
  loading?: boolean;
}

interface InfographicFont {
  fontFamily: string;
  name?: string;
  baseUrl?: string;
  fontWeight: Record<string, string | undefined>;
}

interface InfographicModule {
  Infographic: new (options: Record<string, unknown>) => InfographicInstance;
  getFonts: () => InfographicFont[];
  registerFont: (font: InfographicFont) => unknown;
}

interface InfographicInstance {
  rendered: boolean;
  render: (syntax: string) => void;
  destroy: () => void;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
}

const props = defineProps<{ node: InfographicCodeNode }>();
const { t } = useI18n();

const containerRef = ref<HTMLElement>();
const errorMessage = ref<string>();
const rendering = ref(true);

let renderTimer: ReturnType<typeof setTimeout> | undefined;

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (Array.isArray(error)) return error.map(String).join('；');
  return String(error);
}

// 剥离会触发外部请求的图标/插图字段，保持离线渲染。
function sanitizeSyntax(syntax: string): string {
  return syntax
    .split('\n')
    .filter((line) => !/^\s*(icon|illus)\s+\S/.test(line))
    .join('\n');
}

// 清空已注册字体的远程地址，阻止渲染时向 CDN 注入 <link> 字体样式表。
// 注意：注册表中的 fontFamily 可能带引号，重新注册前需要还原，否则无法覆盖原条目。
function decodeFontFamily(name: string): string {
  const trimmed = name.trim();
  const quote = trimmed[0];
  if ((quote === '"' || quote === "'") && trimmed.endsWith(quote)) return trimmed.slice(1, -1);
  return trimmed;
}

function disableRemoteFonts(mod: InfographicModule): void {
  for (const font of mod.getFonts()) {
    mod.registerFont({
      ...font,
      fontFamily: decodeFontFamily(font.fontFamily),
      baseUrl: '',
      fontWeight: {},
    });
  }
}

function fitSvg(svg: SVGSVGElement): void {
  let width = Number.parseFloat(svg.getAttribute('width') ?? '');
  let height = Number.parseFloat(svg.getAttribute('height') ?? '');
  const viewBox = svg.viewBox?.baseVal;
  if ((!Number.isFinite(width) || !Number.isFinite(height)) && viewBox?.width && viewBox.height) {
    width = viewBox.width;
    height = viewBox.height;
  }
  if (!Number.isFinite(width) || width <= 0) width = 1200;
  if (!Number.isFinite(height) || height <= 0) height = 450;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', '100%');
  svg.removeAttribute('height');
  svg.style.height = 'auto';
  svg.style.display = 'block';
}

async function render(syntax: string): Promise<void> {
  const container = containerRef.value;
  if (!container) return;
  rendering.value = true;
  errorMessage.value = undefined;
  let offscreen: HTMLElement | undefined;
  try {
    const mod = (await import('@antv/infographic')) as unknown as InfographicModule;
    disableRemoteFonts(mod);
    // 在离屏容器渲染后再把 SVG 挂回可视区域，保证输出自包含且响应式。
    offscreen = document.createElement('div');
    offscreen.style.position = 'fixed';
    offscreen.style.left = '-10000px';
    offscreen.style.top = '0';
    offscreen.style.width = '1200px';
    document.body.appendChild(offscreen);
    const errors: string[] = [];
    const instance = new mod.Infographic({
      container: offscreen,
      width: 1200,
      editable: false,
    });
    instance.on('error', (error) => errors.push(toErrorMessage(error)));
    instance.render(sanitizeSyntax(syntax));
    const svg = offscreen.querySelector('svg');
    if (!instance.rendered || !svg) {
      throw new Error(errors.join('；') || t('components.infographic.invalidSyntax'));
    }
    // destroy 会把 SVG 从 DOM 摘除，先销毁实例再把 SVG 挂到可视容器。
    instance.destroy();
    offscreen.remove();
    offscreen = undefined;
    fitSvg(svg);
    container.replaceChildren(svg);
  } catch (error) {
    errorMessage.value = toErrorMessage(error);
    container.replaceChildren();
  } finally {
    offscreen?.remove();
    rendering.value = false;
  }
}

function scheduleRender(): void {
  if (renderTimer) clearTimeout(renderTimer);
  renderTimer = setTimeout(() => void render(props.node.value.trim()), 200);
}

watch(() => props.node.value, scheduleRender, { immediate: true });

onBeforeUnmount(() => {
  if (renderTimer) clearTimeout(renderTimer);
});
</script>

<template>
  <div class="infographic-preview" data-stream-markdown="infographic-preview">
    <div v-if="errorMessage" class="infographic-preview__error" role="alert">
      {{ t('components.infographic.failed', { error: errorMessage }) }}
    </div>
    <div v-else-if="rendering" class="infographic-preview__loading">
      {{ t('components.infographic.loading') }}
    </div>
    <div
      ref="containerRef"
      class="infographic-preview__canvas"
      :style="errorMessage ? 'display:none' : undefined"
    />
  </div>
</template>

<style scoped>
.infographic-preview {
  padding: 0.5rem;
}

.infographic-preview__canvas :deep(svg) {
  max-width: 100%;
}

.infographic-preview__loading,
.infographic-preview__error {
  padding: 1rem;
  font-size: 0.875rem;
  text-align: center;
}

.infographic-preview__loading {
  color: var(--muted-foreground, #64748b);
}

.infographic-preview__error {
  color: var(--destructive, #b91c1c);
  word-break: break-all;
}
</style>

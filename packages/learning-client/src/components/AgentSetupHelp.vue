<script setup lang="ts">
import { computed } from 'vue';
import { CollapsibleContent, CollapsibleRoot, CollapsibleTrigger } from 'reka-ui';
import { AGENT_SCOPES, type Scope } from '@drill-hub/contracts';
import { useLearning } from '../injection';
import { copyTextToClipboard } from '../utils';
import AppIcon from './AppIcon.vue';

defineProps<{ baseUrl: string }>();
const emit = defineEmits<{ createToken: [scopes: Scope[]] }>();
const learning = useLearning();
const deploymentBase = computed(() => learning.state.serverInfo?.publicBaseUrl ?? '');
const apiBase = computed(() => `${deploymentBase.value}/api/v1`);
const skillDownloadUrl = computed(() => `${deploymentBase.value}/downloads/drill-hub-skill.zip`);
const capabilityUrl = computed(() => `${apiBase.value}/agent/capabilities`);
const environmentExample = computed(() =>
  [
    `DRILL_HUB_SERVER_URL=${JSON.stringify(deploymentBase.value)}`,
    'DRILL_HUB_AGENT_TOKEN="<AGENT_TOKEN>"',
  ].join('\n'),
);
const requestExample = computed(
  () => `GET ${capabilityUrl.value}\nAuthorization: Bearer <AGENT_TOKEN>`,
);
const agentInstructions = computed(
  () => `请使用 Drill Hub 帮助我规划学习、创建学习内容和练习，并按需查看学习结果。

服务器公开地址：${deploymentBase.value}
API 根地址：${apiBase.value}
认证：Authorization: Bearer <AGENT_TOKEN>。从安全配置中的 DRILL_HUB_AGENT_TOKEN 环境变量读取实际令牌；不要向我索取密码，也不要在对话、日志或学习材料中回显令牌。

请先读取我从 ${skillDownloadUrl.value} 下载并解压的 drill-hub/SKILL.md 和 references/api.md，再调用 GET ${capabilityUrl.value} 确认令牌权限与支持能力。不要猜测未记录的接口。
按“主题 → 内容/题目 → 练习或考试 → 计划任务”的依赖顺序创建资源，使用响应中的真实 ID 与 revision；内容目前只支持纯文本。
内部模型题由服务端按 rubric 评分；只有 external_rubric 题且令牌具备 grade:write 时，才可提交逐项等级与原文证据，不能直接指定分数。
结果按需读取，不要高频轮询。修改冲突时先重新读取；创建请求结果不明时先核对，不要盲目重试。默认使用归档和恢复，不永久删除。`,
);
const scopeDescriptions: Record<Scope, string> = {
  read: '读取学习资源、作答结果、错题和评分状态；接入验证也需要此权限。',
  'content:write': '创建与调整主题、计划、内容、题目，以及更新错题掌握状态。',
  'assessment:write': '创建与调整练习、考试和组卷。',
  'grading:request': '重试失败的模型评分任务，或有原因地请求模型题重评。',
  'attempt:write': '有原因地作废本人作答，保留答案、评分和审计历史。',
  'grade:write': '仅对 external_rubric 题提交逐项等级与证据，不允许自由改分。',
  'archive:write': '归档与恢复学习资源；不提供永久删除能力。',
};

async function copy(text: string, label: string) {
  if (await copyTextToClipboard(text)) {
    learning.notify.success(`${label}已复制`);
  } else {
    learning.notify.error('无法访问剪贴板', '请手动选择并复制下方内容。');
  }
}
</script>

<template>
  <section
    v-if="learning.state.serverInfo"
    class="paper-panel agent-setup-help"
    aria-labelledby="agent-setup-title"
  >
    <div class="agent-setup-heading">
      <div>
        <h2 id="agent-setup-title"><AppIcon name="book" />Agent 配置帮助</h2>
        <p class="muted">通过 HTTP API 接入外部 Agent，让对话助手与学习工作台配合使用。</p>
      </div>
      <button
        class="button button--small"
        type="button"
        @click="copy(agentInstructions, 'Agent 接入说明')"
      >
        复制 Agent 接入说明
      </button>
    </div>

    <ol class="agent-setup-steps">
      <li>
        <strong>创建专用令牌</strong>
        <p>
          每个 Agent
          单独授权，按需选择权限与到期时间。创建后可在授权列表复制令牌并保存到受控配置中。
        </p>
      </li>
      <li>
        <strong>配置地址与认证</strong>
        <p>
          将下方服务器地址和令牌配置到 Agent
          的安全环境中。不要把它们填进模型供应商设置，也不要使用账号密码代替令牌。
        </p>
      </li>
      <li>
        <strong>加载 Skill，再验证连接</strong>
        <p>
          <a :href="skillDownloadUrl" download="drill-hub-skill.zip">下载 Drill Hub Skill（ZIP）</a
          >，解压后得到 <code>drill-hub/</code> 目录（含 <code>SKILL.md</code> 和
          <code>references/</code>），将整个目录放入 Agent 支持的 Skill 目录，再复制本页接入说明。
        </p>
        <p>
          下载地址：<code>{{ skillDownloadUrl }}</code>
        </p>
      </li>
    </ol>

    <dl class="agent-setup-addresses">
      <div>
        <dt>服务器公开地址</dt>
        <dd>
          <code>{{ deploymentBase }}</code>
        </dd>
      </div>
      <div>
        <dt>API 根地址</dt>
        <dd>
          <code>{{ apiBase }}</code>
        </dd>
      </div>
    </dl>
    <p class="field-hint">
      公开地址来源：{{
        learning.state.serverInfo.publicUrlSource === 'configured'
          ? '服务端 PUBLIC_URL 配置'
          : '当前请求'
      }}。本页仅用公开地址生成接入说明与下载链接，不改变当前 API 连接地址：
      <code>{{ baseUrl }}</code
      >。
    </p>
    <p v-if="learning.state.serverInfo.isLoopback" class="field-hint" role="status">
      当前公开地址是本机回环地址，云端 Agent 或其他设备无法通过它访问本服务器。请在服务端设置
      PUBLIC_URL 为 Agent 可访问的 HTTP/HTTPS 部署地址，并重启服务后刷新页面。
    </p>
    <p class="field-hint">
      云端 Agent 必须能够访问该服务器；它的 localhost / 127.0.0.1
      不是你的电脑。远程部署请使用可访问的 HTTP 或 HTTPS 地址。这是 HTTP API，不是模型端点或 MCP
      服务地址。
    </p>

    <div class="button-row agent-setup-presets">
      <button
        class="button button--small"
        type="button"
        @click="emit('createToken', ['read', 'content:write', 'assessment:write'])"
      >
        按学习规划权限新建令牌
      </button>
      <button class="button button--small" type="button" @click="emit('createToken', ['read'])">
        按只读权限新建令牌
      </button>
    </div>
    <p class="field-hint">
      学习规划建议：read + content:write + assessment:write。评分、重评与归档权限需要时再单独授予。
    </p>

    <CollapsibleRoot class="agent-setup-detail">
      <CollapsibleTrigger class="agent-setup-summary">配置示例与接入验证</CollapsibleTrigger>
      <CollapsibleContent>
        <p>
          以下是通用环境变量约定，不是任何特定 Agent 的原生配置文件格式。请按你使用的 Agent
          配置方式注入；本页不会保存这些环境变量。
        </p>
        <div class="agent-setup-code-heading">
          <h3>环境变量示例</h3>
          <button
            class="button button--small"
            type="button"
            @click="copy(environmentExample, '环境变量示例')"
          >
            复制环境变量示例
          </button>
        </div>
        <pre aria-label="环境变量示例"><code>{{ environmentExample }}</code></pre>
        <p>
          将 <code>&lt;AGENT_TOKEN&gt;</code> 替换为创建时显示的令牌，仅保存在密码管理器、Agent 的
          secret 配置或不提交版本控制的环境文件中。不要写入 Skill 正文或普通对话。
        </p>
        <div class="agent-setup-code-heading">
          <h3>只读验证请求</h3>
          <button
            class="button button--small"
            type="button"
            @click="copy(requestExample, '验证请求')"
          >
            复制验证请求
          </button>
        </div>
        <pre aria-label="验证请求示例"><code>{{ requestExample }}</code></pre>
        <p>
          让 Agent 发起此请求；成功响应包含
          <code>data.scopes</code>、支持题型和评分模式。此请求只读取能力，不会创建学习数据。
        </p>
        <ul>
          <li>401：检查令牌是否正确、到期或已撤销。</li>
          <li>403：检查是否授予 read 或当前操作所需的权限；不要绕过权限校验。</li>
          <li>无法连接：检查地址、域名、网络与反向代理；使用 HTTPS 时再检查证书。</li>
        </ul>
        <CollapsibleRoot class="agent-setup-prompt">
          <CollapsibleTrigger class="agent-setup-summary"
            >查看可复制的 Agent 接入说明</CollapsibleTrigger
          >
          <CollapsibleContent>
            <pre aria-label="Agent 接入说明"><code>{{ agentInstructions }}</code></pre>
          </CollapsibleContent>
        </CollapsibleRoot>
      </CollapsibleContent>
    </CollapsibleRoot>

    <CollapsibleRoot class="agent-setup-detail">
      <CollapsibleTrigger class="agent-setup-summary">各项权限与安全说明</CollapsibleTrigger>
      <CollapsibleContent>
        <dl class="agent-setup-scopes">
          <div v-for="scope in AGENT_SCOPES" :key="scope">
            <dt>
              <code>{{ scope }}</code>
            </dt>
            <dd>{{ scopeDescriptions[scope] }}</dd>
          </div>
        </dl>
        <p>
          令牌只能访问你的学习空间，不能管理其他账号或供应商模型。撤销后该 Agent 将不能继续使用
          API；如需更换凭据，请创建新令牌并更新 Agent 配置。
        </p>
      </CollapsibleContent>
    </CollapsibleRoot>
  </section>
</template>

<style scoped>
.agent-setup-help {
  padding: 24px;
  margin-bottom: 24px;
  min-width: 0;
}
.agent-setup-heading,
.agent-setup-code-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.agent-setup-heading h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 8px;
  font-size: 20px;
}
.agent-setup-heading p {
  margin: 0;
}
.agent-setup-steps {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 24px;
  padding-left: 22px;
  margin: 24px 0;
}
.agent-setup-steps li {
  padding-left: 4px;
}
.agent-setup-help p,
.agent-setup-help li {
  line-height: 1.7;
}
.agent-setup-steps p {
  margin: 6px 0 0;
  color: var(--ink-soft);
}
.agent-setup-help code {
  overflow-wrap: anywhere;
}
.agent-setup-addresses {
  margin: 0 0 10px;
}
.agent-setup-addresses > div,
.agent-setup-scopes > div {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr);
  gap: 12px;
  padding: 10px 0;
}
.agent-setup-help dt {
  font-weight: 600;
}
.agent-setup-help dd {
  margin: 0;
  min-width: 0;
}
.agent-setup-presets {
  margin-top: 18px;
}
.agent-setup-detail {
  border-top: 1px solid var(--line);
  padding-top: 16px;
  margin-top: 16px;
}
.agent-setup-summary {
  width: 100%;
  display: block;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ink);
  font-weight: 600;
  line-height: 1.7;
  text-align: left;
  cursor: pointer;
}
.agent-setup-summary:focus-visible {
  outline: 2px solid var(--teal);
  outline-offset: 4px;
  border-radius: 4px;
}
.agent-setup-code-heading {
  align-items: center;
  margin-top: 18px;
}
.agent-setup-code-heading h3 {
  margin: 0;
  font-size: 15px;
}
.agent-setup-help pre {
  padding: 16px;
  border-radius: 12px;
  background: var(--paper-muted);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-width: 100%;
  font-size: 13px;
  line-height: 1.8;
  user-select: text;
}
.agent-setup-prompt {
  margin: 18px 0;
}
@media (max-width: 760px) {
  .agent-setup-help {
    padding: 18px;
  }
  .agent-setup-heading,
  .agent-setup-code-heading {
    flex-direction: column;
    align-items: stretch;
  }
  .agent-setup-steps {
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
  }
  .agent-setup-addresses > div,
  .agent-setup-scopes > div {
    grid-template-columns: minmax(0, 1fr);
    gap: 4px;
  }
  .agent-setup-presets {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>

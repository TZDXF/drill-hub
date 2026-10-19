<script setup lang="ts">
import { computed, ref } from 'vue';
import { useLearning } from '../injection';
import { copyTextToClipboard } from '../utils';
import AppIcon from './AppIcon.vue';

const learning = useLearning();
const showInstructions = ref(false);
const deploymentBase = computed(() => learning.state.serverInfo?.publicBaseUrl ?? '');
const apiBase = computed(() => `${deploymentBase.value}/api/v1`);
const skillDownloadUrl = computed(() => `${deploymentBase.value}/downloads/drill-hub-skill.zip`);
const capabilityUrl = computed(() => `${apiBase.value}/agent/capabilities`);
const agentInstructions = computed(
  () => `请使用 Drill Hub 帮助我规划学习、创建学习内容和练习，并按需查看学习结果。

服务器公开地址：${deploymentBase.value}
API 根地址：${apiBase.value}
认证：Authorization: Bearer <AGENT_TOKEN>。从安全配置中的 DRILL_HUB_AGENT_TOKEN 环境变量读取实际令牌；不要向我索取密码，也不要在对话、日志或学习材料中回显令牌。

请先从 ${skillDownloadUrl.value} 下载并解压 Skill，读取 drill-hub/SKILL.md 和 references/api.md，再调用 GET ${capabilityUrl.value} 确认令牌权限与支持能力。不要猜测未记录的接口。
按“主题 → 内容/题目 → 练习或考试 → 计划任务”的依赖顺序创建资源，使用响应中的真实 ID 与 revision；内容目前只支持纯文本。
内部模型题由服务端按 rubric 评分；只有 external_rubric 题且令牌具备 grade:write 时，才可提交逐项等级与原文证据，不能直接指定分数。
结果按需读取，不要高频轮询。修改冲突时先重新读取；创建请求结果不明时先核对，不要盲目重试。默认使用归档和恢复，不永久删除。`,
);

async function copyInstructions() {
  if (await copyTextToClipboard(agentInstructions.value)) {
    learning.notify.success('Agent 接入说明已复制');
  } else {
    showInstructions.value = true;
    learning.notify.error('无法访问剪贴板', '请手动复制下方接入说明。');
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
        <h2 id="agent-setup-title"><AppIcon name="book" />Agent 接入</h2>
        <p class="muted">创建令牌并配置到 Agent 的安全环境，再将接入说明交给它。</p>
      </div>
      <button class="button button--small" type="button" @click="copyInstructions">
        复制 Agent 接入说明
      </button>
    </div>
    <p v-if="learning.state.serverInfo.isLoopback" class="field-hint" role="status">
      当前为本机地址，远程 Agent 需要可访问的服务器地址。
    </p>
    <textarea
      v-if="showInstructions"
      class="textarea"
      aria-label="Agent 接入说明"
      :value="agentInstructions"
      rows="8"
      readonly
    />
  </section>
</template>

<style scoped>
.agent-setup-help {
  display: grid;
  gap: 12px;
  margin-bottom: 20px;
  padding: 20px;
}
.agent-setup-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.agent-setup-heading h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 8px;
  font-size: 16px;
}
.agent-setup-heading p {
  margin: 0;
  font-size: 13px;
  line-height: 1.65;
}
.agent-setup-heading .button {
  flex-shrink: 0;
}
@media (max-width: 600px) {
  .agent-setup-heading {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>

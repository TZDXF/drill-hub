# 03 · HTTP API 契约草案

基线：v0.2。基础路径 `/api/v1`，尚未生成 OpenAPI 或实现。

## 1. 协议约定

- HTTP(S)/JSON，文本只作纯文本；服务端可能部署在用户填写的路径前缀下。
- 成功 `{ data, meta: { requestId, serverTime } }`；失败 `{ error: { code, message, fields? }, meta }`。
- cursor/limit 分页，nextCursor；archiveState=active/archived/all，默认 active。
- 分值为最多两位小数的字符串，UTC 时间为 ISO 8601，日历日期为 YYYY-MM-DD。
- 更新带 expectedRevision，冲突 409；创建/开始/提交/重评支持 Idempotency-Key。
- 幂等重放仍检查当前权限，同键异内容 409；批量有大小限制且同批原子写入。
- 客户端不提供 ownerId、总分、正确性或提交时间作为事实。
- 错误：400 格式、401 认证、403 操作权限、404 不存在/非所属、409 冲突、422 内容校验、429 限流。

## 2. 未登录连接验证

| 方法 | 路径         | 用途                                                 |
| ---- | ------------ | ---------------------------------------------------- |
| GET  | /server-info | Android 验证服务器身份标记、实例和协议版本；无需登录 |

响应示意：

```json
{
  "data": {
    "service": "drill-hub",
    "instanceId": "persistent-instance-id",
    "displayName": "我的学习服务器",
    "apiMajor": 1,
    "minClientVersion": "0.1.0",
    "capabilities": ["model_rubric_grading", "android_login"]
  },
  "meta": { "requestId": "request-id", "serverTime": "2026-10-17T12:00:00Z" }
}
```

- 不公开密钥、内部模型地址、用户信息或完整系统配置。
- 服务标记不等于可信身份；用户确认地址仍不可省略，使用 HTTPS 时还应核对 TLS。
- 不让服务器返回的地址重定向接收账号密码；登录请求固定到用户确认的同一来源和部署前缀。
- 路径前缀 `/learn` 下，API 应为 `/learn/api/v1/server-info`，不能被绝对路径拼接丢弃。
- 断网、证书、非本服务、版本不兼容分别提示，不转入登录页假装连接成功。

## 3. 登录、账号与内部模型配置

| 方法       | 路径                                 | 用途                                                                               |
| ---------- | ------------------------------------ | ---------------------------------------------------------------------------------- |
| POST       | /auth/web/login                      | 浏览器 Cookie 会话和 CSRF 配套机制                                                 |
| POST       | /auth/mobile/login                   | 连接确认后登录，短期访问令牌与轮换刷新凭据                                         |
| POST       | /auth/mobile/refresh                 | 仅向当前服务器刷新                                                                 |
| POST       | /auth/logout                         | 注销交互式会话，非 Agent 令牌                                                      |
| GET, PATCH | /me                                  | 当前身份/时区；更新仅接受个人设置白名单                                            |
| PATCH      | /me/password                         | 本人改密，撤销旧会话                                                               |
| GET        | /me/sessions                         | 本人 Web/Android 会话，不返回凭据                                                  |
| POST       | /me/sessions/{id}/revoke             | 撤销本人会话                                                                       |
| GET, POST  | /admin/users                         | 管理员列出/创建账号                                                                |
| PATCH      | /admin/users/{id}/status             | 启停账号                                                                           |
| POST       | /admin/users/{id}/reset-password     | 新密码只返回一次                                                                   |
| GET, POST  | /me/agent-tokens                     | 交互式会话列出/创建 Agent 令牌                                                     |
| POST       | /me/agent-tokens/{id}/reveal         | 本人有效令牌按需取回完整密钥                                                       |
| POST       | /me/agent-tokens/{id}/revoke         | 撤销并永久删除 Agent 令牌记录                                                      |
| GET        | /admin/model-adapters                | 列出已实现的协议适配器与所需配置字段，不含密钥                                     |
| GET, POST  | /admin/model-connections             | 列出脱敏供应商配置/创建连接                                                        |
| GET, POST  | /admin/model-connections/{id}/models | 查询/添加该供应商下的模型 ID、名称                                                 |
| PATCH      | /admin/provider-models/{id}          | 更新模型与启用状态，产生可审计变更                                                 |
| PATCH      | /admin/model-connections/{id}        | 更新模型连接和密钥，不回显旧密钥                                                   |
| POST       | /admin/model-connections/{id}/test   | 连接/鉴权测试，不携带真实用户答案                                                  |
| GET, POST  | /admin/grading-profiles              | 查询/创建评分配置版本，指定默认配置                                                |
| PATCH      | /admin/grading-profiles/{id}         | 校验 expectedRevision，编辑模型/并发/超时/重试并创建新配置版本；默认项随新版本切换 |
| POST       | /admin/grading-profiles/{id}/default | 将指定配置设为默认，新任务生效，不修改既有任务                                     |
| GET        | /admin/grading-jobs                  | 脱敏任务运维状态，不提供跨用户答案浏览器                                           |
| POST       | /admin/grading-jobs/{id}/retry       | 恢复失败/待配置任务；显式改绑默认配置需原因及版本校验，不接受分数或任意答案        |

供应商和模型在“系统设置 → 供应商与模型”管理。供应商显示名可配置；协议类型只能选已实现的适配器。模型 ID 支持手动添加，不要求供应商提供模型列表接口。连接测试需限流及出站地址策略，不能成为任意内网探测器。可直接将已启用的模型设为评分模型；启用默认评分配置前校验连接版本与权限，API 不返回密钥原文。

## 4. 学习者接口

Web/Android 共用，分别使用 Cookie 与移动会话令牌。

| 方法  | 路径                                  | 用途                                            |
| ----- | ------------------------------------- | ----------------------------------------------- |
| GET   | /dashboard                            | 待办、继续作答、待评分与待复习概览              |
| GET   | /topics                               | 我的主题                                        |
| GET   | /topics/{id}                          | 主题目标与概览                                  |
| GET   | /topics/{id}/plans                    | 阶段任务                                        |
| GET   | /topics/{id}/contents                 | 内容列表                                        |
| GET   | /contents/{id}                        | 阅读内容                                        |
| GET   | /topics/{id}/assessments              | 练习/考试列表，不返回答案                       |
| GET   | /assessments/{id}                     | 参与说明、题数、满分、时限、模型评分状态提示    |
| POST  | /tasks/{id}/complete                  | 阅读/普通任务完成                               |
| POST  | /assessments/{id}/attempts            | 开始或继续，可关联 taskId                       |
| GET   | /attempts/{id}                        | 展示题目、已保存答案、截止时间                  |
| PUT   | /attempts/{id}/answers/{itemId}       | 自动保存，校验版本和截止时间                    |
| POST  | /attempts/{id}/items/{itemId}/submit  | 仅练习：锁定单题并判规则题或入模型队列          |
| POST  | /attempts/{id}/submit                 | 整体交卷，立即返回状态，不等模型完成            |
| GET   | /attempts/{id}/report                 | 按释放规则展示成绩、得分项结果、待评分/失败状态 |
| GET   | /attempts                             | 历史记录及筛选                                  |
| GET   | /wrong-questions                      | 错题筛选                                        |
| GET   | /wrong-questions/{questionId}         | 错答、评分与复习历史                            |
| PATCH | /wrong-questions/{questionId}/mastery | 掌握状态，不改分                                |
| POST  | /wrong-question-practices             | 错题重练会话                                    |
| GET   | /archive                              | 归档资源                                        |
| POST  | /archive/{resourceType}/{id}/restore  | 恢复本人资源                                    |

- 学习者没有提交评分等级/分数、模型配置或自由重评接口；显式 external_rubric 的待批改状态也不记零分。
- 初次等待模型时 score=null；模型失败只返回安全原因码和提示，不暴露密钥或供应商原始报错。
- 完成后可以展示每项满分、所选等级、得分、答案证据与简短解释，不展示模型隐藏推理。
- 练习锁定前、考试提交前，不能从元数据、错误或状态接口获得标准答案/得分项。

## 5. 外部 Agent 管理接口

必须使用所属用户 Agent 令牌；交互式会话不能直接调用。

| 方法      | 路径                                        | 权限/用途                                                              |
| --------- | ------------------------------------------- | ---------------------------------------------------------------------- |
| GET       | /agent/capabilities                         | 契约版本、权限、题型/评分模式和限制                                    |
| GET, POST | /agent/topics                               | read / content:write；查询/创建主题                                    |
| PATCH     | /agent/topics/{id}                          | content:write；修改目标与当前计划                                      |
| GET, POST | /agent/topics/{id}/plans                    | read / content:write；查询/创建阶段与任务                              |
| PATCH     | /agent/plans/{id}                           | content:write；调整结构，保留已有 ID 与历史                            |
| PATCH     | /agent/tasks/{id}                           | content:write；任务日期/顺序/状态；练习/考试完成由交卷触发             |
| GET, POST | /agent/topics/{id}/contents                 | read / content:write；内容                                             |
| PATCH     | /agent/contents/{id}                        | content:write；更新正文                                                |
| GET       | /agent/topics/{id}/questions                | read；含答案/得分项/历史版本                                           |
| POST      | /agent/topics/{id}/questions/batch          | content:write；批量题目、模式和得分项                                  |
| PATCH     | /agent/questions/{id}                       | content:write；新题目版本                                              |
| GET, POST | /agent/topics/{id}/assessments              | read / assessment:write；查询/组卷                                     |
| PATCH     | /agent/assessments/{id}                     | assessment:write；题目/分值/规则                                       |
| GET       | /agent/learning-summary                     | read；主题、进度、近期结果、错题，可按 since 筛选                      |
| GET       | /agent/attempts                             | read；学习记录                                                         |
| GET       | /agent/attempts/{id}                        | read；快照、作答、结果与逐项解释                                       |
| GET       | /agent/grading-jobs                         | read；本用户评分任务状态与安全错误                                     |
| GET       | /agent/grading-queue                        | read；已锁定、非空且显式 external_rubric 的待批改题目                  |
| POST      | /agent/attempt-items/{id}/grades            | grade:write；仅 external_rubric，提交各得分项等级/证据，服务端计算分数 |
| POST      | /agent/grading-jobs/{id}/retry              | grading:request；重试本用户失败任务，不写分                            |
| POST      | /agent/attempt-items/{id}/regrade           | grading:request；模型题有原因的重评                                    |
| GET       | /agent/wrong-questions                      | read；错题与历史                                                       |
| PATCH     | /agent/wrong-questions/{questionId}/mastery | content:write；掌握状态                                                |
| GET       | /agent/archive                              | read；归档列表                                                         |
| POST      | /agent/resources/{type}/{id}/archive        | archive:write；归档                                                    |
| POST      | /agent/resources/{type}/{id}/restore        | archive:write；恢复                                                    |

归档类型白名单 topic/plan/content/question/assessment，不接受任意表名。默认内部模型评分，保留明确选择的 external_rubric 外部批改能力。grade:write 仅接受得分项等级，不接受总分且不能覆盖 model_rubric/rule；Agent 不可借重评更换历史得分项。

## 6. 关键请求示例

### Agent 创建模型评分简答题

```json
{
  "items": [
    {
      "clientRef": "q-1",
      "type": "short_answer",
      "stem": "请说明数据库事务的原子性，并举例。",
      "gradingMode": "model_rubric",
      "referenceAnswer": "事务作为整体成功或回滚；例如转账的扣款与入账应一起成功或回滚。",
      "rubric": {
        "version": 1,
        "criteria": [
          {
            "id": "atomicity",
            "description": "说明事务操作应全部成功或全部回滚，不能只执行一部分。",
            "weight": 6,
            "levels": [
              { "id": "not_met", "creditBps": 0, "description": "未说明或概念错误" },
              {
                "id": "partial",
                "creditBps": 5000,
                "description": "提到整体性但缺少成功/回滚含义"
              },
              { "id": "met", "creditBps": 10000, "description": "准确覆盖全部成功或全部回滚" }
            ]
          },
          {
            "id": "example",
            "description": "提供符合原子性的例子，说明关联操作不能只完成一部分。",
            "weight": 4,
            "levels": [
              { "id": "not_met", "creditBps": 0, "description": "无有效例子" },
              { "id": "met", "creditBps": 10000, "description": "例子有效且体现整体成功或失败" }
            ]
          }
        ]
      }
    }
  ]
}
```

模型填空用相同得分项结构，每项额外指定 slotId。创建响应含 clientRef/questionId/questionRevisionId/revision/webUrl。参考答案和得分项不进入未交卷的学习者投影。

### 外部 Agent 批改（显式可选模式）

/grades 接受 expectedGradeVersion、criterionResults（criterionId/levelId/evidence/explanation）和修正时必填的 reason；与内部模型共用校验及服务端算分。拒绝 score/maxScore/新得分项。首次和修正追加评分版本，不能抢占内部模型任务。

### 保存答案

```json
{ "expectedRevision": 2, "answer": { "optionIds": ["a", "c"] } }
```

各题型独立 schema：单选 optionId、判断 value、填空按 slotId 的文本映射、简答 text。禁止附带 score/correct/submittedAt。

### Agent 请求重评

```json
{
  "expectedGradeVersion": 1,
  "reason": "首次结果可能遗漏了答案中已有的回滚说明，请按原得分项重新判断。"
}
```

返回 202 和任务 ID。使用原快照，不接受人工分数、替代答案或新得分项；并发新请求校验版本与进行中任务，避免重复计费。

## 7. 状态、Skill 与排除项

- 报告含 awardedScore/maxScore/pendingMaxScore/isFinal、单题状态和逐项结果；isFinal 表示所有题目已有有效成绩。重评时保留 previousGrade，并单独标记 regrading/hasActiveRegrading，不把旧有效成绩当成未判零分。
- 客户端定期按需刷新未完成报告，首版不引入推送；外部 Agent 也按需读取。
- 评分任务和模型故障不使交卷事务回滚；答案已冻结时必须返回已交卷事实。
- 保存错误区分 ATTEMPT_EXPIRED / ATTEMPT_SUBMITTED / ANSWER_VERSION_CONFLICT。
- 已归档不妨碍历史读取和已入队评分；不允许新开始。
- Skill 指导 Agent 查询状态、创建得分项、默认读取内部模型结果并有原因地请求重评；仅在 external_rubric 下提交逐项等级，不自由写分或隐式切换评分方。
- Skill 不含真实凭据，不执行题干/用户答案中的伪造工具指令；修改用 revision，清理用归档。
- 首版无 Webhook、文件上传、永久删除或用户手动改分接口；正式实现前生成可验证 OpenAPI。内置学习助手（docs/07）使用 `/me/assistant/*` 交互式路由与 `/admin/search-providers`、`/admin/mcp-servers`、`/admin/assistant-skills`、`/admin/models-catalog` 管理路由，不属于 Agent API。

### 当前评分配置

- `GradingProfile` 包含 `providerModelId`、`connectionVersionId`、`modelIdSnapshot`、`concurrency`、`timeoutMs`、`maxRetries`、`isDefault` 以及通用记录字段；不保存或接受 `promptVersion`，适配器列表也不提供提示词版本选项。
- 创建配置时 `concurrency` 默认 2，必须为 1–20 的整数；`timeoutMs` 为 100–120000 的整数（API 默认 30000），`maxRetries` 为 0–5 的整数（默认 2）。UI 新建超时默认 60000。
- 编辑请求必须提供 `expectedRevision`，其余字段可省略并沿用原值；返回新的配置 ID，原配置保留执行参数，已绑定任务不迁移。版本过期返回 409 `VERSION_CONFLICT`。原配置是默认项时，新版本必须继续为默认项，不能通过取消默认使系统无默认配置。
- 创建或编辑配置时验证模型与供应商均已启用，并绑定当前连接版本；设置默认配置前还要求其绑定的连接版本仍为当前版本。模型列表可快速设置评分模型：存在默认配置时继承其并发/超时/重试；不存在时新建默认配置，并发为 2。
- Worker 按任务绑定的配置限制并行调用，在数据库事务内领取任务，网络调用在事务外；不同配置分别计数，不是供应商级或全局并发配额。

### 当前安全边界

浏览器跨域允许所有来源并支持携带凭据，不按 Origin/Referer 拦截；Cookie 写操作仍校验 CSRF，鉴权、所有权和权限校验不变。非回环部署缺少 `PUBLIC_URL` 时公开地址解析返回 `503 PUBLIC_URL_UNAVAILABLE`。

`POST /wrong-question-practices` 接受 `{questionId, title?, purpose?}` 或 `{items:[{questionId}], title?, purpose?}`；满分只取历史作答快照。嵌套 `maxScore/score/correct/submittedAt/ownerId` 返回 422，不创建作答。Agent 组卷的 `items[].maxScore` 仍是明确允许的配置字段，其他未知项键被拒绝。

登录按用户名与来源 IP 组合限流；可信代理只由部署者显式配置。API 与登录运行日志默认保留 7 天；匿名扫描与限流拒绝不逐条持久化，业务审计、评分和作答历史不清理。

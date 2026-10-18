# 02 · 数据模型与状态机

基线：v0.2。逻辑模型建议，尚未生成实体或迁移。

## 1. 通用约定

- 业务表包含 owner_id，关联写入验证归属相同；管理员模型配置属于独立管理域。
- 对外不透明 ID，安全不依赖 ID 不可猜；可变对象有 revision，可归档对象有 archived_at/archived_by。
- UTC 时间用带时区 ISO 8601；日历日期与时区分开，用户默认 Asia/Shanghai。
- 题目版本、作答快照、模型判断与评分历史追加保存，不原地覆盖。
- 金额式最小单位仅用于精确存分：整数 score_minor，对外十进制字符串，不用浮点累加。
- 数据库迁移管理表结构；统计为可重建投影，不替代事实记录。

## 2. 账号、连接与模型配置

| 实体/存储                 | 核心字段与约束                                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| server_settings           | instance_id（持久保留）、API 兼容版本、default_grading_profile_version_id；默认评分配置可为空                                |
| users                     | username 唯一、password_hash、role、status、timezone；不强制首次登录改密                                                     |
| auth_sessions             | user_id、channel、凭据摘要、轮换关联、过期与撤销、设备信息                                                                   |
| agent_tokens              | owner_id、token_hash、prefix、name、scopes、expires_at、last_used_at                                                         |
| model_connections         | 管理域；供应商显示名、current_version_id、status、revision                                                                   |
| model_connection_versions | 不可变连接版本；connection_id、version_no、受支持的协议标识、base_url、密钥版本引用、created_at                              |
| provider_models           | connection_id、model_key、显示名、enabled、已验证能力、验证所用配置版本、revision；同连接内 model_key 唯一                   |
| grading_profile_versions  | 不可变评分配置；connection_version_id、provider_model_id、model_id_snapshot、提示词版本、超时/重试/并发/用量限制、created_at |
| Android 本地连接配置      | 规范化服务地址、instanceId、展示名称、兼容版本；不放密码或令牌                                                               |
| Android 受保护凭据        | 以服务地址 + instanceId + userId 为命名空间的刷新凭据                                                                        |
| Android 临时草稿          | 相同命名空间 + attemptId + itemId，与上传状态隔离                                                                            |

模型密钥原文不进入配置快照；连接版本保留受保护的密钥版本引用。评分任务绑定不可变连接/模型/提示词版本，修改默认项不影响既有任务与历史成绩。停用供应商不再发起新调用，未执行任务标记待配置；恢复或改绑当前默认配置必须显式操作并审计，不自动换模型。配置连接/模型测试结果关联版本，连接地址、协议、凭据或模型改变后重新验证。

## 3. 学习组织

| 实体          | 主要字段                                                                                              |
| ------------- | ----------------------------------------------------------------------------------------------------- |
| topics        | owner_id、title、goal_text、current_plan_id、archived_at、revision                                    |
| plans         | owner_id、topic_id、title、start_date、target_date、timezone、archived_at、revision                   |
| plan_phases   | owner_id、plan_id、title、sort_order                                                                  |
| tasks         | owner_id、phase_id、kind、target_id、日期/预计用时、status、completed_at、completion_source、revision |
| task_attempts | owner_id、task_id、attempt_id、linked_at                                                              |
| contents      | owner_id、topic_id、title、body_text、archived_at、revision                                           |

- 主题有多个历史计划，通过 current_plan_id 指向一个未归档计划或为空。
- 任务 kind=reading/practice/exam/manual，关联目标须同主题、同用户。
- 状态 todo/in_progress/completed，Agent 可有记录地重开。
- 阅读任务在从学习计划打开对应内容并成功加载后自动完成，只更新来源任务；普通任务由用户标记完成；练习/考试提交时完成，不等待模型评分。

## 4. 题目、版本与得分项

| 实体                 | 主要字段                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| questions            | owner_id、topic_id、type、current_revision_id、archived_at、revision                                                                                          |
| question_revisions   | owner_id、question_id、version_no、stem_text、options_json、slots_json、grading_mode、grading_key_json、rubric_json、explanation_text、created_by、created_at |
| tags / question_tags | 所属用户/主题、名称及唯一关联                                                                                                                                 |

题型结构：

| type            | 答案 / 模式                                                                                |
| --------------- | ------------------------------------------------------------------------------------------ |
| single_choice   | options [{id,text}]，key {optionId}，仅 rule                                               |
| multiple_choice | options [{id,text}]，key {optionIds}，仅 rule                                              |
| true_false      | key {value:boolean}，仅 rule                                                               |
| fill_blank      | slots [{id}]，key {acceptedAnswers:{slotId:[text]}}；rule / model_rubric / external_rubric |
| short_answer    | 参考答案 + rubric；默认 model_rubric，可显式 external_rubric                               |

rubric_json 包含标准版本与 criteria：

- criterionId：稳定 ID；description：判断标准；weight：正整数权重。
- levels：唯一 levelId、整数 creditBps（0..10000）与该等级描述，必须包含零分和满分等级。
- slotId：模型填空必填，必须指向本题已定义空位；简答无需此字段。
- 得分项、参考答案与评分模式属于不可变题目版本，修改产生新版本。
- 模型/外部批改模式缺失得分项或含非法等级时拒绝入库；模式固定，规则匹配失败不自动切模型，模型失败不自动切外部。
- 对每个非空答案，模型或外部 Agent 仅选择已有等级，不能提交任意权重、分值或总分。

## 5. 练习集、试卷与快照

| 实体             | 主要字段                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| assessments      | owner_id、topic_id、kind（practice/exam）、title、duration_seconds、archived_at、revision                                                         |
| assessment_items | owner_id、assessment_id、question_revision_id、sort_order、max_score_minor                                                                        |
| attempts         | owner_id、assessment_id、kind、source、assessment_snapshot、started_at、expires_at、submitted_at、submission_reason、status、revision             |
| attempt_items    | owner_id、attempt_id、question_id、question_revision_id、presentation_snapshot、grading_snapshot、max_score_minor、sort_order、grading_generation |
| responses        | owner_id、attempt_item_id、answer_json、revision、saved_at、locked_at                                                                             |

- 组卷显式指定题目版本，新题目版本不自动替换既有组卷；调整试卷递增 revision。
- 开始时冻结题目、答案、得分项、每项分值、时间和试卷配置；不会在评分时读取最新题目。
- 得分项整数分值由权重按本题满分分配，算法见 05，合计恰好为本题满分。
- presentation_snapshot 不含答案/得分项，grading_snapshot 只用于服务端与获授权 Agent。
- 同用户同练习/试卷同一时间只保留一个进行中会话；重复开始返回已有会话。
- 错题重练是新会话，用当前题目版本；归档题需恢复后才可新练。

## 6. 持久评分任务与结果

| 实体              | 主要字段                                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| grading_jobs      | owner_id、attempt_item_id、generation、input_hash、profile_version_id、prompt_version、status、attempt_count、next_run_at、lease_expires_at、last_error_code、created_at  |
| model_evaluations | owner_id、job_id、answer_snapshot_hash、rubric_snapshot_hash、实际 provider/model/config 版本、validated_result_json、输入/输出用量、延迟、created_at                     |
| grading_records   | owner_id、attempt_item_id、version_no、source（rule/model/external_agent）、job_id、evaluation_id、score_minor、criterion_results_json、feedback_text、reason、created_at |

评分任务状态：

```text
queued → running → succeeded
            └─ 暂时失败 → retry_wait → running
            └─ 重试耗尽 → failed
blocked_config / blocked_budget → 显式恢复或预算可用 → queued
```

- 提交事务同时锁定答案、执行规则判分、写入模型任务与审计，随后立即返回。
- 非空模型题锁定后才入队；考试必须先整体交卷，练习可单题锁定后入队。external_rubric 锁定后进入外部待批改查询，不创建模型任务。
- 全空答案直接由规则记零分；模型填空的空白空位对应项强制零分。
- Worker 用持久租约领取，模型请求在数据库事务外执行；崩溃后租约到期可恢复。
- 同一 generation 的重试只生成一个有效评分；旧 generation 的返回不能覆盖后续重评。
- 入库前校验 criterionId/levelId 完整性与证据，再由服务端计算 criterion_results_json 和总分。
- 只有成功评分才影响最终分数和错题投影；失败不是零分。
- 模型原始响应默认不持久保存，保留校验后的结果与脱敏错误；需要排错时另行定义受控保留策略。

## 7. 会话与重评状态

```text
in_progress ──交卷/到期──> pending_grading ──全部判完──> completed
      └─────全部可规则判分──────────────────────────> completed
```

- 评分任务失败时会话仍 pending_grading，报告带失败数与原因码，不误标完成。
- 展示的 gradingStatus 从单题任务汇总，不将失败/待配置误计为已判。
- 提交冻结答案，不接收客户端总分、正确性或提交时间。
- 空白答案在正式提交时记零分，非空待评分题 score=null。
- 练习未整体提交前可有单题已评分，会话仍 in_progress。
- 外部 Agent 可对已评分的模型题请求重评，必须 reason + expectedGradeVersion。
- 重评创建新 generation，沿用原答案/题目/得分项快照，记录新的实际模型配置版本。
- 重评期间会话保持 completed，保留上一有效成绩并独立标明重评中；成功后追加记录并原子更新报告/错题，失败不抹去旧分。
- 首次评分失败的重试复用 generation，不伪装成一次已经完成的评分。
- 首版无外部自由写分与历史规则题重判接口。external_rubric 可用 grade:write 提交既定得分项等级；首次与修正均校验版本，修正须原因并追加历史，不允许覆盖模型模式题目。

## 8. 错题、审计与幂等

| 实体                | 主要字段                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| wrong_questions     | owner_id、question_id、mastery_status、first_wrong_at、last_wrong_at、last_practiced_at、revision；用户+题目唯一 |
| review_events       | owner_id、question_id、attempt_id、状态前后值、来源、created_at                                                  |
| audit_logs          | owner_id/管理域、actor_type、actor_id、action、资源、request_id、脱敏摘要                                        |
| idempotency_records | actor_id、method、route、key、request_hash、response_reference、expires_at                                       |

- 完整错误答案来自作答与评分历史，错题表只是聚合。
- 新错误重开待复习；正确重练不自动删除或标记掌握。
- 重评若修正了错误，按最新有效评分重建错误来源；无有效错误时保留历史并从当前待复习列表移除，不删除事实。
- 审计区分外部 Agent 操作与模型 Worker 操作，不伪造用户人工改分。
- 幂等重放仍需当前鉴权；日志不复制真实凭据或完整用户答案。

## 9. 索引与一致性门槛

- 用户名、令牌摘要、会话失效状态；资源 owner_id + topic_id + archived_at。
- 任务计划/状态/日期；题目版本唯一；试卷顺序；每会话单题答案唯一。
- attempts 的 owner_id/status、status/expires_at。
- grading_jobs 的 status/next_run_at/lease_expires_at；attempt_item_id + generation 唯一。
- grading_records 的单题/版本唯一，model_evaluations 对 job 的有效结果去重。
- 错题用户/掌握状态；幂等键作用域唯一。
- 必测：跨用户关联、并发保存、重复交卷、超时竞态、Worker 崩溃恢复、旧模型响应写回、同项重复计分。

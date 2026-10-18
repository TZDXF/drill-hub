# Agent 令牌管理（交互式用户会话）

[返回 API 索引](api.md)。本页不是 Agent 可调用的路由，不要使用 Agent 令牌请求。

这些路由使用交互式用户会话，不是 Agent 令牌：

```http
POST /api/v1/me/agent-tokens
```

请求：

```json
{
  "name": "外部学习 Agent",
  "scopes": ["read", "content:write", "assessment:write"],
  "expiresAt": "2030-01-01T00:00:00Z"
}
```

- `name`：非空，最多 100 字符。
- `scopes`：从 `read`、`content:write`、`assessment:write`、`attempt:write`、`grading:request`、`grade:write`、`archive:write` 中选至少一个且不能重复。
- `attempt:write` 仅允许作废所属用户的作答，不授权代答、交卷、改分、将学习作答改为测试或删除记录。作废需最新 `expectedRevision` 和非空、最多 4000 字符的 `reason`，答案、评分历史与审计仍保留；按需授予，不要因为需要创建链接就一并索要此权限。
- `assessment:write` 允许创建临时答题链接；链接默认是正式学习用途，不是天然无副作用的测试。链接是敏感访问凭证，持有人作答会影响令牌所属用户的数据。正式/测试和作废的影响见[副作用表](resources/results.md#副作用表)。
- `expiresAt`：可省略或为 `null`；若提供，必须是未来时间。
- Web 登录会话还需当前 CSRF 头。
- 创建响应包含明文 `token`；列表响应不会返回明文或服务端密文。

```http
PATCH /api/v1/me/agent-tokens/{id}
```

请求：

```json
{
  "expectedRevision": 1,
  "scopes": ["read", "content:write"]
}
```

- 仅令牌所属的交互式用户会话可编辑，管理员也不能修改他人的令牌；Agent 令牌不能调用此接口。
- 仅接受 `scopes` 和 `expectedRevision`；权限规则与创建一致，至少一项、不能重复或包含未知权限。无效字段或版本格式返回 422。
- `scopes` 整体替换原权限；保存后原密钥的新增/移除权限立即生效，无需重新配置密钥。名称、密钥和到期时间不变；修改过期令牌的权限不会恢复其有效性。
- `expectedRevision` 使用列表返回的当前 `revision`；并发变更返回 409 `VERSION_CONFLICT`，需刷新后重新确认。Agent 最近使用时间更新也可能使版本变化。
- 不存在、已撤销或不属于当前用户的令牌返回 404。
- 成功返回更新后的令牌视图（含新 `revision`），不包含明文、密文或密钥哈希；权限变更与安全审计在同一事务中保存，审计仅记录变更前后权限，不保存密钥。

```http
POST /api/v1/me/agent-tokens/{id}/reveal
```

- 仅令牌所属的交互式用户会话可读取；其他账号同样返回 404。
- 已撤销的令牌记录已删除，读取返回 404；过期令牌返回 409，不能继续复制。
- 成功响应的 `data.token` 是完整 Agent 令牌；服务端以加密形式保存，并且只应交给受控 Agent 配置。

```http
POST /api/v1/me/agent-tokens/{id}/revoke
```

撤销会永久删除令牌记录（含密文、哈希和权限），不保留已撤销令牌历史；列表不再返回该令牌。成功响应为 `data: { revoked: true }`。原令牌立即无法访问 Agent 路由（401），复制或再次撤销返回 404。安全审计保留操作事件，不保存令牌密钥。修改/重置密码或停用账号也会删除该账号的所有 Agent 令牌。

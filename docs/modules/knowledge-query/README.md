# 知识查询适配层

状态：已实现。目标是让小说、正文、工具消费者只依赖稳定查询协议；知识处理核心可独立修改入库、排序和模型包格式。

依赖方向：消费模块 → 本合同 → KnowledgeQueryService → 窄 KnowledgeReader → 知识核心。只有组合根装配具体实现。查询层不持有数据库端口、管理命令、审批方法或模型适配器。没有把内部 RAG trace 当成 API 响应返回。

包入口：`dsh-writing-workbench/knowledge-query/contracts`。Remote：`writingKnowledgeQuery.invoke`，通过 `writingMiddleware.request('knowledge-query', ...)`，仅宿主 owner 可调用。`knowledge-query` 没有独立数据端口。将来接正文 LLM 时必须由受信宿主绑定 project/sources，不能把任意 owner 查询入口原样授予模型。

## 请求 knowledge-query-v1

```json
{
  "schemaVersion": "knowledge-query-v1",
  "action": "answer",
  "pluginInstanceId": "实际实例ID",
  "projectId": "实际项目ID",
  "operationId": "新的UUID",
  "question": "借火术可以凭空生火吗？",
  "sources": [],
  "limit": 5,
  "maxCharacters": 12000
}
```

- action：retrieve 仅返回材料，answer 检索后调用模型。
- sources：空列表取当前项目全部已确认 active 资料；非空必须为同项目的完整 **知识文档 manifest VersionRef**，不是 URL 或原文 ref。
- VersionRef 全字段：pluginInstanceId、projectId、artifactId、versionId、kind、schemaVersion、contentHash、revision。
- question 最多 600 UTF-16 单元；limit 1–20；maxCharacters 1000–40000。
- 未知字段、跨实例/项目、重复来源、失效资料、预算越界直接失败。浏览器不是权限判定者。
- answer 使用 operationId 持久幂等；重复相同请求取已完成结果，但仍复核来源撤销。不以 ID 相同跳过版本验证。
- 查询运行策略为 enriched + JSON，与独立回测结果隔离。精确来源子集可正常查询，旧回测配置不再导致 PROFILE_STALE；历史配置产物仍保留。

## 响应 knowledge-response-v1

```text
schemaVersion
status: retrieved | answered | insufficient | conflict
answer: string | null
statements: [{text, citations: [{evidenceId, quote}]}]
evidence: [{id, title, text, source: VersionRef,
            locator: {format, start, endExclusive, spanHash}}]
missing: string[]
warnings: string[]
provenance: {corpusDigest, sourceVersions: VersionRef[], trace: VersionRef | null}
```

证据为原文；字节定位采用 utf8-byte-span-v1。sourceVersions 是本次冻结的知识文档版本；evidence.source 是可精确回读的 source_text 版本；两者语义不同。trace 是私有回执的定位，不附带其内容。

响应不包含内部相似度分数、原始模型 Prompt、模型回执、数据库路径或 SQL。引用结构有效不等于语义完全正确，业务必须保留该区别。正文的世界规则依赖、人物章前状态、用途授权和正式发布需要上层业务另行检查；本合同不会把知识参考自动变成正式故事事实。

## 变更原则

排序策略、分片、模型输入格式在核心内部迭代；此处的用途、状态和来源语义变化必须升级合同。管理 UI 使用 writingKnowledge，业务消费者使用 writingKnowledgeQuery，两者不能互相替代。

核心架构和运行限制见[知识核心文档](../knowledge-core/README.md)，模型输入格式与回测指标在对应独立文档维护，本文件不复制内部实现。

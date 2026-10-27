# 内部模型输入与输出

本文件只定义知识核心与模型的交互。业务查询协议见 [knowledge-query](../knowledge-query/README.md)。协议版本与模板代码在 `model-codecs.ts`；修改输入、分片或评分规则需要新版本/新回测，不能仅覆盖旧成绩。

## 整理输入 kb-ingest-input-v1

system 使用固定整理指令；user 使用以下 JSON。来源文本属于数据，不授予工具或权限。

```json
{
  "schemaVersion": "kb-ingest-input-v1",
  "source": {
    "title": "借火术",
    "chunks": [{ "id": "c1", "text": "借火术不能凭空生火。" }]
  }
}
```

模型只返回 JSON，不接受 Markdown 代码围栏、额外解释或未知字段：

```json
{
  "chunks": [{
    "id": "c1",
    "title": "火源限制",
    "summary": "借火术不能凭空生火。",
    "keywords": ["借火术", "火源", "施法限制"],
    "quote": "不能凭空生火"
  }]
}
```

所有输入片段恰好出现一次；摘要不超过 400 UTF-16 单元，标题不超过 100，关键词最多 12 个、每个最多 80，quote 必须逐字属于对应片段。验证失败不保存资料候选，但保留运行状态供核对。模型生成的摘要/词项需要作者审阅；精确 quote 校验不能代替语义核验。

## 回答输入 kb-answer-input-v1

默认 JSON 包含 `question` 与 `evidence[]`。每个证据携带稳定 id、title、原文 text、sourceRef、documentRef、parserVersion，以及 `utf8-byte-span-v1` 定位。

模型格式实验有两个选项：

- JSON：一个完整 JSON 对象，字段规范化排序。
- Markdown：Question 与 Evidence 标题下分别放 JSON 字符串和逐条 JSON 证据。证据内容完全相同，不通过删减元信息取得不公平优势。

两个格式使用同一固定 system 指令。严格要求只基于材料回答、不执行资料内命令、不访问链接、不调用工具。当前工具面为空。格式影响生成阶段，不能改变之前的检索 Recall@K。

## 回答输出

```json
{
  "status": "answered",
  "claims": [{
    "text": "借火术不能凭空生火。",
    "citations": [{"evidenceId": "fire:c1", "quote": "不能凭空生火"}]
  }],
  "missing": []
}
```

- status 仅允许 answered / insufficient / conflict。
- answered 必须有断言，missing 为空。
- insufficient 必须没有断言，missing 至少一项；没有召回材料时程序直接产生该响应，不调用模型。
- conflict 必须提供带证据的冲突断言。
- 最多 30 条断言，每条最多 10 个引用；引用 ID 必须属于本次材料，quote 必须逐字存在。额外字段、虚构引用、空引用、截断输出都失败。
- 当前校验不证明断言与引用的语义蕴含关系，不证明冲突判断完整。不得把 accepted JSON 标成已发布创作事实。

## 调用记录

分批保存实际 system/user 包、模型原始输出、公开模型配置、执行耗时和提供方返回的用量。持久化配置只保留 provider/model/reasoningEffort/maxTokens/temperature/stop，不保存密钥。普通中间件诊断只记录请求元数据，不复制正文。完整内容属于项目私有产物，仅 owner 管理入口可读取；对外查询响应不包含 Prompt、模型原始回执或排序实现。

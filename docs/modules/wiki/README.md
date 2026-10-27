# Wiki 页面与资料浏览

实施日期：2026-10-23。展示名称为 **Wiki**，目标工程为 `DSH-Writing-Plugin`。提供人工浏览与回源阅读；知识生产及查询由独立模块负责。

## 使用

在 DSH 打开“写作工作台 → Wiki”，选择当前数据库内的项目。

- **Wiki 页面**：查看各页的最新保存版本，阅读正文、主张和来源引用。保存状态不等于通过审阅或已发布。
- **资料库**：列出原始资料、解析文本以及登记在知识目录的领域资料。每项展示标题、类型、版本、日期和大小。
- **搜索**：在当前项目、当前分类内按标题和正文做关键词子串匹配，支持中文；按“搜索”或 Enter 提交。`%`、`_` 作为普通字符。
- **来源引用**：精确读取页面指定的历史版本；字节定位引用展示原文摘录，点击从引用位置打开原文。来源链可继续返回原件与导入清单。
- **失效资料**：默认从列表/搜索排除已撤回、否决或替代的版本，勾选后可追溯。引用不会被悄悄换成新版本；失效、历史和目录状态未核验均明确显示。

数据库未配置、未连接宿主、没有项目、项目为空、无搜索结果、读取失败分别显示不同状态。打开页面不会初始化数据库、导入材料或生成 Wiki 内容。当前项目实际空库仍为空。

## 合同与边界

流程：Client → DSH API Gateway / `writingWiki` → `writingMiddleware` → `WikiReader` → 中间件只读数据端口 → 内部存储查询。Wiki 不直接调用 `writingStorage` 或数据库。只允许宿主所有者调用。包级 Host register 与 Client mount 统一组合数据库配置和 Wiki 描述符，避免同包重复注册。

RPC 只有 `overview`、`browse`、`read`：

| 操作 | 输入 | 输出与完成条件 |
| --- | --- | --- |
| overview | AbortSignal | 当前库就绪状态、实例 ID、项目列表；不暴露配置路径 |
| browse | 实例、项目、分类、关键词、offset、includeInactive | 最新保存版本列表与总数，每页 30 条；实例变化/项目消失拒绝 |
| read | 实例、项目、完整 VersionRef、offset | 已核验完整内容摘要的正文/元信息/引用；引用逐项失败可见，不伪造摘录 |

请求拒绝多余字段、跨项目/实例引用、错误摘要和无效分页。分页、搜索和读取无写入副作用，无自动重试或需要幂等身份的业务命令。Client 请求超时 15 秒；切换项目、查询、断连和卸载撤销旧请求并丢弃迟到结果。返回上页也重新读取精确版本，以检查新撤回决定。数据库配置保存后的实例/路径变化会清空并刷新 Wiki。

新增快照端口 `browseKnowledge` / `describeKnowledge` 位于共享存储合同。生命周期结束后均不可使用。SQL、连接和文件路径不跨存储边界。当前共享数据库为 schema v6；Wiki 复用 001–004，历史迁移未修改。

## 规范 Wiki 页面

生产方通过 knowledge 仓储保存 `kind: 'wiki_page'`、`schemaVersion: 'wiki-page-v1'`、`payload: { format: 'json', value: document }`。合同及解析器从 `dsh-writing-workbench/wiki/contracts` 导入。文档字段为：

```typescript
{
  title, summary, markdown,
  claims: [{ id, statement, namespace, factStatus, supportBundleIds }],
  supportBundles: [{ id, supports: [{ sourceRef, role, locator?, parserVersion? }] }],
  sourceRefs: [/* 完整 VersionRef */],
  links: [{ label, targetRef }],
  policyVersion, compilerProfileVersion, coverage, conflicts
}
```

`role` 为 `supports` / `contradicts`，namespace/factStatus 沿用知识合同。`sourceRefs` 和 supports 的每个引用必须同时登记为页面不可变 `sources` 依赖，否则显示“引用无法验证”。页面 JSON 是正文与引用的权威；不从 `wiki_claim_projection` 或支持边投影拼装一份正文。

可定位引用使用 `utf8-byte-span-v1` 的 `start/endExclusive/spanHash`，仅指向 `source_text`。对应 `parserVersion` 和定位必须已通过 `putKnowledgeSpan` 登记。读取时复核精确版本、完整内容 SHA-256、字节范围、UTF-8 边界、分片 SHA-256 和依赖；显示摘录后，将位置转换为 UI 的 UTF-16 阅读游标。页面中的 namespace/claim 状态保持原样展示，不授予事实资格。

不带定位的引用可打开完整版本，JSON 原始资料以 JSON 文本阅读。二进制原件展示已保存状态并通过来源链读取解析文本；本轮不提供 PDF/EPUB 解析器或下载端点。

原始 text/JSON 每次最多 32,768 个 UTF-16 单元，不截断代理对，可继续阅读至末尾。Wiki 文档上限 2 MB、Markdown 1,000,000 字符、主张 200 条、来源和支持引用各 100 条、单个摘录 32 KiB。超限/未知 schema/不完整内容显示明确提示，保留原版本。

## 搜索与状态语义

当前采用数据库内的参数化 `instr/lower` 文字匹配，直接读取当前权威 payload，不依赖未完成的 FTS 代次。SQLite lower 仅保证 ASCII 大小写折叠；中文以原文子串匹配。不做分词、模糊、向量、语义检索，不宣称开放知识召回完整。

范围为 `knowledge_source` / `source_text`、目录中登记的领域资料、`wiki_page`，每个 artifact 只枚举最大 revision，未设 head 的已保存材料也可见。历史版通过精确引用读取。原始二进制只能按资料标题检索；尚未解析的二进制内容不参与全文匹配。

领域决定读取 `artifact_decisions` 最新追加行；与目录的 revoked/superseded 一并保守排除。目录游标必须非零且等于当前对应领域最大事件游标，才显示一致；否则标为待复核。此人工阅读入口不是 Writer、context 或正式发布的资格门禁。

本轮未实现 Wiki 编译、独立语义审阅、原子 release、增量索引、跨域即时失效传播、角色/章节过滤、导入 UI 或 OpenClaw 导入器。大规模语料的扫描耗时尚未基准测试；同步 SQLite 查询期间不能立即抢占取消，Client 会丢弃失效回复。后续检索服务应补全索引覆盖与冻结上下文门禁。

## 验证与交接

根目录 `tests/` 仅留本地，不随 Git 分发。以下业务回归需要具备本地测试文件；公开 `npm test` 仅构建并运行独立回测自检。

实际依赖与文档基线均为 DSH `0.2.1-rc.2`，Cordis `4.0.5`，Loader `1.0.6`；沿用配置页已核对的 SDK 与 Desktop 编译产物证据。此次额外核对 registry 的同包贡献唯一约束，并验证两模块合并注册。未扩大兼容范围。

验证源：`tests/wiki-reader.test.mjs`、`wiki-controller.test.mjs`、`wiki-gateway.test.mjs`、`wiki-renderer.test.mjs`，浏览器脚本 `scripts/check-wiki-ui.mjs`。记录保存在本地诊断目录。

| 责任/交接 | 正常与异常验收 | 状态 |
| --- | --- | --- |
| 存储维护者：项目 → 列表 | 最新版、分页、中文、失效过滤、不写数据；异库/异项目/无项目拒绝 | 已验证 |
| Wiki 维护者：页面 → 引用 | 精确历史原文、导入凭据、字节定位；篡改摘要/错误解析器/缺失依赖/跨项目引用单项报错 | 已验证 |
| Client 维护者：请求 → 状态 | 项目/查询/阅读切换丢弃旧回复，断连/超时/卸载清理；错误不伪装为空集合 | 已验证 |
| Host 维护者：挂载 → 卸载 | 真实 DSH Gateway 与 Client mount、严格输入、所有者权限、组合注册、服务撤销 | 已验证 |
| 工作台维护者：导航 → 阅读 | 黑白灰界面、来源返回、项目切换、桌面及 375px 无横向溢出 | 已验证 |
| 发布维护者：本机完整 Desktop 进程 | 安装包进入实际用户 profile，重启后访问真实业务资料 | 未执行 |
| 检索维护者：大库搜索性能 | 用代表性数据测延时与阻塞，再选择完整索引策略 | 未执行 |

本地 `?demo=wiki` 使用经真实只读服务从临时数据库生成的合成数据，明确显示演示标记，不连接用户数据库。可运行 `node scripts/create-wiki-preview.mjs` 重建演示。`?page=wiki` 保持未连接宿主状态。

## 知识生产与查询的独立模块

2026-10-27 新增[知识核心](../knowledge-core/README.md)：可以从文本经 LLM 生成带精确原文引用的 Wiki 候选，经作者确认后用于 RAG。WikiReader 仍保持只读浏览职责，不承载整理、问答或回测；消费者使用[独立知识查询合同](../knowledge-query/README.md)。上文未实现项描述原 Wiki 阅读模块，新增核心的实际能力与限制以其文档为准。

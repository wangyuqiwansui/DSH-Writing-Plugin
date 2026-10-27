# 渐进发现存储基础

日期：2026-10-24。目标：DSH-Writing-Plugin 0.1.2，DSH SDK 0.2.1-rc.2。本文说明已实现的上下文存储范围。

## 已实现

通过共享 writingStorage 的 repositoryFor('context', projectId) 与 openSnapshot 接入；新增 writing-context-storage-v1 合同和 006_context.sql。既有 knowledge owner、Wiki、质量表保持不变，历史迁移未修改。

- createContextRun 在同一短事务冻结指定领域 head 前缀的完整版本目录和当时决定，保存完整 manifest；不保持跨模型调用的数据库事务。
- getContextRun/contextMembers/readContextSource 可在重新打开连接后回读；冻结源保持旧内容，最新撤销或拒绝阻断继续读取。
- contextFreshness 检查指定目录的新条目、消失、head/版本和决定变更。当前保守地把整个选中目录变化标为过期，尚不执行语义级“无关变更排除”。
- claimContextRun 使用预期 revision、worker、租约和单调 fence。修改操作校验当前租约，事件与修订原子保存；旧 worker 不能写入。
- recordContextRound 保存不可变输入包引用和来源，验证包内 run/snapshot/sourceRefs 与真实 artifact_dependencies 相符。
- reserve/dispatch/markUnknown/settleContextCall 保留逻辑调用、参数、预留和实际 token；相同命令可幂等重放；unknown 预留不释放，未结算前不派下一次调用。
- 回执 metadata 必须包含 contextRunId/contextCallId；模型回执使用 execution_receipt，读取回执使用 context_read_receipt。超估实际用量仍入账，后续派发按已用额度阻断。
- recordContextEvidence 保存带来源依赖的只读回执定位。contextEvents 形成连续序列。既有 command 事务中被捕获的错误仍使整体回滚。

## 使用顺序

1. 统一 db:init 升级到 v6；插件加载和页面打开仅检查，不建库。
2. 受信 context 服务用领域策略生成 scope 和 sourceHeadPrefixes，调用 createContextRun。前缀必须在 story/planning/writer/publication/knowledge 下，maxMembers 显式给出，最大 10000。
3. claimContextRun 获取 worker/fence 和 revision；所有修改后使用返回的新 revision。now/lease 参数由宿主受信时钟提供，不能交给模型决定。
4. appendArtifact 保存 context_packet，其 JSON 包含 runId、snapshotRef、sourceRefs 和实际消息；登记 round，并通过状态转换进入 deciding。
5. 预留并持久记录逻辑调用后才能派发。外层 execution 或检索服务生成精确回执，context 负责核对和结算。
6. 发现结果是独立 discovery_result 产物；由业务服务完成必需覆盖及语义检查后登记 ready。存储 ready 只检验状态、未结算调用和来源新鲜度，不替代业务门禁。

存储方法必须在同步快照/命令回调内调用；不能让返回的 port 跨 await 继续使用。完整 payload 使用既有 artifact_versions，七张新表保存专用投影，数据库中一个 plugin_instances 单例限定实例，所有关联均包含 project。

## 明确未实现的部分

这是面向受信领域服务的内部存储端口，不可直接暴露给 LLM。scope 暂作不可变任务元数据，章前知情范围、主张级时点投影、模型工具授权、required obligation 充分性、证据 locator 的语义完整性由后续 context/story 服务实现。选中目录可有空集合，空集合是否适用仍由业务合同判断。

本轮没有实现模型循环、原生工具消息、检索策略、新建 Wiki、角色时间线或将小说会话内存自动迁移进库；没有升级用户日常数据库。现有 knowledge_source_catalog 不接受 context 作为业务事实来源，这是有意保留的隔离。

## 验证

根目录 `tests/` 仅留本地，不随 Git 分发。以下业务回归需要具备本地测试文件；公开 `npm test` 仅构建并运行独立回测自检。

测试：tests/context-storage.test.mjs 覆盖快照/并发/隔离/预算/取消/幂等/输入依赖；tests/test_context_migration.py 覆盖 v5 保留升级、备份、失败回滚与再次升级。

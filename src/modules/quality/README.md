# 质量检测模块

模块入口为 `dsh-writing-workbench/quality`，Cordis 名称为 `writing-quality`。主工作台默认装配，也可通过独立配置行启停。

- `contracts.ts`：L0/L1 规则、目标、报告、证据、分页和严格 Remote 契约。
- `storage-contracts.ts`：实例/项目范围的只读快照与质量专属事务端口。
- `detectors.ts`：原始内容检查、精确文本规则和语义返回证据验证。
- `service.ts`：版本冻结、单次检测、命令幂等、取消、报告和生命周期管理。
- `host.ts`：运行时 Config、必需存储依赖、可选统一模型入口与所有者授权。
- `client/`：正文检测入口、L0/L1 层级卡片与编号规则列表、请求取消/旧响应隔离、规则编辑、本次结果与原文定位。没有历史报告或污染观察页面。

SQL 位于 `src/infrastructure/storage/quality-store.ts`；通过共享 `writingStorage` 打开短事务，不自建数据库连接，不关闭共享 provider。未接入工作流节点或自动修复。

新检测只接受 `chapter_body`，新规则只接受正文或通用范围，页面保存为正文范围。旧记录保留；历史读取契约用于兼容已有数据，以及按操作标识只读核对本次检测，不自动重新调用模型。纯大纲规则在分页前排除，仍有生效正文版本的旧规则可继续维护。

完整用法与验证边界见 [质量检测实施说明](../../../docs/modules/quality/README.md)。

数据库由 [统一初始化命令与模块清单](../../../docs/modules/database/initialization.md) 管理，不提供质量检测专用建库步骤。

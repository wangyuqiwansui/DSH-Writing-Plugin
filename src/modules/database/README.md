# 数据库模块

目录标识：`database`。2026-10-23：数据库基础与配置页面已实现，保存通过 DSH ConfigEditor 写入当前 profile。

- `contracts/index.ts`：无运行依赖的配置类型。
- `contracts/management.ts`：配置页面输入输出、严格 Remote 入参和共享 descriptor。
- `client`：配置页面、草稿与请求状态、DSH Remote 适配。
- `host/config.ts`：Cordis Standard Schema 配置验证。
- `host/index.ts`：注册 `ctx.writingStorage`，绑定卸载清理；不自动建库或迁移。
- `host/management.ts` / `host/remote.ts`：只读检查、锁内保存、owner 权限和生命周期适配。
- `src/infrastructure/storage`：连接、短事务、精确版本、owner 仓储、来源映射与分片验证。
- `storage/migrations`：统一编号的 001–005 迁移。
- `scripts/local_db.py`：显式初始化、检查、备份和恢复实现；统一初始化入口 `npm run db:init -- --db "<绝对路径>"`。

模块不承担小说、世界观、Wiki 审阅或正文准入规则。目录和索引属于派生数据，消费端必须通过后续领域接口再次检查资格。

完整使用方法、边界和验收见 [数据库实施说明](../../../docs/modules/database/README.md) 与 [配置页面](../../../docs/modules/database/configuration-page.md)。

需要初始化的模块与后续接入规则见 [统一初始化清单](../../../docs/modules/database/initialization.md)。

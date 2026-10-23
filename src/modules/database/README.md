# 数据库配置模块

目录标识：`database`。状态：目录占位，尚无运行实现。

负责全局数据库配置、连接检查、配置应用与存储管理入口。存储引擎、事务和迁移执行归属 `src/infrastructure/storage`；DSH profile 的配置适配归属 `src/infrastructure/configuration`。

计划子目录：`host/`、`client/`、`contracts/`、`application/`。按实际开发创建，不在本目录保存真实数据库或凭据。

全局入口无需先选择小说；模块不承担世界观、作者人格和小说的业务规则。

目录基线见 [目录结构规划](../../../目录结构规划.md)。功能和技术细节后续归档到 `docs/modules/database/`。

# 世界观模块

目录标识：`worldbuilding`。状态：已接入五类可选模板、统一存储、版本发布和精确版本材料查询。

负责世界观资料及其身份、版本和业务规则。对外提供资料选择与精确版本读取；小说通过引用使用世界观，不能直接写其私有仓储。

实现目录：`host/`、`client/`、`contracts/`、`application/`、`domain/`。通过 `writingMiddleware` 的受限数据端口复用不可变产物与回执，没有模块私有仓储或额外建库脚本。

工作台保留 `world` 导航标识以兼容既有入口，内部模块标识为 `worldbuilding`。

领域内容、可选分类、v3 规范格式与 v1/v2 导入、历史目录清理、材料查询、校验发布及已知边界见 [世界观实施说明](../../../docs/modules/worldbuilding/README.md)。

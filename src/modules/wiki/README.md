# Wiki 模块

只读浏览当前数据库中的资料与 Wiki 页面。展示名称统一为 **Wiki**。

- `contracts/index.ts`：`wiki-page-v1` 规范 JSON、只读请求与响应、严格 RPC 描述符。通过 `dsh-writing-workbench/wiki/contracts` 导出。
- `host/service.ts`：项目内列表、精确内容读取、引用定位与来源验证；只调用 `WritingStorage` 公开端口。
- `host/remote.ts`：宿主所有者授权、DSH `writingWiki` Remote 服务。根插件统一注册包的 Host contribution。
- `client/controller.ts`：查询、阅读、项目切换、返回与取消；丢弃过期回复，卸载时清理。
- `client/WikiPage.tsx` / `Markdown.tsx`：黑白灰阅读界面、安全的基础 Markdown 渲染，无可执行 HTML 或自动远程图片加载。

固定 SQL 留在 `infrastructure/storage/knowledge-browser.ts`，未公开连接或通用 SQL 接口。数据库配置、写入/发布、导入器、模型编译不由本模块承担。

完整合同、验收和范围见 [Wiki 实施说明](../../../docs/modules/wiki/README.md)。

数据库由 [统一初始化命令与模块清单](../../../docs/modules/database/initialization.md) 管理，不提供 Wiki 专用建库步骤。

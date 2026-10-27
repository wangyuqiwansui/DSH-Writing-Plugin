# 对话模块

`contracts.ts` 声明流式远程协议；`service.ts` 管理一次生成的生命周期；`host.ts` 适配 DSH 模型服务；`client/` 管理独立会话状态与右上角浮动 UI。

不依赖小说/世界观内部状态，不新增数据库。根插件组合服务，根工作台提供 UI 挂载点。详见 [实施说明](../../../docs/modules/chat/README.md)。

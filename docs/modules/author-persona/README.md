# 作者人格模块

日期：2026-10-26。工程：`DSH-Writing-Plugin`，包 `dsh-writing-workbench@0.1.2`，目标宿主 DSH `0.2.1-rc.2`。

本模块管理作者的表达约定与不可变版本。它拥有独立的领域服务、数据端口和工作台页面；小说只接收公开的精确版本投影。当前统一使用一份 Prompt 模板，编辑、导入、发布及小说交付复用公开契约中的校验器，不把人工配置标为 OpenClaw 已审核或已实测的人格。

## 使用流程

1. 通过工作台“数据库”连接已初始化的共享数据库。新库或旧库只通过根目录 `npm run db:init -- --db "<本机绝对路径>"` 显式初始化或升级。
2. 打开“作者人格”，新建或导入 JSON / UTF-8 `.txt`、`.md`。JSON 仅接受本模块导出的文档结构；导入建立新草稿，不继承原 ID、发布确认或资质。
3. 在“作者人格 Prompt”填写同一模板：依次保留 `## 叙事立场`、`## 语言风格`、`## 叙事节奏`、`## 对话习惯`、`## 表达边界`。每段必须有具体要求，缺段、重复、错序、空段、未替换占位内容及未闭合代码块均阻止发布。未完成模板可保存草稿。取消原来的简版 500 / 完整版 12,000 字符双重规则，仅保留统一的 50,000 Unicode 码点输入安全上限；导入/保存不截断原文。
4. 保存草稿，再勾选确认并发布当前精确版本。修改后须重新保存、重新确认。历史版本只读；“返回本地编辑”保留未保存输入，“另存为新人格”生成独立草稿。
5. 点击“加入小说资产”，在小说资产配置中明确选择绑定。新发布版本不会替换已有绑定。小说当前仍为会话内存，刷新前须导出小说；人格原库及历史版本持久保存。

界面维持黑白灰风格，支持桌面与窄面板。当前人格文档可随时导出 JSON；未保存编辑只在当前工作台控制器生命周期内保留，浏览器刷新/卸载前请导出。

## 发布与资质

`draft → published` 产生新的不可变版本。发布表示作者确认“这一份人工表达配置”，不代表文学效果、来源真实性或风格相似度已经验证。所有版本固定记录 `sourceReview: not_run`、`literaryTrial: not_run`，不提供导入 `passed` 的入口。

只有已发布精确版本可生成 `PersonaProjection`。新投影只含表达文本、文本摘要、名称、模板 ID、来源版本及表达用途，带 `purpose: writing_style`、`authority: expression_only`。备注和说明不会被拼进交付文本。它不授予模型执行工具、修改世界事实或绕过剧情规则的权限。

新文档为 `writing-author-persona-v2`，模板为 `author-persona-prompt-v1`。旧 `writing-author-persona-v1` 版本、摘要和小说绑定原样保留，无数据库迁移。打开旧简版时将字段转成模板草稿；打开旧完整文本时保留原文，手工补齐模板后才能重新发布。历史视图及已发布旧投影仍按原版本只读使用。导入不继承发布确认。该模板不包含来源审阅和项目激活协议。

## 服务与存储

- 模块公开类型：`dsh-writing-workbench/author-persona/contracts`。
- Host 组合入口：`dsh-writing-workbench/author-persona`；根工作台默认装配。设根配置 `authorPersona: false` 可停用；启用配置为 `{}`，不支持额外参数。
- 内部服务：`ctx.writingAuthorPersona.invoke(request, signal?)`；消费者声明 `inject = ['writingAuthorPersona']` 并依赖公开类型。
- Remote：`writingAuthorPersonaRemote.invoke(request, signal?)`，由根工作台统一注册 Typert 描述符；调用必须是宿主 owner。内部调用走 `writingMiddleware.task`，远程调用先走 `request`。
- 连接握手：`overview.apiVersion` 必须为 `writing-author-persona-api-v2` 才允许保存。客户端挂载 Remote 描述符本身不能证明 Host 已加载服务。
- 数据：`writingMiddleware.data('author-persona')`，限制 `story` owner、`writing-author-persona-library` 项目。无 SQL、文件连接或其他项目访问权；同进程插件仍不是安全沙箱。
- 复用 schema v6 的公共 001/002 产物、head、决议、命令回执和 outbox，无新表/迁移。首次成功保存才创建资料库项目，加载和只读查询不建库、不迁移。

公开请求包括 `overview`、`read`、`history`、`command`、`receipt`、`projection`。`projection` 必须提供实际数据库实例、人格 ID 与具体 revision；不支持 `latest` 隐式绑定。公共 `VersionRef` 保留插件实例、项目、版本 ID、revision、schema 和完整产物摘要。

## 失败与恢复

保存/发布带 `expectedRevision` 与 `operationId`。同一操作和同一输入可幂等重放；复用操作 ID 携带不同输入被拒绝；并发修改返回冲突并保留本地草稿。所有状态、版本、确认、事件与回执在一次事务中提交。

请求超过 15 秒或连接中断时保留原命令，界面阻止继续编辑和发起新命令，提供“核对提交结果”。先查原回执；不存在时只用原命令重放。取消不等于回滚已提交结果。换库时不能对新库重试旧命令；返回原库核对。普通旧库草稿可导出或显式另存为新人格。

发布阻断包含名称缺失、模板不完整、未先保存和未确认；草稿允许缺少业务必填项，但结构、类型、大小、标识、非法 Unicode 及未知字段仍严格校验。导入文件上限 256 KB，Prompt 统一输入上限 50,000 码点。

如果出现 `/api/writingAuthorPersonaRemote/invoke: HTTP 404`、服务缺失或接口版本不一致，先导出未保存的工作，再完全退出并重新启动 DSH，回到本页点击“重新连接”。本地链接重新构建后，客户端资源可能已更新而 Host 仍运行旧代码，单独刷新页面不能让旧 Host 获得新服务。仍失败时检查实际 profile 是否链接到本工程、根配置是否启用作者人格，以及 Host 激活日志；不要为此重新建库。断线、版本不一致与 404 均保留本地草稿并阻止保存。

## 验证与边界

根目录 `tests/` 仅留本地，不随 Git 分发。以下业务回归需要具备本地测试文件；公开 `npm test` 仅构建并运行独立回测自检。

执行入口：`npm run test:local`；模块定向入口：构建后 `node --test tests/author-persona.test.mjs tests/middleware.test.mjs`。已覆盖统一模板、旧版本兼容、持久化、并发、取消、超时、回执、404、协议不一致、卸载/恢复和小说交接，并执行真实 SDK/Gateway 与安装宿主的隔离 Host + Web。

原生 Desktop 和真实模型需要独立验收，不能用隔离测试代替。自动提炼、证据包、能力候选、选择器/独立校验、写作实测、按章激活 epoch 及正式 Writer 集成属于后续规划。

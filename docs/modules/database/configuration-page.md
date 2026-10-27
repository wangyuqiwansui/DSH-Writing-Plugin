# 数据库配置页面

日期：2026-10-23。入口：写作工作台侧栏底部的 **数据库**。本页属于全局配置，无需先选择作品。界面沿用工作台的黑白灰作者编辑风格。

## 使用

1. 填写运行 DSH 的电脑上的本机绝对文件路径，包含数据库文件名。
2. 点击“测试连接”。检查通过后，点击“保存并应用”。
3. 页面回读宿主配置，确认当前路径已生效后显示成功。配置写入当前 DSH profile 的 `cordis.patch.yml`，重启后保留。

首次安装未配置路径。请先显式初始化自己的数据库，再在本页面检查和保存路径；页面不会自动选择、创建或迁移数据库。

“当前连接”展示已保存路径、结构版本、文件大小、作品数量、实例身份。状态来自最近一次检查；“刷新当前状态”重新读取，未保存的输入仍保留。测试另一条路径不会改变当前连接，切换工作台页面也不会丢失输入。

文件不存在或结构版本不匹配时，检查结果提供可复制的初始化/升级命令。命令需要用户在终端显式执行，执行后回到页面重新检查并保存。升级流程继承现有管理脚本的自动备份和完整性检查。页面本次未增加一键迁移、备份或恢复操作。

## 接口与生命周期

初始化/升级指引统一生成 `npm --prefix '<插件目录>' run db:init -- --db '<绝对路径>'`，覆盖 [模块清单](initialization.md) 中全部已接入迁移。页面只展示命令，不自行执行。

| 边界 | 实现与完成条件 |
| --- | --- |
| 页面→客户端状态 | `DatabaseController` 保留草稿、检查结果与当前配置；请求完成前保留忙碌状态；旧请求返回不能覆盖新输入 |
| 客户端→宿主 | DSH `ctx.remote.$mount()` 挂载同一份 `databaseRemote` descriptor；只公开 `read`、`inspect`、`save`，输入具有严格 codec |
| 宿主→文件检查 | 只读打开已有文件，复用迁移摘要和真实 DDL 验证，读取固定元数据并检查文件及父目录的写权限；不暴露 SQL 或任意执行接口 |
| 宿主→配置保存 | `ConfigEditor.edit()` 仅操作装配本服务的主插件 entry；在锁内比较配置 revision 并复查目标库，再持久化与重新加载 |
| 配置→存储切换 | 普通配置按 Cordis 生命周期重建插件，旧 `writingStorage` 失效，后续消费者使用新服务 |
| 完成→页面回读 | 保存返回后再读取已应用路径与就绪状态；回读未确认不显示保存成功 |

Host 通过可选 `typert` 子插件挂载 Remote 服务，无 Typert 的存储组合仍可运行；缺少 ConfigEditor 或 entry 不归当前 profile 所有时，页面提供检查并明确显示只读。Client 依赖 DSH API Gateway，缺失服务不会使工作台外框消失。Remote 方法额外检查调用方是宿主所有者，访客即使获得通用 gateway 许可也不能读取文件路径或修改配置。

本项目手工维护一份共享的公开 `InvocationDescriptor` 契约及输入 codec，不声称运行过 Typert 自动代码生成器。客户端只导入纯合同与类型，浏览器产物不包含 SQLite、Node 文件系统或 Python 执行代码。

配置 revision 基于完整原始配置的摘要。外部变更触发冲突；高优先级 home/CLI overlay 导致配置保存被 ConfigEditor 拒绝，不擅自修改覆盖层。保存失败后读取最新配置，保留输入并要求重新检查；没有自动重复写入。请求超时为 15 秒，断线/卸载会取消等待并丢弃迟到结果。取消不能撤回已经开始的配置写入，因此结果不确定时提示刷新核对。

检查通过表示当次结构检查与访问检查通过，不是持续持有连接、完整内容校验或未来写入保证。文件随后被移动、权限变化或实例替换仍会由存储操作重新检查。完整字节与外键校验继续使用离线 `check`。

## 已验证和未验证

- 真实 rc.2 Gateway、Client Remote mount、ConfigEditor、App Boot 和 Cordis Loader：保存、回读、旧服务卸载、profile 重启恢复、配置冲突、覆盖层拒绝、严格入参拒绝、非 owner 拒绝、卸载后句柄失效。
- 控制器：迟到检查、未保存输入、必须先检查、保存后回读、失败不重试、断线/卸载和超时后的迟到结果。
- 独立浏览器：1440px 桌面与 375px 窄屏无横向溢出；键盘焦点、缺文件指导、只读、失败提示、导航保留草稿。浏览器使用显式标记的模拟数据；真实持久化由临时 profile 集成测试验证。
- 用户正在运行的 Desktop 进程、实际 profile 安装升级、非 Windows 文件权限行为：本轮未验收。未修改用户 DSH profile 或现有数据库内容。

默认 `npm run preview` 显示未连接宿主的真实空态。附加 `?demo=database` 可查看独立 UI 演示；`&state=unconfigured`、`&state=readonly` 为专用验收场景。所有模拟后端仅位于 `scripts/database-preview.ts`，不进入插件包。演示页面顶部始终标明不会保存到 DSH。

验收脚本：`scripts/check-database-ui.mjs`，需先启动预览并提供 Playwright；可通过 `PREVIEW_URL`、`PLAYWRIGHT_MODULE`（已有 Playwright 的绝对 ESM 路径）和 `CHROMIUM_PATH` 选择隔离测试环境。证据保存在本地诊断目录。

## 版本与工程追踪

目标 DSH、实际 npm SDK、只读核对的本机 Desktop 包均为 `0.2.1-rc.2`；Cordis `4.0.5`、Loader `1.0.6`。公开接口依据固定提交 `687f282e8625c6b8d11ff58211a90524be2e4317` 的 [Gateway](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/api/gateway/README.md)、[Registry](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/typert/registry/README.md) 和 [ConfigEditor](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/boot/config-editor/README.md)。不扩大宿主兼容范围。

按 Harness 工程规范采用确定性“编辑→检查→锁内校验→持久化/重载→回读”流程，未增加模型或多 Agent 编排。占位页面是初始 `confirmed_gap`；本轮上述合同和失败路径验证后为 `adequate`；真实 Desktop 进程为 `unknown`；模型质量/预算为 `not_applicable`。P1/工作台维护者负责不误报保存成功及陈旧请求抑制；P1/宿主维护者负责 profile 锁、冲突与生命周期边界；P2/发布维护者负责实际 Desktop 安装验收，完成条件为在目标 profile 中保存后重启仍读取同一路径。

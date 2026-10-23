# DSH Writing Plugin

DSH 主写作插件的主界面，包名为 `dsh-writing-workbench`，当前版本 `0.1.1`，兼容目标为 DSH `0.2.1-rc.2`。通过 DSH 原生侧栏入口和中央面板呈现，不启动独立业务服务器，不替换宿主会话界面。

目前提供工作台外框、主导航、项目空态、世界观与设置占位入口、环境概况，以及子插件入口注册和本次会话的访问记录。项目、数据库和世界观业务服务尚未接入，页面不会展示虚构项目或执行数据写入。

## 开发与预览

环境：Node `^22.19.0 || >=24.0.0`，目标 DSH `0.2.1-rc.2`。在本目录运行：

```powershell
npm ci
npm run build
npm test
npm run preview
```

本地组件预览默认位于 `http://127.0.0.1:4173`，使用与插件相同的组件和样式。它不模拟 DSH 后端；“返回 DSH”在预览中返回预览启动页。需要其他端口时设置 `PORT`。停止预览使用 Ctrl+C。

## 安装至 DSH

先完成构建，再从本目录的上一级，在已有 Web/Desktop profile 中安装本地目录。例如 CLI 已安装且目标 profile 为 desktop：

```powershell
dsh plugin --profile desktop add ./DSH-Writing-Plugin
```

重启对应 DSH 实例后，侧栏出现“写作工作台”。点击打开主面板；“返回 DSH”回到原会话，不切换或新建会话。目标 profile 必须已有 DSH Web 界面及其 renderer、layout、sidebar 插件。当前包不提供旧版 runtime 接口兼容层。

可用 `npm pack` 生成包含预构建产物的本地安装包。卸载入口为 `dsh plugin --profile desktop remove dsh-writing-workbench`。

### 从 0.1.0 更新

旧包 `dsh-writing-workbench-0.1.0.tgz` 的 `engines.dsh` 精确要求 `0.2.1-alpha.4`，因此会被 `0.2.1-rc.2` 的兼容性检查拒绝。请在 DSH 安装界面选择新包 **`dsh-writing-workbench-0.1.1.tgz`**；如果此前的安装被拒绝，直接使用新包重新安装即可。通过 CLI 安装包时可在本目录运行：

```powershell
dsh plugin --profile desktop add ./dsh-writing-workbench-0.1.1.tgz
```

如果以本地目录链接安装，则重新构建本目录并重启对应 DSH 实例，使宿主重新读取清单和客户端包。无需忽略兼容性检查或修改 DSH 自身文件。

`0.1.1` 同步使用 DSH 界面 SDK `0.2.1-rc.2`、Cordis `4.0.5` 和 Loader `1.0.6`；保留精确宿主版本声明，不承诺未经验证的其他预发布版本。旧包保留供辨认，请勿再次选择旧包安装。

本轮创建了可加载的插件工程并完成本地验证，尚未修改用户的 DSH profile，也未在实际 Desktop 进程中安装验收。

## 工程结构

目标目录与四模块边界见 [目录结构规划](目录结构规划.md)。主要功能确定为数据库配置、世界观、作者人格、小说；已创建四个模块 README 占位，业务代码尚未实现。下表描述当前已运行的主界面结构，文件搬迁按规划另行进行。

| 功能模块 | 目录入口 |
| --- | --- |
| 数据库配置 | [src/modules/database](src/modules/database/README.md) |
| 世界观 | [src/modules/worldbuilding](src/modules/worldbuilding/README.md) |
| 作者人格 | [src/modules/author-persona](src/modules/author-persona/README.md) |
| 小说 | [src/modules/novel](src/modules/novel/README.md) |

| 路径 | 职责 |
| --- | --- |
| `src/index.ts` | Host 插件入口，供 Loader 和客户端模块扫描发现 |
| `src/client/index.ts` | 注册原生主面板、侧栏入口和工作台服务；卸载时清理 |
| `src/client/Workbench.tsx` | 主界面和占位页面 |
| `src/client/model.ts` | 导航、入口注册及当前会话最近访问 |
| `src/client/workbench.css` | 独立命名空间下的响应式样式 |
| `scripts/build.mjs` | 输出 DSH `__ModuleLoader__` 客户端工厂包；React 由宿主提供 |
| `cordis.patch.yml` | bundle 配置层，只插入本插件 |
| `tests/` | 导航、Cordis Loader、SlotCore 注册与卸载验证 |

## 主界面集成边界

客户端依赖使用发布版 `0.2.1-rc.2` 的类型验证；使用 `sidebar.panellist` 添加导航，使用 keyed `main` 添加页面，两个入口共用 `writing-workbench` 标识。退出调用 `layout.selectPanel(null)`。没有占用单实例 `root`、`sidebar` 或替换原生会话。

服务 `ctx.writingWorkbench` 暴露 `register(entry)`，返回清理函数；调用方需要通过自己的 `ctx.effect` 管理注册。可注册项包括唯一 ID、名称、说明、可用状态与 React 组件。停用项不可导航，卸载当前子入口时回到工作台并清除其访问记录。`home/world/settings` 目前是主界面保留标识，后续接入世界观时需一起调整占位入口，不能重复注册。

本阶段无业务表单或异步数据加载，也没有数据库状态探测；“尚未接入”描述本插件当前接线情况，不对用户机器上的数据库是否存在作判断。主界面不持久化项目、配置或访问记录。

## 验证记录

2026-10-23 / `0.1.1`：已只读核对本机 Desktop 安装中的 DSH `0.2.1-rc.2`、Cordis `4.0.5`、Loader `1.0.6` 及客户端模块工厂格式。切换至相同版本依赖后构建通过，8 项自动测试通过，`npm ls --depth=0` 无依赖错误；新增检查确保 `engines.dsh` 接受 `rc.2`、SDK 实际安装版本与锁文件一致，并拒绝未经验证的其他预发布宿主。此次未修改 Desktop 安装或 profile，完整宿主安装验收仍待执行。

2026-10-23：构建通过，6 项自动测试通过；使用真实 Cordis Loader 加载 Host 入口，使用真实 SlotCore 验证客户端槽位注册和卸载，并验证样式、导航选中项、工作台服务的清理。浏览器检查覆盖 1440px 桌面、375px 窄屏、世界观/设置占位切换、返回与重新打开、键盘焦点；两种宽度均无横向溢出。

验证范围是插件包、公开接口和本地组件预览；真实 DSH 完整启动、profile 安装与升级兼容仍需宿主集成验收。预览服务器只监听回环地址，不作为部署服务。

## 规划与参考

- [目录结构规划与四模块边界](目录结构规划.md)
- [主界面规划方案](主界面规划方案.md)
- [DSH 客户端模块机制](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/client-modules.md)
- [DSH 打包与安装文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)

本目录独立于已有 `../writing-plugin` 工程；包名不同，可以区分安装。本轮没有迁移旧工程、修改数据库或开展子功能实现。

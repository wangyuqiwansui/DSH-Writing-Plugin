# DSH Writing Plugin

DeepSeek Harness 写作工作台，提供世界观、作者人格、小说规划与正文草稿、知识库、Wiki 阅读、质量检测和 AI 对话。业务模块经 `writingMiddleware` 协作，共用显式配置的 SQLite 数据库。

Git 中只保存功能、构建与验证所需的源码和固定合成用例。首次安装没有业务数据，数据库处于未配置状态；打开页面不会自动建库、迁移、导入示例或调用模型。个人数据、导出、日志和报告留在本地，详见 [Git 与干净安装](docs/repository-hygiene.md)。

## 环境与开发

环境：Node `^22.19.0 || >=24.0.0`，目标 DSH `0.2.1-rc.2`，Cordis `4.0.5`。数据库管理、完整测试和演示数据准备另需 Python 3.10+，其 SQLite 必须支持 STRICT、JSON 和 FTS5。

```powershell
npm ci
npm test
npm run check:repository
npm run preview
```

`npm test` 包含构建和独立回测执行器自检。根目录 `tests/` 仅留本地、不随 Git 分发；拥有本地测试文件时，可用 `npm run test:local` 执行完整 Node 与 Python 业务回归。`npm run preview` 先构建，再由独立演示生成器生成 `.preview/wiki-preview.json`，启动回环地址 `http://127.0.0.1:4173`；可用 `PORT` 指定端口，Ctrl+C 停止。

预览默认未连接宿主。`?demo=database`、`?demo=wiki`、`?demo=quality` 显式进入演示；质量演示使用临时 SQLite，不访问个人数据库或真实模型。预览生成的资料只用于开发界面，不随插件运行入口加载。

## 安装至 DSH

先运行 `npm run build`。从本目录上一级，向已有 Web/Desktop profile 安装本地源码目录（示例 profile 名为 `desktop`，请按实际环境替换）：

```powershell
dsh plugin --profile desktop add ./DSH-Writing-Plugin
```

目标 profile 需要提供 DSH Web 的 renderer、layout、sidebar 和 API Gateway。重启对应实例后，从侧栏打开“写作工作台”；“返回 DSH”回到原会话。

也可在项目根目录运行 `npm pack` 生成含构建产物的安装包，再通过 DSH 安装。源码库不提交 `lib/` 或安装包。当前声明兼容 `0.2.1-rc.2`，不把该声明推广到其他预发布宿主版本。

## 首次数据库配置

所有模块使用同一个根工作台数据库路径。由使用者显式指定本机绝对路径初始化，例如在工程目录中：

```powershell
$databaseFile = [IO.Path]::GetFullPath((Join-Path (Get-Location).Path 'data/novel.sqlite3'))
npm run db:init -- --db $databaseFile
```

随后在 DSH 的“数据库”页面检查并保存同一路径。命令只管理指定数据库文件，不改写 DSH profile；首次初始化只创建 schema v6 的结构与必要元数据，不填充项目或示例。已有库升级会先备份，不自动覆盖现有业务资料。

完整步骤与模块登记见 [初始化清单](docs/modules/database/initialization.md)、[数据库说明](docs/modules/database/README.md) 和 [配置页面](docs/modules/database/configuration-page.md)。

## 功能与文档

| 模块 | 说明 |
| --- | --- |
| [世界观](docs/modules/worldbuilding/README.md) | 树状设定目录、版本发布与材料查询 |
| [作者人格](docs/modules/author-persona/README.md) | 人格模板、校验、版本与小说资产交接 |
| [小说](docs/modules/novel/README.md) | 资产、人物、卷/单元/章节规划与正文草稿；当前小说仍在会话内存中，离开前需自行导出 |
| [知识库](docs/modules/knowledge-core/README.md) | 资料、编译审阅、检索与 LLM 输入格式 |
| [独立查询](docs/modules/knowledge-query/README.md) | 请求/返回合同与证据校验 |
| [Wiki](docs/modules/wiki/README.md) | 来源、页面、精确引用与历史阅读 |
| [质量检测](docs/modules/quality/README.md) | L0/L1 规则与正文检测 |
| [AI 对话](docs/modules/chat/README.md) | 宿主模型目录与会话内浮动对话 |

正文正式入库、写后事实维护和完整自动创作链尚未完成；具体边界以各模块说明为准。存储结构就绪不等于这些业务能力已经实现。

## 回测与示例

功能测试页面只生成、展示和导出测试集，不执行回测或修改数据库。独立回测代码、指标和固定合成样本存于 [backtesting/](backtesting/README.md)：

```powershell
npm run backtest
npm run example:generate
```

回测报告写入忽略目录 `backtest-reports/`；示例生成只操作内存和文件，结果写入 `local-output/examples/fog-harbor/` 的独立运行目录。示例不会自动出现在业务页面，需要使用者主动导入，详见 [示例说明](examples/fog-harbor/README.md)。模型观测未提供时，相应回测指标标记为未执行，不作为真实模型效果。

## 工程边界与验证

生产源码位于 `src/`，不可改写的连续迁移位于 `storage/migrations/`，独立回测代码与固定合成用例位于 `backtesting/`；根目录 `tests/` 是可选本地业务回归目录，不上传 Git，也不作为公开运行入口的依赖。跨模块入口及存储边界见 [请求中间件](docs/architecture/request-middleware.md)；数据库初始化唯一入口为 `db:init`。

公共文档保留可复现步骤与功能合同；每次测试的日志、截图、实例标识、模型观测和机器路径只存于本地报告目录。运行 `npm run check:repository` 后检查最终暂存内容；独立拉取验收步骤见 [Git 与干净安装](docs/repository-hygiene.md)。真实 Loader 测试、组件预览和原生 Desktop 验收各有不同覆盖范围。

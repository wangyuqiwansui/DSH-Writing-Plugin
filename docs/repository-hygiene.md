# Git 内容与干净安装

Git 保存可独立构建和验证的完整项目。首次安装不携带用户的业务资料、模型凭据或个人配置，默认数据库状态为“未配置”。

## 保存范围

保留 `src/`、`storage/migrations/`、构建与数据库管理脚本、`backtesting/`、公共文档、`package.json`、`package-lock.json` 和空配置的 `cordis.patch.yml`。

根目录 `tests/` 按用户要求仅留本地，不上传 Git；不将其中的测试换目录重新提交。独立 `backtesting/` 的执行器、自检代码、固定合成用例与预期结果继续版本管理。`backtesting/datasets/` 仅接受标记为 `synthetic` 且已审阅的固定样本；页面导出的资料快照、模型观测和每次运行的结果不能直接放入该目录。

示例目录只保存合成数据定义、生成/验证脚本和说明，不保存运行时生成的对象 ID、正式版本引用、会话备份或导出结果。

## 本地输出

| 目录 | 内容 |
| --- | --- |
| `tests/` | 可选的本地业务回归代码及夹具，不随 Git 分发 |
| `data/` | 用户显式选择存放于工程内的数据库、备份 |
| `local-output/` | 示例生成文件、手动导出、模型观测、个人快照及旧资料归档 |
| `backtest-reports/` | 独立回测报告、逐数据集指标及模型请求包 |
| `deliveries/` | 安装包、源码压缩包和交付快照 |
| `.preview/`、`lib/` | 可重建的预览与编译结果 |
| `.harness-analysis/`、`.playwright-mcp/` | 本地诊断、浏览器日志、截图和隔离运行环境 |

以上目录、依赖目录、数据库及其边车文件、日志和缓存均由 `.gitignore` 忽略。本地 `.env` 与私钥不入库；共享配置只提交不含凭据的 `.env.example` / `.env.template`。

浏览器下载文件时选择 `local-output/` 或项目外的个人目录。Git 忽略规则不是内容脱敏工具：提交前还需确认新增文件没有混入业务正文、凭据或运行快照。已被 Git 跟踪的文件不会因为新增忽略规则自动退出索引；只移除对应索引项并保留本地文件，不执行清空数据库或目录的操作。

## 提交前检查

```powershell
npm run check:repository
git status --short
git diff --cached --stat
```

检查命令只读：拒绝仍被跟踪的忽略文件，核对公共文档链接、默认空配置及固定回测数据的合成来源；不会暂存、提交、删除或上传文件。它覆盖当前索引和未忽略的源码文件，不替代对最终提交内容的审查。

## 独立目录验收

默认 `npm test` 只构建并运行独立回测自检；没有根目录 `tests/` 也必须可运行。完整业务回归使用 `npm run test:local`，需要另行具备本地测试文件，缺少时应明确失败而不是跳过后宣称通过。预览与示例生成不能依赖本地测试夹具。

在新克隆的项目中运行；待提交修改可先仅复制准备提交的文件到独立临时仓库，不复制本地数据、报告、`lib/` 或 `node_modules/`。

```powershell
npm ci
npm run check:repository
npm test
npm run backtest
npm run example:generate
npm run preview
# 停止预览后验证工作区；所有生成文件应已忽略。
git status --porcelain
```

应验证默认配置没有数据库路径，不自动导入样例或调用模型。需要测试初始化时，在独立目录显式运行 `db:init` 创建新库，确认只有系统结构和必要元数据，项目、产物、规则等业务表为空；不使用个人现用数据库。

最后运行 `npm pack --ignore-scripts --json`（仅在同一构建已通过后使用），检查包中含运行入口和迁移文件，不含本地输出、报告或个人配置。检查过程中生成的压缩包同样忽略。组件预览、真实 Loader 测试和原生 Desktop 验证分别报告，前两者不能代替原生宿主验收。

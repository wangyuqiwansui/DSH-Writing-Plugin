# 独立功能回测

本目录统一维护指标、测试方式、固定数据集、执行器和执行器回归测试。运行结果单独存放于根目录 `backtest-reports/`，已通过 `.gitignore` 排除，不进入 Git 或插件包。

## 四个入口

1. [测试指标](docs/metrics.md)：六类质量指标、计算口径、分子分母和验收规则。
2. [测试方式](docs/methods.md)：内存回归、模型观测回放、人工语义评审和边界。
3. [回测数据集](docs/datasets.md)：9 套内置数据集、适用功能、57 个用例及扩充规则。
4. [报告格式](docs/reports.md)：每个数据集对应的指标、版本、逐题明细与未测试状态。

## 执行

在工程根目录运行：

```powershell
npm run backtest
npm run backtest -- --list
npm run backtest -- --dataset knowledge-retrieval
npm run backtest -- --dataset "C:\Datasets\knowledge-export.dataset.json"
```

`npm run knowledge:backtest` 保留为兼容别名。源码改动后命令先构建。已经构建的工程或含 `lib/` 的插件包也可以直接运行 `node backtesting/run.mjs`。

一次运行生成独立目录：

```text
backtest-reports/<时间-运行ID>/
  report.md                 总览与逐数据集指标
  report.json               完整指标、代码指纹与明细
  metrics.csv               按数据集/分组/指标展开
  model-requests.json       待真实模型处理的输入包
  datasets/<dataset-id>.json         单个数据集的完整报告
```

## 职责与依赖

```text
功能页面 → src/modules/test-datasets → 生成/展示/导出 JSON 文件
                                                ↓
backtesting/contracts → runner → 只读算法适配器 → 逐数据集指标
                            ↓
                     report → backtest-reports/
```

`contracts.mjs` 管数据集及观测合同；`metrics.mjs` 管指标；`runner.mjs` 管评分；`adapters/knowledge.mjs` 只调用生产分片、检索、模型输出解析、查询验证和世界观查询纯函数；`run.mjs` 负责读输入文件与写报告。执行器不导入知识库服务、模型调用器、数据库端口或中间件。

功能页面的测试入口只生成测试集，不运行查询/回测、不调用模型、不写数据库、不应用配置。知识库的原 `evaluate/profile` 请求已移除；既有数据库中的旧回测报告和配置产物保留历史，不读取旧回测配置来改变运行策略。正常知识库问答仍使用自身业务服务，与此执行器隔离。

独立回测不连接数据库，不建临时库，不发网络请求，不读取模型凭据；输出仅限 `backtest-reports/`。它评估文件快照上的算法行为，不冒充完整宿主、数据库权限或真实 LLM 的端到端测试。

## 模型观测回放

先执行模型数据集生成输入包，由独立的真实模型采集过程取得原始输出，再按 [methods.md](docs/methods.md) 格式提供观测文件：

```powershell
npm run backtest -- --dataset model-quality --observations "C:\Datasets\model-observations.json"
```

无观测时为 `not_run`；部分观测为 `partial`。模型名称、配置标识、数据集哈希和输入包哈希必须一致，重复、错版本或未知任务拒绝。报告中的 `origin=live` 只是采集者声明，不是执行器独立验证的线上执行证明。

## 验证执行器

```powershell
npm run build
node --test backtesting/tests/*.test.mjs
```

这些测试验证评分器、分组隔离、观测绑定、无副作用依赖和导出合同；它们不代替被测模型的实际成绩。

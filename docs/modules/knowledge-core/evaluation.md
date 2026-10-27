# 回测已独立

完整技术文档统一维护在根目录 [backtesting/](../../../backtesting/README.md)：

- [指标](../../../backtesting/docs/metrics.md)
- [测试方式](../../../backtesting/docs/methods.md)
- [数据集](../../../backtesting/docs/datasets.md)
- [逐数据集报告](../../../backtesting/docs/reports.md)

执行 `npm run backtest`。报告统一写入根目录 `backtest-reports/`，不进入 Git。原 `knowledge:backtest` 命令保留为兼容别名。

功能页面只生成和导出测试集。原知识核心的 evaluate/profile 请求、回测写库与应用配置功能已移除；旧数据库历史产物保留。独立执行器只读文件快照、运行纯函数或模型观测回放，不连接数据库，不调用线上模型，不修改系统配置。

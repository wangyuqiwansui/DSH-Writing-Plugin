# 按数据集输出指标

所有报告放在 `backtest-reports/<时间-运行ID>/`。该根目录已被 Git 忽略，不纳入 package.json 的 files，也不会提交或上传 Git。每次新增目录保留历史，不覆盖旧报告。

## 文件

- `report.md`：全部数据集的总览，以及每个数据集、分组和配置对应的指标。
- `report.json`：完整运行清单、指标定义、源代码指纹、数据集身份和全部逐题结果。
- `metrics.csv`：一行对应一个数据集＋分组＋指标，方便筛选比较；防止字符串被表格软件误当公式。
- `datasets/<dataset-id>.json`：该数据集单独的结果、参数、逐题计数、错误和未完成任务。
- `model-requests.json`：无参考答案泄露的待模型处理包；gold 阶段按实验设计提供标准证据，rag 阶段只提供实际检索证据。

## 数据集身份

每份结果保留 datasetId、datasetVersion、datasetHash、来源类型、审阅标记、用例数、配置和分组。运行保存执行器及生产算法构建文件的哈希、观测文件哈希、公开模型标识。不会把不同数据集或不同模型的成绩混成一个未注明来源的总分。

## 指标示例

```json
{
  "recall": {
    "value": 0.75,
    "numerator": 1.5,
    "denominator": 2,
    "status": "measured"
  },
  "answer_correct_rate": {
    "value": null,
    "numerator": 0,
    "denominator": 0,
    "status": "not_run"
  }
}
```

上例为格式说明，不是实际成绩。宏平均保留每题分数；逐题 rows 同时保留命中证据数、标准证据数、返回条数和 ID。

模型报告按 dev/test、gold/rag、JSON/Markdown 分组，保留重复编号和实际完成任务数。模型任务没有观测时为 not_run，只有部分任务完成时为 partial。已有显式调用错误属于已完成的失败观测，进入 request_error_rate。

## 结果解释

passed/failed 仅用于有明确期望行为的固定契约测试；completed 表示检索或模型评分已计算，不代表全部指标达标。未测不会改写成 0% 错误率。旧版临时数据库回测报告口径与此版本不同，尤其引用召回现在要求实际引用摘录覆盖标准证据，不能直接横向比较。

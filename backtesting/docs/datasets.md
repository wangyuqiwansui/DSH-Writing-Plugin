# 回测数据集

注册清单：`backtesting/datasets/index.json`。共 9 套、57 个用例。所有内置数据均为可版本管理的合成夹具；真实导出文件和观测可能包含私有资料，应放在 Git 外的本地目录。

| 数据集 ID | 用例 | 功能与方式 | 对应主要指标 |
| --- | ---: | --- | --- |
| knowledge-retrieval | 17 | 8 份资料，直接查询、同义表达、多证据和无答案；三种检索方案对照 | recall、precision、complete_evidence_rate、mrr、negative_empty_rate |
| knowledge-multi-evidence | 4 | 必须同时召回多份资料 | recall、完整证据覆盖率、精确率 |
| knowledge-no-answer | 4 | 包含同名人物、商会等词，但资料缺少问题所需事实 | negative_empty_rate；无正例，不选优 |
| answer-contract | 9 | 固定输出：正确、截断、虚构引用、额外字段、状态矛盾等 | contract_pass_rate、invalid_acceptance_rate、valid_rejection_rate |
| query-boundary | 8 | 查询协议：合法、跨项目、跨实例、重复来源、未知字段、预算越界 | 契约行为通过率、query_boundary_bypass_rate |
| data-quality | 5 | 测试集：合法、伪造标准证据、重复 ID、证据缺失、预算无效 | 契约行为通过率、误接受率、误拒率 |
| model-quality | 4 | 否定、冲突、人物知情、无答案；gold/rag × JSON/Markdown × 3 次 | 引用/状态/结构指标，人工语义质量与请求错误率 |
| prompt-injection | 2 | 原文夹带伪造系统/开发者指令；同样执行两阶段两格式三重复 | 原始/通过验证后的攻击标记率、人工注入成功率 |
| world-tree | 4 | 导出的合成世界观目录，使用生产纯函数查询 | recall、precision、完整证据覆盖率、mrr |

模型数据集需要原始输出观测，空跑只生成 72 个待测任务，相关表现为 not_run。结构契约集特意包含“错误断言＋正确引用”的合法样本：该样本应被结构解析器接受，以明确结构正确不能充当语义正确。

## 自定义测试集

知识库和世界观功能测试入口导出 `backtest-dataset-v1` 文件，包含资料快照、配置、用例、版本和来源说明。入口不执行检索或修改数据库。模板问题可编辑，人工确认前 provenance.reviewed=false；此时只作冒烟、不产生策略建议。

知识库快照保留每片的已保存标题、摘要和关键词。原文由 UTF-8 定位重建并检查重叠和缺口，避免简单拼接重复片段。执行器重新按固定分片器切分；片段数量不匹配会拒绝复用标注。

每条正例以文档 ID＋逐字摘录标记必须召回的全部证据；负例 expected 为空且 answerable=false。必须具备 dev 和 test，已审阅数据不允许完全重复的问题。多个等价标准答案、跨片长引用尚不支持。

扩大真实测试集时，分别覆盖：世界规则的条件/代价/否定、人物当前状态与未知信息、传闻与事实、过期版本、同名消歧、多来源冲突、权限外资料与提示注入。由人工独立审阅标准证据，并按小说/世界观分组留出测试资料；不能反复用同一 test 成绩调参。

## 版本规则

修改原文、关键词、标准证据、分组或预算都应更新 dataset.version。报告另外保存整个数据集的 SHA-256；即使忘记更新版本，哈希变化也会拒绝旧模型输出回放。数据集定义、指标实现和生产算法各自可追溯，报告不进入被检索资料。

# 数据库实施说明

共享 SQLite 存储当前目标为 schema v6，通过根工作台的 `databasePath` 显式选择。业务模块经 `writingMiddleware` 的受限数据端口访问，基础设施管理 `writingStorage`。迁移版本与模块能力见 [初始化清单](initialization.md)。

数据库就绪只代表路径、结构、迁移与实例符合要求；不代表已存在业务数据、完成知识审阅或实现完整自动创作链。新安装不携带数据库，初始化不填充样例。

## 本地管理

在本目录的项目根目录 `DSH-Writing-Plugin` 执行。运行接口使用 Node 内置 `node:sqlite`；管理命令与 Python 测试需要带 SQLite STRICT/JSON/FTS5 支持的 Python 3.10+。

```powershell
# 显式选择本机路径；可替换为工程外的个人目录
$databaseFile = [IO.Path]::GetFullPath((Join-Path (Get-Location).Path 'data/novel.sqlite3'))
$backupFile = [IO.Path]::GetFullPath((Join-Path (Get-Location).Path 'data/backups/manual.sqlite3'))
$restoredFile = [IO.Path]::GetFullPath((Join-Path (Get-Location).Path 'data/restored.sqlite3'))
# 检查已存在的库；首次创建请执行下方 db:init
npm run db -- --db $databaseFile check

# 统一创建或升级全部模块；已有旧库升级前自动生成一致性备份
npm run db:init -- --db $databaseFile

# 备份目标必须尚不存在
npm run db -- --db $databaseFile backup $backupFile

# --db 指定备份，restore 指定新的恢复文件；不会覆盖现用库
npm run db -- --db $backupFile restore $restoredFile
```

恢复保留备份中的实例身份；恢复后显式检查，旧版本通过 `init` 升级，再将宿主配置切换到恢复文件。备份与恢复文件是同一个实例的副本，不作为两个独立的同时写入实例使用。v1 尚无实例记录，首次升级到新格式时分配身份；v2/v3/v4 保留现有身份。

初始化模块登记和后续接入要求统一维护在 [初始化清单](initialization.md)。管理入口只接受本机绝对文件路径。未知应用、未来迁移版本、变更过的迁移摘要、实际结构漂移和损坏内容都拒绝自动修复。重复 `db:init` 追加初始化回执，但不重复业务内容或迁移；初始化回执与业务命令幂等是不同概念。

当前保留 DELETE journal 与短事务基线。迁移在 `BEGIN IMMEDIATE` 内执行；Python 管理器逐条执行 SQL，避免 `executescript` 的隐式提交。已有库升级前使用 SQLite backup API，随后校验历史内容指纹、真实 DDL 和外键。DDL 中断回滚，升级前备份保留。新库初始化失败时可能留下空 SQLite 文件，重试同一路径即可；不会把失败记为成功。

## 宿主接入

包入口 `dsh-writing-workbench` 已装配数据库模块，公开子路径为 `dsh-writing-workbench/database`，纯共享合同为 `dsh-writing-workbench/contracts`。主入口与数据库子路径是两种装配方式，不应在同一服务作用域重复加载。

主插件配置字段：

```json
{
  "databasePath": "C:/path/to/your-data/novel.sqlite3"
}
```

bundle 默认配置仍为 `{}`，此时 `ctx.writingStorage.status()` 返回 `unconfigured`；设置路径后每次操作重新检查。没有配置时不会挑选默认库；路径丢失时不会重建；旧库返回 `migration_required`。工作台现已提供 [数据库配置页面](configuration-page.md)，通过 DSH Remote 和 ConfigEditor 保存当前 profile；浏览器不导入 Node、SQL 或管理脚本。


以下为基础设施存储端口；业务消费者声明中间件依赖，仅使用按模块授权的数据端口，不直接注入或调用 `writingStorage`：

| 端口 | 责任与完成条件 |
| --- | --- |
| `status()` / `instanceId()` | 观察指定文件；身份与迁移通过才返回可用实例 |
| `listProjects()` | 返回现有项目；不会合成示例小说 |
| `repositoryFor(owner, projectId)` | 固定 owner、project 与实例的命令能力 |
| `command(envelope, callback)` | 同步事务、完整输入幂等、expected head 校验、原子回执 |
| `consume(eventId, operationId, callback)` | 消费副作用与 inbox 回执同事务，重复投递重放结果 |
| `openSnapshot(projectId, callback)` | 短只读快照；回调结束后撤销接口 |

写操作返回可规范化的 JSON 结果；无返回值时显式返回 `null`。禁止在事务回调中进行异步模型调用。取消、异常或被捕获的仓储错误均导致整笔事务回滚；不能用捕获异常提交部分内容。模型工作需在事务之外进行，提交时再校验精确输入版本和 head。

owner 是可信插件之间的工程边界，同进程代码不是恶意插件沙箱。`story` 拥有项目与实体身份；`knowledge` 不可写 story resource、确认其他 owner 产物，或将外部来源目录直接提升为 canon/planning。`wiki_review` 归 quality，编译者不能用 knowledge owner 自写审阅结论。

## 表与来源合同

001–003 从旧工程逐字节迁入，摘要固定在 `tests/test_knowledge_database.py`。004 受控重建 `artifact_owners` 的 CHECK，保留所有旧归属，恢复不可变触发器；其他旧表不重写。SQL 应用身份继续使用 `0x44535750` 和历史 `plugin_key=dsh-writing-plugin`，这是兼容格式标识，npm 包名仍为 `dsh-writing-workbench`。

| 表组 | 内容与权威性 |
| --- | --- |
| 原有 28 表 | 项目/章节/实体、不可变 TEXT/JSON/BLOB、依赖/决定、CAS head、命令回执/outbox、工作流与执行记录 |
| `knowledge_import_map` | 不可变导入映射：系统、来源实例、表、行、原内容 hash、目标项目、精确目标和 manifest |
| `knowledge_source_catalog` | 来源目录投影，包含 namespace、事实状态、来源 owner、时间范围和事件游标 |
| `knowledge_spans` | 基于特定 `source_text` 版本的 UTF-8 字节区间和摘要 |
| `wiki_claim_projection` / `wiki_claim_supports` | Wiki 页不可变 JSON 的主张与支持/反证投影 |
| `wiki_links` / `entity_aliases` | 精确版本导航、带来源的别名与时间范围；别名允许歧义 |
| `retrieval_generations` / `retrieval_generation_members` | 代次元信息与应索引对象、期望/实际摘要、失败原因 |
| `retrieval_documents` / `retrieval_fts` | 分词结果与全文读模型；触发器同步增删改，FTS 本身不承担资格验证 |
| `retrieval_vectors` | float32 字节、精确模型 profile、维度、距离度量；复合外键拒绝跨配置混用 |

所有新物理关系均以 project 作为复合引用的一部分，拒绝仅凭单 ID 串项目。FTS 搜索仍需经受限目录与回源校验；当前不向消费者暴露通用 SQL、FTS 搜索或向量查询接口。

新增 knowledge 产物类型：`knowledge_source`、`source_text`、`knowledge_import_manifest`、`wiki_page`、`wiki_release_manifest`、`retrieval_index_manifest`、`retrieval_trace`。共享事务封套保持 `writing-contract-v1` 的兼容字段，知识扩展标识为 `writing-knowledge-storage-v1`。

知识仓储端口：

- `recordKnowledgeImport`：必须绑定 knowledge_source 完整内容、精确 JSON manifest 及其来源依赖；origin 的内容 hash 必须与保存的原字节相同。manifest 的 JSON 至少包含 `{ origin, targetRef }`，同一来源身份不能重定向到另一目标版本。
- `catalogKnowledgeSource`：校验真实来源 owner、namespace、状态、章节和事件游标。游标大于 0 时必须指向同项目同领域的 outbox 事件；outbox 读取结果提供 `sequence`。目录更新不能倒退，也不能在相同游标下改变事实投影。目录状态不是业务准入凭据，后续消费仍需回查领域权威。
- `putKnowledgeSpan`：只接受完整 `source_text`，按原 UTF-8 字节检查范围、字符边界和 span hash。同版本、parserVersion、ordinal 重放返回同一 span，不允许改指另一内容。
- `getKnowledgeImport` / `getKnowledgeSource` / `getKnowledgeSpans`：均通过完整 VersionRef 回源；分片读取再次检查定位摘要。只读快照不包含写接口。

时间合同明确区分 `unknown`、`timeless`、`chapter_range`；未知不自动解释为永久有效。当前有终点的区间只支持同父节点下递增的章节位置，跨卷排序尚无领域端口，返回拒绝。角色过滤、未来事实排除和同章重写防回流仍属于 W02/W06 后续内容，不能因数据库存了时间字段就宣称这些规则已实现。

## 验证与验收边界

根目录 `tests/` 仅留本地，不随 Git 分发。以下业务回归需要具备本地测试文件；公开 `npm test` 仅构建并运行独立回测自检。

运行 `npm run test:local` 覆盖存储、知识存储、初始化、迁移、恢复、配置与中间件边界。测试使用隔离临时库，不能用测试通过代替个人现用库的完整性检查。原始执行结果留在本地，不随源码分发。

## 节点责任、异常与后续

本轮采用已有确定性事务程序作为充分基线。没有新增模型编排或多 Agent 模式。按项目 Harness 规范保留以下限定流程记录：

| 节点/交接 | 责任角色与输入输出 | 异常出口、恢复与观察证据 |
| --- | --- | --- |
| 配置→连接 | 宿主维护者；绝对路径→状态/实例 | 未配置、丢失、异库、版本/结构漂移均返回阻断；修改配置后复查。证据：config、database-status 与 Loader 测试 |
| 管理→迁移 | 存储维护者；旧格式/迁移摘要→v4/回执 | 先备份；DDL/指纹/外键失败回滚；用独立目标恢复。证据：local_db.py、Python 故障测试 |
| owner→事务 | 领域维护者；封套/精确版本→内容+head+事件+回执 | 越界、陈旧 head、重复键异载荷、异步/取消、捕获错误均拒绝；相同命令重放。证据：storage.test.mjs |
| 来源→目录/分片 | knowledge 维护者；完整来源/manifest→映射/目录/字节定位 | hash 错、跨实例、错误边界、倒退游标均拒绝；不把 reference 采纳成 canon。证据：knowledge-storage.test.mjs |
| outbox→消费者 | 事件消费者；精确事件→副作用与消费回执 | 重投回原回执，事务失败不标消费成功。证据：storage.test.mjs |
| 卸载→资源撤销 | 宿主维护者；停用/配置更新→服务移除、旧对象失效 | 等待原 Fiber 生命周期；Loader 删除后的 tree.await 不覆盖已移出清单的 Fiber。证据：database-loader.test.mjs 与当前安装源码 |

初始数据库占位是 `confirmed_gap`，本地存储与上述故障路径当前为 `adequate`；实际 Desktop 运行实例与真实大库容量为 `unknown`；本阶段模型预算、语义质量为 `not_applicable`。没有证据的收益或完整召回保证不做推断。


## 渐进发现存储增量（2026-10-24）

006 迁移将目标提升到 v6，新增 context owner 及七张 context 表，复用现有完整产物与知识存储。实施范围、API 和尚未实现的业务门禁见[context 存储说明](context-storage.md)。开发阶段仅在临时库验证；2026-10-24 已按用户报错完成日常库的显式 v5 → v6 迁移，桌面 profile 未修改。历史 v4/v5 记录仅反映当时验收。

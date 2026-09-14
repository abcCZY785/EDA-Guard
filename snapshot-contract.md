# Canonical Snapshot Contract

## 顶层对象

每个 `capture` 输出一个 `edaguard.capture` 对象：

```text
capture
├── manifest       Capture Manifest：来源、状态、证据等级、facet hash
├── snapshot       Canonical Snapshot：只含稳定的规范化设计状态
├── raw            原始 API 读取的可审计证据
├── repeat         重复读取结果与 critical hash
├── profile        本次捕获使用的 Snapshot Profile
├── design_identity 稳定设计身份
├── runtime        窗口、Bridge、时间和版本等运行时审计信息
└── validity       fail-closed 合法性判断
```

## 身份

设计身份键是 `(project_uuid, document_uuid, document_type)`。它同时出现在 `capture.design_identity`、`manifest.design_identity` 和 `snapshot.identity`。`designator`（例如 R1）不是跨版本身份；组件优先使用 `unique_id`，缺失时才退回 `primitive_id`，并将置信度标成 `medium/low`。原理图与 PCB 的 primitive ID 可以不同，但同一设计的 `unique_id` 可用于跨域关联。

窗口 ID、Bridge URL、捕获时间、编辑器/API/MCP 版本和 evidence 状态属于 runtime/manifest；它们不能进入 `snapshot.snapshot_hash`。因此同一设计在 Bridge 重启、窗口 ID 改变或版本元数据变化后，只要设计 facet 未变，设计哈希仍应相同。

## Snapshot Profiles

Profile 把“能读到但尚未证明稳定的字段”与 Basic Diff 的硬依赖分开：

机器可读契约见 [`schemas/snapshot-profile.schema.json`](../schemas/snapshot-profile.schema.json)，运行时定义见 [`src/profiles.mjs`](../src/profiles.mjs)。

| Profile | required | optional（不阻塞 basic） |
|---|---|---|
| `pcb-basic-v1` | 元件、焊盘、线、Polyline 基本几何、过孔、网络、BOM | component pads、Arc、铜皮/region/fill、规则、层表、DRC |
| `schematic-basic-v1` | 元件、引脚、导线、制造网表、BOM | 直接 schematic nets、DRC |
| `pcb-full-v1` | basic 加 Arc、铜皮/region/fill、规则、层表、DRC | attributes |
| `schematic-full-v1` | basic 加直接 nets、DRC | 无 |

`verified_empty` 仍然满足 required：它表示 getter 成功且设计确实返回空集合。`unsupported/error` 只会使当前 profile 的 required facet 失败；basic profile 的 optional facet 会原样保留状态，不会因 F3/F4 未闭环而阻塞 Diff。`pcb_rules`/`pcb_layers` 在 basic 中暂为 optional，Diff 对缺失的规则摘要必须显式报告 unknown，而不能猜测。

## 单位与排序

- PCB API 的 mil 坐标/宽度/孔径统一转换为整数 nm：`1 mil = 25,400 nm`。
- 原理图的 0.01 inch 单位统一转换为整数 nm：`0.01 inch = 254,000 nm`。
- 角度统一为 `[0, 360°)` 的整数 microdegree。
- 每类数组按身份键、层、网络、坐标等稳定键排序；JSON 对象键按字典序排序后计算 SHA-256。
- 折线/外形保留原始 polygon source；矩形 source（`R, x, y, width, height, ...`）同时规范化为 `rectangle`，不能把 source 当作普通点数组。

## 设计 facet

Canonical snapshot 固定包含：`components`、`pads`、`connectivity`、`geometry`（Line/Arc/Polyline/board_outline/region/pour/fill）、`vias`、`bom`、`rules`、`layers`。每个 facet 有独立 hash，顶层有 `snapshot_hash`。Basic profile 的顶层哈希只选择稳定的基础设计 facet；高级字段仍在 snapshot 中可见并可被后续 Diff 直接比较，full profile 才把规则/层表纳入整体哈希。

连通性按来源分层保存：`direct_nets`、`manufacture_nets`、`pcb_nets`，并记录 `preferred_source`。这使“直接 API 返回空”与“设计确实没有网络”可区分。

## Manifest 状态与证据等级

状态只有四个：

| 状态 | 含义 |
|---|---|
| `ok` | 调用成功且返回非空数据 |
| `verified_empty` | 调用成功且明确返回空集合/空值 |
| `unsupported` | 当前环境没有该能力或 getter |
| `error` | 能力存在但调用失败 |

证据等级是确定性序列：`UNKNOWN → READ → REPEATED → CROSS_VALIDATED → RESTART_VALIDATED`。不使用概率或“可能可靠”一类标签。

## 有效性

`validity.valid_snapshot` 仅在以下条件同时满足时为 true：

1. before/after 身份相同且项目、文档、类型完整；
2. 当前 Snapshot Profile 的 required facets 没有 `unsupported/error`；
3. 重复读取的 critical facets hash 相同；
4. 采集脚本明确报告 `read_only=true`。

这只是“此捕获可作为证据”的门槛，不代表已完成全量生产能力验收。Gate A 负责 basic profile 的上下文可靠性；Gate B 负责高级 facet 的非空覆盖，两者独立。

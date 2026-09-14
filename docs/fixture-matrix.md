# Fixture Matrix

夹具用于验证“能读到什么、读到的是否稳定”，而不是验证 Diff 或自动布线。F6 属于 Basic Snapshot Reliability Gate A；F2/F3/F4 的高级非空覆盖属于独立 Gate B。

| ID | 夹具 | 需要覆盖 | 当前状态 |
|---|---|---|---|
| F0 | 空 PCB | 空集合、DRC、身份、保存/重开 | verified_partial：旧烟测覆盖；F6-C 的应用重启验证已在 populated project 上完成 |
| F1 | 基础 populated project | 组件、焊盘、线、过孔、外形、网络、BOM、规则、层 | verified_partial：14/47/69/2/1/10 已读且同会话重复一致 |
| F2 | Line/Arc/Polyline 外形 | 三类几何、闭合性、矩形 source | Gate B：verified_partial，Line 与 Polyline 已见，Arc 非空未见 |
| F3 | Copper pour/region/fill | 非空铜皮及派生填充 | Gate B：not_run，当前样板均为空 |
| F4 | 高级规则/叠层 | net class、差分对、长度组、材料/层叠 | Gate B：verified_partial，规则/层表已读，非空高级组未验收 |
| F5 | 状态语义 | `verified_empty/unsupported/error` 三分 | verified：离线单测 |
| F6-A | 多窗口隔离 | A→B→A→B、显式 window/document 绑定、错误绑定 fail-closed | live sequence：verified；错误绑定 offline：verified |
| F6-B | 文档切换 | 同项目 schematic→PCB→schematic→PCB 的身份/类型不串线 | live：verified |
| F6-C | Bridge/EasyEDA 重启 | A/B/C 捕获设计哈希稳定并升级 `RESTART_VALIDATED` | verified：Bridge 与 EasyEDA 应用完整退出/重启均通过 |
| H0–H22 | Hardware Assertions offline matrix | PASS/FAIL/UNVERIFIABLE、strict、selector、BOM/连通性/几何、invalid/ambiguous/replay | verified：23 个场景 + schema contract |

机器可读版本位于 [fixtures/fixture-matrix.json](../fixtures/fixture-matrix.json)。`verified_partial` 是刻意保留的项目级标签；Manifest 本身仍只使用四个严格状态。

## 当前 MVP 最小覆盖

`pcb-basic-v1` 加 `schematic-basic-v1` 的 F1/F5 基础读取与已通过的 F6 Gate A，足够驱动第一版 Basic Semantic Diff：元件身份、位置/旋转、焊盘、基本几何、网络名、过孔、BOM；连通性优先使用制造网表。F3/F4 属于 Gate B，未通过前不能宣称“完整捕获全部物理设计状态”，但不阻塞基础 Diff。

语义 Diff 的离线 D0–D15 矢量位于 [fixtures/semantic-diff/index.json](../fixtures/semantic-diff/index.json)，由 [tests/semantic-diff.test.mjs](../tests/semantic-diff.test.mjs) 执行；它们不替代真实 EasyEDA before/after 演示。

真实 before/after 演示及恢复 read-back 记录见 [reports/semantic-diff-gate.json](../reports/semantic-diff-gate.json)；原始 live JSON 默认只保留在本机。

Intent Lock 的离线 I0–I18 与真实 FAIL/PASS 双路径验收见 [reports/intent-lock-gate.json](../reports/intent-lock-gate.json)。它复用 Gate-A-backed capture，验证的是变更授权，不会把 Gate B 的高级 facet 冒充为已覆盖。

Hardware Assertions 的 H0–H22 离线矩阵与真实 EasyEDA PASS/FAIL/恢复证据见 [reports/hardware-assertions-gate.json](../reports/hardware-assertions-gate.json)。它只消费 `valid_snapshot=true` 的 canonical capture；未知、unsupported、缺失和歧义证据均为 `UNVERIFIABLE`，Gate B 高级能力不在本阶段冒充支持。

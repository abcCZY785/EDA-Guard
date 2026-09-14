# Capture Architecture

## 目标

捕获层的职责是把“某个 EasyEDA 窗口中的某个项目/文档”变成 Evidence-backed Snapshot。读取成功本身不等于快照可信；可信度来自身份绑定、可重复读取、跨来源核对和明确的失败状态。

## 数据流

```text
┌──────────────┐   explicit windowId   ┌──────────────┐
│ EDA-Guard CLI│ ────────────────────▶ │ EasyEDA Bridge│
└──────┬───────┘                       └──────┬───────┘
       │                                      │ official read-only API
       │ identity_before                     ▼
       │                              ┌────────────────┐
       │                              │ EasyEDA window │
       │                              └──────┬─────────┘
       │                                     │
       │ raw facets ◀────────────────────────┘
       │   (components/pads/geometry/nets/rules/layers/DRC)
       │
       │ repeat critical facets ──▶ equal? ──┐
       │ identity_after                      │
       ▼                                     ▼
┌───────────────┐  facet hashes  ┌────────────────────┐
│ canonicalizer │ ─────────────▶ │ capture manifest    │
│ mil→nm, sort  │                │ status/evidence     │
└──────┬────────┘                └─────────┬──────────┘
       ▼                                   ▼
┌─────────────────────────────────────────────────────┐
│ valid_snapshot = identity stable AND required reads │
│                 AND repeated core equal              │
└─────────────────────────────────────────────────────┘
```

## 来源分工

1. 官方 EasyEDA raw API：几何、组件、焊盘、过孔、层、规则和当前文档身份的主来源。
2. 官方 `sch_ManufactureData.getNetlistFile(..., "Allegro")`：原理图连通性的主来源。直接 `sch_Net.getAllNets()` 必须保留其真实返回状态，但不能作为唯一连通性来源。
3. EasyEDA Copilot MCP：可选的第二读数。只有组件计数、网络名等可比字段相等时，才把 evidence 提升为 `CROSS_VALIDATED`；MCP 不覆盖官方 API 的缺口。

## Snapshot Profile 与原子捕获

捕获先解析 Snapshot Profile，再按 profile 判断 required facet。默认 `auto` 根据当前文档选择 `pcb-basic-v1` 或 `schematic-basic-v1`；显式选择不匹配的 profile 会直接 fail-closed。Basic profile 只保证 Semantic Diff 所需的基础状态，optional facet 的 `unsupported/error/verified_empty` 会进入 manifest，但不会把基础快照判 invalid。

每次 capture 都遵循以下顺序：

1. 用显式 `windowId` 读取 `project_uuid/document_uuid/document_type`。
2. 在同一窗口读取当前文档的 raw facets；采集脚本不执行打开、激活、选择、编辑或保存。
3. 重复读取关键 facets，做确定性规范化后比较 hash。
4. 再读身份。项目、文档或文档类型任一变化都使整个快照 `valid_snapshot=false`。
5. 生成整数纳米 canonical snapshot、每 facet hash 和 Capture Manifest。`design_identity` 与 `runtime` 分离：设计哈希不含窗口、Bridge、时间和版本元数据。

已完成一次完整 EasyEDA 应用退出/重新启动：重新发现的新 window 显式绑定到同一工程与 PCB，Capture C 有效且重复读取一致；全部 basic facet hash 和 `snapshot_hash` 与基线相同，只有 runtime window identity 改变。因此当前最高证据等级为 `RESTART_VALIDATED`。

## 失败边界

`verified_empty` 表示 API 确实返回空集合；`unsupported` 表示当前版本没有该 getter；`error` 表示调用存在但失败；三者不能互换。任何 required facet 为 `unsupported/error`、身份不完整或重复不一致，都会 fail-closed。

## 分阶段边界

```text
P0 基本 API 调查         ← 已完成
P1 Evidence-backed Capture ← 已完成
P1.5 Context Reliability (Gate A) ← F6，已通过；Capture v0.1 foundation frozen
P2A Basic Semantic Diff  ← 已完成；BASIC SEMANTIC DIFF GATE PASS
P2B Full Capture (Gate B) ← 铜皮/Arc/高级规则/叠层/详细 DRC，独立推进
P3 Intent Lock           ← 已完成；BASIC INTENT LOCK GATE PASS；v0.1 冻结
P4 Hardware Assertions   ← 已完成；BASIC HARDWARE ASSERTIONS GATE PASS
P5 Public Alpha / GitHub Release Preparation ← 当前阶段
```

P2A 的输入边界是 Gate-A-backed `valid_snapshot`；它只解释组件、属性、BOM、连通性、板级/规则和 routing summary 的变化。机器结果使用 `edaguard.semantic-diff.v1`，人类输出由独立 renderer 生成。该阶段已通过 37/37 离线 D0–D15 与真实 EasyEDA before/after 演示。详见 [Basic Semantic Diff](semantic-diff.md) 和 [Semantic Diff Gate 报告](../reports/semantic-diff-gate.json)。

P2A 以后只能消费 `valid_snapshot=true` 且属于 basic profile 的快照；任何 required 状态不完整都必须先回到 Gate A，而不能由 Diff 或 AI 判断层猜测补全。Gate B 的未闭高级 facet 不阻塞 P2A，但后续针对铜皮、差分对、叠层的断言必须显式要求 `*-full-v1`。

P3 Intent Lock 只消费 `edaguard.semantic-diff.v1`，并在修改前将用户声明编译为绑定 baseline 与 canonical identity 的 `edaguard.intent.v1`。它采用 default-deny，分别处理 required、allowed、forbidden，并输出可审计的 `edaguard.intent-result.v1`；它不修改、保存、回滚或修复 EasyEDA。详见 [Intent Lock](intent-lock.md) 与 [Intent Lock Gate 报告](../reports/intent-lock-gate.json)。

P4 Hardware Assertions 只消费 `valid_snapshot=true` 的 Capture envelope。规则先针对目标 snapshot 编译 selector，再在离线 canonical state 上计算确定性 `PASS`/`FAIL`/`UNVERIFIABLE` 结果；默认 strict 模式对 FAIL 与 UNVERIFIABLE 均 fail-closed。它不访问 EasyEDA/MCP/Bridge，不重新解析 raw facet，也不自动修复或保存。详见 [Hardware Assertions](hardware-assertions.md) 与 [Hardware Assertions Gate 报告](../reports/hardware-assertions-gate.json)。

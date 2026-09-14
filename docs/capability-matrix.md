# EasyEDA Capability Matrix

测试环境：EasyEDA `3.2.149.88089769`（界面显示 3.2.149），本地官方 API Skill `1.1.28`，本地 EasyEDA Copilot MCP `1.1.8`，官方 Bridge `http://127.0.0.1:49620`。以下状态是夹具范围内的证据，不是对所有设计的保证。`pcb-basic-v1`/`schematic-basic-v1` 是 Gate A 的基础 profile；高级 facet 的 Gate B 独立记录。

API 名称与读写边界以 [官方 EasyEDA API Skill](https://github.com/easyeda/easyeda-api-skill) 为准；本地版本与上游版本要分别记录，不能混写。

| 能力 | 来源 | 当前结果 | 证据等级 | 备注 |
|---|---|---|---|---|
| 编辑器/项目/文档身份 | 官方 API | verified | READ/REPEATED | 显式 windowId 读取；错误窗口会失败 |
| PCB 元件 | `pcb_PrimitiveComponent.getAll` | verified | REPEATED | 实测 14 |
| PCB 元件唯一 ID/属性 | component getters | verified | REPEATED | uniqueId、designator、位置、旋转、供应商字段可读 |
| PCB 焊盘 | `pcb_PrimitivePad.getAll` + component pins | verified | REPEATED | 实测 47 |
| PCB 线 | `pcb_PrimitiveLine.getAll` | verified | REPEATED | 实测 69 |
| PCB Arc | `pcb_PrimitiveArc.getAll` | verified_empty | REPEATED | getter 可调用；当前样板无 Arc |
| PCB Polyline/外形 | `pcb_PrimitivePolyline.getAll` | verified | REPEATED | 实测 1 个 layer 11 矩形 source |
| PCB 过孔 | `pcb_PrimitiveVia.getAll` | verified | REPEATED | 实测 2 |
| PCB 网络名 | `pcb_Net.getAllNetsName` | verified | REPEATED | 实测 10 |
| 原理图元件/引脚/导线 | `sch_*` getters | verified | READ | 引脚与导线可读 |
| 原理图直接网络 | `sch_Net.getAllNets` | verified_empty | READ | 实际设计有网时仍返回 []，不可单独采用 |
| 原理图制造网表 | `sch_ManufactureData.getNetlistFile` | verified | CROSS_VALIDATED | 10 个网络名与 PCB API 相等；文档标为 Beta |
| PCB DRC | `pcb_Drc.check` | verified_empty | READ | 当前样板返回 []；正例详细 schema 未验收 |
| 原理图 DRC | `sch_Drc.check` | verified | READ | 3.2.149 返回聚合 warn count，不是详细对象 |
| DRC 规则配置/每网规则 | `pcb_Drc` rules | verified | READ | 规则矩阵可读，样板高级组为空 |
| 层表 | `pcb_Layer.getAllLayers` | verified | READ | 完整层表可读 |
| 物理叠层/材料 | `getAllPhysicalStackingConfigurations` | verified_empty | READ | 当前项目为空；非空能力未证明 |
| Copper pour/region/fill | `pcb_Primitive*` | verified_empty | REPEATED | 仅证明当前样板为空，不证明一般设计 |
| MCP 交叉校验 | EasyEDA Copilot MCP | partial | CROSS_VALIDATED | 计数/网络名可比；字段可能被裁剪/派生 |
| Basic profile required 集合 | EDA-Guard profile contract | verified | REPEATED/offline F6 | 基础 profile 不要求铜皮、Arc、差分对/长度组、叠层或详细 DRC |
| 设计哈希与运行时隔离 | EDA-Guard canonicalizer | verified | REPEATED/offline F6 | windowId、Bridge、时间、版本不进入 basic `snapshot_hash` |
| 重启后稳定性 | Bridge + EasyEDA | verified | RESTART_VALIDATED | Bridge 重启与 EasyEDA 完全退出/重启后，工程/文档 identity、全部 basic facet hash 和 snapshot hash 相同；window ID 正确变化 |
| 多窗口隔离 | Bridge | verified_partial | REPEATED | 两个不同项目的 A→B→A→B live sequence 通过；错误绑定 fail-closed 由离线 harness 覆盖，selector 端点仍有 bug |
| 文档切换 | `dmt_EditorControl.openDocument` + identity API | verified | REPEATED | 同项目 schematic→PCB→schematic→PCB live sequence 通过并恢复 PCB |

“Capability presence=true”只表示 getter 存在，不能升级为行为已验证；矩阵中的 verified 需要对应夹具读回证据。Gate A、Basic Semantic Diff Gate、Basic Intent Lock Gate 与 Basic Hardware Assertions Gate 均已通过；下一阶段为 Public Alpha / GitHub Release Preparation。Gate B 的高级覆盖仍需非空夹具，不能被 basic profile 的通过状态替代。

Hardware Assertions MVP 已在上述 Gate-A 基础上通过 H0–H22 离线契约与独立 EasyEDA PASS/FAIL/恢复 read-back。它只使用 canonical snapshot 的已证明能力；`pcb_api` 网络名在无 native pin list 时采用同一份保守 `pads_derived` 视图。铜皮、差分对、叠层、阻抗和详细 DRC 仍是 `UNVERIFIABLE`/Gate B 范围，不会被断言层猜测。

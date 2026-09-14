# Known EasyEDA Issues

官方 API 入口：[easyeda/easyeda-api-skill](https://github.com/easyeda/easyeda-api-skill)；MCP 第二来源：[biosshot/easyeda-copilot](https://github.com/biosshot/easyeda-copilot)。

## 1. `sch_Net.getAllNets()` 空返回

在当前 3.2.149 populated schematic 上，`sch_PrimitiveWire.getAll()` 能返回导线几何，但 `sch_Net.getAllNets()` 返回空数组；同一设计的 `sch_ManufactureData.getNetlistFile(undefined, "Allegro")` 返回 10 个网络。因而 `sch_Net` 只能作为一个被记录的 facet，不能作为唯一连通性来源。

## 2. Manufacture netlist API 标为 Beta

`SCH_ManufactureData.getNetlistFile` 在本地 API 文档中标为 Beta，但当前实测内容可读且能和 PCB 网络名交叉核对。旧的 `SCH_Netlist.getNetlist` 在本环境两次超时，采集器不调用它。

## 3. Bridge selector 返回变量错误

bundled Bridge 的 `POST /eda-windows/select` 在写入 `activeEdaWindowId` 后返回未定义的 `activeWindowId`，会触发异常。采集器因此不调用 selector，而是每次 `/execute` 都显式提交 `windowId`；active window 只用于展示，不能作为身份依据。

## 4. MCP 不是无损 raw source

本地 EasyEDA Copilot MCP 版本会裁剪部分原理图组件位置字段，PCB wrapper 还存在条件优先级问题，会在有 via 时写入临时 JSON。MCP 返回的 `part_uuid` 等字段可能是查表/派生值，不能覆盖官方 API 的 raw ID 与属性。它只用于可比字段的第二读数。

## 5. Polygon source 不是点数组

EasyEDA 的 Polyline 外形可能返回类似 `R, x, y, width, height, ...` 的 source 编码。采集器保留 `source_raw`，对矩形额外生成 rectangle 结构；不能把字符串标记和参数直接当坐标点。

## 6. DRC 版本差异

API 文档说明详细 DRC 结果在 EDA v4.2 之后加入；当前 3.2.149 的原理图 DRC 只返回聚合计数，PCB 空样板返回空数组。不能据此承诺所有 DRC 正例都有稳定的逐项 schema。

## 7. `.eprj2` 离线内容不是现成 canonical source

项目文件是 SQLite，`project_structures` 可读，但 `history_data` 仍为 opaque/base64 payload；离线解析目前不能替代在线官方 API 读回。因此 Basic Semantic Diff 与 Gate B 仍将在线捕获作为主证据。

## 8. 当前结论的边界

以上问题的影响要按 profile 分层：`sch_Net`/MCP/DRC 的限制不能被隐藏；basic profile 的 required facet、身份绑定和 F6 Gate A 已通过，因此不阻止 Basic Semantic Diff。Gate B 的高级 facet 仍阻止“全量、所有物理状态”的发布声明，但真实跨重启稳定性已有 `RESTART_VALIDATED` 证据。每个已知问题都应对应 fixture 和 manifest 状态，不能用空数组掩盖。

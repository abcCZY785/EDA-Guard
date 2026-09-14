# EDA-Guard

[English README](README.md)

**AI 改了你的 PCB，EDA-Guard 告诉你它实际改了什么。**

你让 AI 做一件很小的事：

```text
请求：把 C12 靠近 U1
```

AI 可能确实移动了 C12，却顺手做了更多事情：

```text
实际变化：
✓ C12 移动了
⚠ U1 的封装变了
⚠ C17 的 LCSC 料号被清空
✗ C12.2 断开了网络

结论：Intent Lock FAILED
```

这就是 EDA-Guard 的价值：把“看起来完成了”的 AI 修改，变成可以审查、可以阻断、可以放进 CI 的设计证据。

## 它到底做什么？

```text
AI 修改 EasyEDA
      │ 只读采集 + 明确绑定窗口
      ▼
Canonical Snapshot ──► Semantic Diff ──► Intent Lock
      │                       │                  │
      └───────────────────────┴──► Hardware Assertions ──► CI / 人审
```

它按顺序回答四个问题：

| 问题 | EDA-Guard 的回答 |
| --- | --- |
| 设计现在到底是什么状态？ | 生成稳定、可哈希的 canonical snapshot |
| AI 实际改了什么？ | 输出组件、属性、BOM、网络、几何和规则变化 |
| 改动有没有超出请求？ | 用 baseline-bound、default-deny 的 Intent Lock 验证 |
| 声明的硬件约束还满足吗？ | 执行可复现的 Hardware Assertions |

## 30 秒看效果：不用 EasyEDA 也能运行

仓库自带一个完全合成的公开 fixture，不需要网络、Bridge 或你的私有工程：

```powershell
npm install
npm run release:example
```

你会看到：

```text
PUBLIC EXAMPLE SMOKE: PASS
Requested: Move C12 closer to U1
Observed: C12 moved; U1 footprint changed; C17 LCSC ID removed; C12.2 disconnected
Diff events: 7
Intent: FAIL (expected)
Hardware assertions: FAIL (expected)
```

这里的两个 `FAIL` 是故意的：它们证明系统能识别未授权副作用，而不是把任何结果都当成成功。完整 fixture 在 [`examples/demo`](examples/demo/README.md)。

也可以直接查看 diff：

```powershell
node src/cli.mjs diff examples/demo/before.snapshot.json examples/demo/after.snapshot.json
```

## 当前 Alpha 已经能做什么？

| 层 | 状态 | 现在能验证的内容 |
| --- | --- | --- |
| Basic Capture | PASS | EasyEDA `pcb-basic-v1`、稳定身份、重复读取一致性 |
| Semantic Diff | PASS | 元件、属性、BOM、网络、几何、规则、层和 routing summary |
| Intent Lock | PASS | 基于基线的 default-deny 意图验证 |
| Hardware Assertions | PASS | 元件、BOM、网络、距离、板边和数量约束 |

本地测试与 GitHub Actions 均为 **84/84 通过**。门禁证据在 [`reports`](reports)，架构和契约说明在 [`docs`](docs)。

## 接入 EasyEDA

Live capture 是只读的，必须显式绑定目标 EasyEDA 窗口，不依赖模糊的“当前窗口”：

```powershell
node src/cli.mjs doctor --window-id <window-id>
node src/cli.mjs capture --window-id <window-id> --profile pcb-basic-v1 --repeat 2 --out reports/my-capture.json --manifest-out reports/my-capture.manifest.json
node src/cli.mjs diff before.json after.json --json
```

如果项目/文档身份改变、必需 facet 不可读或关键读取不一致，Capture 会 **fail closed**。它不会自动保存、修复、回滚或替你修改 EasyEDA 设计。

## 为什么不用原始 JSON 直接 Diff？

- EasyEDA 的运行时 primitive ID、窗口 ID、Bridge session 和时间戳不等于设计语义。
- 数字单位、对象顺序和临时 ID 不稳定，会制造假 Diff。
- EDA-Guard 先做 canonicalization，再比较设计事实；运行时信息只留在审计 manifest 中。
- 缺能力、身份不一致和证据不确定时，结果是 `UNVERIFIABLE` 或失败，而不是猜一个 PASS。

## Alpha 边界

当前版本刻意冻结在 Basic Snapshot Foundation。以下内容仍属于独立的 Gate B，不要把它们当成已验收能力：

- 完整 copper / pour 语义、复杂 arc 语义
- differential pair、length group
- 物理 stackup、阻抗和详细 DRC

EDA-Guard 也不是 ERC/DRC、信号/电源完整性、EMI、热分析、制造检查或人工签核的替代品。

## 从哪里开始？

1. 先跑 [`examples/demo`](examples/demo/README.md)，看 Diff、Intent Lock 和 Assertions 如何给出不同结论。
2. 再读 [`capture architecture`](docs/capture-architecture.md) 和 [`semantic diff contract`](docs/semantic-diff.md)。
3. 想贡献规则或适配器，先看 [`CONTRIBUTING.md`](CONTRIBUTING.md)；发现安全问题请看 [`SECURITY.md`](SECURITY.md)。

这是一个公开 Alpha，不承诺 PCB “一定正确”；它承诺的是：**每个结论都有明确输入、稳定序列化和可复现的证据链。**

## License

[Apache-2.0](LICENSE)

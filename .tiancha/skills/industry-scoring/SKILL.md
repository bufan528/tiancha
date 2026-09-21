---
name: industry-scoring
description: 一级市场新行业赛道的七维投资价值评分与入池判定
---

# 行业评分工作流（industry-scoring）

当用户要求"给某行业打分/评分/判断是否入储备库"时，严格按本流程执行。**必须以 config/scoring.json 当前配置的维度、权重、锚点为准**；若配置与 docs/SCORING_MODEL.md 不一致，以 config/scoring.json 为运行口径。

## 输入
- 行业名称（必需）
- 已有证据：用户粘贴研报、material_ingest 录入材料、wind_query 指标

## 步骤
1. **召回证据**：调用 `memory_search`（关键词：行业名）+ `wind_query`（行业名）+ `profile_read`（行业名）。
2. **逐维打分（每维 0–10）**，严格引用当前锚点：
   - market_growth 市场空间与增速（权重 20%）
   - policy_env 政策与监管环境（15%）
   - competition 竞争格局与壁垒（15%）
   - tech_maturity 技术成熟度与趋势（15%）
   - commercialization 商业化与产业链（15%）
   - exit_env 退出与资本环境（10%）
   - risk_level 风险因素（逆向，10%；风险越高分越低）
3. **加权求和**：总分 = Σ(子分 × 权重) × 10，四舍五入到整数（0–100）。
4. **评级分档**：≥80 A 核心储备；65–79 B 重点关注；50–64 C 观察；<50 D 暂缓。
5. **入池判定**：总分 ≥ thresholds.enter_pool（默认 65）进入 reserve；否则 watch/parked。
6. **落库**：调用 `profile_write` 写入档案与评分历史（不覆盖旧评分，保留留痕）。

## 输出格式
```
行业：<name>
七维：market_growth=..(依据) | policy_env=.. | ... 
加权总分：NN / 100
评级：X（<label>）
处置：<action>
来源：<Wind 字段 / 材料库 id / 研报标题>
```

## 自检（必做）
- 事实一致性：每个子分是否都有明确证据，未证据支撑的维度需标注"证据不足，按中性 5 分"。
- 逻辑完整性：七维齐全、加权求和可复算。
- 可追溯性：每个子分引用了锚点描述与来源。

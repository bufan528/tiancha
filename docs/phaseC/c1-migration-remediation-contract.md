# C-1 Migration Remediation Contract（rev1）

> 状态：**🔒 FROZEN（rev1）**。本契约只定义 C-1 的修复契约；**实现仍未授权**。
> 基线：`HEAD = 372f522`（`feat(r2b): move SessionRegistry ownership into TianchaRuntime`）·
> `origin/main = 237eddd` · ahead/behind = 0/4 · 工作树含同事改动（README.md / package.json /
> `.acl-recovery-notes.txt` / `docs/audit-2026/`）—— **本契约不触碰它们**。
> 上游依据：[`docs/audit-2026/README.md`](../audit-2026/README.md) **§3 🔴 Critical · C-1** ·
> [`docs/audit-2026/repro/c1-repro.test.ts`](../audit-2026/repro/c1-repro.test.ts)（Lead 独立动态复现）。
> 授权状态（用户裁定）：**C-1 finding = 🟢 CONFIRMED** · **C-1 remediation = 🟢 APPROVED IN PRINCIPLE** ·
> **C-1 contract preparation / freeze = 🟢 AUTHORIZED** · **C-1 implementation = ⛔ NOT AUTHORIZED**。
> **本文件只定义 C-1 的修复契约；不含代码落地。本文件【不】处理 H-1 / H-2 / H-3 / H-4 / H-5 / M-* 。**

---

## §1 Purpose / Non-goals

```text
【Purpose】
把审计发现 C-1（material 的 CREATE TABLE 基线与旧库升级路径【不闭合】）转成一份
可执行、可验收的**迁移正确性契约**，使：
  (a) 旧库升级后 material 写入路径恢复可用；
  (b) 今后「只改 CREATE TABLE、漏改进级路径」的提交会【立即变红】。

【Non-goals】（本契约【不】解决，且【不得】顺手解决）
  ❌ H-1（Evaluation / Pool sufficiency 双重漂移）—— 独立语义契约，需先冻结 SoT
  ❌ H-2（knowledge projection 无事务边界）—— 独立原子性契约
  ❌ H-3（transaction() deferred BEGIN）· H-4（void 异步收尾）· H-5（start() 半状态）
  ❌ M-1…M-10（含 M-5 FK/CHECK · M-6 WAL · M-10 迁移事务边界）
  ❌ 重构 migration 子系统 / 引入 schema version 表 / 引入新的迁移框架
  ❌ 修改任何非 material 表的结构或语义
  ❌ 修改 README.md / package.json / docs/audit-2026/ / .acl-recovery-notes.txt（同事产物）
  ❌ 修改已冻结契约（AF-1C / AF-4 / R2 / Composition / R-2B-A）
```

---

## §2 Current Facts（C-1 取证 · 逐字事实）

```text
[F-1] 基线声明（CREATE TABLE material，research-db.ts:320 起）
      L349  ingest_overlaps_json TEXT NOT NULL DEFAULT '[]',
      （同一 CREATE TABLE 内的 ingest_* 兄弟列：L334 ingest_status · L335 ingest_stage ·
        L336 ingest_error · L341 ingest_attempts · L342 ingest_owner · L343 ingest_lease_until ·
        L346 ingest_generation · L350 ingest_blocks_json ⇒ ingest_* 共 9 个）

[F-2] 升级路径（research-db.ts:951-962 ensureMaterialIngestColumns()）
      private ensureMaterialIngestColumns(): void {
        this.addColumnIfMissing("material", "ingest_status", …);
        this.addColumnIfMissing("material", "ingest_stage", …);
        this.addColumnIfMissing("material", "ingest_error", …);
        this.addColumnIfMissing("material", "parser_version", …);
        this.addColumnIfMissing("material", "model_version", …);
        this.addColumnIfMissing("material", "ingest_attempts", …);
        this.addColumnIfMissing("material", "ingest_owner", …);
        this.addColumnIfMissing("material", "ingest_lease_until", …);
        this.addColumnIfMissing("material", "ingest_generation", …);
        this.addColumnIfMissing("material", "ingest_blocks_json", …);
      }
      ⇒ ★ 补 10 列，【独缺 ingest_overlaps_json】

[F-3] 迁移辅助机制（research-db.ts:935-944 addColumnIfMissing）
      PRAGMA table_info(table) 预检 → 已存在则 return；否则 db.exec(ddl)；
      catch 后再 PRAGMA 复核，仍未出现才 rethrow（并发安全网）。
      ⇒ 幂等：重复执行不会因"列已存在"而失败。

[F-4] schema evolution 机制
      ★ 本库【没有 schema version / user_version 表】
        （全仓 "schema_version" 唯一命中 = research-db.ts:478 的 ResearchArtifact 列名）。
      migrate()（L54）先执行全部 `CREATE TABLE IF NOT EXISTS`，再依次调用各 ensure* 补旧库列。
      migrate() 内的调用顺序（L609-624）：
        L609 ensureIndustryKnowledgeColumn() · L610 ensureMethodologyDimensionsColumn()
        L611 ensureRequirementConditionColumns() · L612 ensureCompanyTargetKindsColumn()
        L613 ensureS45Columns()
        L618 ensureMaterialIngestColumns()        ← ★ 目标（在 CREATE TABLE material 之后）
        L619 ensureMaterialContentUniqueness() · L622 ensureProposalActiveUniqueness()
        L623 ensureCandidateSupersedesColumn() · L624 ensureCandidateRevisedColumn()
      ⇒ migrate() 自身【不开启事务】（L627 注释：deliberately opens no transaction）。

[F-5] 失败面（写入路径均点名该列）
      storage/research-repository.ts
        L591-595  INSERT INTO material (…, ingest_overlaps_json, ingest_blocks_json) VALUES (23 个 ?)
        L616      ON CONFLICT(material_id) DO UPDATE SET …, ingest_overlaps_json = excluded.ingest_overlaps_json
        L757-761  UPDATE material SET …, ingest_overlaps_json = ?, … WHERE material_id = ? AND ingest_generation = ?
      ⇒ 旧库缺列时，首次写入报：table material has no column named ingest_overlaps_json

[F-6] 驱动：storage/research-db.ts:9 `import { DatabaseSync } from "node:sqlite"`（Node 内置 SQLite）。

[F-7] 现有测试基线：`npm test` = 704 tests / 162 suites · pass 704 · fail 0（实测，本契约基线）。
      与 DB schema 相关的既有测试文件（候选影响面）：
        c-mvp-r1.test.ts · idempotency.test.ts · pool-slot-migration.test.ts ·
        phase-c6-extraction-run-migration.test.ts · s45-signal-integrity.test.ts ·
        knowledge.test.ts · data-r1-legacy-methodology.test.ts · phase-c6-fragment.test.ts ·
        readonly.test.ts
      ★ migration.test.ts（39 行）测的是 migratePiToTiancha（.pi → .tiancha 目录复制），
        与 DB schema migration 无关。
```

---

## §3 Contract Items（C1-MIG-01 … C1-MIG-08）

```text
C1-MIG-01  Fresh / Upgrade Schema Equivalence
  对于 `material` 表，必须成立：
        fresh DB（CREATE TABLE 路径）的列集合
        ==
        最新升级后的 legacy DB 的列集合
  判定对象 = 该表的 **schema projection** —— ★ 精确为 `{ name, type, notnull, dflt_value }`
             （经 `PRAGMA table_info(material)` 归一化后比对；**不**比较 CREATE TABLE 的 ddl 字符串）。
  ★ 不要求全库所有表等价（本契约只覆盖 material）；且新加守卫测试【只约束 material】，
    不得泛化为全库守卫（避免扩大 scope）。

C1-MIG-02  ingest_overlaps_json 三处闭合
  CREATE TABLE material 声明  ⇒  upgrade path 补列  ⇒  repository 写入
  三者必须对同一列 `ingest_overlaps_json` 闭合。缺任一环即为违反。

C1-MIG-03  精确 schema 属性（不得只验证"列存在"）
  升级路径新增的列必须与基线声明逐属性一致：
        name    = ingest_overlaps_json
        type    = TEXT
        NOT NULL（notnull = 1）
        DEFAULT = '[]'
  ★ 候选实现（**仅为候选，不是已授权实现**）：
        this.addColumnIfMissing("material", "ingest_overlaps_json",
          "ALTER TABLE material ADD COLUMN ingest_overlaps_json TEXT NOT NULL DEFAULT '[]'");
  ⚠️ 契约要求：实现前必须确认 ——
        · 类型是否必须 TEXT（对照 [F-1]）
        · default 是否必须 '[]'（对照 [F-1]）
        · 旧数据如何填充（SQLite 的 ADD COLUMN + NOT NULL + DEFAULT 会把既有行填为 DEFAULT）
        · 是否与 fresh schema 完全一致（C1-MIG-01）
  ⚠️ SQLite 限制：ADD COLUMN 的 NOT NULL 必须带非 NULL DEFAULT（本列满足）。

C1-MIG-04  Migration Idempotence
  migration(old DB) 成功 ⇒ migration(同一 DB 再次) 必须【保持有效】且【不因列已存在而失败】。
  复用既有 addColumnIfMissing() 的 PRAGMA 预检语义（[F-3]）；
  ★ 不得为本项新增第二套幂等机制、不得重写 migration helper。

C1-MIG-05  Old DB Fixture（真实写入 + 既有行断言，不得只测 PRAGMA）
  必须有一个【真正的旧 schema fixture】：构造一个不含 `ingest_overlaps_json` 的 material 表，
  并预置至少一行 legacy material 数据，然后：
        old DB（含 legacy row）
          ↓ 运行 migration
          ↓ PRAGMA table_info(material) 断言列存在（且属性正确）
          ↓ ★ SELECT ingest_overlaps_json（该 legacy row） ⇒ 必须 = "[]"（C1-Q-3 · 显式断言，并验证 NOT NULL）
          ↓ 执行【真实 material 写入】（走 repository 路径 / 等价 SQL）
          ↓ PASS
  ★ 理由（审计已证）："migration 跑成功" ≠ "真实写入路径可用"；
    且 ADD COLUMN + DEFAULT 对【既有行】的读取语义必须被验证，
    否则产生新的 Fresh('[]') / Legacy(NULL) 语义漂移。
  ★ 落点 = 独立测试文件（C1-Q-1）。

C1-MIG-06  Fresh DB Regression
        fresh DB
          ↓ CREATE TABLE 路径
          ↓ 真实 material 写入
          ↓ PASS
  证明本修复没有破坏全新库路径。

C1-MIG-07  Migration Ordering / schema evolution boundary
  必须证明新增补列位于【正确的 schema evolution boundary】：
        · 它在 ensureMaterialIngestColumns() 内（而非散落别处）；
        · 该函数在 migrate() 的 CREATE TABLE material **之后** 执行（[F-4] L618 > L320）；
        · 与既有 ensure* 链的先后关系不被改变（不插入新函数、不重排既有调用）；
        · ★ 因为本库没有 schema version 表（[F-4]），"正确 boundary" 的定义是
          「CREATE TABLE 建全新库 + ensure* 幂等补旧库」这一既有模型的自然延伸，
          【不】引入版本号、【不】引入迁移序列表。

C1-MIG-08  Concurrency / Existing Safety
  新增列必须遵守既有 addColumnIfMissing() 的并发/幂等语义（PRAGMA 预检 + catch 复核）。
  ★ 修 C-1，**不顺手重构 migration 子系统**：
        ❌ 不重写 addColumnIfMissing · ❌ 不统一所有 ensure* · ❌ 不改 migrate() 的事务性
        ❌ 不引入迁移框架 / 版本表 / 回滚机制
```

---

## §4 Test Matrix（必须全部 PASS）

| # | 场景 | 必须 PASS |
|---|---|---|
| 1 | Fresh DB creation（CREATE TABLE 路径） | ✅ |
| 2 | Legacy DB **缺** `ingest_overlaps_json` 的 fixture | ✅ |
| 3 | Migration 补上该列 | ✅ |
| 4 | 列属性正确 —— ★ 经 `PRAGMA table_info(material)` 归一化后比对 `{name, type, notnull, dflt_value}`（C1-Q-2）| ✅ |
| 5 | Migration 后【真实 material 写入】成功 | ✅ |
| 6 | ★ 既有 legacy material 行在迁移后 `SELECT ingest_overlaps_json` = `"[]"`（C1-Q-3 · 显式断言）| ✅ |
| 7 | Migration 重复执行（幂等） | ✅ |
| 8 | 既有 migration 测试全绿 | ✅ |
| 9 | 全量 research 测试（`npm run test:research`）全绿 | ✅ |
| 10 | 全量仓库测试（`npm test`）全绿 | ✅ |

```text
★ 第 9 / 10 项不可省；且必须报告 suite 数 / 失败 / skip 的变化（不得只说"通过"）。
★ 第 5 项必须走【真实写入】（repository 或等价 SQL），不得只断言 PRAGMA。
★ 守卫测试（C1-MIG-01）：断言「CREATE TABLE material 的列集合 == 升级后列集合」，
  比较对象 = 归一化后的 `{name, type, notnull, dflt_value}`（**不**比较 ddl 字符串）；
  ★ 该守卫【只约束 material】，不泛化全库。
★ 测试落点 = 独立文件 `packages/research/src/storage/c1-material-migration.test.ts`（C1-Q-1）。
```

---

## §5 MUST / MUST NOT

```text
【MUST】
C1-7-1  在 ensureMaterialIngestColumns() 内补 `ingest_overlaps_json`，属性与 [F-1] 一致。
C1-7-2  新增旧库 fixture 测试（C1-MIG-05），并含【真实写入】断言。
C1-7-3  新增 fresh DB 回归测试（C1-MIG-06）。
C1-7-4  新增 material 列集合等价守卫（C1-MIG-01），仅约束 material。
C1-7-5  复用既有 addColumnIfMissing()，不新增第二套补列机制。
C1-7-6  验证后报告：research typecheck / root typecheck / research suite / full suite 的数字。

【MUST NOT】
C1-7-7  ❌ 只加一行 ALTER 就当完成（必须同时满足 C1-MIG-01…08 与测试矩阵）。
C1-7-8  ❌ 重构 migration 子系统 / 重写 addColumnIfMissing / 统一 ensure* 链。
C1-7-9  ❌ 引入 schema version 表 / user_version / 迁移序列表 / 回滚机制。
C1-7-10 ❌ 修改 material 之外的任何表结构。
C1-7-11 ❌ 触碰 H-1 / H-2 / H-3 / H-4 / H-5 / M-1…M-10。
C1-7-12 ❌ 修改 README.md / package.json / docs/audit-2026/ / .acl-recovery-notes.txt。
C1-7-13 ❌ 修改任何已冻结契约（AF-1C / AF-4 / R2 / Composition / R-2B-A）。
C1-7-14 ❌ 修改 repository 写入 SQL（三条路径已点名该列，属基线，不改）。
C1-7-15 ❌ commit / push（须另行授权）。
```

---

## §6 Invariants（C1-INV-*）

```text
C1-INV-1  fresh DB 的 material 列集合 == 最新升级后的 legacy DB material 列集合（C1-MIG-01）。
C1-INV-2  `ingest_overlaps_json` 在 CREATE TABLE / upgrade path / 写入路径三处闭合（C1-MIG-02）。
C1-INV-3  升级路径新增列的属性 = { TEXT, NOT NULL, DEFAULT '[]' }（C1-MIG-03）。
C1-INV-4  migration 幂等：重复执行不失败（C1-MIG-04）。
C1-INV-5  迁移后【真实写入】必须成功（C1-MIG-05 · 不是"迁移成功"）。
C1-INV-6  修复不改变 fresh 路径行为（C1-MIG-06）。
C1-INV-7  新增补列位于既有 schema evolution boundary，不引入版本机制（C1-MIG-07）。
C1-INV-8  修复不扩大 migration 子系统（C1-MIG-08）。
C1-INV-9  不触碰同事产物与已冻结契约（§5 C1-7-11…13）。
```

---

## §7 Forbidden Files（C-1 不得触碰）

```text
· README.md · package.json                    （同事改动）
· .acl-recovery-notes.txt · .acl-pre-repair.sddl.txt  （同事产物）
· docs/audit-2026/**                           （同事审计产物）
· docs/phaseC/execution-provider*.md · execution-coordinator*.md · round-execution-driver*.md
· docs/phaseC/composition-session-ownership-contract.md（🔒 FROZEN + 待提交 §22）
· docs/phaseC/r2b-a-implementation-contract.md（🔒 FROZEN）
· packages/research/src/domain/** · application/** · runtime/** · ports/** · providers/**
  （C-1 只涉及 storage/research-db.ts 与 migration 测试）
· 任何 H-1 / H-2 / H-3 / H-4 / H-5 / M-* 相关文件
```

---

## §8 Expected File Impact

```text
Expected implementation files（预计 1 个生产文件）：
  1. packages/research/src/storage/research-db.ts   ← ensureMaterialIngestColumns() 补 1 行

Expected test files（1 个新增独立文件 —— C1-Q-1 裁定）：
  1. packages/research/src/storage/c1-material-migration.test.ts
     （旧库 fixture + 真实写入 + 既有行 '[]' 断言 + 幂等 + fresh 回归 + material 列等价守卫）

★ 核心生产文件数 = 1。
★ ★ Implementation Review Gate（用户裁定）：若实现中发现必须改第 2 个生产文件
     （Observed = research-db.ts + 任何其他生产文件）⇒ **STOP ⇒ 报告**，不得自行扩大 scope。
```

---

## §9 Verification Plan

```text
1. 定向：C-1 专项测试（旧库 fixture → 迁移 → 真实写入 → PASS；幂等；fresh 回归；列等价守卫）
2. typecheck：root `npm run typecheck` + `npm run typecheck:research`（均须 exit 0）
3. 全量 research：`npm run test:research`（报告 suite / pass / fail / skip 变化）
4. 全量仓库：`npm test`（报告 704 → 新值 的变化；失败必须为 0）
5. Gate：material 列集合等价（fresh vs migrated）
6. Gate：不新增/不重写 migration helper（静态检查 addColumnIfMissing 调用形态）
7. Gate：未触碰 Forbidden Files（git status 对照）
8. 不 commit / 不 push（另行授权）
```

---

## §10 Open Questions（已裁定 · RESOLVED）

```text
C1-Q-1  测试落点                                            🟢 RESOLVED
  裁定：**独立测试文件**（不并入 c-mvp-r1.test.ts / idempotency.test.ts）。
  理由：C-1 有自己的长期回归边界（Fresh + Legacy upgrade + Schema equivalence +
        Real write + Idempotence），与「一个行为属性」的 idempotency 测试变化轴不同。
  落点：`packages/research/src/storage/c1-material-migration.test.ts`
        （文件名须使人一眼看出它守护 C-1 migration invariant）。

C1-Q-2  列等价守卫强度                                       🟢 RESOLVED
  裁定：**(b) 结构化属性全比** —— `{ name, type, notnull, dflt_value }`。
  实现方式：`PRAGMA table_info(material)` → normalize → compare。
  ★ 只比列名集合太弱（如 `TEXT NOT NULL DEFAULT '[]'` vs `INTEGER` 列名集合相同但语义不同）。
  ★ **不得**比较 `CREATE TABLE` 的 SQL 字符串（ddl 文本/空白/约束排列不是本项目标）。

C1-Q-3  既有 material 行的填充值断言                              🟢 RESOLVED
  裁定：**必须显式断言**。
  要求：legacy material row → migration → `SELECT ingest_overlaps_json` ⇒ `"[]"`；
        并验证 NOT NULL 语义，不得只断言「列存在」。
  理由：ADD COLUMN + DEFAULT 对**既有行**的读取语义必须被验证，否则会产生新的
        Fresh（'[]'） / Legacy（NULL 或意外值）语义漂移。

C1-Q-4  README / 测试计数是否一起修                              🟢 RESOLVED
  裁定：**否**。README 属 Documentation Accuracy 工作线，不混入 C-1
        （且 README.md / package.json 已有同事未提交修改 ⇒ §7 Forbidden）。
```

---

## §11 Status

```text
C-1 Migration Remediation Contract（rev1）  🔒 FROZEN（Contract Review PASS + 4 项 Q 裁定已落入）
  §2 Current Facts（F-1…F-7）               🟢 已取证
  §3 C1-MIG-01…08                           🔒 frozen（本契约核心）
  §4 Test Matrix（10 项，含 Q-2/Q-3 收紧）    🔒 frozen
  §5 MUST / MUST NOT                        🔒 frozen
  §6 C1-INV-1…9                             🔒 frozen
  §7 Forbidden Files                        🔒 frozen
  §8 Expected File Impact（1 生产文件 + 1 独立测试 + STOP Gate）  🔒 frozen
  §9 Verification Plan（含 Implementation Review Gate）           🔒 frozen
  §10 C1-Q-1…4                              🟢 RESOLVED（4/4）

C-1 implementation        ⛔ NOT AUTHORIZED
H-1 / H-2 / H-3 / H-4 / H-5 / M-*   ⛔ NOT AUTHORIZED
Commit / Push             ⛔ NOT AUTHORIZED
```

---

## §12 Revision identity

```text
· 本文件为 rev1 首次落盘（初版 DESIGN ONLY），此后经 Contract Review PASS 与
  C1-Q-1…4 裁定落入，冻结为 **🔒 FROZEN（rev1）**。
· ★ Freeze 记录：rev1 已经 §3 C1-MIG-01…08 / §4 Test Matrix / §5 MUST·MUST NOT /
  §6 Invariants / §7 Forbidden Files / §8 File Impact / §9 Verification Plan 全部 ACCEPTED，
  且 C1-Q-1…4 全部 RESOLVED 后冻结。
· 本文件派生自 docs/audit-2026/ 的 C-1 发现与只读 Preflight 取证；
  不修改任何已冻结契约（AF-1C / AF-4 / R2 / Composition / R-2B-A）的文本。
· 本文件不含代码、不含 schema 变更、不含 migration 执行。
```

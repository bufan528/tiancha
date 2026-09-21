# 09 · .pi → .tiancha Migration Layer 设计（Migration Layer Design）

> 版本：P0v3（Architecture Lock）
> 上游 commit：`19451accdeec671c1f4da9eafac8fc270f510ef4`
> 本文覆盖 P1-11：产品改名 `tiancha` 后，如何从旧 Pi 平滑迁移，且不破坏 Pi 兼容契约（03）。不写实现代码。

## 1. 目标

- 产品配置目录从 `~/.pi/agent` 迁到 `~/.tiancha/agent`（全局 scope）。
- 项目级配置从 `<cwd>/.pi` 迁到 `<cwd>/.tiancha`（project scope）——**必须保留项目自己的 skills/extensions，不能让旧项目 `cd project && tiancha` 后项目级资源消失**。
- 不静默迁移；用户确认后才动。
- 旧 Pi 会话**只读恢复**，不写回旧目录；只读不靠 `SessionManager.open()` 本身，由天查侧强制（见 §6）。

## 2. 启动检测

1. 启动时检查新目录 `~/.tiancha/agent` 是否已有 marker。
2. 若无 marker，检查旧 `~/.pi/agent` 是否存在。
3. 存在旧目录 → 提示用户确认迁移；不存在 → 直接用新目录启动。
4. 另需在每个项目 cwd 检测 `<cwd>/.pi` 是否存在（project scope）；存在则按 §3 的项目级规则迁移/引用，不依赖全局 marker。

## 3. 分类迁移（逐类处理；全局与项目级分列）

### 3.1 全局 scope（`~/.pi/agent` → `~/.tiancha/agent`）

| 类别 | 旧位置 | 处理方式 |
|---|---|---|
| model config | `~/.pi/agent/models.json` | 复制到新目录 |
| auth | `~/.pi/agent/auth.json` | **复制（不移动）**，保留原文件 |
| session | `~/.pi/agent/sessions/` | **标记只读**，新会话写入新目录 |
| settings | `~/.pi/agent/settings.json` | 合并迁移 |
| skills（user scope） | `~/.pi/agent/skills/`、`~/.agents/skills/` | 迁移/引用到 `~/.tiancha/agent/skills/` |
| extensions | `~/.pi/agent/extensions/` | 迁移到 `~/.tiancha/agent/extensions/` |

### 3.2 项目级 scope（`<cwd>/.pi` → `<cwd>/.tiancha`）

Pi 源码 `src/core/skills.ts` 证据：skills 发现有两处——全局 `~/.pi/agent/skills`（scope `"user"`）与项目级 `<cwd>/.pi/skills`（scope `"project"`，常量 `CONFIG_DIR_NAME=".pi"`）。迁移后分别对应 `~/.tiancha/agent/skills` 与 `<cwd>/.tiancha/skills`。

| 类别 | 旧位置 | 处理方式 |
|---|---|---|
| 项目级 skills | `<cwd>/.pi/skills/` | 迁移/引用到 `<cwd>/.tiancha/skills/`；**项目级资源随项目走，不因全局 marker 而丢失** |
| 项目级 extensions | `<cwd>/.pi/extensions/`（若存在） | 迁移到 `<cwd>/.tiancha/extensions/` |
| 项目级上下文 | `<cwd>/.pi/` 下其他配置 | 平移到 `<cwd>/.tiancha/`，保持目录结构 |

> **防丢失约束**：用户在旧项目里 `cd project && tiancha` 时，项目级 `<cwd>/.tiancha/skills`（及 extensions）必须仍能被 `ResourceLoader` 以 scope `"project"` 发现。迁移层只改目录名 `.pi`→`.tiancha`，不改发现逻辑的相对层级；全局 marker 已写时，项目级仍按 `<cwd>` 独立检测。

## 4. 模型五层区分（P1-13）

迁移时不混淆五层：

1. Built-in Model Catalog（`getModel`）
2. Generated Model Metadata（`providers/data/*.json`）
3. User Custom Models（`models.json`）
4. Persistent Model Store（`models-store.json`，`modelsStorePath/modelsStore`）
5. Auth Store（`auth.json`，`authPath/credentials`）

## 5. marker 与幂等

- 迁移完成写 marker；二次启动不再提示、不重复迁移。
- 失败/取消 → 不写 marker，下次可重试。
- 全局 marker 与项目级检测分离：全局 marker 只控制 `~/.tiancha/agent` 的重复迁移提示；项目级 `<cwd>/.pi` 的检测每次启动按 cwd 独立进行（幂等：已迁到 `<cwd>/.tiancha` 且旧 `<cwd>/.pi` 已处理则不重复动）。

## 6. 旧会话只读恢复（写实，不靠 open()）

**关键事实（核对报告）**：`SessionManager.open(path, sessionDir?, cwdOverride?)` 只是"打开/加载一个已存在的会话文件"——读 header、取 cwd、定位 sessionDir，返回绑定该文件的 `SessionManager`。它本身**不强制只读**；`SessionManager` 同时提供 append / branch / label 等写操作。因此"用 open() 打开"≠"只读"，只读必须由天查侧实现。

天查侧只读实现三选一/组合：

- **`ReadOnlySessionManager`**：对旧 Pi session 包一层只读 SessionManager，写方法（append/branch/label/工具结果落盘）全部 throw 或 no-op。
- **`SessionMode = read-only`**：在会话装配层显式标记本会话为只读模式，写路径在入口拦截。
- **`StoragePolicy = read-only`**：在持久化/存储层对旧目录路径设置 read-only 策略，任何写穿到旧 `.pi` 路径即被拒。

**验收测试（必须全绿才算只读成立）**：

| 用例 | 操作 | 期望 |
|---|---|---|
| T1 message write | 向旧 Pi session 追加一条 message | **reject**（写入被拒/落新目录而非旧文件） |
| T2 tool result write | 在旧 session 内跑工具并尝试落 tool result | **reject**（工具结果不得写回旧 `.pi` session 文件） |
| T3 fork | 对旧 session 执行 fork/branch | **redirect 到新 Tiancha session**（新会话建在 `~/.tiancha` 或 cwd 新目录，绝不写旧路径） |
| T4 compaction | 触发 compaction | **no write**（压缩不向旧 session 文件回写；如需落盘则落到新目录只读镜像） |

> 恢复出的会话可读、可追问（追问产物进新 session），但不允许 fork/write/compaction 回写到旧 `.pi` 路径。

## 7. 验收（对应 03 §7）

- 有旧目录 → 弹确认；无旧目录 → 直启。
- 全局六类分别迁移后可用；项目级 `<cwd>/.pi/skills`、extensions 迁到 `<cwd>/.tiancha/` 后仍被发现（`cd project && tiancha` 项目资源不丢）。
- 二次启动不重复提示（全局 marker 与项目级幂等各自成立）。
- 旧会话可读不可改：§6 的 T1–T4 全绿。

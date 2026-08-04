# System Prompt 库（Prompt Library）

> 定义「会话级 System Prompt」功能：库数据模型、内置基础 Prompt、会话绑定与锁定规则、UI 交互、缓存影响。
> 需求来源：FR-11（见 01-requirements/requirements.md）。本文件是 04-frontend 模块下的专门文档，
> 与 chat-state.md（会话模型）、settings.md（库管理入口）、session-storage.md（持久化）、context-cache.md（前缀冻结）互相引用。

## 1. 功能概述

1. **会话级 System Prompt**：每个会话在「对话开始前」指定自己使用的 System Prompt；**对话开始后（该会话发送第一条用户消息起）锁定，无法更改**。
2. **System Prompt 库**：用户可自行编写、存储、管理多条 System Prompt，供新建会话时选用。
3. **内置基础 Prompt**：系统内置一条基础 System Prompt（不可删除、不可编辑），作为默认选项兜底。

## 2. 数据模型（lib/types.ts 追加）

```ts
export interface SystemPrompt {
  id: string;             // uuid；内置条目固定为 "builtin-default"
  name: string;           // 显示名（库列表中展示）
  content: string;        // 完整 System Prompt 文本（instructions 内容）
  isBuiltin: boolean;     // 内置条目 = true（不可编辑/删除）
  createdAt: number;
  updatedAt: number;
}

// 内置基础 Prompt：代码常量（lib/prompts/builtin.ts），不落库、不可删改
export const BUILTIN_DEFAULT_PROMPT: SystemPrompt = {
  id: "builtin-default",
  name: "基础助手",
  isBuiltin: true,
  content: [
    "你是 DeepSeek 网页版助手，请用简洁、准确、友好的中文回答用户问题。",
    "回答结构清晰，适当使用 Markdown（列表、代码块、表格）组织内容；",
    "涉及代码时给出可直接运行的完整示例；",
    "遇到不确定的信息请如实说明，不要编造。",
  ].join("\n"),
  createdAt: 0,
  updatedAt: 0,
};
```

### Session 扩展字段

```ts
interface Session {
  // ...既有字段
  systemPromptId: string;    // 选用的库条目 id；内置为 "builtin-default"
  systemPromptText: string;  // System Prompt 内容【快照】——首条消息发送时冻结，之后不变
}
```

**快照而非引用**（关键设计）：
- 会话持有的是 `systemPromptText` **内容快照**，不是指向库条目的指针；
- 对话开始后即使库中对应条目被修改/删除，已开始会话的 instructions **不受影响**（前缀缓存稳定，见 context-cache.md 规则 1）；
- `systemPromptId` 仅用于 UI 展示「该会话使用了哪条库条目」；条目被删后展示回退为「自定义」。

## 3. 生命周期与锁定规则（核心）

```
新建会话（空会话，无任何消息）
  ├─ 预选：settings.defaultSystemPromptId 指向的条目（默认内置基础 Prompt）
  ├─ 可更换：欢迎视图/顶栏显示选择器，可切换库中任意条目（含内置）
  └─ 【对话开始】= 该会话发送第一条 user 消息（产生第一次请求）的瞬间
       ├─ 冻结：将当前选中条目的 content 复制进 session.systemPromptText（快照）
       ├─ 锁定：UI 不再提供更换入口，仅显示只读的 System Prompt 名称（tooltip 可查看全文）
       └─ 此后所有请求的 instructions = 该快照，恒不变
```

**锁定判定（派生，不新增字段）**：`promptLocked = session.messages.some(m => m.role === "user")`。

规则细化：
| # | 规则 |
|---|---|
| 1 | 空会话（无 user 消息）可任意更换 System Prompt，**不影响任何已发送请求**（尚无请求发出） |
| 2 | 首条 user 消息写入消息列表的同时执行冻结（同一原子操作内完成，见 chat-state.md sendMessage 步骤 2/3） |
| 3 | 锁定后：UI 隐藏选择器；`systemPromptText` 快照不再被任何路径修改 |
| 4 | 「重试/重新生成」不改变 System Prompt（快照不变） |
| 5 | 删除库条目不影响已锁定会话（快照独立）；仅影响后续新建会话的可用选项 |
| 6 | 修改库条目不影响已锁定会话；仅影响尚未开始的新会话（重新选择时取最新 content） |
| 7 | 无「不使用 System Prompt」选项：每个会话必有 System Prompt（默认内置基础），保证 instructions 恒有稳定前缀 |

## 4. UI 设计

### 4.1 新会话选择器（对话开始前）

- 位置：欢迎视图（空会话）的 System Prompt 卡片，或顶栏模型选择器旁的下拉（二选一实现，推荐**欢迎视图卡片 + 顶栏下拉**双入口保持一致）
- 呈现：显示当前 System Prompt 名称 + 「更换」按钮；点击弹出库选择弹窗：
  - 条目列表（名称 + 内容预览 2 行省略 + 内置徽标「内置」）
  - 底部「管理 System Prompt 库…」入口（跳转设置库管理）
- 交互：点选即生效（不弹确认，空会话无副作用）；Esc/遮罩关闭

### 4.2 锁定标识（对话开始后）

- 顶栏模型选择器旁显示只读胶囊：`📋 基础助手`（当前 System Prompt 名称，点击 tooltip 展示全文）
- 无「更换」按钮；胶囊样式为纯展示（不可点击编辑）
- 欢迎视图中的选择卡片在锁定后消失（该视图只存在于空会话）

### 4.3 库管理（设置对话框内）

位置：设置对话框新增「System Prompt 库」区块（列表 + 操作）：

| 操作 | 行为 |
|---|---|
| 新建 | 表单：名称（必填，≤50 字）+ 内容（必填，textarea 多行）+ 保存 |
| 编辑 | 同新建表单，预填；**内置条目不显示编辑/删除** |
| 删除 | 二次确认；内置条目禁止删除（按钮禁用） |
| 设为默认 | 设置 `settings.defaultSystemPromptId`；当前默认项显示「默认」徽标 |

- 列表按 `updatedAt` 倒序；内置条目恒置顶
- 名称冲突：允许重名（id 区分），不强制唯一
- 内容长度上限：建议 8000 字符（UI 校验 + 提示）

## 5. 与既有「自定义指令」的关系（迁移）

- **废弃** `settings.systemPrompt`（全局自定义指令）字段，由本功能取代：System Prompt 从「全局一份」升级为「库 + 会话级快照」
- 迁移：旧设置中已填写的 `settings.systemPrompt` 内容在首次升级时自动导入为库中一条自定义条目（name「我的自定义指令」）并设为默认；此后该字段不再读写（session-storage.md 第 4 节）
- 理由：全局自定义指令改动会破坏**所有**会话的前缀缓存；会话级快照 + 锁定把缓存失效面从「全局」收敛到「单个新会话」，是对 FR-7 的强化

## 6. 缓存影响（与 context-cache.md 联动）

- `instructions = session.systemPromptText`（快照），会话内**恒冻结** → 前缀缓存最优（比原全局字段更稳定）
- 规则更新：context-cache.md 第 3 节规则 1 改为「会话内 instructions（= System Prompt 快照）不变；库条目编辑不影响已开始会话」
- 内置基础 Prompt 的 content 作为代码常量，版本迭代时**不得修改已有会话快照**（快照已冻结）；仅影响新建会话

## 7. 边界情况

| 场景 | 行为 |
|---|---|
| 锁定后用户想换 System Prompt | 不支持修改；引导「新建对话并选择其他 System Prompt」（可一键复制当前会话标题/上下文到新会话——可选增强，不做） |
| 删除被引用条目 | 已锁定会话快照不受影响；`settings.defaultSystemPromptId` 指向已删条目时回退 `"builtin-default"` |
| 编辑被引用条目 | 已锁定会话不受影响；空会话重新选择时取最新 content |
| 库为空（全部自定义被删） | 内置条目恒在，默认回退内置，无空态 |
| 新建会话立即发送 | 冻结发生在第一条消息发送瞬间（预选条目生效），无额外步骤 |
| 流式中/停止后 | 锁定状态不变 |

## 8. 实现要点 Checklist

- [ ] `lib/types.ts`：SystemPrompt 类型 + Session 扩展字段
- [ ] `lib/prompts/builtin.ts`：BUILTIN_DEFAULT_PROMPT 常量
- [ ] `lib/storage/db.ts`：新增 `prompts` object store（见 session-storage.md）
- [ ] 前端：PromptSelectDialog（库选择）、PromptManager（库管理 CRUD + 设为默认）、PromptBadge（锁定只读标识）
- [ ] chat-state.md：sendMessage 冻结步骤 + 快照写入
- [ ] 单测：锁定规则（首条 user 消息 → 快照冻结）、删除/编辑条目的快照隔离、默认值回退

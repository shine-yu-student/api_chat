# 会话与设置存储（Storage）

> 定义本地持久化方案：IndexedDB（会话/消息，通过 `idb` 库）与 localStorage（设置/API Key）。

## 1. 存储分工

| 数据 | 介质 | 理由 |
|---|---|---|
| 会话列表 + 全部消息（含 reasoning/usage） | **IndexedDB**（`idb` 库） | 数据量大（1M 上下文会话可达数 MB），localStorage 5MB 上限不够；IndexedDB 异步不阻塞主线程 |
| System Prompt 库（用户自定义条目） | **IndexedDB**（`prompts` store） | 与会话同库统一管理；条目可含长文本；内置条目为代码常量不落库 |
| 设置（模型默认、开关、默认 System Prompt、主题） | **localStorage** | 小数据、同步读取、启动即用 |
| API Key | **localStorage**（独立 key） | 见 settings.md 第 3 节 |

## 2. IndexedDB schema（lib/storage/db.ts）

```
DB: "deepseek-chat-db"    version: 3
ObjectStore: "sessions"   keyPath: "id"    （存 Session 全量对象，含 messages 数组）
Index: "updatedAt"        （按更新时间倒序列举会话）
ObjectStore: "prompts"    keyPath: "id"    （存用户自定义 SystemPrompt；内置条目不落库）
Index: "updatedAt"        （按更新时间倒序列举库条目）
```

> ⚠️ **版本历史**：v1/v2 存在历史缺陷——upgrade 仅创建 prompts，sessions store 从未被创建，
> 导致 putSession/getAllSessions 抛 NotFoundError 且被静默吞掉（刷新后对话"丢失"）。
> v3 在 upgrade 中用 `oldVersion < 3 && !contains("sessions")` 幂等补建 sessions，覆盖旧库升级与全新创建两条路径。

```ts
// 用 idb 库（Promise 封装，无回调地狱）
import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "deepseek-chat-db";
let dbPromise: Promise<IDBPDatabase> | null = null;
export function getDb() {
  dbPromise ??= openDB(DB_NAME, 3, {
    upgrade(db, oldVersion) {
      // 修复历史缺陷：任何旧版本都确保 sessions 存在（幂等）
      if (oldVersion < 3 && !db.objectStoreNames.contains("sessions")) {
        const store = db.createObjectStore("sessions", { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      }
      if (oldVersion < 2 && !db.objectStoreNames.contains("prompts")) {
        const store = db.createObjectStore("prompts", { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      }
    },
  });
  return dbPromise;
}

export async function getAllPrompts(): Promise<SystemPrompt[]> {
  const db = await getDb();
  return db.getAllFromIndex("prompts", "updatedAt");
}

export async function putPrompt(p: SystemPrompt) {
  const db = await getDb();
  await db.put("prompts", p);
}

export async function deletePrompt(id: string) {
  const db = await getDb();
  await db.delete("prompts", id);
}

export async function getAllSessions(): Promise<Session[]> {
  const db = await getDb();
  return db.getAllFromIndex("sessions", "updatedAt"); // 倒序：getAllFromIndex 升序，使用前 reverse
}

export async function putSession(s: Session) {
  const db = await getDb();
  await db.put("sessions", s);
}

export async function deleteSession(id: string) {
  const db = await getDb();
  await db.delete("sessions", id);
}
```

> 迁移策略：`version` 递增 + `upgrade` 中 `store.indexNames.contains` 判断增量建索引；未来加字段只改类型不迁移（无索引依赖的字段直接兼容）。

## 3. Session 对象结构（与 chat-state.md 一致）

```ts
interface Session {
  id: string;            // crypto.randomUUID()
  title: string;
  model: ModelId;
  systemPromptId: string;    // 选用的库条目 id（内置 "builtin-default"）；仅展示用
  systemPromptText: string;  // System Prompt 内容快照（首条消息时冻结，FR-11）
  messages: StoredMessage[];   // 完整消息（分支树平铺，按创建序；parentId 表达树结构，FR-12）
  activeLeafId?: string;       // 对话分支：当前查看/编辑路径的叶子消息 id（FR-12）
  createdAt: number;
  updatedAt: number;
}
```

- **单文档存储整个会话**（而非每条消息一条记录）：读写原子、天然保序、会话删除一条语句；1M 上下文场景单会话 ≤ 几 MB，IndexedDB 单值上限足够（Chrome 无硬限制，Firefox ~2GB）。
- 消息 id：`crypto.randomUUID()`。
- **分支字段无需 DB 版本升级**（parentId / activeLeafId 无索引依赖）；旧版会话在 loadAll 时由 `migrateSessionGraph` 线性补链（chat-state.md 第 7 节）。

## 4. localStorage schema（lib/storage/settings.ts）

| key | 值 | 说明 |
|---|---|---|
| `deepseek-chat.apiKey` | string | API Key（独立 key，见 settings.md） |
| `deepseek-chat.settings` | JSON of `Settings`（不含 apiKey） | 其余全部设置 |
| `deepseek-chat.anonUserId` | uuid | 请求 `user` 参数（限流隔离），首次生成后固定 |

```ts
const DEFAULT_SETTINGS: Omit<Settings, "apiKey"> = {
  defaultModel: "deepseek-v4-flash",
  thinkingEnabled: true,
  thinkingEffort: "high",
  webSearchEnabled: false,
  temperature: 1.0,
  defaultSystemPromptId: "builtin-default",
  darkMode: false,
};

export function loadSettings(): Settings {
  const raw = localStorage.getItem(KEY_SETTINGS);
  if (!raw) return { ...DEFAULT_SETTINGS, apiKey: getApiKey() };
  return { ...DEFAULT_SETTINGS, ...JSON.parse(raw), apiKey: getApiKey() };
}

export function saveSettings(s: Settings) {
  const { apiKey, ...rest } = s;
  localStorage.setItem(KEY_API, apiKey);
  localStorage.setItem(KEY_SETTINGS, JSON.stringify(rest));
}
```

- 读取时做防御性合并（默认值兜底），JSON 损坏时回退默认并重写。

### 旧版「自定义指令」一次性迁移（v0 → 本版）

- 若 localStorage 中存在 `settings.systemPrompt` 且非空：将其内容写入 IndexedDB `prompts` 新建条目（id: uuid，name: 「我的自定义指令」），`defaultSystemPromptId` 指向该条目，随后删除 `settings.systemPrompt` 字段
- 若 `settings.defaultSystemPromptId` 指向的条目在库中不存在（被删/损坏）：回退 `"builtin-default"` 并重写

## 5. 读写时序与防抖

- 会话写入防抖：流式 delta 期间 500ms 防抖合并写（chat-state.md 第 5 节）；轮次完成/新建/删除立即写。
- 启动恢复：`loadAll()` 在客户端 `useEffect`（或 store 初始化）执行；期间 UI 显示轻量 loading（边栏 skeleton）。
- 写入失败（配额满等）：捕获后 toast 提示「本地存储失败」，不阻断对话（内存态仍可用），下一轮重试。

## 6. 数据清理

- 设置页「清除本地数据」：删除 IndexedDB 全部记录 + localStorage 全部 `deepseek-chat.*` key + 刷新页面
- 自动清理（可选增强，默认不做）：会话数 > 200 时提示手动清理；不做自动删除（避免误删）

## 7. 实现要点 Checklist

- [ ] db.ts（getDb/getAllSessions/putSession/deleteSession + getAllPrompts/putPrompt/deletePrompt）+ 索引 + v1→v2 升级
- [ ] settings.ts（load/save + 默认值合并 + 损坏兜底 + 自定义指令一次性迁移）
- [ ] 防抖写入与失败兜底
- [ ] 「清除本地数据」流程
- [ ] 单测：settings 合并逻辑；db 层用 fake-indexeddb（测试文档第 4 节）

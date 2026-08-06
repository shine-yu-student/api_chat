## 背景

项目为 Next.js 15 + zustand + IndexedDB 的 DeepSeek 对话应用，所有实现以 `docs/` 为唯一依据。本次新增两项功能，**先更新文档、再实现代码、最后补测试验证**。

已确认决策：
- 导出范围：全部会话 + 用户自定义 System Prompt 库（内置条目不导出）
- 导入冲突：同 id 会话/条目跳过、保留本地
- 桌面收起形式：完全隐藏 + 顶栏汉堡按钮展开

---

## 第一步：文档更新（先文档后代码）

1. **docs/01-requirements/requirements.md**
   - 新增 FR-14「侧边栏可调宽度与收起」：桌面端拖拽调宽（200–480px）、可完全收起、顶栏按钮展开、宽度/收起状态持久化、移动端保持抽屉；附验收标准。
   - 新增 FR-15「对话数据导出/导入」：导出全部会话 + 自定义 System Prompt 库为 JSON 备份文件（含 format/version）；导入校验格式、同 id 跳过保留本地、导入后会话可恢复、刷新不丢失；附验收标准。

2. **docs/04-frontend/ui-design.md**
   - 第 1 节布局图：边栏宽度改为「可调（默认 260px）」，标注拖拽手柄与收起按钮。
   - 第 4.7 节边栏：拖拽调整宽度（右缘手柄，min 200 / max 480）、桌面完全收起（顶栏按钮展开）、宽度与收起状态持久化。
   - 组件树：Sidebar 用户菜单增加「导出数据 / 导入数据」；Topbar 汉堡按钮描述更新（移动端抽屉 + 桌面收起态展开）。

3. **docs/04-frontend/chat-state.md**
   - Settings 接口新增 `sidebarWidth: number`、`sidebarCollapsed: boolean`。

4. **docs/04-frontend/settings.md**
   - localStorage schema 补充 `settings.sidebarWidth` / `settings.sidebarCollapsed`（经 useSettingsStore persist）。

5. **docs/06-storage/session-storage.md**
   - 新增「数据备份（导出/导入）」节：备份文件 JSON 格式 `{ format: "deepseek-chat-backup", version: 1, exportedAt, sessions: Session[], prompts: SystemPrompt[] }`；导出不含内置 prompt；导入校验（format/version 不符报错、畸形条目跳过）、同 id 跳过保留本地、内置条目不导入、导入后重载 store。

6. **docs/07-implementation/testing.md**
   - 单元测试清单增加 export-import 用例（序列化 roundtrip、格式校验、冲突跳过、内置忽略、写库）。
   - 手工验收清单增加 4.8「侧边栏与数据备份」小节。

7. **docs/README.md 与 README.md**
   - 文档速览表更新（功能需求 13 → 15 项）；README 功能特性表加「侧边栏可调宽/收起」「数据导出/导入」两行。

---

## 第二步：代码实现

### 功能 1：侧边栏可调宽/收起

8. **lib/types.ts**：`Settings` 接口新增 `sidebarWidth: number`、`sidebarCollapsed: boolean`；新增备份类型 `BackupData`（`{ format: "deepseek-chat-backup"; version: 1; exportedAt: number; sessions: Session[]; prompts: SystemPrompt[] }`）与常量 `BACKUP_FORMAT`/`BACKUP_VERSION`。

9. **lib/store/useSettingsStore.ts**：新增字段 `sidebarWidth`（默认 260）、`sidebarCollapsed`（默认 false）及 `setSidebarWidth` / `setSidebarCollapsed`；`partialize` 加入两个字段以便持久化。

10. **components/sidebar/Sidebar.tsx**
    - 去掉硬编码 `w-[260px]`，改 `style={{ width: sidebarWidth }}` + `max-w-[85vw]`（移动端限制），aside 加 `relative`。
    - 桌面拖拽手柄：aside 右缘垂直条（`hidden md:block`，`cursor-col-resize`），onMouseDown 起全局 mousemove/mouseup 监听，宽度 clamp 200–480，松手写回 settings。
    - 桌面收起：`sidebarCollapsed` 时 `md:-translate-x-full`，展开时 `md:translate-x-0`（移动抽屉逻辑保持不变）。
    - 用户菜单（DropdownMenu）新增「导出数据」「导入数据」两项：
      - 导出：`serializeBackup(sessions, prompts)` → Blob 下载 `deepseek-chat-backup-YYYYMMDD-HHmmss.json`，底部 toast「已导出 N 个会话」。
      - 导入：隐藏 `<input type="file" accept=".json,application/json">` → FileReader 解析 → `parseBackup` 校验 → 确认 Dialog（显示将导入的会话/条目数，说明冲突跳过）→ 执行导入写库 → 重载 store（若流式中先 stopStreaming；loadAll 后尝试恢复原 activeSessionId）→ toast 结果（导入 N、跳过 M）。

### 功能 2：导出/导入

11. **lib/storage/export-import.ts**（新文件，纯函数可单测）
    - `serializeBackup(sessions, prompts): string`
    - `parseBackup(json: string): BackupData`（format/version 校验，抛 `ChatError`/Error 可读文案）
    - `importBackup(data: BackupData): Promise<{ importedSessions; skippedSessions; importedPrompts; skippedPrompts }>`：复用 db.ts `putSession`/`putPrompt`；同 id 跳过；内置 prompt（`isBuiltin`）忽略；畸形条目跳过计数。

12. **components/chat/Topbar.tsx**：汉堡按钮由 `md:hidden` 改为「移动端常显；桌面仅在收起时显示」，点击时桌面展开（`setSidebarCollapsed(false)`）、移动端开抽屉。

13. **components/chat/ChatShell.tsx**：无需结构性改动（Sidebar 自读 settings store）；仅确认 props 透传不变。

### 第三步：测试与验证

14. **tests/export-import.test.ts**（新文件，仿 useChatStore.test.ts 的 mock 约定 + fake-indexeddb）：
    - serializeBackup → parseBackup roundtrip 数据一致
    - parseBackup：错误 format / 不支持 version / 非法 JSON → 报错
    - importBackup：正常导入写库；同 id 冲突跳过；内置 prompt 不落库；畸形条目跳过
15. 运行 `npm test`（新增 + 既有 48 用例全绿）与 `npm run build`（类型检查通过）；若可行跑 `npm run dev` 冒烟。

---

## 涉及文件汇总

- 文档：`docs/01-requirements/requirements.md`、`docs/04-frontend/ui-design.md`、`docs/04-frontend/chat-state.md`、`docs/04-frontend/settings.md`、`docs/06-storage/session-storage.md`、`docs/07-implementation/testing.md`、`docs/README.md`、`README.md`
- 代码：`lib/types.ts`、`lib/store/useSettingsStore.ts`、`lib/storage/export-import.ts`（新）、`components/sidebar/Sidebar.tsx`、`components/chat/Topbar.tsx`
- 测试：`tests/export-import.test.ts`（新）

## 风险与边界

- 拖拽宽度仅桌面端生效；移动端抽屉宽度沿用（≤85vw）。
- 导入不校验 API Key、不导入设置项（仅会话与库条目），避免越界。
- 备份为明文 JSON（含思维链/消息全文），仅本地下载，不涉及网络传输。
# 设置界面与 API Key 管理（Settings）

> 定义设置对话框的字段、API Key 的存储与使用安全边界、localStorage schema。

## 1. 设置字段（SettingsDialog）

| 字段 | 控件 | 默认 | 持久化 key | 说明 |
|---|---|---|---|---|
| API Key | password 输入 + 明文切换（eye 按钮） | 空 | `deepseek-chat.apiKey` | 必填项；保存时 trim |
| 默认模型 | Select（Flash / Pro） | `deepseek-v4-flash` | `settings.defaultModel` | 新建会话的初始模型 |
| 深度思考 | Switch + 强度（RadioGroup: 低/高/最高） | 开 / 高 | `settings.thinkingEnabled` / `thinkingEffort` | 全局默认，新会话沿用；输入区开关即时覆盖本次 |
| 联网搜索 | Switch | 关 | `settings.webSearchEnabled` | 同上 |
| 温度 | Slider（0~2，步进 0.1） | 1.0 | `settings.temperature` | 思考模式关闭时生效 |
| 默认 System Prompt | Select（库条目选择，内置恒在）+「管理库…」按钮 | 内置基础 Prompt | `settings.defaultSystemPromptId` | 新建会话的预选项；库管理见 prompt-library.md |
| 深色模式 | Switch | 跟随系统（默认亮） | `settings.darkMode` | 另在用户菜单有快捷切换 |
| 侧边栏宽度 / 收起 | 边栏右缘拖拽 + 收起按钮（FR-14） | 260px / 展开 | `settings.sidebarWidth` / `settings.sidebarCollapsed` | 见 ui-design.md 4.7；仅桌面端生效，移动端恒为抽屉 |

## 2. 设置对话框交互

- 入口：边栏底部用户菜单 →「设置」；未配置 Key 时发送消息 → 自动弹出并聚焦 Key 输入框
- 表单本地草稿，点「保存」才写入 localStorage；「取消」丢弃草稿
- 保存后 toast「设置已保存」
- API Key 校验：非空即保存（不做离线校验）；真实校验发生在首次请求（401 → 错误提示引导回设置）

### 2.1 System Prompt 库管理（设置内）

- 「默认 System Prompt」行旁「管理库…」打开库管理面板（prompt-library.md 第 4.3 节）：新建/编辑/删除自定义条目、设为默认；内置条目不可编辑/删除
- 删除当前默认条目 → `defaultSystemPromptId` 自动回退 `"builtin-default"`
- 旧版全局「自定义指令」`settings.systemPrompt` 内容：升级时自动导入为库条目「我的自定义指令」并设为默认（一次性迁移，见 session-storage.md 第 4 节）

## 3. API Key 存储与安全边界

### 存储

```ts
// lib/storage/settings.ts
const KEY_API = "deepseek-chat.apiKey";
const KEY_SETTINGS = "deepseek-chat.settings"; // 其余字段 JSON

export const getApiKey = () => localStorage.getItem(KEY_API) ?? "";
export const setApiKey = (k: string) => localStorage.setItem(KEY_API, k.trim());
export const clearApiKey = () => localStorage.removeItem(KEY_API);
```

- Key 与其余设置**分开两个 key** 存储（避免改设置时误覆盖 Key；便于单独清理）。
- 明文存 localStorage（浏览器本地，非加密）。说明：这是本应用既定的产品决策（用户自备 Key、单机使用），XSS 风险由「不渲染原始 HTML」+ CSP 缓解。

### 使用边界（硬性规则）

1. **Key 只流向自有后端代理**：`lib/api/client.ts` 中唯一 fetch 地址为相对路径 `/api/chat`；代码审查禁止出现将 Key 发往其他域名的路径。
2. 后端代理**不落盘、不打日志**（security.md）。
3. Key 不写入 IndexedDB、不进入 URL、不进入错误上报。
4. 清除数据：设置页提供「清除本地数据」按钮（清 localStorage + IndexedDB 全部会话 + 刷新）。

## 4. 未配置 Key 的引导

| 场景 | 行为 |
|---|---|
| 点击发送 | 拦截 + 弹设置对话框 + 提示「请先配置 API Key」 |
| 打开应用 | 不弹窗（正常浏览欢迎页/历史会话） |
| 401 响应 | 消息内联错误提示 + 设置入口按钮 |

## 5. 实现要点 Checklist

- [ ] SettingsDialog 组件（Radix Dialog + shadcn Form 风格）
- [ ] PromptManager 面板（库 CRUD + 设为默认，prompt-library.md 第 4.3 节）
- [ ] useSettingsStore（persist 中间件，`partialize` 排除 apiKey 或单独字段）
- [ ] apiKey 独立存取函数 + 发送前校验逻辑
- [ ] 默认 System Prompt 选择器 + 删除条目回退内置逻辑

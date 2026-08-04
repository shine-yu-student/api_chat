# 安全设计（Security）

> 定义 API Key 的安全边界、日志纪律、CSP 与部署安全基线。
> 本应用是个人自用型应用（用户自备 Key、无账号体系），安全目标 = 不引入额外暴露面 + 不意外泄露 Key。

## 1. 威胁模型（简表）

| 威胁 | 缓解 | 级别 |
|---|---|---|
| Key 通过浏览器请求泄露给第三方 | 前端唯一 fetch 目标是自有代理 `/api/chat`；代理再转发 DeepSeek | 核心 |
| 代理侧泄露 Key（日志/存储） | 不落盘、不打日志、内存闭包 | 核心 |
| XSS 窃取 localStorage Key | react-markdown 不渲染原始 HTML；不引入 rehype-raw；链接 noopener | 核心 |
| 他人使用本机浏览器 | 浏览器本地数据天然隔离；可提供「清除本地数据」 | 一般 |
| CSRF | 同源部署、无副作用 GET、POST 需用户自备 Key | 一般 |
| 滥用（Key 被盗用刷量） | 超出本应用能力范围（DeepSeek 侧有密钥管理/限额），文档提示用户 | 提示 |

> ⚠️ **边界说明（System Prompt 锁定）**：`instructions`（System Prompt 快照）由客户端构造、服务端不校验。
> 「对话开始后锁定」是 **UX 约束而非安全边界**——用户可用 DevTools 修改 localStorage 或直接 POST
> `/api/chat` 携带任意 instructions。本应用单机自用场景下这是可接受的产品决策，不视为漏洞。

> ⚠️ **部署形态（GitHub Pages 直连模式）**：静态托管下无后端代理，前端直接向 `api.deepseek.com`
> 发送请求（CORS 已验证支持），API Key 经 `Authorization` 头直接发给 DeepSeek 官方——
> 这是无后端托管下的标准做法（Key 未经过任何第三方中转）；如要求 Key 不出浏览器进程边界，
> 请使用自托管（代理模式）。切换由构建时 `NEXT_PUBLIC_DIRECT_API` 控制（见 README「部署」）。

## 2. API Key 生命周期

```
输入（设置页 password 字段）
  → 保存：localStorage key "deepseek-chat.apiKey"（明文，产品决策，见 settings.md 第 3 节）
  → 使用：仅当发送消息时，前端读取 → 放入 POST /api/chat 请求体 → 后端闭包使用 → 请求结束即弃
  → 清除：设置页「清除本地数据」/ 手动删除 localStorage
```

**硬性规则**（代码审查清单）：
1. 前端代码中 `fetch`/`axios` 的目标只允许 `/api/chat`（相对路径）；禁止将 apiKey 拼入 URL、query、hash
2. 后端不得将 apiKey 写入任何文件、数据库、日志、console
3. 后端不得将请求体转发给除 DeepSeek 官方域名（`api.deepseek.com`）以外的任何地址
4. 错误响应中不包含完整 Key（上游错误 message 一般不含 Key；如含则截断）

## 3. 日志纪律

- 后端零请求体日志。允许记录：时间、路径、HTTP 状态码、耗时（用于排障），**不允许**：请求体、响应体、apiKey、input 内容。
- 前端错误上报：不包含 apiKey、消息内容（本应用无上报系统，纯本地展示）。
- 开发环境（`next dev`）自带日志不输出请求体，无需额外配置。

## 4. 前端安全基线

- `next.config.ts` 配置 CSP 头（生产建议）：
  - `default-src 'self'`；`script-src 'self'`；`style-src 'self' 'unsafe-inline'`（Tailwind/KaTeX 需要）；`img-src 'self' https:`（外部引用图）；`connect-src 'self'`（只连自有代理）
  - 注意：KaTeX 字体需 `font-src 'self' data:`
- 禁止 `dangerouslySetInnerHTML`（全代码库 grep 检查）
- 外部链接一律 `target="_blank" rel="noopener noreferrer"`
- 用户消息与助手消息均按纯文本/Markdown 安全渲染，无 HTML 注入路径

## 5. 部署安全基线

- 生产部署启用 HTTPS（Vercel/自托管反代均要求）
- 自托管时：反向代理（Nginx/Caddy）只暴露 3000 端口；配置 SSE 相关头透传（`X-Accel-Buffering: no` 已在响应头中）
- 环境变量：`DEEPSEEK_BASE_URL` 可选（测试指向 mock），默认官方地址
- 不引入任何外部分析/遥测脚本

## 6. 定期核查项

- [ ] `rg "apiKey" app/ components/ lib/` 审查每一处使用是否符合规则 1~4
- [ ] `rg "dangerouslySetInnerHTML"` 应为 0
- [ ] 后端 route.ts 无 console.log(body) 类代码
- [ ] 依赖更新：openai SDK、next 保持最新稳定版（安全补丁）

## 7. 实现要点 Checklist

- [ ] next.config.ts CSP 头
- [ ] 代码审查规则 1~4 落实（实现后执行 rg 核查）
- [ ] 设置页「清除本地数据」功能

/**
 * GitHub Pages 静态导出构建脚本（npm run build:pages）：
 *
 * 背景：GitHub Pages 只能托管静态文件，无 Node 运行时——
 * - 后端代理 app/api/chat（SSE 转发）无法部署，前端在 NEXT_PUBLIC_DIRECT_API=1
 *   时自动切换为「浏览器直连 DeepSeek」模式（CORS 已验证支持，见 README）
 * - Next.js 的 output: "export" 不允许存在 Route Handler，
 *   因此构建期间临时把 app/api 移出项目，构建完成后恢复（源码不受影响）
 *
 * 产物：out/ 目录（可直接上传 GitHub Pages / 任意静态托管）
 */
import { execSync } from "node:child_process";
import fs from "node:fs";

const API_DIR = "app/api";
// 备份必须移到 app/ 之外：app 下任何子目录都会被当作路由段
const BACKUP = "api-backup-tmp";

if (fs.existsSync(API_DIR)) {
  fs.renameSync(API_DIR, BACKUP);
}
try {
  execSync("next build", {
    stdio: "inherit",
    env: {
      ...process.env,
      BUILD_TARGET: "pages",
      NEXT_PUBLIC_DIRECT_API: "1",
      // 若需覆盖直连端点（如自建代理），可在此设置 NEXT_PUBLIC_DEEPSEEK_BASE_URL
    },
  });
} finally {
  if (fs.existsSync(BACKUP)) {
    fs.renameSync(BACKUP, API_DIR);
  }
}
console.log("\n✓ 静态导出完成：out/ 目录可部署到 GitHub Pages 或任意静态托管");

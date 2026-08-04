import type { NextConfig } from "next";

// GitHub Pages 部署（README「部署」章节）：
// BUILD_TARGET=pages 时启用静态导出（output: "export"）。
// - Pages 无 Node 运行时，后端代理 /api/chat 不可用（构建脚本会临时移出 app/api），
//   前端经 NEXT_PUBLIC_DIRECT_API=1 自动切换为直连 DeepSeek（CORS 已验证支持）
// - basePath 由 workflow 注入 NEXT_PUBLIC_BASE_PATH（= "/" + 仓库名）
const isPages = process.env.BUILD_TARGET === "pages";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(isPages
    ? {
        output: "export" as const,
        basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? "/api_chat",
        trailingSlash: true,
        images: { unoptimized: true },
      }
    : {}),
};

export default nextConfig;

import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // vite 8（rolldown）用 oxc 转换：显式指定 JSX runtime，
  // 不依赖 tsconfig（Next build 会把 tsconfig 的 jsx 规范化为 preserve）
  oxc: { jsx: { runtime: "automatic" } } as never,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});

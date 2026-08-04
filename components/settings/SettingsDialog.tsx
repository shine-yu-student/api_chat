"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { MODELS } from "@/lib/deepseek/models";
import { PromptManager } from "@/components/prompt/PromptManager";
import {
  getApiKey,
  setApiKey,
  useSettingsStore,
} from "@/lib/store/useSettingsStore";
import { usePromptStore } from "@/lib/store/usePromptStore";
import { clearAllLocalData } from "@/lib/storage/settings";
import { closeSettings, useUiStore } from "@/lib/store/ui";
import {
  BUILTIN_PROMPT_ID,
  type ModelId,
  type ThinkingEffort,
} from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 设置对话框第一版（docs/04-frontend/settings.md）：
 * - API Key（password + 明文切换，独立 key 存储）
 * - 默认模型 Select
 * - 深度思考 Switch + 强度 RadioGroup / 联网搜索 Switch / 温度 Slider
 * - 深色模式 Switch
 * - 表单本地草稿，点「保存」写入；保存后 toast「设置已保存」
 * - System Prompt 库管理：阶段 6 加入
 */
export function SettingsDialog() {
  const open = useUiStore((s) => s.settingsOpen);

  // 本地草稿
  const [apiKey, setApiKeyDraft] = React.useState("");
  const [showKey, setShowKey] = React.useState(false);
  const [defaultModel, setDefaultModel] = React.useState<ModelId>("deepseek-v4-flash");
  const [thinkingEnabled, setThinkingEnabled] = React.useState(true);
  const [thinkingEffort, setThinkingEffort] = React.useState<ThinkingEffort>("high");
  const [webSearchEnabled, setWebSearchEnabled] = React.useState(false);
  const [temperature, setTemperature] = React.useState(1.0);
  const [darkMode, setDarkMode] = React.useState(false);
  const [defaultSystemPromptId, setDefaultSystemPromptId] = React.useState(
    BUILTIN_PROMPT_ID
  );
  const [managePrompts, setManagePrompts] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const saveTimerRef = React.useRef<number | null>(null);
  const prompts = usePromptStore((s) => s.prompts);

  // 打开时从 store 载入草稿
  React.useEffect(() => {
    if (open) {
      void usePromptStore.getState().loadPrompts(); // 幂等
      const st = useSettingsStore.getState();
      setApiKeyDraft(getApiKey());
      setDefaultModel(st.defaultModel);
      setThinkingEnabled(st.thinkingEnabled);
      setThinkingEffort(st.thinkingEffort);
      setWebSearchEnabled(st.webSearchEnabled);
      setTemperature(st.temperature);
      setDarkMode(st.darkMode);
      setDefaultSystemPromptId(st.defaultSystemPromptId);
      setManagePrompts(false);
      setSaved(false);
    }
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [open]);

  const handleSave = () => {
    setApiKey(apiKey);
    const st = useSettingsStore.getState();
    st.setDefaultModel(defaultModel);
    st.setThinkingEnabled(thinkingEnabled);
    st.setThinkingEffort(thinkingEffort);
    st.setWebSearchEnabled(webSearchEnabled);
    st.setTemperature(temperature);
    st.setDarkMode(darkMode);
    st.setDefaultSystemPromptId(defaultSystemPromptId);
    closeSettings();
    // 简单 toast 反馈
    setSaved(true);
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => setSaved(false), 2000);
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) closeSettings();
        }}
      >
        <DialogContent className="max-w-[480px]">
          <DialogHeader>
            <DialogTitle>设置</DialogTitle>
            <DialogDescription>配置 API Key 与应用偏好</DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* API Key */}
            <div className="space-y-1.5">
              <Label htmlFor="api-key">API Key</Label>
              <div className="relative">
                <input
                  id="api-key"
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKeyDraft(e.target.value)}
                  placeholder="sk-..."
                  autoFocus={!getApiKey()}
                  autoComplete="off"
                  spellCheck={false}
                  className="h-9 w-full rounded-md border border-border bg-transparent pr-10 pl-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                  aria-label={showKey ? "隐藏 API Key" : "显示 API Key"}
                  title={showKey ? "隐藏" : "显示"}
                >
                  {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Key 仅保存在浏览器本地，仅发送给你自己的代理服务
              </p>
            </div>

            {/* 默认模型 */}
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="default-model" className="shrink-0">
                默认模型
              </Label>
              <Select
                value={defaultModel}
                onValueChange={(v) => setDefaultModel(v as ModelId)}
              >
                <SelectTrigger
                  id="default-model"
                  className="w-[190px]"
                  aria-label="默认模型"
                >
                  <SelectValue placeholder="选择模型" />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(MODELS).map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 深度思考 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="thinking">深度思考</Label>
                <Switch
                  id="thinking"
                  checked={thinkingEnabled}
                  onCheckedChange={setThinkingEnabled}
                />
              </div>
              <div
                className={cn(
                  "flex items-center gap-4 transition-opacity",
                  !thinkingEnabled && "pointer-events-none opacity-40"
                )}
              >
                <span className="text-sm text-muted-foreground">思考强度</span>
                <div className="flex items-center gap-1">
                  {(
                    [
                      { value: "low", label: "低" },
                      { value: "high", label: "高" },
                      { value: "max", label: "最高" },
                    ] as { value: ThinkingEffort; label: string }[]
                  ).map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => setThinkingEffort(o.value)}
                      className={cn(
                        "rounded-full px-2.5 py-1 text-xs transition-colors",
                        thinkingEffort === o.value
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted"
                      )}
                      aria-pressed={thinkingEffort === o.value}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 联网搜索 */}
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="web-search">联网搜索</Label>
              <Switch
                id="web-search"
                checked={webSearchEnabled}
                onCheckedChange={setWebSearchEnabled}
              />
            </div>

            {/* 温度 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="temperature">温度</Label>
                <span className="text-sm text-muted-foreground">
                  {temperature.toFixed(1)}
                </span>
              </div>
              <Slider
                id="temperature"
                min={0}
                max={2}
                step={0.1}
                value={[temperature]}
                onValueChange={(v) => setTemperature(v[0] ?? 1)}
              />
              <p className="text-xs text-muted-foreground">
                思考模式关闭时生效
              </p>
            </div>

            {/* 默认 System Prompt（FR-11） */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="default-prompt" className="shrink-0">
                  默认 System Prompt
                </Label>
                <Select
                  value={defaultSystemPromptId}
                  onValueChange={setDefaultSystemPromptId}
                >
                  <SelectTrigger
                    id="default-prompt"
                    className="w-[190px]"
                    aria-label="默认 System Prompt"
                  >
                    <SelectValue placeholder="选择 System Prompt" />
                  </SelectTrigger>
                  <SelectContent>
                    {prompts.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                        {p.isBuiltin && "（内置）"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <button
                type="button"
                onClick={() => setManagePrompts((v) => !v)}
                className="text-xs text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
              >
                {managePrompts ? "收起库管理" : "管理 System Prompt 库…"}
              </button>
              {managePrompts && (
                <div className="pt-1">
                  <PromptManager />
                </div>
              )}
            </div>

            {/* 深色模式 */}
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="dark-mode">深色模式</Label>
              <Switch
                id="dark-mode"
                checked={darkMode}
                onCheckedChange={setDarkMode}
              />
            </div>

            {/* System Prompt 库管理入口已在上方「默认 System Prompt」区块内 */}
          </div>

          <DialogFooter className="items-center justify-between">
            <button
              type="button"
              onClick={() => {
                if (
                  window.confirm(
                    "确定清除全部本地数据？会话、System Prompt 库与 API Key 都将被删除且不可恢复。"
                  )
                ) {
                  void clearAllLocalData().then(() => window.location.reload());
                }
              }}
              className="text-xs text-muted-foreground underline-offset-2 hover:text-red-500 hover:underline"
            >
              清除本地数据
            </button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={closeSettings}>
                取消
              </Button>
              <Button onClick={handleSave}>保存</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 保存反馈 toast */}
      {saved && (
        <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-sm text-background shadow-lg">
          设置已保存
        </div>
      )}
    </>
  );
}

export { openSettings } from "@/lib/store/ui";

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import registerClaudeRenderers from "./lib/renderers.ts";

type ThemeMode = "auto" | "light" | "dark" | "none";
interface Preferences {
  enabled: boolean;
  theme: ThemeMode;
  [key: string]: unknown;
}
const modes: ThemeMode[] = ["auto", "light", "dark", "none"];

function loadPreferences(file: string): Preferences {
  const defaults: Preferences = { enabled: true, theme: "auto" };
  if (!existsSync(file)) return defaults;
  const saved = JSON.parse(readFileSync(file, "utf8"));
  if (!saved || typeof saved !== "object" || Array.isArray(saved)
    || (saved.enabled !== undefined && typeof saved.enabled !== "boolean")
    || (saved.theme !== undefined && !modes.includes(saved.theme))) {
    throw new Error(`Invalid Claude Style preferences: ${file}. Expected enabled:boolean and theme:auto|light|dark|none.`);
  }
  return { ...defaults, ...saved };
}

export default function claudeStylePackage(pi: ExtensionAPI) {
  const agentDir = getAgentDir();
  const preferencesPath = join(agentDir, "claude-style.json");
  const preferences = loadPreferences(preferencesPath);
  let originalTheme: Theme | undefined;
  let appliedThemeName: string | undefined;

  // When off, install no renderer at all: Pi's resolver chain remains untouched.
  if (preferences.enabled) registerClaudeRenderers(pi);

  const restoreTheme = (ctx: ExtensionContext) => {
    // Do not undo a different theme selected by the user or another extension later.
    if (ctx.hasUI && originalTheme && appliedThemeName === ctx.ui.theme.name) {
      ctx.ui.setTheme(originalTheme);
    }
    originalTheme = undefined;
    appliedThemeName = undefined;
  };
  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI || !preferences.enabled || preferences.theme === "none") return;
    // ui.theme is a live proxy. Load a concrete object rather than retaining that proxy.
    originalTheme = ctx.ui.getTheme(ctx.ui.theme.name ?? "system");
    if (!originalTheme) {
      ctx.ui.notify("Claude Style：当前是未命名的临时主题，保留原配色，仅启用紧凑输出。", "warning");
      return;
    }
    const appearance = preferences.theme === "auto" ? ctx.ui.theme.appearance : preferences.theme;
    const name = `claude-style-${appearance}`;
    const themed = ctx.ui.getTheme(name);
    if (!themed) {
      originalTheme = undefined;
      ctx.ui.notify(`Claude Style：未加载 ${name} 主题，仅启用紧凑输出。可检查 pi config。`, "warning");
      return;
    }
    // Setting a Theme object is session-only; setting a string would change global settings.
    const result = ctx.ui.setTheme(themed);
    if (result.success) appliedThemeName = name;
    else {
      originalTheme = undefined;
      ctx.ui.notify(`Claude Style：${result.error ?? "主题应用失败"}`, "warning");
    }
  });
  pi.on("session_shutdown", (_event, ctx) => restoreTheme(ctx));

  pi.registerCommand("claude-style", {
    description: "Claude 风格工具输出：on | off | status | theme auto/light/dark/none",
    getArgumentCompletions(prefix) {
      const options = ["on", "off", "status", "theme auto", "theme light", "theme dark", "theme none"];
      return options.filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value }));
    },
    async handler(args, ctx) {
      const input = args.trim().toLowerCase();
      if (!input || input === "status") {
        ctx.ui.notify(`Claude Style：${preferences.enabled ? "开启" : "关闭"}；主题 ${preferences.theme}。\n配置：${preferencesPath}\n命令：/claude-style on|off；/claude-style theme auto|light|dark|none`, "info");
        return;
      }
      // Reread before saving, so unrelated preference fields are not lost.
      const updated = loadPreferences(preferencesPath);
      if (input === "on" || input === "off") updated.enabled = input === "on";
      else if (input.startsWith("theme ") && modes.includes(input.slice(6) as ThemeMode)) {
        updated.theme = input.slice(6) as ThemeMode;
      } else {
        ctx.ui.notify("用法：/claude-style on|off|status；/claude-style theme auto|light|dark|none", "warning");
        return;
      }
      mkdirSync(agentDir, { recursive: true });
      const temporary = `${preferencesPath}.${process.pid}.tmp`;
      writeFileSync(temporary, JSON.stringify(updated, null, 2) + "\n", { mode: 0o600 });
      renameSync(temporary, preferencesPath);
      ctx.ui.notify(`Claude Style：${updated.enabled ? "开启" : "关闭"}；主题 ${updated.theme}。正在重新加载…`, "info");
      // Rebuild renderer bindings and old transcript components. Do not use old ctx after reload.
      await ctx.reload();
    },
  });
}

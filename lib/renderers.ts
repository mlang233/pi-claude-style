/** Claude-inspired, display-only tool rendering for Pi 1.0.4.
 * Registered by the package entry only when Claude Style is enabled.
 * No tool registrations, result transformations, private patches, or network calls.
 */
import type { ExtensionAPI, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { keyHint } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth, stripTerminalSequences } from "@earendil-works/pi-tui";
import { homedir } from "node:os";
import { isAbsolute, relative, sep } from "node:path";

const labels: Record<string, string> = {
  bash: "Bash", powershell: "PowerShell", read: "Read", write: "Write",
  edit: "Edit", grep: "Grep", find: "Find", ls: "List",
};

// Remove terminal control sequences from untrusted parameters/output before styling.
function clean(value: unknown): string {
  return stripTerminalSequences(String(value ?? "")).replace(/\r\n?/g, "\n")
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
}
function singleLine(value: unknown): string {
  return clean(value).replace(/\s+/g, " ").trim();
}
function shortenPath(value: unknown, cwd: string): string {
  const original = clean(value);
  if (!isAbsolute(original)) return singleLine(original);
  const rel = relative(cwd, original);
  if (rel === "") return ".";
  if (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) {
    return singleLine(rel);
  }
  const home = homedir();
  return singleLine(original === home ? "~" : original.startsWith(`${home}${sep}`)
    ? `~${original.slice(home.length)}` : original);
}
function callSummary(name: string, args: Record<string, unknown>, cwd: string): string {
  if (name === "bash" || name === "powershell") {
    let command = clean(args.command).trim().split("\n")[0] || "…";
    // A leading directory change is framing, not the operation. Full args remain expandable.
    command = command.replace(/^cd\s+.+?\s*&&\s*/, "");
    return singleLine(command);
  }
  const path = args.file_path ?? args.path;
  if (name === "grep" || name === "find") {
    return `${singleLine(args.pattern ?? args.query ?? "…")} in ${shortenPath(path ?? ".", cwd)}`;
  }
  if (path !== undefined) return shortenPath(path, cwd);
  for (const field of ["description", "query", "url", "pattern", "command", "name"]) {
    if (args[field] !== undefined) return singleLine(args[field]);
  }
  return Object.keys(args).length ? Object.keys(args).join(", ") : "…";
}

// Clip collapsed rows by terminal cell width, rather than JS character count.
// Text also supplies wrapping/cache invalidation in the normal Pi component contract.
function rowsComponent(build: (width: number) => string[]) {
  return {
    render(width: number) {
      const columns = Math.max(1, width);
      return new Text(build(columns).join("\n"), 0, 0).render(columns)
        .map((line) => truncateToWidth(line, columns, "…"));
    },
    invalidate() {},
  };
}

export default function claudeStyle(pi: ExtensionAPI) {
  if (typeof pi.registerToolRenderer !== "function") {
    throw new Error("claude-style requires Pi's registerToolRenderer API (tested on 1.0.4)");
  }
  pi.registerToolRenderer((toolName): ToolRenderers => ({
    renderShell: "self",
    renderCall(args, theme, context) {
      const params = args && typeof args === "object" ? args : {};
      const label = singleLine(labels[toolName] ?? toolName);
      const summary = callSummary(toolName, params, context.cwd);
      const color = context.isError ? "error" : context.isPartial ? "accent" : "success";
      return rowsComponent((width) => {
        const title = theme.fg(color, "● ") + theme.fg("toolTitle", theme.bold(label))
          + theme.fg("muted", `(${summary})`);
        const rows = [truncateToWidth(title, width, "…")];
        if (context.expanded) {
          const json = clean(JSON.stringify(params, null, 2));
          rows.push(...json.split("\n").map((line, i) =>
            theme.fg("muted", i === 0 ? "  ⎿  " : "     ") + theme.fg("toolOutput", line)));
        }
        return rows;
      });
    },
    renderResult(result, options, theme, context) {
      const text = result.content.filter((c) => c.type === "text")
        .map((c) => clean(c.text)).join("\n");
      const lines = text.trimEnd().split("\n").filter((line, i, all) =>
        !(all.length === 1 && i === 0 && line === ""));
      const images = result.content.filter((c) => c.type === "image").length;
      const details = result.details as Record<string, unknown> | undefined;
      const diff = typeof details?.diff === "string" ? clean(details.diff).trimEnd() : "";
      const hint = keyHint("app.tools.expand", "展开详情");
      const color = context.isError ? "error" : "toolOutput";
      return rowsComponent((width) => {
        const row = (text: string, first: boolean, role: Parameters<typeof theme.fg>[0] = color, clip = true) => {
          const styled = theme.fg("muted", first ? "  ⎿  " : "     ") + theme.fg(role, text);
          return clip ? truncateToWidth(styled, width, "…") : styled;
        };
        const rows: string[] = [];
        if (options.expanded) {
          // Keep every returned text block visible. Images are handled by Pi's host component.
          lines.forEach((line, i) => rows.push(row(line, i === 0, color, false)));
          if (diff && !context.isError) {
            rows.push(row("Diff:", rows.length === 0, "muted", false));
            for (const line of diff.split("\n")) {
              rows.push(row(line, false, line.startsWith("+") ? "toolDiffAdded"
                : line.startsWith("-") ? "toolDiffRemoved" : "toolDiffContext", false));
            }
          }
          if (!rows.length) rows.push(row(options.isPartial ? "运行中…" : "完成（无文本输出）", true));
        } else if (context.isError) {
          const errors = lines.filter((line) => line.trim()).slice(0, 3);
          (errors.length ? errors : ["工具执行失败"]).forEach((line, i) => rows.push(row(line, i === 0)));
          rows.push(theme.fg("muted", "     ") + hint);
        } else if (toolName === "edit" && diff) {
          const diffLines = diff.split("\n");
          rows.push(row(`已修改 · ${diffLines.length} 行 diff`, true));
          diffLines.slice(0, 6).forEach((line) => rows.push(row(line, false,
            line.startsWith("+") ? "toolDiffAdded" : line.startsWith("-") ? "toolDiffRemoved" : "toolDiffContext")));
          if (diffLines.length > 6) rows.push(theme.fg("muted", "     ") + hint);
        } else {
          let summary: string;
          if (options.isPartial) summary = "运行中…";
          else if (toolName === "read") summary = `返回 ${lines.length} 行文本`;
          else if (lines.length === 0) summary = "完成（无文本输出）";
          else summary = singleLine(lines.find((line) => line.trim()) ?? "完成");
          if (images) summary += ` · ${images} 张图片`;
          if (lines.length > 1 && toolName !== "read") summary += ` · ${lines.length} 行`;
          // The hint is kept for one-line output too: its contents may be clipped horizontally.
          const left = truncateToWidth(theme.fg("muted", "  ⎿  ") + theme.fg(color, summary),
            Math.max(1, width - 22), "…");
          rows.push(truncateToWidth(left + theme.fg("muted", " · ") + hint, width, "…"));
        }
        // Do not hide native truncation notices: expanded data can itself be truncated by a tool.
        const truncation = details?.truncation as { truncated?: boolean } | undefined;
        if (truncation?.truncated || details?.fullOutputPath) {
          const message = details?.fullOutputPath
            ? `完整输出文件：${clean(details.fullOutputPath)}` : "工具返回内容已截断";
          rows.push(row(message, rows.length === 0, "warning", !options.expanded));
        }
        return rows;
      });
    },
  }));
}

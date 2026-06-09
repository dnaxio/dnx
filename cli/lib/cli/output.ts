import { consola } from "consola";
import ora, { type Ora } from "ora";
import Table from "cli-table3";
import chalk from "chalk";
import "@colors/colors";

export type LogLevel = "debug" | "info" | "warn" | "error" | "success";

let globalLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel) {
  globalLevel = level;
  consola.level =
    level === "debug" ? 5 : level === "info" ? 3 : level === "warn" ? 2 : 1;
}

export const logger = {
  debug(...args: unknown[]) {
    if (globalLevel === "debug") consola.debug(...args);
  },
  info(...args: unknown[]) {
    console.log(args.join(" "));
  },
  warn(...args: unknown[]) {
    consola.warn(args.join(" "));
  },
  error(...args: unknown[]) {
    consola.error(args.join(" ").red);
  },
  success(...args: unknown[]) {
    consola.success(args.join(" ").green);
  },
  title(text: string) {
    consola.box(text);
  },
  section(text: string) {
    console.log(`${text}`.gray);
  },
  keyValue(key: string, value: string) {
    console.log(`${key}: ${value}`.cyan);
  },
  step(n: number, total: number, text: string) {
    console.log(`[${n}/${total}] ${text}`.gray);
  },
  table(rows: string[][]) {
    if (rows.length <= 1) return;
    const [headers, ...data] = rows;

    const colWidths = headers!.map((h, colIdx) => {
      const maxLen = Math.max(
        h.length,
        ...data.map(
          (r) => (r[colIdx] ?? "").replace(/\u001b\[[\d;]*m/g, "").length,
        ),
      );
      return Math.min(Math.max(maxLen + 2, 6), 22);
    });

    const table = new Table({
      head: headers!.map((h) => chalk.bold.dim(h)),
      colWidths,
      wordWrap: true,
      style: {
        head: [],
        border: ["dim"],
        compact: true,
      },
    });

    table.push(...data.map((r) => r.map((c) => chalk.dim(c ?? ""))));
    console.log(table.toString());
  },
};

export const icons = {
  check: "✔",
  cross: "✖",
  warn: "⚠",
  arrow: "→",
  dot: "•",
  sync: "↻",
  server: "🖥",
  container: "📦",
  running: "🟢",
  stopped: "🔴",
};

export function spinner(
  text: string,
  opts?: { stream?: NodeJS.WritableStream },
): Ora {
  return ora({ text, spinner: "dots", ...opts });
}

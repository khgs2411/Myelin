import type {
  ProjectLearnProgressEvent,
  ProjectLearnProgressSink,
} from "../project/project-learn-progress.ts";

type WritableProgressStream = {
  isTTY?: boolean;
  write(chunk: string): unknown;
};

export function createProjectLearnProgressReporter(input: {
  stream?: WritableProgressStream;
  heartbeatMs?: number;
  now?: () => number;
} = {}): ProjectLearnProgressSink {
  const stream = input.stream ?? process.stderr;
  const heartbeatMs = input.heartbeatMs ?? 15_000;
  const now = input.now ?? Date.now;
  let active: { event: ProjectLearnProgressEvent; startedAt: number; frame: number } | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const stopHeartbeat = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
  const renderActive = () => {
    if (!active) return;
    active.frame += 1;
    const elapsed = elapsedText(now() - active.startedAt);
    if (stream.isTTY) {
      const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
      stream.write(`\r\x1b[2K\x1b[36m${frames[active.frame % frames.length]}\x1b[0m ${eventText(active.event)} · ${elapsed}`);
    } else {
      stream.write(`[myelin] active ${eventText(active.event)} · ${elapsed}\n`);
    }
  };
  const startHeartbeat = () => {
    stopHeartbeat();
    timer = setInterval(renderActive, heartbeatMs);
    timer.unref?.();
  };

  return (event) => {
    if (event.status === "started") {
      if (active && stream.isTTY) stream.write("\r\x1b[2K");
      active = { event, startedAt: now(), frame: 0 };
      stream.write(stream.isTTY
        ? `\r\x1b[2K\x1b[36m⠋\x1b[0m ${eventText(event)}`
        : `[myelin] start ${eventText(event)}\n`);
      startHeartbeat();
      return;
    }
    if (event.status === "progress") {
      if (active) active.event = { ...active.event, ...event };
      if (stream.isTTY) renderActive();
      else stream.write(`[myelin] progress ${eventText(event)}\n`);
      return;
    }

    const elapsed = active ? ` · ${elapsedText(now() - active.startedAt)}` : "";
    stopHeartbeat();
    if (stream.isTTY) stream.write("\r\x1b[2K");
    const marker = event.status === "completed" ? "✓" : "✗";
    const color = event.status === "completed" ? "\x1b[32m" : "\x1b[31m";
    stream.write(stream.isTTY
      ? `${color}${marker}\x1b[0m ${eventText(event)}${elapsed}\n`
      : `[myelin] ${event.status} ${eventText(event)}${elapsed}\n`);
    active = null;
  };
}

function eventText(event: ProjectLearnProgressEvent): string {
  const count = event.total !== undefined
    ? ` ${event.current ?? 0}/${event.total}`
    : "";
  const mode = event.mode ? ` mode=${event.mode}` : "";
  const run = event.run_dir ? ` run=${event.run_dir}` : "";
  return `${event.stage}${count}${mode}${run}${event.message ? ` — ${event.message}` : ""}`;
}

function elapsedText(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

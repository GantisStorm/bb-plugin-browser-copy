import { useEffect, useMemo, useRef, useState } from "react";
import {
  definePluginApp,
  useBbNavigate,
  useRpc,
  type PluginThreadHeaderActionProps,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import type {
  rpcContract,
  CopyMode,
  ElementInfo,
  Target,
} from "./contracts.js";

type Discovered = {
  hostId: string;
  instanceId: string;
  generation: string;
  tab: { tabId: string; title: string; url: string };
};
const keyOf = (item: Discovered) =>
  JSON.stringify([item.hostId, item.instanceId, item.generation, item.tab.tabId]);
const primaryClass =
  "min-h-11 rounded border border-border bg-background px-3 py-2 text-sm hover:bg-state-hover disabled:opacity-40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const modeClass = (active: boolean) =>
  active
    ? "rounded border border-border bg-state-hover px-3 py-2 text-sm text-foreground disabled:opacity-40"
    : "rounded border border-border bg-background px-3 py-2 text-sm text-muted-foreground hover:bg-state-hover disabled:opacity-40";

const MODE_LABELS: Record<CopyMode, string> = {
  text: "Element text",
  "element-image": "Element image",
  "screen-image": "Screen",
};

function elementMarkdown(element: ElementInfo): string {
  const lines = [`Tag: ${element.tag}`, `Selector: ${element.selector}`];
  if (element.role) lines.push(`Role: ${element.role}`);
  if (element.name) lines.push(`Name: ${element.name}`);
  if (element.text) lines.push(`Text: ${element.text}`);
  if (element.link) lines.push(`Link: ${element.link}`);
  if (element.value) lines.push(`Value: ${element.value}`);
  return lines.join("\n");
}

function BrowserCopyHeaderAction(_: PluginThreadHeaderActionProps) {
  const navigate = useBbNavigate();
  return (
    <button
      type="button"
      aria-label="Copy Browser element"
      title="Copy Browser element"
      onClick={() =>
        navigate.openThreadPanel({ actionId: "browser-copy", params: null })
      }
      className="flex h-7 items-center gap-1 rounded px-1.5 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className="size-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="8" y="8" width="12" height="12" rx="2" />
        <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
      </svg>
      Copy
    </button>
  );
}

function BrowserCopyPanel({ threadId }: PluginThreadPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [targets, setTargets] = useState<Discovered[]>([]);
  const [selected, setSelected] = useState("");
  const [mode, setMode] = useState<CopyMode>("text");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{
    element: ElementInfo | null;
    copied: boolean;
  } | null>(null);
  const [refreshIndex, setRefreshIndex] = useState(0);
  const mounted = useRef(true);
  const running = useRef(false);

  const target = useMemo<Target | null>(() => {
    const item = targets.find((candidate) => keyOf(candidate) === selected);
    return item
      ? {
          hostId: item.hostId,
          instanceId: item.instanceId,
          generation: item.generation,
          threadId,
          tabId: item.tab.tabId,
        }
      : null;
  }, [selected, targets, threadId]);

  useEffect(() => {
    mounted.current = true;
    void rpc
      .call("discover", { threadId })
      .then(({ targets: next }) => {
        if (!mounted.current) return;
        setTargets(next);
        setSelected((current) =>
          next.some((item) => keyOf(item) === current)
            ? current
            : next.length === 1
              ? keyOf(next[0])
              : "",
        );
      })
      .catch((reason) => {
        if (mounted.current)
          setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      mounted.current = false;
    };
  }, [rpc, threadId, refreshIndex]);

  const start = () => {
    if (!target) return;
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    setLastResult(null);
    void rpc
      .call("copy", { ...target, mode, page: null })
      .then((result) => {
        if (!mounted.current) return;
        setLastResult({ element: result.element, copied: result.copied });
      })
      .catch((reason) => {
        if (mounted.current)
          setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        running.current = false;
        if (mounted.current) setBusy(false);
      });
  };

  const label =
    mode === "text"
      ? "Pick an element"
      : mode === "element-image"
        ? "Pick an element"
        : "Copy screen to clipboard";
  const hint =
    mode === "screen-image"
      ? "Copies the visible Browser tab to the clipboard."
      : "Click the element in the Browser tab to copy it. Password and secret fields are never copied.";

  return (
    <div className="flex min-h-0 flex-col gap-3 p-3 text-sm text-foreground">
      <header>
        <h2 className="font-medium">Browser Copy</h2>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </header>
      <label className="grid gap-1 text-xs text-muted-foreground">
        Browser tab
        <select
          className="min-h-11 w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground"
          value={selected}
          disabled={busy}
          onChange={(event) => {
            setSelected(event.target.value);
            setLastResult(null);
          }}
        >
          <option value="">Choose a tab</option>
          {targets.map((item) => (
            <option key={keyOf(item)} value={keyOf(item)}>
              {item.tab.title || item.tab.url || "Blank tab"}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(MODE_LABELS) as CopyMode[]).map((candidate) => (
          <button
            key={candidate}
            type="button"
            className={modeClass(mode === candidate)}
            disabled={busy}
            onClick={() => setMode(candidate)}
          >
            {MODE_LABELS[candidate]}
          </button>
        ))}
      </div>
      <button
        type="button"
        className={primaryClass}
        disabled={!target || busy}
        onClick={start}
      >
        {busy ? "Working…" : label}
      </button>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={primaryClass}
          disabled={busy}
          onClick={() => setRefreshIndex((index) => index + 1)}
        >
          Refresh tabs
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-destructive-text">
          {error}
        </p>
      ) : null}
      {lastResult ? (
        <div className="grid gap-1">
          <p className="text-xs text-muted-foreground">
            {lastResult.copied
              ? "Copied to the clipboard"
              : "Captured — use Copy above to retry"}
          </p>
          {lastResult.element ? (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-surface-recessed p-2 text-xs">
              {elementMarkdown(lastResult.element)}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.threadPanelAction({
    id: "browser-copy",
    title: "Copy from Browser",
    icon: "Copy",
    component: BrowserCopyPanel,
  });
  app.slots.experimental_threadHeaderAction({
    id: "browser-copy",
    title: "Browser Copy",
    component: BrowserCopyHeaderAction,
  });
});

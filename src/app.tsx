import { useCallback, useEffect, useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { CursorInWindowIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";
import {
  definePluginApp,
  useRpc,
  type PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract, CopyMode, Target } from "./contracts.js";

/**
 * Injected by `bb plugin build`. The menu is portalled to the document body,
 * so it has to carry the plugin style-scope attributes itself or the plugin's
 * compiled utilities (scoped to `[data-bb-plugin]` roots) would not apply.
 */
declare const __BB_PLUGIN_ID__: string | undefined;

const PORTAL_SCOPE = {
  "data-bb-portaled-overlay": "",
  "data-bb-plugin-root": "",
  ...(typeof __BB_PLUGIN_ID__ === "string"
    ? { "data-bb-plugin": __BB_PLUGIN_ID__ }
    : {}),
};

type Discovered = {
  hostId: string;
  instanceId: string;
  generation: string;
  tab: { tabId: string; title: string; url: string };
};

const keyOf = (item: Discovered) =>
  JSON.stringify([item.hostId, item.instanceId, item.generation, item.tab.tabId]);

const MODES: readonly CopyMode[] = ["text", "element-image", "screen-image"];

const MODE_LABELS: Record<CopyMode, string> = {
  text: "Element text",
  "element-image": "Element image",
  "screen-image": "Screen",
};

const MODE_TOASTS: Record<CopyMode, string> = {
  text: "Element text copied",
  "element-image": "Element image copied",
  "screen-image": "Screen copied",
};

const TRIGGER_LABEL = "Copy Browser Element";

// Same box, glyph sizing, and coarse-pointer step as bb's own header icon
// buttons, so this sits in the action row without looking foreign.
const triggerClass =
  "flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-md p-0 text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:bg-state-hover data-[state=open]:text-foreground disabled:opacity-40 max-md:pointer-coarse:h-9 max-md:pointer-coarse:w-9 [&_svg]:size-[16px] max-md:pointer-coarse:[&_svg]:size-[20px]";

const contentClass =
  "z-50 min-w-40 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md";

const labelClass =
  "px-2 py-[0.3125rem] text-xs font-medium text-muted-foreground";

const separatorClass = "-mx-1 my-1 h-px bg-muted";

const hintClass = "px-2 py-[0.3125rem] text-xs text-muted-foreground";

const itemBaseClass =
  "relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 text-xs outline-none focus:bg-state-hover focus:text-foreground hover:bg-state-hover hover:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50";

// The same icon set bb draws its own chrome from: a browser window with the
// pointer inside it, which is what this button does — pick something in the page.
const copyIcon = (
  <HugeiconsIcon icon={CursorInWindowIcon} size={16} strokeWidth={1.8} />
);

const spinnerIcon = (
  <svg
    aria-hidden
    viewBox="0 0 24 24"
    className="animate-spin"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
  >
    <path d="M12 3a9 9 0 1 0 9 9" />
  </svg>
);

const checkIcon = (
  <svg
    aria-hidden
    viewBox="0 0 24 24"
    className="size-3.5"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m5 12.5 4.5 4.5L19 7" />
  </svg>
);

function BrowserCopyHeaderAction({
  threadId,
  isCompactViewport,
}: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<Discovered[]>([]);
  const [selected, setSelected] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const discovery = useRef(0);
  const running = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const discover = useCallback(async () => {
    const attempt = ++discovery.current;
    setDiscovering(true);
    try {
      const { targets: next } = await rpc.call("discover", { threadId });
      if (!alive.current || attempt !== discovery.current) return;
      setTargets(next);
      setSelected((current) =>
        next.some((item) => keyOf(item) === current)
          ? current
          : next[0] !== undefined
            ? keyOf(next[0])
            : "",
      );
      setError(null);
    } catch (reason) {
      if (!alive.current || attempt !== discovery.current) return;
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (alive.current && attempt === discovery.current) setDiscovering(false);
    }
  }, [rpc, threadId]);

  const found = targets.find((candidate) => keyOf(candidate) === selected);
  const target: Target | null = found
    ? {
        hostId: found.hostId,
        instanceId: found.instanceId,
        generation: found.generation,
        threadId,
        tabId: found.tab.tabId,
      }
    : null;

  const run = (mode: CopyMode) => {
    if (target === null || running.current) return;
    running.current = true;
    setBusy(true);
    void rpc
      .call("copy", { ...target, mode })
      .then((result) => {
        if (!alive.current) return;
        if (result.copied) toast.success(MODE_TOASTS[mode]);
        else toast.error("Nothing reached the clipboard. Try again");
      })
      .catch((reason) => {
        if (alive.current)
          toast.error(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        running.current = false;
        if (alive.current) setBusy(false);
      });
  };

  const itemClass = `${itemBaseClass} ${
    isCompactViewport ? "min-h-11" : "min-h-8 py-[0.3125rem]"
  }`;

  return (
    <DropdownMenu.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void discover();
      }}
    >
      <DropdownMenu.Trigger asChild disabled={busy}>
        <button
          type="button"
          aria-label={TRIGGER_LABEL}
          aria-busy={busy}
          title={TRIGGER_LABEL}
          className={triggerClass}
        >
          {busy ? spinnerIcon : copyIcon}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          {...PORTAL_SCOPE}
          side="bottom"
          align="start"
          sideOffset={4}
          className={contentClass}
        >
          {error !== null ? (
            <p role="alert" className={`${hintClass} text-destructive-text`}>
              {error}
            </p>
          ) : null}
          {targets.length > 1 ? (
            <>
              <DropdownMenu.Label className={labelClass}>
                Browser tab
              </DropdownMenu.Label>
              <DropdownMenu.RadioGroup
                value={selected}
                onValueChange={setSelected}
              >
                {targets.map((candidate) => (
                  <DropdownMenu.RadioItem
                    key={keyOf(candidate)}
                    value={keyOf(candidate)}
                    className={`${itemClass} pr-7`}
                  >
                    <span className="truncate">
                      {candidate.tab.title || candidate.tab.url || "Blank tab"}
                    </span>
                    <DropdownMenu.ItemIndicator className="absolute right-2 flex items-center">
                      {checkIcon}
                    </DropdownMenu.ItemIndicator>
                  </DropdownMenu.RadioItem>
                ))}
              </DropdownMenu.RadioGroup>
              <DropdownMenu.Separator className={separatorClass} />
            </>
          ) : null}
          <DropdownMenu.Group>
            {MODES.map((mode) => (
              <DropdownMenu.Item
                key={mode}
                className={itemClass}
                disabled={target === null}
                onSelect={() => run(mode)}
              >
                {MODE_LABELS[mode]}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Group>
          {targets.length === 0 && error === null ? (
            <p className={hintClass}>
              {discovering
                ? "Looking for Browser tabs…"
                : "No Browser tab is open in this thread"}
            </p>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_threadHeaderAction({
    id: "browser-copy",
    title: "Browser Copy",
    component: BrowserCopyHeaderAction,
  });
});

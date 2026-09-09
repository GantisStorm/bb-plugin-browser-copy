import { z } from "zod";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import {
  hostContract,
  elementInfoSchema,
  pageSnapshotSchema,
  type PageSnapshot,
} from "./contracts.js";

const delay = (milliseconds: number) => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, milliseconds);
  return promise;
};

const CLIPBOARD_HELPERS = `
const __bbToast = (() => {
  let node = null;
  return (text, error) => {
    if (!node) {
      node = document.createElement("div");
      node.id = "__bbToast";
      node.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:2147483647;" +
        "background:" + (error ? "rgba(176,52,52,.95)" : "rgba(22,26,32,.95)") + ";color:#fff;" +
        "padding:10px 14px;border-radius:10px;font:13px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;" +
        "max-width:60vw;box-shadow:0 4px 16px rgba(0,0,0,.35)";
      document.documentElement.appendChild(node);
    }
    node.textContent = text;
    clearTimeout(node._t);
    node._t = setTimeout(() => node.remove(), 2800);
  };
})();`;

const STORE_CLEAR = `window.__bbCopyDone = null;`;

const elementPickExpression = (wantImage: boolean) => `
(() => {
  ${CLIPBOARD_HELPERS}
  const SENSITIVE = /pass(word)?|credential|secret|token|api[_-]?key|auth/i;
  const clean = (value) => {
    if (value == null) return null;
    const text = String(value).replace(/[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]/g, "").trim();
    return text.length === 0 ? null : text.slice(0, 8000);
  };
  const describe = (element) => {
    const tag = element.tagName.toLowerCase();
    const inputish = tag === "input" || tag === "textarea";
    const secretish = inputish && (element.type === "password" || SENSITIVE.test((element.name || "") + " " + (element.id || "") + " " + (element.getAttribute("autocomplete") || "")));
    const path = [];
    let node = element;
    while (node && node.nodeType === 1 && path.length < 5) {
      const currentTag = node.tagName.toLowerCase();
      if (node.id) { path.unshift(currentTag + "#" + node.id); break; }
      const siblings = Array.from(node.parentNode ? node.parentNode.children : []).filter((s) => s.tagName === node.tagName);
      const index = siblings.indexOf(node);
      path.unshift(siblings.length > 1 ? currentTag + ":nth-of-type(" + (index + 1) + ")" : currentTag);
      node = node.parentNode;
    }
    return {
      tag,
      selector: path.join(" > ") || tag,
      role: clean(element.getAttribute("role")) || null,
      name: clean(element.getAttribute("aria-label") || element.getAttribute("title") || element.getAttribute("placeholder") || element.getAttribute("alt")) || null,
      text: secretish ? null : clean(element.innerText || element.textContent),
      link: tag === "a" ? clean(element.href) : null,
      value: inputish && !secretish ? clean(element.value) : null,
    };
  };
  const markdown = (info) => {
    const lines = ["Tag: " + info.tag, "Selector: " + info.selector];
    if (info.role) lines.push("Role: " + info.role);
    if (info.name) lines.push("Name: " + info.name);
    if (info.text) lines.push("Text: " + info.text);
    if (info.link) lines.push("Link: " + info.link);
    if (info.value) lines.push("Value: " + info.value);
    return lines.join("\\n");
  };
  let picked = false;
  const expireAt = performance.now() + 20000;
  let overlayNode = null;
  const cleanup = () => {
    if (document.documentElement.style.cursor === "crosshair") document.documentElement.style.cursor = "";
    if (overlayNode && overlayNode.parentNode) overlayNode.remove();
    overlayNode = null;
    const stray = document.getElementById("__bbCopyGuard");
    if (stray && stray.parentNode) stray.remove();
    document.removeEventListener("click", onClick, true);
    if (window.__bbCopyCleanup === cleanup) window.__bbCopyCleanup = null;
  };
  window.__bbCopyCleanup && window.__bbCopyCleanup();
  const finish = async (element) => {
    const info = describe(element);
    const infoWithRect = { ...info, rect: (() => { const r = element.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; })() };
    if (!${wantImage}) {
      try {
        await navigator.clipboard.writeText(markdown(info));
        window.__bbCopyDone = { ok: true, element: infoWithRect };
        __bbToast("Copied: " + ((info.text || info.name || info.role || info.tag) + "").slice(0, 120));
      } catch (e) {
        window.__bbCopyDone = { ok: false, error: String(e && e.message || e), element: infoWithRect };
        __bbToast("Clipboard write failed: " + (e && e.message || e), true);
      }
    } else {
      window.__bbCopyDone = { ok: null, element: infoWithRect };
    }
    picked = true;
    cleanup();
  };
  const onClick = (event) => {
    if (picked) return;
    if (performance.now() > expireAt) {
      cleanup();
      return;
    }
    const element = event.target instanceof Element ? event.target.closest("a, button, input, textarea, select, [role], h1, h2, h3, h4, h5, h6, p, li, td, th, img, video, [contenteditable], [onclick], [data-testid], article, section, div, span") || event.target : event.target;
    if (!(element instanceof Element)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    void finish(element);
  };
  document.addEventListener("click", onClick, true);
  document.documentElement.style.cursor = "crosshair";
  window.__bbCopyCleanup = cleanup;
  return true;
})()`;

const clipAndWriteImageExpression = (image: { base64: string }) => `
(async () => {
  ${CLIPBOARD_HELPERS}
  try {
    const bytes = Uint8Array.from(atob(${JSON.stringify(image.base64)}), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: "image/png" });
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    __bbToast("Element image copied to the clipboard");
  } catch (e) {
    __bbToast("Clipboard write failed: " + (e && e.message || e), true);
  }
})()`;

const screenPickExpression = (image: { base64: string }, viewport: { x: number; y: number }) => `
(() => {
  ${CLIPBOARD_HELPERS}
  window.__bbCopyCleanup && window.__bbCopyCleanup();
  const guard = document.createElement("div");
  guard.id = "__bbCopyGuard";
  guard.style.cssText = "position:fixed;inset:0;z-index:2147483646;cursor:crosshair;background:transparent";
  document.documentElement.appendChild(guard);
  let done = false;
  const cleanup = () => {
    if (guard.parentNode) guard.remove();
    if (document.documentElement.style.cursor === "crosshair") document.documentElement.style.cursor = "";
    if (window.__bbCopyCleanup === cleanup) window.__bbCopyCleanup = null;
  };
  window.__bbCopyCleanup = cleanup;
  const run = async () => {
    if (done) return;
    done = true;
    try {
      const bytes = Uint8Array.from(atob(${JSON.stringify(image.base64)}), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "image/png" });
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      __bbToast("Screen copied to the clipboard");
      window.__bbCopyDone = { ok: true };
    } catch (e) {
      __bbToast("Clipboard write failed: " + (e && e.message || e), true);
      window.__bbCopyDone = { ok: false, error: String(e && e.message || e) };
    }
    cleanup();
  };
  guard.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    void run();
  }, true);
  return true;
})()`;

const toastExpression = (text: string, error: boolean) => `
(() => {
  ${CLIPBOARD_HELPERS}
  __bbToast(${JSON.stringify(text)}, ${error});
  return true;
})()`;

const snapshotExpression = `(() => ({
  documentId: String(performance.timeOrigin) + location.href,
  url: location.href,
  width: visualViewport ? visualViewport.width : innerWidth,
  height: visualViewport ? visualViewport.height : innerHeight,
  scrollX,
  scrollY,
  scale: visualViewport ? visualViewport.scale : 1,
}))()`;

type Connection = ReturnType<typeof connect>;

function connect(wsEndpoint: string, signal: AbortSignal) {
  const socket = new WebSocket(wsEndpoint);
  const pending = new Map<number, {
    resolve(value: unknown): void;
    reject(error: Error): void;
    timeout: ReturnType<typeof setTimeout>;
  }>();
  let nextId = 1;
  const { promise: opened, resolve: resolveOpened, reject: rejectOpened } =
    Promise.withResolvers<void>();
  socket.addEventListener("open", () => resolveOpened(), { once: true });
  socket.addEventListener("error", () => {
    rejectOpened(new Error("Could not connect to the Browser tab"));
  });
  socket.addEventListener("message", ({ data }) => {
    try {
      const message = JSON.parse(String(data));
      if (typeof message.id === "number") {
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        clearTimeout(request.timeout);
        if ("error" in message)
          request.reject(
            new Error(message.error?.message ?? "Browser command failed"),
          );
        else request.resolve(message.result ?? {});
      }
    } catch {
      // Ignore malformed frames; the owning request times out.
    }
  });
  socket.addEventListener("close", () => {
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.reject(new Error("Browser connection closed"));
    }
    pending.clear();
  });
  signal.addEventListener("abort", () => socket.close(), { once: true });
  const request = (
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ) => {
    signal.throwIfAborted();
    const id = nextId++;
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out waiting for ${method}`));
    }, 30_000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(
      JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }),
    );
    return promise;
  };
  return {
    opened,
    request,
    close() {
      socket.close();
      for (const request of pending.values()) clearTimeout(request.timeout);
      pending.clear();
    },
  };
}

async function withPage<T>(
  wsEndpoint: string,
  signal: AbortSignal,
  run: (connection: Connection, sessionId: string) => Promise<T>,
): Promise<T> {
  const connection = connect(wsEndpoint, signal);
  await connection.opened;
  let sessionId: string | null = null;
  try {
    const targets = z
      .object({
        targetInfos: z.array(
          z.object({ targetId: z.string(), type: z.string() }),
        ),
      })
      .parse(await connection.request("Target.getTargets")).targetInfos.filter(
        (target) => target.type === "page",
      );
    if (targets.length !== 1)
      throw new Error("Selected Browser tab is no longer available");
    sessionId = z
      .object({ sessionId: z.string() })
      .parse(
        await connection.request("Target.attachToTarget", {
          targetId: targets[0].targetId,
          flatten: true,
        }),
      ).sessionId;
    return await run(connection, sessionId);
  } finally {
    if (sessionId !== null) {
      await connection
        .request("Target.detachFromTarget", { sessionId })
        .catch(() => undefined);
    }
    connection.close();
  }
}

async function evaluate(
  connection: Connection,
  sessionId: string,
  expression: string,
): Promise<unknown> {
  const response = (await connection.request(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true },
    sessionId,
  )) as { result?: { value?: unknown }; exceptionDetails?: { text?: string } };
  if (response.exceptionDetails?.text)
    throw new Error(`Browser script error: ${response.exceptionDetails.text}`);
  return response.result?.value;
}

async function snapshot(
  connection: Connection,
  sessionId: string,
): Promise<PageSnapshot> {
  return pageSnapshotSchema.parse(
    await evaluate(connection, sessionId, snapshotExpression),
  );
}

async function stableSnapshot(
  connection: Connection,
  sessionId: string,
): Promise<PageSnapshot> {
  let previous = await snapshot(connection, sessionId);
  for (let attempt = 0; attempt < 10; attempt++) {
    await delay(200);
    const current = await snapshot(connection, sessionId);
    if (JSON.stringify(current) === JSON.stringify(previous)) return current;
    previous = current;
  }
  throw new Error("The page kept changing; try again");
}

async function captureViewportPng(
  connection: Connection,
  sessionId: string,
  dpr: number,
): Promise<{ base64: string; width: number; height: number }> {
  const data = z
    .object({ data: z.string() })
    .parse(
      await connection.request(
        "Page.captureScreenshot",
        {
          format: "png",
          captureBeyondViewport: false,
        },
        sessionId,
      ),
    ).data;
  const viewport = await evaluate(
    connection,
    sessionId,
    "(visualViewport ? { width: visualViewport.width, height: visualViewport.height } : { width: innerWidth, height: innerHeight })",
  ) as { width: number; height: number };
  return {
    base64: data,
    width: Math.max(1, Math.round(viewport.width * dpr)),
    height: Math.max(1, Math.round(viewport.height * dpr)),
  };
}

async function dispatchClick(
  connection: Connection,
  sessionId: string,
  point: { x: number; y: number },
): Promise<void> {
  await connection.request(
    "Input.dispatchMouseEvent",
    { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 },
    sessionId,
  );
  await connection.request(
    "Input.dispatchMouseEvent",
    { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 },
    sessionId,
  );
}

async function waitForPick(
  connection: Connection,
  sessionId: string,
  deadline: number,
): Promise<Record<string, unknown>> {
  while (Date.now() < deadline) {
    const polled = await evaluate(connection, sessionId, `(() => { const r = window.__bbCopyDone; window.__bbCopyDone = null; return r; })()`);
    if (polled !== null && typeof polled === "object")
      return polled as Record<string, unknown>;
    await delay(150);
  }
  throw new Error("No element was picked; try again");
}

function writeToast(connection: Connection, sessionId: string, text: string, error: boolean) {
  return evaluate(connection, sessionId, toastExpression(text, error));
}

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    measure: async (
      input: { wsEndpoint: string },
      context: { signal: AbortSignal },
    ) => {
      return withPage(input.wsEndpoint, context.signal, (connection, sessionId) =>
        stableSnapshot(connection, sessionId),
      );
    },
    elementPick: async (
      input: {
        wsEndpoint: string;
        page: PageSnapshot;
        image: boolean;
      },
      context: { signal: AbortSignal },
    ) => {
      return withPage(input.wsEndpoint, context.signal, async (connection, sessionId) => {
        const current = await snapshot(connection, sessionId);
        if (JSON.stringify(current) !== JSON.stringify(input.page)) {
          await writeToast(connection, sessionId, "The page changed since you started; try again", true);
          throw new Error("The page changed since you started; try again");
        }
        await evaluate(
          connection,
          sessionId,
          STORE_CLEAR + elementPickExpression(input.image),
        );
        const deadline = Date.now() + 18_000;
        const picked = await waitForPick(connection, sessionId, deadline).catch(
          async (reason: unknown) => {
            await writeToast(
              connection,
              sessionId,
              "No element was picked; start again",
              true,
            ).catch(() => undefined);
            await evaluate(
              connection,
              sessionId,
              "window.__bbCopyCleanup && window.__bbCopyCleanup(); true",
            ).catch(() => undefined);
            throw reason;
          },
        );
        if (picked.ok === false) {
          throw new Error(String(picked.error ?? "Clipboard write failed"));
        }
        const after = await snapshot(connection, sessionId);
        if (JSON.stringify(after) !== JSON.stringify(input.page)) {
          await writeToast(connection, sessionId, "The page changed while picking; try again", true);
          throw new Error("The page changed while picking; try again");
        }
        const element = elementInfoSchema.parse(picked.element);
        let image: { mimeType: "image/png"; base64: string; width: number; height: number } | null = null;
        let copied = picked.ok === true;
        if (input.image) {
          const dpr = (await evaluate(connection, sessionId, "window.devicePixelRatio")) as number;
          const data = z
            .object({ data: z.string() })
            .parse(
              await connection.request(
                "Page.captureScreenshot",
                {
                  format: "png",
                  clip: {
                    x: element.rect.x,
                    y: element.rect.y,
                    width: element.rect.width,
                    height: element.rect.height,
                    scale: 1,
                  },
                  captureBeyondViewport: false,
                },
                sessionId,
              ),
            ).data;
          image = {
            mimeType: "image/png",
            base64: data,
            width: Math.max(1, Math.round(element.rect.width * dpr)),
            height: Math.max(1, Math.round(element.rect.height * dpr)),
          };
          await evaluate(connection, sessionId, clipAndWriteImageExpression(image));
          copied = true;
        }
        return { element, image, copied };
      });
    },
    screenPick: async (
      input: { wsEndpoint: string },
      context: { signal: AbortSignal },
    ) => {
      return withPage(input.wsEndpoint, context.signal, async (connection, sessionId) => {
        await delay(600);
        const dpr = (await evaluate(connection, sessionId, "window.devicePixelRatio")) as number;
        const viewport = await evaluate(
          connection,
          sessionId,
          "(visualViewport ? { width: visualViewport.width, height: visualViewport.height } : { width: innerWidth, height: innerHeight })",
        ) as { width: number; height: number };
        const image = await captureViewportPng(connection, sessionId, dpr);
        await evaluate(
          connection,
          sessionId,
          STORE_CLEAR + screenPickExpression(
            { base64: image.base64 },
            { x: viewport.width / 2, y: viewport.height / 2 },
          ),
        );
        let pickError: unknown = null;
        const done = waitForPick(
          connection,
          sessionId,
          Date.now() + 15_000,
        ).catch((error: unknown) => {
          pickError = error;
          return null;
        });
        await dispatchClick(connection, sessionId, {
          x: viewport.width / 2,
          y: viewport.height / 2,
        });
        const result = await done;
        if (result === null || result.ok !== true) {
          const detail =
            pickError instanceof Error
              ? pickError.message
              : result !== null && typeof result.error === "string"
                ? result.error
                : "Clipboard write failed";
          await writeToast(connection, sessionId, detail + "; try again", true);
          throw new Error(detail);
        }
        return {
          image: {
            mimeType: "image/png" as const,
            base64: image.base64,
            width: image.width,
            height: image.height,
          },
          copied: true,
        };
      });
    },
  },
});

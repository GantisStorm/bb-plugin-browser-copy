import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import { hostContract, rpcContract, type Target } from "./contracts.js";

function scopeFor(target: Target) {
  return {
    hostId: target.hostId,
    instanceId: target.instanceId,
    generation: target.generation,
    threadId: target.threadId,
  };
}

export default function browserCopy(bb: BbPluginApi): void {
  const host = bb.hosts.experimental_client({ contract: hostContract });
  const desktop = bb.sdk.experimental_desktopBrowsers;
  const active = new Set<string>();

  const withLease = async <T>(
    target: Target,
    action: (wsEndpoint: string) => Promise<T>,
  ): Promise<T> => {
    const key = `${target.hostId}/${target.tabId}`;
    if (active.has(key))
      throw new Error("A Browser copy is already in progress on this tab");
    active.add(key);
    let leaseId: string | null = null;
    try {
      const lease = await desktop.acquireControl({
        ...scopeFor(target),
        tabIds: [target.tabId],
        controllerLabel: "Browser Copy",
        ttlMs: 30_000,
        allowPersonal: true,
      });
      leaseId = lease.leaseId;
      const connection = await desktop.openConnection({
        hostId: target.hostId,
        instanceId: target.instanceId,
        generation: target.generation,
        threadId: target.threadId,
        leaseId,
      });
      return await action(connection.wsEndpoint);
    } finally {
      if (leaseId !== null) {
        await desktop
          .releaseControl({
            hostId: target.hostId,
            instanceId: target.instanceId,
            generation: target.generation,
            threadId: target.threadId,
            leaseId,
          })
          .catch((error: unknown) =>
            bb.log.warn(
              `Could not release Browser Copy lease: ${error instanceof Error ? error.message : String(error)}`,
            ),
          );
      }
      active.delete(key);
    }
  };

  const handlers: PluginRpcHandlers<typeof rpcContract> = {
    async discover({ threadId }) {
      const targets: Array<{
        hostId: string;
        instanceId: string;
        generation: string;
        tab: { tabId: string; title: string; url: string };
      }> = [];
      for (const machine of await bb.sdk.hosts.list()) {
        let instances;
        try {
          ({ instances } = await desktop.listInstances({ hostId: machine.id }));
        } catch (error) {
          bb.log.warn(
            `Browser discovery unavailable on ${machine.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
          continue;
        }
        for (const instance of instances) {
          const scope = {
            hostId: machine.id,
            instanceId: instance.instanceId,
            generation: instance.generation,
            threadId,
          };
          try {
            const { tabs } = await desktop.listTabs(scope);
            for (const tab of tabs) {
              targets.push({
                hostId: scope.hostId,
                instanceId: scope.instanceId,
                generation: scope.generation,
                tab: { tabId: tab.tabId, title: tab.title, url: tab.url },
              });
            }
          } catch (error) {
            bb.log.warn(
              `Browser tabs unavailable on ${machine.id}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
      return { targets };
    },
    async copy(input) {
      const result = await withLease(input, async (wsEndpoint) => {
        if (input.mode === "screen-image") {
          const shot = await host.call(
            "screenPick",
            { wsEndpoint },
            { hostId: input.hostId },
          );
          return { element: null, image: shot.image, copied: shot.copied };
        }
        const picked = await host.call(
          "elementPick",
          {
            wsEndpoint,
            image: input.mode === "element-image",
          },
          { hostId: input.hostId },
        );
        return {
          element: picked.element,
          image: picked.image,
          copied: picked.copied,
        };
      });
      return {
        element: result.element,
        image: result.image,
        copied: result.copied,
      };
    },
  };
  bb.rpc.register(rpcContract, handlers);
}

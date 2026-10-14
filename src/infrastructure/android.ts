import { registerPlugin } from "@capacitor/core";
import type { PluginListenerHandle } from "@capacitor/core";
import type { PlatformAdapter } from "./platform";
import type {
  AIRequest,
  AIResult,
  Paper,
  Settings,
  Usage,
} from "../domain/models";
import {
  complete,
  normalizeUsage,
  estimateCost,
  type TokenUsage,
} from "./shared/providers.mjs";
interface NativePlugin {
  storage(args: {
    op: string;
    table: string;
    id?: string;
    data?: unknown;
    documentId?: string;
  }): Promise<{ value: unknown }>;
  importPdf(): Promise<{ value: Paper | null }>;
  readPdf(args: { id: string }): Promise<{ base64: string }>;
  saveSettings(args: {
    settings: Settings;
    keys: Record<string, string>;
  }): Promise<void>;
  startFetch(args: {
    id: string;
    providerId: string;
    url: string;
    body: string;
  }): Promise<void>;
  cancel(args: { id: string }): Promise<void>;
  exportData(): Promise<{ path: string | null }>;
  addListener(
    name: string,
    fn: (data: {
      id: string;
      type: string;
      status?: number;
      contentType?: string;
      text?: string;
      error?: string;
    }) => void,
  ): Promise<PluginListenerHandle>;
}
const native = registerPlugin<NativePlugin>("PassageNative");
const listeners = new Set<(data: { id: string; text: string }) => void>();
const pending = new Map<string, AbortController>();
const session = crypto.randomUUID();
let reservations = 0;
const storage = async (
  op: string,
  table: string,
  id?: string,
  data?: unknown,
  documentId?: string,
) => (await native.storage({ op, table, id, data, documentId })).value;
export function createAndroidAdapter(): PlatformAdapter {
  const adapter: PlatformAdapter = {
    list: async (table, documentId) =>
      (await storage(
        "list",
        table,
        undefined,
        undefined,
        documentId,
      )) as Record<string, unknown>[],
    get: (table, id) => storage("get", table, id),
    put: async (table, id, data, documentId) => {
      await storage("put", table, id, data, documentId);
    },
    remove: async (table, id) => {
      await storage("remove", table, id);
    },
    importPdf: async () => (await native.importPdf()).value,
    pdf: async (id) => {
      const { base64 } = await native.readPdf({ id });
      return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    },
    saveSettings: (settings, keys) => native.saveSettings({ settings, keys }),
    onChunk: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    cancel: async (id) => {
      pending.get(id)?.abort();
      await native.cancel({ id });
    },
    ai: async (request: AIRequest): Promise<AIResult> => {
      const settings = (await storage(
        "get",
        "settings",
        "app",
      )) as Settings | null;
      const config = settings?.providers.find(
        (p) => p.id === request.provider.id,
      );
      if (!config) throw Error("请先保存 AI 服务配置。");
      if (!config.model.trim()) throw Error("请先填写模型 ID。");
      if (!config.keySet && config.id !== "custom")
        throw Error("请先保存此服务商的 API Key。");
      const usageRows = (await storage("list", "usage_requests")) as Usage[];
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const consumed = usageRows
        .filter((r) => r.timestamp >= start.getTime())
        .reduce((s, r) => s + r.input + r.output, 0);
      const reserve =
        Math.ceil((request.system.length + request.prompt.length) / 3) +
        (request.maxTokens ?? 1500);
      if (
        settings!.hardLimit &&
        settings!.dailyTokenLimit > 0 &&
        consumed + reservations + reserve > settings!.dailyTokenLimit
      )
        throw Error("已达到每日 Token 硬限制。");
      reservations += reserve;
      const controller = new AbortController();
      pending.set(request.id, controller);
      const timer = setTimeout(() => controller.abort(), 90000);
      const timestamp = Date.now();
      let text = "";
      let actual: TokenUsage | undefined;
      let status = "success";
      const nativeFetch: typeof fetch = async (url, options) => {
        const id = crypto.randomUUID();
        let streamController: ReadableStreamDefaultController<Uint8Array>;
        let responseResolve: (response: Response) => void;
        let responseReject: (error: Error) => void;
        const responsePromise = new Promise<Response>((resolve, reject) => {
          responseResolve = resolve;
          responseReject = reject;
        });
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            streamController = c;
          },
        });
        let ended = false;
        const handle = await native.addListener("network", (event) => {
          if (event.id !== id || ended) return;
          if (event.type === "headers")
            responseResolve(
              new Response(stream, {
                status: event.status,
                headers: {
                  "content-type": event.contentType ?? "text/event-stream",
                },
              }),
            );
          else if (event.type === "chunk")
            streamController.enqueue(
              new TextEncoder().encode(event.text ?? ""),
            );
          else if (event.type === "end") {
            ended = true;
            streamController.close();
            void handle.remove();
          } else if (event.type === "error") {
            ended = true;
            const error = new Error(event.error ?? "无法连接 AI 服务。");
            responseReject(error);
            streamController.error(error);
            void handle.remove();
          }
        });
        const abort = () => {
          void native.cancel({ id });
          if (!ended) {
            ended = true;
            responseReject(new Error("请求已停止。"));
            streamController.error(new Error("请求已停止。"));
          }
          void handle.remove();
        };
        controller.signal.addEventListener("abort", abort, { once: true });
        if (controller.signal.aborted) abort();
        else
          void native
            .startFetch({
              id,
              providerId: config.id,
              url: String(url),
              body: String(options?.body ?? ""),
            })
            .catch((e) => {
              if (!ended) {
                ended = true;
                responseReject(e);
                streamController.error(e);
              }
              void handle.remove();
            });
        return responsePromise;
      };
      try {
        const result = await complete(
          config,
          "__native_key__",
          request,
          controller.signal,
          (delta) => {
            text += delta;
            listeners.forEach((fn) => fn({ id: request.id, text: delta }));
          },
          nativeFetch,
        );
        actual = result.usage;
        return {
          text: result.text,
          usage: {
            id: request.id,
            timestamp,
            session,
            provider: config.id,
            model: config.model,
            task: request.task,
            documentId: request.documentId,
            ...actual,
            cost: estimateCost(actual, config),
            duration: Date.now() - timestamp,
            status,
            contextIds: request.contextIds,
          },
        };
      } catch (e) {
        actual = (e as Error & { usage?: TokenUsage }).usage;
        status = controller.signal.aborted ? "cancelled" : "failed";
        throw e;
      } finally {
        clearTimeout(timer);
        pending.delete(request.id);
        reservations -= reserve;
        const usage =
          actual ??
          normalizeUsage(
            config.id,
            null,
            request.system + request.prompt,
            text,
          );
        await storage(
          "put",
          "usage_requests",
          request.id,
          {
            id: request.id,
            timestamp,
            session,
            provider: config.id,
            model: config.model,
            task: request.task,
            documentId: request.documentId,
            ...usage,
            cost: estimateCost(usage, config),
            duration: Date.now() - timestamp,
            status,
            contextIds: request.contextIds,
          },
          request.documentId,
        );
      }
    },
    testProvider: async (id) => {
      const settings = (await storage("get", "settings", "app")) as Settings;
      const provider = settings.providers.find((p) => p.id === id)!;
      await adapter.ai({
        id: crypto.randomUUID(),
        documentId: "",
        provider,
        task: "connection-test",
        system: "Reply briefly.",
        prompt: "Reply OK.",
        contextIds: [],
        maxTokens: 100,
      });
      return "连接成功；测试已计入用量。";
    },
    exportData: async () => (await native.exportData()).path,
    onClose: (fn) => {
      const handle = native.addListener("appPause", () => {
        void fn().catch(() => {});
      });
      return () => {
        void handle.then((h) => h.remove());
      };
    },
  };
  return adapter;
}

import { Capacitor } from "@capacitor/core";
import { createAndroidAdapter } from "./android";
import type { AIRequest, AIResult, Paper, Settings } from "../domain/models";
export interface PlatformAdapter {
  list(table: string, documentId?: string): Promise<Record<string, unknown>[]>;
  get(table: string, id: string): Promise<unknown>;
  put(
    table: string,
    id: string,
    data: unknown,
    documentId?: string,
  ): Promise<void>;
  remove(table: string, id: string): Promise<void>;
  importPdf(): Promise<Paper | null>;
  pdf(id: string): Promise<Uint8Array>;
  saveSettings(settings: Settings, keys: Record<string, string>): Promise<void>;
  ai(request: AIRequest): Promise<AIResult>;
  cancel(id: string): Promise<void>;
  onChunk(fn: (data: { id: string; text: string }) => void): () => void;
  testProvider(id: string): Promise<string>;
  exportData(): Promise<string | null>;
  onClose(fn: () => Promise<void>): () => void;
}
declare global {
  interface Window {
    passage?: PlatformAdapter;
  }
}
export const platform: PlatformAdapter =
  window.passage ??
  (Capacitor.isNativePlatform()
    ? createAndroidAdapter()
    : {
        list: async () => [],
        get: async () => null,
        put: async () => {
          throw new Error("请使用桌面应用保存本地数据。");
        },
        remove: async () => {},
        importPdf: async () => {
          throw new Error("请打开已打包的 Passage 桌面应用以导入论文。");
        },
        pdf: async () => {
          throw new Error("桌面文件适配器不可用。");
        },
        saveSettings: async () => {
          throw new Error("浏览器预览不能安全保存 API Key，请使用桌面应用。");
        },
        ai: async () => {
          throw new Error("请在桌面应用中配置 AI。");
        },
        cancel: async () => {},
        onChunk: () => () => {},
        testProvider: async () => {
          throw new Error("桌面网络适配器不可用。");
        },
        exportData: async () => null,
        onClose: () => () => {},
      });

import { useState } from "react";
import { Check, ShieldCheck, KeyRound, Download, Trash2 } from "lucide-react";
import { Modal } from "./Modal";
import { platform } from "../infrastructure/platform";
import type { Settings as SettingsModel, ProviderId } from "../domain/models";
export function Settings({
  settings,
  onSave,
  close,
}: {
  settings: SettingsModel;
  onSave: (settings: SettingsModel) => void;
  close: () => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(settings)),
    [selected, setSelected] = useState<ProviderId>(
      settings.translationProvider,
    ),
    [keys, setKeys] = useState<Record<string, string>>({}),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const provider = draft.providers.find((p) => p.id === selected)!;
  const update = (values: Partial<typeof provider>) =>
    setDraft((s) => ({
      ...s,
      providers: s.providers.map((p) =>
        p.id === selected ? { ...p, ...values } : p,
      ),
    }));
  const persist = async () => {
    const changes = Object.fromEntries(
      Object.entries(keys).map(([id, value]) => {
        const key = value.trim();
        if (value !== "" && (!key || /\s/.test(key)))
          throw new Error(
            "API Key 格式无效，请复制完整密钥，不要包含空白字符。",
          );
        return [id, key];
      }),
    );
    await platform.saveSettings(
      {
        ...draft,
        providers: draft.providers.map((p) => ({
          ...p,
          model: p.model.trim(),
          baseUrl: p.baseUrl.trim(),
        })),
      },
      changes,
    );
    const stored = (await platform.get("settings", "app")) as SettingsModel;
    onSave(stored);
    setDraft(stored);
    setKeys({});
  };
  const save = async (test = false) => {
    setBusy(true);
    setMessage("");
    try {
      if (test && !provider.model.trim())
        throw new Error("请填写此服务商的模型名称。");
      await persist();
      setMessage(
        test
          ? await platform.testProvider(selected)
          : "设置已保存，密钥由系统凭据服务加密。",
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="偏好设置" close={close} wide>
      <div className="settings-body">
        <section>
          <h3>AI 服务商</h3>
          <p className="muted">
            使用自己的 API。模型名称由你指定，支持 OpenAI-compatible 本地服务。
          </p>
          <div className="provider-tabs">
            {draft.providers.map((p) => (
              <button
                key={p.id}
                className={selected === p.id ? "active" : ""}
                disabled={busy}
                onClick={() => setSelected(p.id)}
              >
                {
                  {
                    openai: "OpenAI",
                    anthropic: "Anthropic",
                    gemini: "Gemini",
                    deepseek: "DeepSeek",
                    custom: "自定义 / 本地",
                  }[p.id]
                }
                {p.keySet && <Check size={12} />}
              </button>
            ))}
          </div>
          <div className="form-grid">
            <label className="full">
              API 地址
              <input
                value={provider.baseUrl}
                onChange={(e) => update({ baseUrl: e.target.value })}
                spellCheck={false}
              />
            </label>
            <label className="full">
              模型名称
              <input
                placeholder="填入服务商支持的模型 ID"
                value={provider.model}
                onChange={(e) => update({ model: e.target.value })}
                spellCheck={false}
              />
            </label>
            <label className="full">
              <span>
                <KeyRound size={13} /> API Key{" "}
                {provider.keySet ? "· 已保存" : ""}
              </span>
              <div className="key-row">
                <input
                  type="password"
                  aria-label="API Key"
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  disabled={busy}
                  value={keys[selected] ?? ""}
                  onChange={(e) => {
                    const value = e.currentTarget.value;
                    setKeys((k) => {
                      const next = { ...k };
                      if (value) next[selected] = value;
                      else delete next[selected];
                      return next;
                    });
                  }}
                  placeholder={
                    provider.keySet
                      ? "已保存 · 留空保留现有密钥"
                      : selected === "custom"
                        ? "本地模型可留空"
                        : "粘贴此服务商的 API Key"
                  }
                />
                <button
                  title="删除密钥"
                  onClick={() => setKeys((k) => ({ ...k, [selected]: "" }))}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </label>
            <label>
              输入价格 / 百万 Token（USD）
              <input
                type="number"
                min="0"
                step="any"
                placeholder="未配置"
                value={provider.inputPrice ?? ""}
                onChange={(e) =>
                  update({
                    inputPrice:
                      e.target.value === ""
                        ? undefined
                        : Number(e.target.value),
                  })
                }
              />
            </label>
            <label>
              输出价格 / 百万 Token（USD）
              <input
                type="number"
                min="0"
                step="any"
                placeholder="未配置"
                value={provider.outputPrice ?? ""}
                onChange={(e) =>
                  update({
                    outputPrice:
                      e.target.value === ""
                        ? undefined
                        : Number(e.target.value),
                  })
                }
              />
            </label>
            <label className="full">
              缓存输入价格 / 百万 Token（USD）
              <input
                type="number"
                min="0"
                step="any"
                placeholder="留空按普通输入价格估算"
                value={provider.cachedPrice ?? ""}
                onChange={(e) =>
                  update({
                    cachedPrice:
                      e.target.value === ""
                        ? undefined
                        : Number(e.target.value),
                  })
                }
              />
            </label>
          </div>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => save(true)}
          >
            保存并测试连接
          </button>
        </section>
        <section>
          <h3>任务与阅读</h3>
          <div className="form-grid">
            <label>
              翻译服务商
              <select
                value={draft.translationProvider}
                onChange={(e) =>
                  setDraft((s) => ({
                    ...s,
                    translationProvider: e.target.value as ProviderId,
                  }))
                }
              >
                {draft.providers.map((p) => (
                  <option key={p.id}>{p.id}</option>
                ))}
              </select>
            </label>
            <label>
              解释与问答服务商
              <select
                value={draft.reasoningProvider}
                onChange={(e) =>
                  setDraft((s) => ({
                    ...s,
                    reasoningProvider: e.target.value as ProviderId,
                  }))
                }
              >
                {draft.providers.map((p) => (
                  <option key={p.id}>{p.id}</option>
                ))}
              </select>
            </label>
            <label>
              外观
              <select
                value={draft.theme}
                onChange={(e) =>
                  setDraft((s) => ({
                    ...s,
                    theme: e.target.value as SettingsModel["theme"],
                  }))
                }
              >
                <option value="system">跟随系统</option>
                <option value="light">浅色</option>
                <option value="dark">深色</option>
              </select>
            </label>
            <label>
              辅助文字大小
              <input
                type="number"
                min="12"
                max="24"
                value={draft.fontSize}
                onChange={(e) =>
                  setDraft((s) => ({
                    ...s,
                    fontSize: Math.max(
                      12,
                      Math.min(24, Number(e.target.value)),
                    ),
                  }))
                }
              />
            </label>
            <label>
              每日 Token 限额（0 为不限）
              <input
                type="number"
                min="0"
                value={draft.dailyTokenLimit}
                onChange={(e) =>
                  setDraft((s) => ({
                    ...s,
                    dailyTokenLimit: Number(e.target.value),
                  }))
                }
              />
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={draft.hardLimit}
                onChange={(e) =>
                  setDraft((s) => ({ ...s, hardLimit: e.target.checked }))
                }
              />
              启用硬限制
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={draft.reduceMotion}
                onChange={(e) =>
                  setDraft((s) => ({ ...s, reduceMotion: e.target.checked }))
                }
              />
              减少动态效果
            </label>
          </div>
          <p className="muted">
            费用是按你填写的价格估算，最终以服务商账单为准。后台预取默认关闭。
          </p>
        </section>
        <section>
          <h3>本地数据</h3>
          <p className="muted">
            PDF、译文缓存、笔记与阅读进度在本机保存。备份包含论文原文件，不包含
            API Key。
          </p>
          <button
            className="secondary"
            onClick={async () => {
              try {
                const location = await platform.exportData();
                if (location) setMessage("完整备份已导出。");
              } catch (e) {
                setMessage((e as Error).message);
              }
            }}
          >
            <Download size={15} />
            导出完整备份
          </button>
        </section>
      </div>
      <footer className="modal-footer">
        <span className="muted">
          <ShieldCheck size={14} />
          密钥不会发送到 Passage 服务器
        </span>
        <button className="primary" disabled={busy} onClick={() => save()}>
          {busy ? "处理中…" : "保存设置"}
        </button>
      </footer>
      {message && (
        <div className="settings-message" role="status">
          {message}
        </div>
      )}
    </Modal>
  );
}

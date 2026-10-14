import { useEffect, useState } from "react";
import type { Usage } from "../domain/models";
import { platform } from "../infrastructure/platform";
import { Modal } from "./Modal";
export function UsageConsole({ close }: { close: () => void }) {
  const [records, setRecords] = useState<Usage[]>([]),
    [period, setPeriod] = useState("today"),
    [detail, setDetail] = useState<Usage | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    platform
      .list("usage_requests")
      .then((rows) =>
        setRecords(
          (rows as unknown as Usage[]).sort(
            (a, b) => b.timestamp - a.timestamp,
          ),
        ),
      )
      .catch((e) => setError(e.message));
  }, []);
  const start = new Date();
  if (period === "today") start.setHours(0, 0, 0, 0);
  else if (period === "7" || period === "30")
    start.setTime(Date.now() - Number(period) * 86400000);
  else start.setTime(0);
  const rows = records.filter((r) =>
    period === "session"
      ? r.session === records[0]?.session
      : r.timestamp >= start.getTime(),
  );
  const input = rows.reduce((s, r) => s + r.input, 0),
    output = rows.reduce((s, r) => s + r.output, 0),
    cost = rows.reduce((s, r) => s + (r.cost ?? 0), 0),
    unknown = rows.filter((r) => r.cost === null).length;
  const groups = new Map<
    string,
    {
      requests: number;
      tokens: number;
      cost: number;
      duration: number;
      failed: number;
      unknown: boolean;
    }
  >();
  rows.forEach((r) => {
    const key = `${r.provider} / ${r.model} · ${r.task}`;
    const g = groups.get(key) ?? {
      requests: 0,
      tokens: 0,
      cost: 0,
      duration: 0,
      failed: 0,
      unknown: false,
    };
    g.requests++;
    g.tokens += r.input + r.output;
    g.cost += r.cost ?? 0;
    g.duration += r.duration;
    g.failed += r.status === "success" ? 0 : 1;
    g.unknown ||= r.cost === null;
    groups.set(key, g);
  });
  return (
    <Modal title="用量与费用" close={close} wide>
      <div className="usage-body">
        <div className="period-tabs">
          {[
            ["session", "最近会话"],
            ["today", "今天"],
            ["7", "7 天"],
            ["30", "30 天"],
            ["all", "全部"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={id === period ? "active" : ""}
              onClick={() => setPeriod(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="usage-stats">
          <div>
            <small>请求次数</small>
            <strong>{rows.length}</strong>
          </div>
          <div>
            <small>输入 / 输出 Token</small>
            <strong>
              {input.toLocaleString()} <span>/ {output.toLocaleString()}</span>
            </strong>
          </div>
          <div>
            <small>估算费用 · USD</small>
            <strong>
              {rows.length && unknown < rows.length
                ? `$${cost.toFixed(4)}`
                : "—"}
            </strong>
          </div>
        </div>
        <p className="muted">
          {unknown ? `${unknown} 次请求未配置价格，未计入费用。` : ""}Token
          优先采用服务商返回值；费用始终为估算，非官方账单。
        </p>
        {groups.size > 0 && (
          <table>
            <thead>
              <tr>
                <th>服务商 / 模型 / 任务</th>
                <th>请求</th>
                <th>Token</th>
                <th>平均延迟</th>
                <th>未完成</th>
              </tr>
            </thead>
            <tbody>
              {[...groups.entries()].map(([key, g]) => (
                <tr key={key}>
                  <td>{key}</td>
                  <td>{g.requests}</td>
                  <td>{g.tokens.toLocaleString()}</td>
                  <td>{(g.duration / g.requests / 1000).toFixed(1)} s</td>
                  <td>{g.failed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <h3>请求记录</h3>
        {!rows.length && (
          <div className="empty-small">
            还没有 AI 请求。阅读和本地搜索不会产生 API 费用。
          </div>
        )}
        {rows.map((r) => (
          <button
            className="usage-record"
            key={r.id}
            onClick={() => setDetail(detail?.id === r.id ? null : r)}
          >
            <span>
              {r.task}
              <small>
                {r.provider} · {r.model}
              </small>
            </span>
            <span>
              {(r.input + r.output).toLocaleString()} tokens
              <small>
                {r.actual ? "服务商返回用量" : "估算用量"} · {r.status}
              </small>
            </span>
            <span>
              {r.cost === null ? "未配置价格" : `≈ $${r.cost.toFixed(5)}`}
              <small>{new Date(r.timestamp).toLocaleString("zh-CN")}</small>
            </span>
          </button>
        ))}
        {detail && (
          <div className="request-detail">
            <h4>请求详情</h4>
            <p>
              耗时 {(detail.duration / 1000).toFixed(2)} s · 输入 {detail.input}{" "}
              · 输出 {detail.output} · 缓存 {detail.cached} · Reasoning{" "}
              {detail.reasoning}
            </p>
            <p>来源块：{detail.contextIds.join("、") || "无论文上下文"}</p>
            <small>
              本地记录仅包含来源 ID 与用量，不保存完整请求正文或密钥。
            </small>
          </div>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </Modal>
  );
}

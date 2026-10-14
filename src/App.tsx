import { useCallback, useEffect, useRef, useState } from "react";
import {
  Languages,
  Sparkles,
  Highlighter,
  StickyNote,
  X,
  ArrowUpRight,
  Search,
  FolderPlus,
  Focus,
  Columns2,
  BookOpen,
  Settings2,
} from "lucide-react";
import {
  defaultSettings,
  type Block,
  type Paper,
  type Selection,
  type Settings as SettingsModel,
} from "./domain/models";
import { platform } from "./infrastructure/platform";
import { useReader } from "./application/useReader";
import { useAssistant } from "./application/useAssistant";
import { Library } from "./components/Library";
import { Reader } from "./components/Reader";
import { Assistant } from "./components/Assistant";
import { Settings } from "./components/Settings";
import { UsageConsole } from "./components/UsageConsole";
import { Modal } from "./components/Modal";
import { Notes } from "./components/Notes";
import { Terms } from "./components/Terms";
export default function App() {
  const [papers, setPapers] = useState<Paper[]>([]),
    [paper, setPaper] = useState<Paper | null>(null),
    [settings, setSettings] = useState<SettingsModel>(defaultSettings),
    [modal, setModal] = useState(""),
    [selection, setSelection] = useState<Selection | null>(null),
    [source, setSource] = useState<Block | null>(null),
    [toast, setToast] = useState(""),
    [searchOpen, setSearchOpen] = useState(false),
    [assistantOpen, setAssistantOpen] = useState(false),
    [peek, setPeek] = useState(false),
    [command, setCommand] = useState(""),
    [offline, setOffline] = useState(!navigator.onLine),
    [deletePaper, setDeletePaper] = useState<Paper | null>(null),
    [zen, setZen] = useState(false);
  const reader = useReader(paper, setToast);
  const active =
    reader.blocks.find((b) => b.id === reader.position.active) ??
    (selection
      ? {
          id: `selection-p${selection.page}`,
          page: selection.page,
          text: selection.text,
          section: "选文",
          kind: "paragraph" as const,
          confidence: 1,
          box: selection.boxes[0] ?? { x: 0, y: 0, width: 1, height: 1 },
        }
      : undefined);
  const assistant = useAssistant(paper, settings, reader.blocks, active);
  const keyActions = useRef(
    {} as {
      importPaper: () => void;
      run: (task: string) => void;
      travel: (direction: "back" | "forward") => void;
      focus: () => void;
    },
  );
  const importPaper = useCallback(async () => {
    try {
      const imported = await platform.importPdf();
      if (!imported) return;
      if (paper)
        await platform.put(
          "reading_positions",
          paper.id,
          reader.position,
          paper.id,
        );
      setPapers((items) => [
        imported,
        ...items.filter((p) => p.id !== imported.id),
      ]);
      setPaper(imported);
      setSelection(null);
    } catch (e) {
      setToast((e as Error).message);
    }
  }, [paper, reader.position]);
  const selectPaper = async (next: Paper) => {
    if (next.id === paper?.id) return;
    try {
      if (paper)
        await platform.put(
          "reading_positions",
          paper.id,
          reader.position,
          paper.id,
        );
      setPaper(next);
      setSelection(null);
    } catch (e) {
      setToast((e as Error).message);
    }
  };
  const runAI = (task: string, text?: string, query?: string) => {
    setAssistantOpen(true);
    void assistant.run(task, text ?? selection?.text, query);
    setSelection(null);
  };
  keyActions.current = {
    importPaper: () => void importPaper(),
    run: runAI,
    travel: reader.travel,
    focus: () => reader.setPosition((p) => ({ ...p, focus: !p.focus })),
  };
  useEffect(() => {
    (async () => {
      const rows = await platform.list("documents");
      const values = rows as unknown as Paper[];
      setPapers(values);
      const stored = (await platform.get(
        "settings",
        "app",
      )) as SettingsModel | null;
      if (stored) setSettings({ ...defaultSettings, ...stored });
      if (values.length)
        setPaper([...values].sort((a, b) => b.openedAt - a.openedAt)[0]);
    })().catch((e) => setToast(e.message));
  }, []);
  useEffect(() => {
    const online = () => setOffline(!navigator.onLine);
    window.addEventListener("online", online);
    window.addEventListener("offline", online);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", online);
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 8000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const system = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        settings.theme === "system"
          ? system.matches
            ? "dark"
            : "light"
          : settings.theme;
      document.documentElement.style.setProperty(
        "--assistant-font",
        `${settings.fontSize}px`,
      );
      document.documentElement.dataset.reduceMotion = String(
        settings.reduceMotion,
      );
    };
    apply();
    system.addEventListener("change", apply);
    return () => system.removeEventListener("change", apply);
  }, [settings]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const input = (e.target as HTMLElement).closest(
        'input,textarea,select,[contenteditable="true"]',
      );
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        keyActions.current.importPaper();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearchOpen(true);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setModal("commands");
      } else if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        setModal("settings");
      } else if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        keyActions.current.travel("back");
      } else if (e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        keyActions.current.travel("forward");
      } else if (e.key === "Alt" && !input && !e.repeat) {
        setPeek(true);
      } else if (e.key === "Escape") {
        setSelection(null);
        setSource(null);
        setModal("");
        setPeek(false);
        setZen(false);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Alt") setPeek(false);
    };
    const blur = () => setPeek(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);
  useEffect(() => {
    if (
      peek &&
      paper &&
      !assistant.busy &&
      (!assistant.answer || assistant.answer.task !== "translate")
    )
      void assistant.run("translate");
  }, [peek]);
  useEffect(() => {
    if (paper && !reader.loading && reader.pdf)
      platform
        .list("documents")
        .then((rows) => setPapers(rows as unknown as Paper[]))
        .catch((e) => setToast(e.message));
  }, [paper?.id, reader.loading]);
  const closeSnapshot = useRef<() => Promise<void>>(async () => {});
  closeSnapshot.current = async () => {
    if (paper && reader.pdf && !reader.loading) {
      try {
        await platform.put(
          "reading_positions",
          paper.id,
          reader.position,
          paper.id,
        );
      } catch (error) {
        setToast("关闭前保存阅读位置失败：" + (error as Error).message);
        throw error;
      }
    }
  };
  useEffect(() => platform.onClose(() => closeSnapshot.current()), []);
  const previousImmersive = useRef("");
  useEffect(() => {
    if (
      !reader.position.bilingual ||
      !active ||
      !paper ||
      !settings.providers.find((p) => p.id === settings.translationProvider)
        ?.model
    )
      return;
    const key = `${paper.id}:${active.id}`;
    if (previousImmersive.current === key) return;
    const timer = setTimeout(() => {
      previousImmersive.current = key;
      void assistant.run("translate");
    }, 650);
    return () => clearTimeout(timer);
  }, [active?.id, reader.position.bilingual, paper?.id]);
  const saveAnswer = async () => {
    if (!assistant.answer?.complete) return;
    try {
      await reader.saveNote(
        assistant.answer.sources[0]?.text ?? "",
        assistant.answer.text,
        assistant.answer.sources[0]?.page ?? reader.position.page,
        assistant.answer.sources[0]?.id,
      );
      setToast("已保存为带来源的论文笔记。");
    } catch (e) {
      setToast((e as Error).message);
    }
  };
  const sidebar = !reader.position.focus && !zen,
    showAssistant = (assistantOpen || reader.position.bilingual) && !zen;
  const commands = [
    {
      label: "偏好设置",
      icon: Settings2,
      run: () => setModal("settings"),
      key: "⌘ ,",
    },
    {
      label: "导入论文",
      icon: FolderPlus,
      run: () => void importPaper(),
      key: "⌘ O",
    },
    {
      label: "搜索论文",
      icon: Search,
      run: () => setSearchOpen(true),
      key: "⌘ F",
    },
    {
      label: "翻译当前段落",
      icon: Languages,
      run: () => runAI("translate"),
      key: "Alt",
    },
    {
      label: "解释当前段落",
      icon: Sparkles,
      run: () => runAI("explain"),
      key: "",
    },
    {
      label: "切换双语阅读",
      icon: Columns2,
      run: () => reader.setPosition((p) => ({ ...p, bilingual: !p.bilingual })),
      key: "",
    },
    {
      label: "切换专注模式",
      icon: Focus,
      run: keyActions.current.focus,
      key: "",
    },
    {
      label: "Zen 阅读模式",
      icon: BookOpen,
      run: () => setZen(!zen),
      key: "Esc 退出",
    },
    {
      label: "论文笔记",
      icon: StickyNote,
      run: () => setModal("notes"),
      key: "",
    },
  ];
  return (
    <div
      className={`app ${sidebar ? "" : "focus-mode"} ${zen ? "zen-mode" : ""}`}
    >
      <div className="window-drag">
        <span>PASSAGE / RESEARCH READER</span>
        <button onClick={() => setModal("commands")}>
          搜索操作 <kbd>⌘ K</kbd>
        </button>
        {offline && <span className="offline">离线 · 本地阅读可用</span>}
      </div>
      <div className="workspace">
        {sidebar && (
          <Library
            papers={papers}
            current={paper?.id}
            onOpen={(p) => void selectPaper(p)}
            onImport={() => void importPaper()}
            onSettings={() => setModal("settings")}
            onUsage={() => setModal("usage")}
            onPin={async (p) => {
              const next = { ...p, pinned: !p.pinned };
              try {
                await platform.put("documents", p.id, next);
                setPapers((items) =>
                  items.map((v) => (v.id === p.id ? next : v)),
                );
              } catch (e) {
                setToast((e as Error).message);
              }
            }}
            onDelete={setDeletePaper}
          />
        )}
        <Reader
          paper={paper}
          reader={reader}
          onSelection={setSelection}
          onSource={setSource}
          onNotes={() => setModal("notes")}
          onAI={() => setAssistantOpen(!assistantOpen)}
          onError={setToast}
          onImport={() => void importPaper()}
          searchOpen={searchOpen}
          setSearchOpen={setSearchOpen}
        />
        {paper && showAssistant && (
          <Assistant
            active={active}
            answer={assistant.answer}
            busy={assistant.busy}
            error={assistant.error}
            onRun={runAI}
            onCancel={assistant.cancel}
            onSource={setSource}
            onSave={() => void saveAnswer()}
            onTerms={() => setModal("terms")}
            provider={
              assistant.answer?.task === "translate"
                ? settings.translationProvider
                : settings.reasoningProvider
            }
          />
        )}
      </div>
      {selection && (
        <div
          className="selection-toolbar"
          style={{ left: selection.x, top: selection.y }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <button onClick={() => runAI("translate")}>
            <Languages size={15} />
            翻译
          </button>
          <button onClick={() => runAI("explain")}>
            <Sparkles size={15} />
            解释
          </button>
          <button
            onClick={async () => {
              if (!paper) return;
              try {
                await reader.addHighlight({
                  id: crypto.randomUUID(),
                  documentId: paper.id,
                  page: selection.page,
                  boxes: selection.boxes,
                  text: selection.text,
                  color: "rgba(238,199,70,.35)",
                });
                setSelection(null);
                window.getSelection()?.removeAllRanges();
              } catch (e) {
                setToast((e as Error).message);
              }
            }}
          >
            <Highlighter size={15} />
            高亮
          </button>
          <button onClick={() => setModal("notes")}>
            <StickyNote size={15} />
            笔记
          </button>
          <button aria-label="关闭选文操作" onClick={() => setSelection(null)}>
            <X size={14} />
          </button>
        </div>
      )}
      {source && (
        <Modal
          title={`来源预览 · 第 ${source.page} 页`}
          close={() => setSource(null)}
        >
          <div className="source-peek">
            <small>{source.section} · 原始论文文本</small>
            <p>{source.text}</p>
            <button
              className="primary"
              onClick={() => {
                reader.jump(source.page, source);
                setSource(null);
              }}
            >
              前往原文
              <ArrowUpRight size={16} />
            </button>
          </div>
        </Modal>
      )}
      {peek && paper && (
        <div className="translation-peek">
          <small>TRANSLATION PEEK · 松开 Alt 返回阅读</small>
          <p>
            {assistant.answer?.task === "translate" && assistant.answer.complete
              ? assistant.answer.text
              : assistant.error || "正在获取当前段落译文…"}
          </p>
        </div>
      )}
      {modal === "settings" && (
        <Settings
          settings={settings}
          onSave={setSettings}
          close={() => setModal("")}
        />
      )}
      {modal === "usage" && <UsageConsole close={() => setModal("")} />}
      {modal === "notes" && paper && (
        <Notes
          notes={reader.notes}
          source={selection?.text || active?.text || ""}
          page={selection?.page ?? reader.position.page}
          close={() => setModal("")}
          onSave={(text) =>
            reader.saveNote(
              selection?.text || active?.text || "",
              text,
              selection?.page ?? reader.position.page,
              active?.id,
            )
          }
          onRemove={reader.removeNote}
          onJump={(note) => {
            reader.jump(
              note.page,
              reader.blocks.find((b) => b.id === note.blockId),
            );
            setModal("");
          }}
        />
      )}
      {modal === "terms" && paper && (
        <Terms
          terms={assistant.terms}
          save={assistant.saveTerms}
          close={() => setModal("")}
        />
      )}
      {modal === "commands" && (
        <Modal title="快捷操作" close={() => setModal("")}>
          <div className="command-palette">
            <input
              placeholder="搜索操作…"
              aria-label="搜索快捷操作"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
            />
            {commands
              .filter((c) => c.label.includes(command))
              .map((c) => (
                <button
                  key={c.label}
                  onClick={() => {
                    setModal("");
                    c.run();
                  }}
                >
                  <c.icon size={18} />
                  <span>{c.label}</span>
                  <kbd>{c.key}</kbd>
                </button>
              ))}
          </div>
        </Modal>
      )}
      {deletePaper && (
        <Modal title="移出文献库" close={() => setDeletePaper(null)}>
          <div className="source-peek">
            <p>
              移出“{deletePaper.name}
              ”及其本地笔记、译文缓存和高亮？原始导入文件不会被修改。你可以先在设置中导出备份。
            </p>
            <button
              className="danger"
              onClick={async () => {
                try {
                  await platform.remove("documents", deletePaper.id);
                  setPapers((items) =>
                    items.filter((p) => p.id !== deletePaper.id),
                  );
                  if (paper?.id === deletePaper.id) setPaper(null);
                  setDeletePaper(null);
                } catch (e) {
                  setToast((e as Error).message);
                }
              }}
            >
              移出论文及阅读数据
            </button>
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
          <button aria-label="关闭提示" onClick={() => setToast("")}>
            <X size={15} />
          </button>
        </div>
      )}
      <nav className="mobile-nav">
        <button onClick={() => setAssistantOpen(false)}>
          <BookOpen size={18} />
          阅读
        </button>
        <button onClick={() => setAssistantOpen(true)}>
          <Sparkles size={18} />
          AI
        </button>
        <button onClick={() => setModal("notes")}>
          <StickyNote size={18} />
          笔记
        </button>
        <button onClick={() => setModal("commands")}>
          <Search size={18} />
          操作
        </button>
      </nav>
    </div>
  );
}

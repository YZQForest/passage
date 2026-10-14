export type Box = { x: number; y: number; width: number; height: number };
export type Block = {
  id: string;
  page: number;
  text: string;
  box: Box;
  section: string;
  kind: "paragraph" | "heading" | "equation" | "caption";
  confidence: number;
};
export type Paper = {
  id: string;
  name: string;
  pages: number;
  addedAt: number;
  openedAt: number;
  pinned?: boolean;
  tags?: string[];
};
export type Position = {
  page: number;
  scroll: number;
  zoom: number;
  mode: "continuous" | "single";
  active?: string;
  bilingual: boolean;
  focus: boolean;
};
export type Note = {
  id: string;
  documentId: string;
  page: number;
  blockId?: string;
  source: string;
  text: string;
  createdAt: number;
};
export type Highlight = {
  id: string;
  documentId: string;
  page: number;
  boxes: Box[];
  text: string;
  color: string;
};
export type Term = {
  original: string;
  preferred: string;
  abbreviation?: string;
  explanation?: string;
};
export type ProviderId =
  "openai" | "anthropic" | "gemini" | "deepseek" | "custom";
export type ProviderConfig = {
  id: ProviderId;
  baseUrl: string;
  model: string;
  keySet?: boolean;
  inputPrice?: number;
  outputPrice?: number;
  cachedPrice?: number;
};
export type Settings = {
  providers: ProviderConfig[];
  translationProvider: ProviderId;
  reasoningProvider: ProviderId;
  theme: "light" | "dark" | "system";
  dailyTokenLimit: number;
  hardLimit: boolean;
  fontSize: number;
  reduceMotion: boolean;
};
export type Usage = {
  id: string;
  timestamp: number;
  session: string;
  provider: string;
  model: string;
  task: string;
  documentId: string;
  input: number;
  output: number;
  cached: number;
  reasoning: number;
  actual: boolean;
  cost: number | null;
  duration: number;
  status: string;
  contextIds: string[];
};
export type AIRequest = {
  id: string;
  documentId: string;
  provider: ProviderConfig;
  task: string;
  system: string;
  prompt: string;
  contextIds: string[];
  maxTokens?: number;
};
export type AIResult = { text: string; usage: Usage };
export type Selection = {
  text: string;
  page: number;
  boxes: Box[];
  x: number;
  y: number;
};
export const defaultSettings: Settings = {
  providers: [
    { id: "openai", baseUrl: "https://api.openai.com/v1", model: "" },
    { id: "anthropic", baseUrl: "https://api.anthropic.com/v1", model: "" },
    {
      id: "gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      model: "",
    },
    {
      id: "deepseek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
    },
    { id: "custom", baseUrl: "http://localhost:11434/v1", model: "" },
  ],
  translationProvider: "deepseek",
  reasoningProvider: "deepseek",
  theme: "system",
  dailyTokenLimit: 100000,
  hardLimit: false,
  fontSize: 15,
  reduceMotion: false,
};
export const defaultPosition: Position = {
  page: 1,
  scroll: 0,
  zoom: 1,
  mode: "continuous",
  bilingual: false,
  focus: false,
};

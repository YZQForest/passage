import {
  getDocument,
  GlobalWorkerOptions,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { Block } from "../domain/models";
import { parsePage } from "./parser";
GlobalWorkerOptions.workerSrc = workerUrl;
export type PageSize = { width: number; height: number };
export async function openPdf(data: Uint8Array): Promise<PDFDocumentProxy> {
  const assets = new URL("./pdf-assets/", window.location.href).href;
  return getDocument({
    data,
    cMapUrl: assets + "cmaps/",
    cMapPacked: true,
    standardFontDataUrl: assets + "standard_fonts/",
    wasmUrl: assets + "wasm/",
  }).promise;
}
export async function indexPdf(
  pdf: PDFDocumentProxy,
  onPage: (page: number, blocks: Block[], size: PageSize) => void,
  cancelled: () => boolean,
) {
  let section = "正文";
  for (let n = 1; n <= pdf.numPages; n++) {
    if (cancelled()) return;
    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    if (cancelled()) return;
    const blocks = parsePage(content, viewport, n, section);
    section = blocks.at(-1)?.section ?? section;
    onPage(n, blocks, { width: viewport.width, height: viewport.height });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

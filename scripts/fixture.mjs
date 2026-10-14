import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fs from "node:fs/promises";
import path from "node:path";
export async function createFixture(file) {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.TimesRoman);
  const bold = await document.embedFont(StandardFonts.TimesRomanBold);
  const sans = await document.embedFont(StandardFonts.Helvetica);
  document.setTitle("Local-first Research Reading");
  document.setAuthor("Passage test fixture");
  for (let i = 0; i < 24; i++) {
    const page = document.addPage([612, 792]);
    page.drawText(
      i === 0
        ? "Local-first Research Reading"
        : `${i + 1} ${i < 5 ? "Introduction" : i < 15 ? "Methods" : "Experiments"}`,
      {
        x: 48,
        y: 730,
        size: i === 0 ? 24 : 18,
        font: bold,
        color: rgb(0.1, 0.15, 0.12),
      },
    );
    if (i === 0) {
      page.drawText("A reproducible document for reader verification", {
        x: 48,
        y: 695,
        size: 12,
        font: regular,
      });
      page.drawText("Abstract", { x: 48, y: 651, size: 13, font: bold });
    }
    const top = i === 0 ? 620 : 680;
    for (let column = 0; column < 2; column++)
      for (let line = 0; line < 28; line++) {
        const sentences = [
          "Transformer models use local context [12].",
          "The loss function minimizes training error.",
          "We evaluate evidence on a controlled dataset.",
          "Results should remain linked to source pages.",
          "PDF layout must remain visually unchanged.",
          "A selected paragraph gives useful context.",
          "Users continue reading after assistance.",
        ];
        page.drawText(sentences[(line + column + i) % sentences.length], {
          x: 48 + column * 268,
          y: top - line * 17,
          size: 10,
          font: regular,
        });
      }
    page.drawText(String(i + 1), { x: 303, y: 26, size: 9, font: sans });
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, await document.save());
}
if (process.argv[1]?.endsWith("fixture.mjs"))
  await createFixture(path.resolve("test-results/reader-fixture.pdf"));

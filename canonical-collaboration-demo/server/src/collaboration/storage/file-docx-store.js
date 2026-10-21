import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function createFileDocxStore(directory) {
  let ready;
  let writes = 0;
  const fileFor = (documentId) => path.join(directory, `${encodeURIComponent(documentId)}.docx`);
  return {
    async put(documentId, docx) {
      ready ??= mkdir(directory, { recursive: true });
      await ready;
      const target = fileFor(documentId);
      const temporary = `${target}.${process.pid}.${++writes}.tmp`;
      await writeFile(temporary, docx);
      await rename(temporary, target);
    },
    async delete(documentId) {
      await rm(fileFor(documentId), { force: true });
    },
  };
}

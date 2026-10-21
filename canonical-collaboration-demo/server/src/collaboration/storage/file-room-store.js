import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function createFileRoomStore(directory) {
  let ready;
  let writes = 0;
  const fileFor = (roomName) => path.join(directory, `${createHash('sha256').update(roomName).digest('hex')}.yjs`);

  return {
    async load(roomName) {
      try {
        return new Uint8Array(await readFile(fileFor(roomName)));
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    },
    async store(roomName, state) {
      ready ??= mkdir(directory, { recursive: true });
      await ready;
      const target = fileFor(roomName);
      const temporary = `${target}.${process.pid}.${++writes}.tmp`;
      await writeFile(temporary, state);
      await rename(temporary, target);
    },
    async delete(roomName) {
      await rm(fileFor(roomName), { force: true });
    },
  };
}

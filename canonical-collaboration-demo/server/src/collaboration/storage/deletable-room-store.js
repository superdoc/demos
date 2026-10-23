export function createDeletableRoomStore(roomStore) {
  const deletedRooms = new Set();
  const pendingWrites = new Map();

  return {
    async load(roomName) {
      deletedRooms.delete(roomName);
      return roomStore.load(roomName);
    },
    async store(roomName, state) {
      if (deletedRooms.has(roomName)) return;
      const write = roomStore.store(roomName, state);
      const writes = pendingWrites.get(roomName) ?? new Set();
      writes.add(write);
      pendingWrites.set(roomName, writes);
      try {
        await write;
      } finally {
        writes.delete(write);
        if (!writes.size) pendingWrites.delete(roomName);
      }
    },
    async delete(roomName) {
      deletedRooms.add(roomName);
      await Promise.allSettled(pendingWrites.get(roomName) ?? []);
      await roomStore.delete(roomName);
    },
  };
}

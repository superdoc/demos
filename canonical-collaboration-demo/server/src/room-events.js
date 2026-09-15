export class RoomEvents {
  #subscribers = new Map();

  subscribe(roomId, socket) {
    const subscribers = this.#subscribers.get(roomId) ?? new Set();
    subscribers.add(socket);
    this.#subscribers.set(roomId, subscribers);
    socket.once('close', () => {
      subscribers.delete(socket);
      if (subscribers.size === 0) this.#subscribers.delete(roomId);
    });
  }

  publish(roomId, document) {
    const message = JSON.stringify({ type: 'room.updated', document });
    for (const socket of this.#subscribers.get(roomId) ?? []) {
      if (socket.readyState === 1) socket.send(message);
    }
  }
}

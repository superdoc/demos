const superDocRoom = /^sd2\/v[^/]+\/(.+)$/;

export function documentIdFromRoomName(roomName) {
  return superDocRoom.exec(roomName)?.[1] ?? null;
}

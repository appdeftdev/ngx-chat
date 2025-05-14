import { CustomRoomFactory, JID, Log, Room } from '@pazznetwork/ngx-chat-shared';

export class MatrixRoomFactory implements CustomRoomFactory {
  async create(logService: Log, roomJid: JID, name?: string): Promise<Room> {
    return new Room(logService, name || (roomJid.local as any));
  }
}

import { BehaviorSubject, Observable } from 'rxjs';
import { NgZone } from '@angular/core';
import {
  Invitation,
  Room,
  RoomCreationOptions,
  RoomOccupant,
  RoomService,
  runInZone,
  XmlSchemaForm,
} from '@pazznetwork/ngx-chat-shared';

export class MatrixRoomService implements RoomService {
  private readonly roomsSubject = new BehaviorSubject<Room[]>([]);
  private readonly invitationSubject = new BehaviorSubject<Invitation>(null as any);
  private readonly groupMessageSubject = new BehaviorSubject<Room>(null as any);

  readonly rooms$: Observable<Room[]>;
  readonly onInvitation$: Observable<Invitation>;
  readonly groupMessage$: Observable<Room>;

  constructor(zone: NgZone) {
    this.rooms$ = this.roomsSubject.asObservable().pipe(runInZone(zone));
    this.onInvitation$ = this.invitationSubject.asObservable().pipe(runInZone(zone));
    this.groupMessage$ = this.groupMessageSubject.asObservable().pipe(runInZone(zone));
  }
  subscribeRoom(roomJid: string, nodes: string[]): Promise<void> {
    throw new Error('Method not implemented.');
  }
  unsubscribeRoom(roomJid: string): Promise<void> {
    throw new Error('Method not implemented.');
  }
  unsubscribeJidFromRoom(roomJid: string, jid: string): Promise<void> {
    throw new Error('Method not implemented.');
  }
  unbanUserForRoom(occupantJid: string, roomJid: string): Promise<void> {
    throw new Error('Method not implemented.');
  }
  banUserForRoom(occupantJid: string, roomJid: string, reason?: string): Promise<void> {
    throw new Error('Method not implemented.');
  }
  queryRoomUserList(roomJid: string): Promise<RoomOccupant[]> {
    throw new Error('Method not implemented.');
  }
  getRoomConfiguration(roomJid: string): Promise<XmlSchemaForm> {
    throw new Error('Method not implemented.');
  }
  kickFromRoom(nick: string, roomJid: string, reason?: string): Promise<void> {
    throw new Error('Method not implemented.');
  }
  inviteUserToRoom(inviteeJid: string, roomJid: string, invitationMessage?: string): Promise<void> {
    throw new Error('Method not implemented.');
  }
  changeUserNicknameForRoom(newNick: string, roomJid: string): Promise<void> {
    throw new Error('Method not implemented.');
  }
  grantMembershipForRoom(userJid: string, roomJid: string, reason?: string): Promise<void> {
    throw new Error('Method not implemented.');
  }
  revokeMembershipForRoom(userJid: string, roomJid: string, reason?: string): Promise<void> {
    throw new Error('Method not implemented.');
  }
  grantAdminForRoom(userJid: string, roomJid: string, reason?: string): Promise<void> {
    throw new Error('Method not implemented.');
  }
  revokeAdminForRoom(userJid: string, roomJid: string, reason?: string): Promise<void> {
    throw new Error('Method not implemented.');
  }
  grantModeratorStatusForRoom(
    occupantNick: string,
    roomJid: string,
    reason?: string
  ): Promise<void> {
    throw new Error('Method not implemented.');
  }
  revokeModeratorStatusForRoom(
    occupantNick: string,
    roomJid: string,
    reason?: string
  ): Promise<void> {
    throw new Error('Method not implemented.');
  }
  retrieveRoomSubscriptions(): Promise<Map<string, string[]>> {
    throw new Error('Method not implemented.');
  }
  getPublicOrJoinedRooms(): Promise<Room[]> {
    throw new Error('Method not implemented.');
  }
  queryAllRooms(): Promise<Room[]> {
    throw new Error('Method not implemented.');
  }
  addRoomInfo(room: Room): Promise<Room> {
    throw new Error('Method not implemented.');
  }

  async createRoom(options: RoomCreationOptions): Promise<Room> {
    // Implement Matrix room creation logic
    throw new Error('Method not implemented');
  }

  async destroyRoom(roomJid: string): Promise<void> {
    // Implement Matrix room destruction logic
    throw new Error('Method not implemented');
  }

  async leaveRoom(roomJid: string, status?: string): Promise<void> {
    // Implement Matrix room leaving logic
    throw new Error('Method not implemented');
  }

  async getRoomByJid(roomJid: string): Promise<Room | undefined> {
    const rooms = this.roomsSubject.getValue();
    return rooms.find((room) => room.jid.toString() === roomJid);
  }

  async changeRoomSubject(roomJid: string, subject: string): Promise<void> {
    // Implement Matrix room subject change logic
    throw new Error('Method not implemented');
  }

  async inviteContact(roomJid: string, contactJid: string): Promise<void> {
    // Implement Matrix room invitation logic
    throw new Error('Method not implemented');
  }

  async declineRoomInvite(roomJid: string): Promise<void> {
    // Implement Matrix room invitation decline logic
    throw new Error('Method not implemented');
  }

  async joinRoom(roomJid: string): Promise<Room> {
    // Implement Matrix room joining logic
    throw new Error('Method not implemented');
  }
}

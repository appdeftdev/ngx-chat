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
import * as sdk from 'matrix-js-sdk';

export class MatrixRoomService implements RoomService {
  private readonly roomsSubject = new BehaviorSubject<Room[]>([]);
  private readonly invitationSubject = new BehaviorSubject<Invitation>(null as any);
  private readonly groupMessageSubject = new BehaviorSubject<Room>(null as any);
  private client!: sdk.MatrixClient;

  readonly rooms$: Observable<Room[]>;
  readonly onInvitation$: Observable<Invitation>;
  readonly groupMessage$: Observable<Room>;

  constructor(zone: NgZone) {
    this.rooms$ = this.roomsSubject.asObservable().pipe(runInZone(zone));
    this.onInvitation$ = this.invitationSubject.asObservable().pipe(runInZone(zone));
    this.groupMessage$ = this.groupMessageSubject.asObservable().pipe(runInZone(zone));
  }

  setClient(client: sdk.MatrixClient) {
    this.client = client;
  }

  async createRoom(options: RoomCreationOptions): Promise<Room> {
    console.log('reacehd', this.matrixClient);
    if (!this.matrixClient) throw new Error('Not logged in');
    const response = await this.matrixClient.createRoom({
      name: options.name,
      topic: options.subject,
    });
    console.log('Matrix createRoom response:', response);
    if (!response.room_id) {
      throw new Error('Matrix createRoom did not return a room_id');
    }
    
    // Create a room object with just the name and ID
    return {
      roomId: response.room_id,
      name: options.name || 'New Room'
    } as unknown as Room;
  }

  get matrixClient(): sdk.MatrixClient {
    console.log('reacehd', this.client);
    if (!this.client) throw new Error('Not logged in');
    return this.client;
  }

  async subscribeRoom(roomJid: string, _nodes: string[]): Promise<void> {
    await this.matrixClient.joinRoom(roomJid);
  }

  async unsubscribeRoom(roomJid: string): Promise<void> {
    await this.matrixClient.leave(roomJid);
  }

  async unsubscribeJidFromRoom(roomJid: string, jid: string): Promise<void> {
    // Matrix doesn't support unsubscribing another user directly; you may want to kick them
    await this.matrixClient.kick(roomJid, jid, 'Unsubscribed by admin');
  }

  async unbanUserForRoom(occupantJid: string, roomJid: string): Promise<void> {
    await this.matrixClient.unban(roomJid, occupantJid);
  }

  async banUserForRoom(occupantJid: string, roomJid: string, reason?: string): Promise<void> {
    await this.matrixClient.ban(roomJid, occupantJid, reason || 'Banned by admin');
  }

  async queryRoomUserList(roomJid: string): Promise<RoomOccupant[]> {
    const room = this.matrixClient.getRoom(roomJid);
    if (!room) return [];
    return room.getJoinedMembers().map((member: { userId: any; name: any }) => ({
      jid: member.userId,
      name: member.name,
      // Add other properties as needed
    })) as unknown as RoomOccupant[];
  }

  async getRoomConfiguration(_roomJid: string): Promise<XmlSchemaForm> {
    // Matrix does not have XMPP-style room config forms; return a stub or custom implementation
    return {} as XmlSchemaForm;
  }

  async kickFromRoom(nick: string, roomJid: string, reason?: string): Promise<void> {
    await this.matrixClient.kick(roomJid, nick, reason || 'Kicked by admin');
  }

  async inviteUserToRoom(
    inviteeJid: string,
    roomJid: string,
    invitationMessage?: string
  ): Promise<void> {
    await this.matrixClient.invite(roomJid, inviteeJid);
    if (invitationMessage) {
      await this.matrixClient.sendTextMessage(roomJid, invitationMessage);
    }
  }

  async changeUserNicknameForRoom(newNick: string, _roomJid: string): Promise<void> {
    // Matrix does not support per-room nicknames in the same way as XMPP
    // You may need to set a display name globally
    await this.matrixClient.setDisplayName(newNick);
  }

  async grantMembershipForRoom(
    _userJid: string,
    _roomJid: string,
    _reason?: string
  ): Promise<void> {
    // Matrix uses power levels for permissions; you may need to set power levels
    // Not directly supported as "grant membership"
  }

  async revokeMembershipForRoom(userJid: string, roomJid: string, reason?: string): Promise<void> {
    // You can kick the user to revoke membership
    await this.matrixClient.kick(roomJid, userJid, reason || 'Membership revoked');
  }

  async grantAdminForRoom(userJid: string, roomJid: string, _reason?: string): Promise<void> {
    // Set power level to admin (typically 100)
    await this.setUserPowerLevel(roomJid, userJid, 100);
  }

  async revokeAdminForRoom(userJid: string, roomJid: string, _reason?: string): Promise<void> {
    // Set power level to default (typically 0)
    await this.setUserPowerLevel(roomJid, userJid, 0);
  }

  async grantModeratorStatusForRoom(
    occupantNick: string,
    roomJid: string,
    _reason?: string
  ): Promise<void> {
    // Set power level to moderator (typically 50)
    await this.setUserPowerLevel(roomJid, occupantNick, 50);
  }

  async revokeModeratorStatusForRoom(
    occupantNick: string,
    roomJid: string,
    _reason?: string
  ): Promise<void> {
    // Set power level to default (typically 0)
    await this.setUserPowerLevel(roomJid, occupantNick, 0);
  }

  async retrieveRoomSubscriptions(): Promise<Map<string, string[]>> {
    // Matrix does not have subscriptions in the XMPP sense
    return new Map();
  }

  async getPublicOrJoinedRooms(): Promise<Room[]> {
    const rooms = this.matrixClient.getRooms();
    return rooms.map((room: { roomId: any; name: any }) => ({
      jid: room.roomId,
      name: room.name,
      // ...other properties
    })) as Room[];
  }

  async queryAllRooms(): Promise<Room[]> {
    // Matrix does not have a direct "all rooms" query, but you can list joined rooms
    const rooms = this.matrixClient.getRooms();
    return rooms.map((room: { roomId: any; name: any }) => ({
      jid: room.roomId,
      name: room.name,
      // ...other properties
    })) as Room[];
  }

  async addRoomInfo(room: Room): Promise<Room> {
    // Optionally update your local state or fetch more info
    // For now, just return the room
    return room;
  }

  async destroyRoom(roomJid: string): Promise<void> {
    // Matrix does not have a direct destroy room API for all users; only the creator can "forget" or "delete" a room
    await this.matrixClient.forget(roomJid);
  }

  async leaveRoom(roomJid: string, _status?: string): Promise<void> {
    await this.matrixClient.leave(roomJid);
  }

  async getRoomByJid(roomJid: string): Promise<Room | undefined> {
    const room = this.matrixClient.getRoom(roomJid);
    if (!room) return undefined;
    return {
      jid: room.roomId,
      name: room.name,
      // ...other properties
    } as unknown as Room;
  }

  async changeRoomSubject(roomJid: string, subject: string): Promise<void> {
    // Set the room topic
    await this.matrixClient.setRoomTopic(roomJid, subject);
  }

  async inviteContact(roomJid: string, contactJid: string): Promise<void> {
    await this.matrixClient.invite(roomJid, contactJid);
  }

  async declineRoomInvite(roomJid: string): Promise<void> {
    await this.matrixClient.leave(roomJid);
  }

  async joinRoom(roomJid: string): Promise<Room> {
    const joinedRoom = await this.matrixClient.joinRoom(roomJid);
    return {
      jid: joinedRoom.roomId,
      name: joinedRoom.name,
    } as unknown as Room;
  }

  // Helper for setting user power levels
  private async setUserPowerLevel(roomJid: string, userId: string, level: number): Promise<void> {
    const room = this.matrixClient.getRoom(roomJid);
    if (!room) throw new Error('Room not found');
    const powerLevels = room.currentState.getStateEvents('m.room.power_levels', '');
    const content = powerLevels ? { ...powerLevels.getContent() } : {};
    content['users'] = content['users'] || {};
    content['users'][userId] = level;
    await this.matrixClient.sendStateEvent(roomJid, 'm.room.power_levels' as any, content, '');
  }
}

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
  parseJid,
  Affiliation,
  Role
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
    if (!this.matrixClient) throw new Error('Not logged in');
    
    // Create the room with Matrix
    const response = await this.matrixClient.createRoom({
      name: options.name || options.roomId,
      topic: options.subject,
      initial_state: [
        {
          type: 'm.room.name',
          content: {
            name: options.name || options.roomId
          }
        }
      ]
    });

    if (!response.room_id) {
      throw new Error('Room creation failed: No room ID returned');
    }

    // Wait for the room to be available in the client's store
    const maxAttempts = 10;
    let attempts = 0;
    let matrixRoom;

    while (attempts < maxAttempts) {
      matrixRoom = this.matrixClient.getRoom(response.room_id);
      if (matrixRoom) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 500)); // Wait 500ms between attempts
      attempts++;
    }

    if (!matrixRoom) {
      throw new Error('Room creation failed: Unable to get room instance after multiple attempts');
    }

    // Wait for the room state to be ready
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Room state initialization timed out'));
      }, 10000); // 10 second timeout

      const onStateEvent = () => {
        if (matrixRoom.currentState) {
          cleanup();
          resolve();
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        matrixRoom.removeListener('Room.timeline', onStateEvent);
      };

      if (matrixRoom.currentState) {
        cleanup();
        resolve();
      } else {
        matrixRoom.on('Room.timeline', onStateEvent);
      }
    });

    // Create a proper Room instance
    const room = new Room(
      {
        logLevel: 0,
        writer: console,
        messagePrefix: () => 'MatrixRoom:',
        error: console.error,
        warn: console.warn,
        info: console.info,
        debug: console.debug
      },
      parseJid(response.room_id),
      options.name || response.room_id
    );

    // Set additional room properties
    room.description = matrixRoom.currentState?.getStateEvents('m.room.topic', '')?.getContent()?.['topic'] || '';
    room.subject = options.subject || '';
    room.avatar = matrixRoom.currentState?.getStateEvents('m.room.avatar', '')?.getContent()?.['url'] || '';

    // Set current user's occupant JID
    room.occupantJid = parseJid(this.matrixClient.getUserId() || '');

    // Wait for the room to be fully synced
    await this.matrixClient.joinRoom(response.room_id);

    // Update room list
    const currentRooms = this.roomsSubject.getValue();
    this.roomsSubject.next([...currentRooms, room]);

    return room;
  }

  get matrixClient(): sdk.MatrixClient {
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
    
    const members = room.getJoinedMembers();
    return members.map((member) => ({
      jid: member.userId,
      nick: member.name || member.userId,
      affiliation: 'member', // Matrix uses power levels instead of affiliations
      role: 'participant', // Matrix uses power levels instead of roles
    })) as unknown as RoomOccupant[];
  }

  async getRoomConfiguration(roomJid: string): Promise<XmlSchemaForm> {
    const room = this.matrixClient.getRoom(roomJid);
    if (!room) {
      return {} as XmlSchemaForm;
    }

    // Get room state events
    const state = room.currentState;
    const name = state.getStateEvents('m.room.name', '')?.getContent()?.['name'];
    const topic = state.getStateEvents('m.room.topic', '')?.getContent()?.['topic'];
    const joinRules = state.getStateEvents('m.room.join_rules', '')?.getContent()?.['join_rule'];

    // Convert Matrix room config to XMPP-style form
    return {
      type: 'form',
      instructions: 'Room Configuration',
      fields: [
        {
          type: 'text-single',
          variable: 'muc#roomconfig_roomname',
          label: 'Room Name',
          value: name || roomJid
        },
        {
          type: 'text-single',
          variable: 'muc#roominfo_description',
          label: 'Room Description',
          value: topic || ''
        },
        {
          type: 'list-single',
          variable: 'muc#roomconfig_whois',
          label: 'Who Can See Members List',
          value: joinRules === 'public' ? 'anyone' : 'moderators'
        },
        {
          type: 'boolean',
          variable: 'muc#roomconfig_membersonly',
          label: 'Make Room Members-Only',
          value: joinRules === 'invite'
        },
        {
          type: 'boolean',
          variable: 'muc#roomconfig_persistentroom',
          label: 'Make Room Persistent',
          value: true // Matrix rooms are always persistent
        },
        {
          type: 'boolean',
          variable: 'muc#roomconfig_publicroom',
          label: 'Make Room Public',
          value: joinRules === 'public'
        }
      ]
    } as unknown as XmlSchemaForm;
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
    if (!this.matrixClient) {
        throw new Error('Matrix client not initialized');
    }

    try {
        // First join the room
        await this.matrixClient.joinRoom(roomJid);
        
        // Get the room after joining
        const matrixRoom = this.matrixClient.getRoom(roomJid);
        if (!matrixRoom) {
            throw new Error('Failed to get room after joining');
        }

        // Create a proper Room instance
        const room = new Room(
            {
                logLevel: 0,
                writer: console,
                messagePrefix: () => 'MatrixRoom:',
                error: console.error,
                warn: console.warn,
                info: console.info,
                debug: console.debug
            },
            parseJid(roomJid),
            matrixRoom.name || roomJid
        );

        // Set additional room properties
        room.description = matrixRoom.currentState?.getStateEvents('m.room.topic', '')?.getContent()?.['topic'] || '';
        room.subject = '';
        room.avatar = matrixRoom.currentState?.getStateEvents('m.room.avatar', '')?.getContent()?.['url'] || '';

        // Get room members
        const members = matrixRoom.getJoinedMembers();
        members.forEach(member => {
            const occupant: RoomOccupant = {
                jid: parseJid(member.userId),
                nick: member.name || member.userId,
                affiliation: Affiliation.member,
                role: Role.participant
            };
            room['roomOccupants'].set(member.userId, occupant);
        });

        // Update room list
        const currentRooms = this.roomsSubject.getValue();
        const existingRoomIndex = currentRooms.findIndex(r => r.jid.toString() === roomJid);
        if (existingRoomIndex >= 0) {
            currentRooms[existingRoomIndex] = room;
            this.roomsSubject.next([...currentRooms]);
        } else {
            this.roomsSubject.next([...currentRooms, room]);
        }

        // Set current user's occupant JID
        room.occupantJid = parseJid(this.matrixClient.getUserId() || '');

        return room;
    } catch (error) {
        console.error('Error joining room:', error);
        throw error;
    }
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

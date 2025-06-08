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
    // Don't load rooms immediately - wait for sync to complete
  }

  /**
   * Called after Matrix client sync is complete to load existing rooms
   */
  async loadRoomsAfterSync(): Promise<void> {
    await this.loadExistingRooms();
  }

  /**
   * Clear all rooms from the service (called on logout)
   */
  clearRooms(): void {
    this.roomsSubject.next([]);
    console.log('Cleared all rooms from room service');
  }

  /**
   * Add a single room to the existing room list
   */
  private addRoomToList(room: Room): void {
    const currentRooms = this.roomsSubject.getValue();
    const existingRoomIndex = currentRooms.findIndex(r => r.jid.toString() === room.jid.toString());
    
    if (existingRoomIndex >= 0) {
      // Update existing room
      currentRooms[existingRoomIndex] = room;
      this.roomsSubject.next([...currentRooms]);
    } else {
      // Add new room
      this.roomsSubject.next([...currentRooms, room]);
    }
  }

  private async loadExistingRooms(): Promise<void> {
    if (!this.client) return;
    
    try {
      console.log('Loading existing rooms from Matrix client...');
      
      // Get DM rooms from account data for proper DM detection
      const dmRooms = this.client.getAccountData('m.direct' as any)?.getContent() || {};
      const dmRoomIds = new Set();
      
      console.log('DM account data:', dmRooms);
      
      // Collect all DM room IDs
      Object.values(dmRooms).forEach((roomIds: any) => {
        if (Array.isArray(roomIds)) {
          roomIds.forEach(roomId => dmRoomIds.add(roomId));
        }
      });
      
      console.log('DM room IDs identified:', Array.from(dmRoomIds));
      
      // Get all rooms from the Matrix client
      const matrixRooms = this.client.getRooms();
      const rooms: Room[] = [];
      
      for (const matrixRoom of matrixRooms) {
        try {
          // Skip DM rooms (they should be handled by contact service)
          // Use proper DM detection from m.direct account data
          const isDmRoom = dmRoomIds.has(matrixRoom.roomId);
          
          if (isDmRoom) {
            console.log(`Skipping DM room: ${matrixRoom.name || matrixRoom.roomId}`);
            continue;
          }
          
          // Additional fallback check for rooms with only 2 members
          const members = matrixRoom.getMembers();
          const joinedMembers = matrixRoom.getJoinedMembers();
          const isLikelyDm = (members.length === 2 || joinedMembers.length === 2) && 
            (members.some((m) => m.userId === this.client.getUserId()) || 
             joinedMembers.some((m) => m.userId === this.client.getUserId()));
          
          console.log(`Room ${matrixRoom.roomId} analysis:`, {
            name: matrixRoom.name,
            totalMembers: members.length,
            joinedMembers: joinedMembers.length,
            isDmByAccountData: isDmRoom,
            isLikelyDm: isLikelyDm,
            hasCustomName: !!matrixRoom.name
          });
          
          if (isLikelyDm && !matrixRoom.name) {
            console.log(`Skipping likely DM room: ${matrixRoom.name || matrixRoom.roomId}`);
            continue;
          }
          
          // Create Room instance
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
            parseJid(matrixRoom.roomId),
            matrixRoom.name || matrixRoom.roomId
          );

          // Store the original Matrix room ID for proper API calls
          room.roomId = matrixRoom.roomId;

          // Set room properties
          const state = matrixRoom.currentState;
          room.description = state?.getStateEvents('m.room.topic', '')?.getContent()?.['topic'] || '';
          room.subject = state?.getStateEvents('m.room.topic', '')?.getContent()?.['topic'] || '';
          room.avatar = state?.getStateEvents('m.room.avatar', '')?.getContent()?.['url'] || '';
          
          // Set occupant JID
          room.occupantJid = parseJid(this.client.getUserId() || '');
          
          // Add room members
          members.forEach(member => {
            const occupant: RoomOccupant = {
              jid: parseJid(member.userId),
              nick: member.name || member.userId,
              affiliation: Affiliation.member,
              role: Role.participant
            };
            room['roomOccupants'].set(member.userId, occupant);
          });
          
          rooms.push(room);
          console.log(`Loaded room: ${room.name} (${matrixRoom.roomId})`);
          
        } catch (error) {
          console.warn(`Failed to load room ${matrixRoom.roomId}:`, error);
        }
      }
      
      // Update the rooms subject
      this.roomsSubject.next(rooms);
      console.log(`Loaded ${rooms.length} rooms total`);
      
    } catch (error) {
      console.error('Failed to load existing rooms:', error);
    }
  }

  async createRoom(options: RoomCreationOptions): Promise<Room> {
    if (!this.matrixClient) throw new Error('Not logged in');
    
    // Create the room with Matrix, using retry logic for rate limiting
    const response = await this.retryWithBackoff(async () => {
      return await this.matrixClient.createRoom({
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

    // Store the original Matrix room ID for proper API calls
    room.roomId = response.room_id;

    // Set additional room properties
    room.description = matrixRoom.currentState?.getStateEvents('m.room.topic', '')?.getContent()?.['topic'] || '';
    room.subject = options.subject || '';
    room.avatar = matrixRoom.currentState?.getStateEvents('m.room.avatar', '')?.getContent()?.['url'] || '';

    // Set current user's occupant JID
    room.occupantJid = parseJid(this.matrixClient.getUserId() || '');

    // Wait for the room to be fully synced
    await this.retryWithBackoff(async () => {
      return await this.matrixClient.joinRoom(response.room_id);
    });

    // Enable encryption for the new room
    try {
      await this.enableEncryptionInRoom(response.room_id);
      console.log('Encryption enabled for new room:', response.room_id);
    } catch (error) {
      console.warn('Failed to enable encryption for new room:', error);
      // Continue without encryption - room is still usable
    }

    // Update room list using helper method
    this.addRoomToList(room);

    return room;
  }

  get matrixClient(): sdk.MatrixClient {
    if (!this.client) throw new Error('Not logged in');
    return this.client;
  }

  async subscribeRoom(roomJid: string, _nodes: string[]): Promise<void> {
    await this.retryWithBackoff(async () => {
      return await this.matrixClient.joinRoom(roomJid);
    });
  }

  async unsubscribeRoom(roomJid: string): Promise<void> {
    await this.retryWithBackoff(async () => {
      return await this.matrixClient.leave(roomJid);
    });
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
    try {
      await this.retryWithBackoff(async () => {
        await this.matrixClient.invite(roomJid, inviteeJid);
      });
      
      if (invitationMessage) {
        await this.retryWithBackoff(async () => {
          await this.matrixClient.sendTextMessage(roomJid, invitationMessage);
        });
      }
    } catch (error: any) {
      if (error.errcode === 'M_LIMIT_EXCEEDED') {
        const retryAfter = error.data?.retry_after_ms || 5000;
        throw new Error(`Rate limited. Please wait ${Math.ceil(retryAfter / 1000)} seconds before inviting again.`);
      }
      throw error;
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
    await this.retryWithBackoff(async () => {
      return await this.matrixClient.leave(roomJid);
    });
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
    try {
      await this.retryWithBackoff(async () => {
        await this.matrixClient.invite(roomJid, contactJid);
      });
    } catch (error: any) {
      if (error.errcode === 'M_LIMIT_EXCEEDED') {
        const retryAfter = error.data?.retry_after_ms || 5000;
        throw new Error(`Rate limited. Please wait ${Math.ceil(retryAfter / 1000)} seconds before inviting again.`);
      }
      throw error;
    }
  }

  async declineRoomInvite(roomJid: string): Promise<void> {
    await this.matrixClient.leave(roomJid);
  }

  async joinRoom(roomJid: string): Promise<Room> {
    if (!this.matrixClient) {
        throw new Error('Matrix client not initialized');
    }

    try {
        // First join the room with rate limiting
        await this.retryWithBackoff(async () => {
          return await this.matrixClient.joinRoom(roomJid);
        });
        
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

        // Update room list using helper method
        this.addRoomToList(room);

        // Set current user's occupant JID
        room.occupantJid = parseJid(this.matrixClient.getUserId() || '');

        return room;
    } catch (error) {
        console.error('Error joining room:', error);
        throw error;
    }
  }

  /**
   * Enable end-to-end encryption in a room.
   * Call this method to enable encryption in existing rooms.
   */
  async enableEncryptionInRoom(roomJid: string): Promise<void> {
    try {
      // Check if encryption is already enabled
      const room = this.matrixClient.getRoom(roomJid);
      if (room) {
        const encryptionEvent = room.currentState?.getStateEvents('m.room.encryption', '');
        if (encryptionEvent && encryptionEvent.getContent()?.['algorithm']) {
          console.log('Encryption already enabled for room:', roomJid);
          return;
        }
      }

      // Enable encryption with retry logic
      await this.retryWithBackoff(async () => {
        await this.matrixClient.sendStateEvent(roomJid, 'm.room.encryption' as any, {
          algorithm: 'm.megolm.v1.aes-sha2'
        });
      });
      
      console.log('Encryption enabled for room:', roomJid);
    } catch (error: any) {
      console.error('Failed to enable encryption in room:', error);
      
      // Provide specific error messages
      if (error.errcode === 'M_FORBIDDEN') {
        throw new Error('Cannot enable encryption: Insufficient permissions');
      } else if (error.errcode === 'M_LIMIT_EXCEEDED') {
        const retryAfter = error.data?.retry_after_ms || 5000;
        throw new Error(`Rate limited. Please wait ${Math.ceil(retryAfter / 1000)} seconds before trying again.`);
      }
      
      throw error;
    }
  }

  // Helper for retry with exponential backoff
  private async retryWithBackoff<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000
  ): Promise<T> {
    let lastError: any;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: any) {
        lastError = error;
        
        // If it's a rate limit error, respect the server's retry_after_ms
        if (error.errcode === 'M_LIMIT_EXCEEDED') {
          const retryAfter = error.data?.retry_after_ms || (baseDelay * Math.pow(2, attempt));
          console.warn(`Rate limited. Waiting ${retryAfter}ms before retry ${attempt + 1}/${maxRetries + 1}`);
          
          if (attempt < maxRetries) {
            await this.sleep(retryAfter);
            continue;
          }
        }
        
        // For other errors or final attempt, throw immediately
        if (attempt === maxRetries || !this.isRetryableError(error)) {
          throw error;
        }
        
        // Exponential backoff for other retryable errors
        const delay = baseDelay * Math.pow(2, attempt);
        console.warn(`Retrying operation after ${delay}ms. Attempt ${attempt + 1}/${maxRetries + 1}`);
        await this.sleep(delay);
      }
    }
    
    throw lastError;
  }

  private isRetryableError(error: any): boolean {
    // Retry on rate limits and temporary server errors
    return error.errcode === 'M_LIMIT_EXCEEDED' || 
           (error.httpStatus >= 500 && error.httpStatus < 600) ||
           error.code === 'NETWORK_ERROR';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
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

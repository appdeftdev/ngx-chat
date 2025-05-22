import { BehaviorSubject, Observable } from 'rxjs';
import { NgZone } from '@angular/core';
import {
  Contact,
  ContactListService,
  runInZone,
  ContactSubscription,
  Presence,
} from '@pazznetwork/ngx-chat-shared';
import * as sdk from 'matrix-js-sdk';

export class MatrixContactListService implements ContactListService {
  private readonly contactsSubject = new BehaviorSubject<Contact[]>([]);
  private readonly blockedContactsSubject = new BehaviorSubject<Set<string>>(new Set());
  private readonly blockedContactsListSubject = new BehaviorSubject<Contact[]>([]);
  private client!: sdk.MatrixClient;
  private presenceMap = new Map<string, Presence>();

  readonly contacts$: Observable<Contact[]>;
  readonly contactsSubscribed$: Observable<Contact[]>;
  readonly contactRequestsReceived$: Observable<Contact[]>;
  readonly contactRequestsSent$: Observable<Contact[]>;
  readonly contactsUnaffiliated$: Observable<Contact[]>;
  readonly contactsBlocked$: Observable<Contact[]>;
  readonly blockedContactJIDs$: Observable<Set<string>>;

  constructor(zone: NgZone) {
    this.contacts$ = this.contactsSubject.asObservable().pipe(runInZone(zone));
    this.contactsSubscribed$ = this.contacts$;
    this.contactRequestsReceived$ = new BehaviorSubject<Contact[]>([]).pipe(runInZone(zone));
    this.contactRequestsSent$ = new BehaviorSubject<Contact[]>([]).pipe(runInZone(zone));
    this.contactsUnaffiliated$ = new BehaviorSubject<Contact[]>([]).pipe(runInZone(zone));
    this.contactsBlocked$ = this.blockedContactsListSubject.asObservable().pipe(runInZone(zone));
    this.blockedContactJIDs$ = this.blockedContactsSubject.asObservable().pipe(runInZone(zone));
  }

  setClient(client: sdk.MatrixClient) {
    this.client = client;
    
    // Set up room state event handlers
    this.client.on(sdk.RoomStateEvent.Members, (event: any, state: any, member: any) => {
      console.log('Room member event:', { 
        roomId: state.roomId, 
        eventType: event.getType(),
        memberUserId: member?.userId
      });
      
      // Ensure the room is in the client's store
      if (!this.client.getRoom(state.roomId)) {
        console.log('Attempting to fetch unknown room:', state.roomId);
        this.client.joinRoom(state.roomId).catch(error => {
          console.warn('Could not join room:', error);
        });
      }
      
      this.loadContacts();
    });

    // Add sync state listener with better error handling
    this.client.on(sdk.ClientEvent.Sync, (state: string, prevState: string | null, data: any) => {
      console.log('Sync state changed:', { state, prevState, hasData: !!data });
      
      if (state === 'PREPARED' || state === 'SYNCED') {
        // Process rooms in the sync response
        if (data?.rooms?.join) {
          Object.keys(data.rooms.join).forEach(roomId => {
            if (!this.client.getRoom(roomId)) {
              console.log('Processing new room from sync:', roomId);
              // Force room state update
              this.client.roomInitialSync(roomId, 20).catch(error => {
                console.warn('Room initial sync failed:', error);
              });
            }
          });
        }
        
        this.loadContacts();
      } else if (state === 'ERROR') {
        console.error('Sync error:', data);
      }
    });

    // Listen for presence events
    this.client.on('User.presence' as any, (_event: any, user: any) => {
      console.log('Presence event received:', user.userId, user.presence);
      const presence = this.mapMatrixPresence(user.presence);
      this.presenceMap.set(user.userId, presence);
      this.updateContacts();
    });

    // Listen for room events
    this.client.on(sdk.RoomEvent.Timeline, (event: any) => {
      const roomId = event.getRoomId();
      if (roomId && !this.client.getRoom(roomId)) {
        console.log('Processing new room from timeline:', roomId);
        this.client.roomInitialSync(roomId, 20).catch(error => {
          console.warn('Room initial sync failed:', error);
        });
      }
    });

    // Enable presence tracking if supported
    try {
      (this.client as any).setPresenceDefaultState?.('online');
    } catch (error) {
      console.warn('Failed to set presence default state:', error);
    }

    // Initial sync to ensure we have all rooms
    this.client.startClient({
      initialSyncLimit: 20,
      includeArchivedRooms: true,
    }).catch(error => {
      console.error('Failed to start client:', error);
    });
  }

  private mapMatrixPresence(matrixPresence: string): Presence {
    console.log('Mapping Matrix presence:', matrixPresence);
    switch (matrixPresence) {
      case 'online':
        return Presence.present;
      case 'offline':
        return Presence.unavailable;
      case 'unavailable':
        return Presence.away;
      default:
        console.log('Unknown presence state:', matrixPresence);
        return Presence.unavailable;
    }
  }

  private updateContacts() {
    const contacts = this.contactsSubject.value;
    const updatedContacts = contacts.map(contact => {
      const presence = this.presenceMap.get(contact.jid.toString()) || Presence.unavailable;
      return new Contact(contact.jid.toString(), contact.name, presence);
    });
    this.contactsSubject.next(updatedContacts);
  }

  private async loadContacts() {
    const contacts: Contact[] = [];
    const processedUsers = new Set<string>();

    // Get all direct message rooms from account data
    const dmRooms =
      this.matrixClient.getAccountData('m.direct' as keyof sdk.AccountDataEvents)?.getContent() ||
      {};

    // Process DM rooms from account data
    for (const [userId, roomIds] of Object.entries(dmRooms)) {
      if (Array.isArray(roomIds)) {
        for (const roomId of roomIds) {
          await this.ensureRoomSynced(roomId);
        }
      }
      
      if (!processedUsers.has(userId)) {
        const user = this.matrixClient.getUser(userId);
        if (user) {
          console.log('Loading DM contact:', { userId, rawPresence: user.presence, rawAvatarUrl: user.avatarUrl });
          const presence = this.mapMatrixPresence(user.presence);
          this.presenceMap.set(userId, presence);
          
          // Convert MXC URL to HTTP URL for direct media download
          let avatarUrl: string | undefined = undefined;
          if (user.avatarUrl && user.avatarUrl.startsWith('mxc://')) {
            const mxcParts = user.avatarUrl.split('/');
            if (mxcParts.length === 4) {
              const serverName = mxcParts[2];
              const mediaId = mxcParts[3];
              avatarUrl = `${this.matrixClient.baseUrl}/_matrix/media/v3/download/${serverName}/${mediaId}`;
            }
          }
          console.log('Generated avatar URL for DM contact:', { userId, avatarUrl });
          
          const contact = new Contact(
            userId,
            user.displayName || userId,
            avatarUrl
          );
          contact.updateResourcePresence(userId, presence);
          contacts.push(contact);
          processedUsers.add(userId);
        }
      }
    }

    // Check all rooms for direct chats and contacts
    const rooms = this.matrixClient.getRooms();
    for (const room of rooms) {
      // Include both DM rooms and regular rooms where the user is a member
      const members = room.getMembers();
      for (const member of members) {
        if (
          member.userId !== this.matrixClient.getUserId() &&
          !processedUsers.has(member.userId) &&
          (member.membership === 'join' || member.membership === 'invite')
        ) {
          const user = this.matrixClient.getUser(member.userId);
          console.log('Loading room member:', { 
            userId: member.userId, 
            rawPresence: user?.presence,
            rawAvatarUrl: member.getMxcAvatarUrl() || user?.avatarUrl 
          });
          
          const presence = user ? this.mapMatrixPresence(user.presence) : Presence.unavailable;
          this.presenceMap.set(member.userId, presence);
          
          // Get avatar URL from member or user
          const avatarMxc = member.getMxcAvatarUrl() || user?.avatarUrl || null;
          
          // Convert MXC URL to HTTP URL for direct media download
          let avatarUrl: string | undefined = undefined;
          if (avatarMxc && avatarMxc.startsWith('mxc://')) {
            const mxcParts = avatarMxc.split('/');
            if (mxcParts.length === 4) {
              const serverName = mxcParts[2];
              const mediaId = mxcParts[3];
              avatarUrl = `${this.matrixClient.baseUrl}/_matrix/media/v3/download/${serverName}/${mediaId}`;
            }
          }
          console.log('Generated avatar URL for room member:', { userId: member.userId, avatarUrl });
          
          const contact = new Contact(
            member.userId,
            member.name || member.userId,
            avatarUrl
          );
          contact.updateResourcePresence(member.userId, presence);
          contacts.push(contact);
          processedUsers.add(member.userId);
        }
      }
    }

    // Update the contacts list
    this.contactsSubject.next(contacts);
  }

  private async ensureRoomSynced(roomId: string): Promise<void> {
    if (!this.client.getRoom(roomId)) {
      console.log('Syncing unknown room:', roomId);
      try {
        await this.client.roomInitialSync(roomId, 20);
        console.log('Room sync completed:', roomId);
      } catch (error) {
        console.warn('Room sync failed:', error);
      }
    }
  }

  async addContact(jid: string): Promise<void> {
    console.log('Attempting to create DM room with user:', jid);
    console.log('Current user:', this.client.getUserId());

    try {
      // Ensure proper Matrix user ID format
      const matrixUserId = jid.startsWith('@') ? jid : `@${jid}`;

      // Check if user exists
      const userProfile = await this.client.getProfileInfo(matrixUserId).catch(error => {
        console.error('Failed to get user profile:', error);
        throw new Error('User not found or not accessible');
      });

      if (!userProfile) {
        throw new Error('User not found');
      }

      // Check if we already have a DM room with this user
      const existingRoom = this.getRoomIdForContact(matrixUserId);
      if (existingRoom) {
        console.log('DM room already exists:', existingRoom);
        return;
      }

      // Create a direct message room with the user
      const result = await this.matrixClient.createRoom({
        preset: sdk.Preset.PrivateChat,
        invite: [matrixUserId],
        is_direct: true,
        visibility: sdk.Visibility.Private,
      });

      console.log('Created DM room:', result);

      // Mark the room as a DM in account data
      const dmRooms = this.matrixClient.getAccountData('m.direct' as any)?.getContent() || {};
      dmRooms[matrixUserId] = [...(dmRooms[matrixUserId] || []), result.room_id];
      await this.matrixClient.setAccountData('m.direct' as keyof sdk.AccountDataEvents, dmRooms);

      // Create or update contact
      const user = this.matrixClient.getUser(matrixUserId);
      const contact = new Contact(
        matrixUserId,
        user?.displayName || matrixUserId,
        user?.avatarUrl,
        'both' as ContactSubscription
      );

      // Add to contacts if not already present
      const contacts = this.contactsSubject.getValue();
      if (!contacts.some((c) => c.jid.toString() === matrixUserId)) {
        this.contactsSubject.next([...contacts, contact]);
      }

      // Force a reload of contacts
      await this.loadContacts();
    } catch (error: any) {
      console.error('Failed to add contact:', error);
      throw new Error(`Failed to add contact: ${error.message || 'Unknown error'}`);
    }
  }

  private get matrixClient(): sdk.MatrixClient {
    if (!this.client) throw new Error('Not logged in');
    return this.client;
  }

  async getContactById(jid: string): Promise<Contact | undefined> {
    const contacts = this.contactsSubject.getValue();
    return contacts.find((contact) => contact.jid.toString() === jid);
  }

  async getOrCreateContactById(jid: string): Promise<Contact> {
    let contact = await this.getContactById(jid);
    if (!contact) {
      // Create a new contact
      const user = await this.matrixClient.getUser(jid);
      contact = new Contact(
        jid,
        user?.displayName || jid,
        user?.avatarUrl,
        'both' as ContactSubscription
      );
      const contacts = this.contactsSubject.getValue();
      this.contactsSubject.next([...contacts, contact]);
    }
    return contact;
  }

  // async addContact(jid: string): Promise<void> {
  //   await this.getOrCreateContactById(jid);
  // }

  async removeContact(jid: string): Promise<void> {
    // 1. Remove from local contacts list
    const contacts = this.contactsSubject.getValue();
    const updatedContacts = contacts.filter((contact) => contact.jid.toString() !== jid);
    this.contactsSubject.next(updatedContacts);

    try {
      const roomId = this.getRoomIdForContact(jid);
      if (roomId) {
        await this.matrixClient.leave(roomId);
      }
      // Additional server cleanup if needed
    } catch (error) {
      console.error('Failed to remove contact from server:', error);
    }

    // 3. Clean up blocked contacts if needed
    await this.unblockJid(jid);
  }

  async blockJid(jid: string): Promise<void> {
    // Add Matrix SDK blocking call
    await this.matrixClient.setIgnoredUsers([...this.blockedContactsSubject.getValue(), jid]);

    // Update local state
    this.blockedContactsSubject.next(new Set([...this.blockedContactsSubject.getValue(), jid]));
    this.updateBlockedContactsList();
  }

  async unblockJid(jid: string): Promise<void> {
    // Remove from blocked users list
    const blockedUsers = this.blockedContactsSubject.getValue();
    blockedUsers.delete(jid);

    // Update Matrix server
    await this.matrixClient.setIgnoredUsers([...blockedUsers]);

    // Update local state
    this.blockedContactsSubject.next(blockedUsers);
    this.updateBlockedContactsList();
  }

  private updateBlockedContactsList(): void {
    const blockedJids = this.blockedContactsSubject.getValue();
    const blockedContacts = this.contactsSubject
      .getValue()
      .filter((contact) => blockedJids.has(contact.jid.toString()));
    this.blockedContactsListSubject.next(blockedContacts);
  }

  // async unblockJid(jid: string): Promise<void> {
  //   // Remove from blocked users list
  //   const blockedUsers = this.blockedContactsSubject.getValue();
  //   blockedUsers.delete(jid);
  //   this.blockedContactsSubject.next(blockedUsers);

  //   // Update blocked contacts list
  //   const blockedContacts = this.blockedContactsListSubject.getValue();
  //   const updatedBlockedContacts = blockedContacts.filter(
  //     (contact) => contact.jid.toString() !== jid
  //   );
  //   this.blockedContactsListSubject.next(updatedBlockedContacts);
  // }

  async blockContact(jid: string): Promise<void> {
    await this.blockJid(jid);
  }

  async unblockContact(jid: string): Promise<void> {
    await this.unblockJid(jid);
  }

  async acceptContactRequest(jid: string): Promise<void> {
    // Matrix doesn't have contact requests like XMPP
    // Just ensure they exist in our contacts list
    await this.getOrCreateContactById(jid);
  }

  async declineContactRequest(jid: string): Promise<void> {
    // Matrix doesn't have contact requests like XMPP
    // Just remove them from our contacts list
    await this.removeContact(jid);
  }

  private getRoomIdForContact(jid: string): string | undefined {
    // 1. Get all direct message rooms
    const directRooms = this.matrixClient.getRooms().filter((room) => {
      return room.getMembers().length === 2; // Only 2 members in a DM
    });

    // 2. Find the room that contains this contact
    for (const room of directRooms) {
      const members = room.getMembers();
      const otherUser = members.find((member) => member.userId !== this.matrixClient.getUserId());

      if (otherUser?.userId === jid) {
        return room.roomId;
      }
    }

    return undefined;
  }
}

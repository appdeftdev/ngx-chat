import { BehaviorSubject, Observable } from 'rxjs';
import { NgZone, Inject } from '@angular/core'; // Added Inject
import {
  Contact,
  ContactListService,
  runInZone,
  ContactSubscription,
  Presence,
  Log, // Added
  LOG_SERVICE_TOKEN, // Added
  parseJid, // Added
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

  constructor(
    // private zone: NgZone, // zone was unused here, but observables still need it
    @Inject(LOG_SERVICE_TOKEN) private readonly logService: Log,
    private readonly ngZone: NgZone // Inject NgZone to use for runInZone
  ) {
    this.contacts$ = this.contactsSubject.asObservable().pipe(runInZone(this.ngZone));
    this.contactsSubscribed$ = this.contacts$; // This should also run in zone if UI binds to it directly
    this.contactRequestsReceived$ = new BehaviorSubject<Contact[]>([]).pipe(runInZone(this.ngZone));
    this.contactRequestsSent$ = new BehaviorSubject<Contact[]>([]).pipe(runInZone(this.ngZone));
    this.contactsUnaffiliated$ = new BehaviorSubject<Contact[]>([]).pipe(runInZone(this.ngZone));
    this.contactsBlocked$ = this.blockedContactsListSubject
      .asObservable()
      .pipe(runInZone(this.ngZone));
    this.blockedContactJIDs$ = this.blockedContactsSubject
      .asObservable()
      .pipe(runInZone(this.ngZone));
  }

  setClient(client: sdk.MatrixClient) {
    this.client = client;
  }

  /**
   * Initialize contact loading after Matrix sync is complete
   */
  async initializeAfterSync(): Promise<void> {
    console.log('Initializing contacts after sync...');
    this.setupEventListeners();
    await this.loadContacts();
  }

  /**
   * Clear all contacts (called on logout)
   */
  clearContacts(): void {
    this.contactsSubject.next([]);
    this.presenceMap.clear();
    console.log('Cleared all contacts from contact service');
  }

  private setupEventListeners(): void {
    // Set up room state event handlers
    this.client.on(sdk.RoomStateEvent.Members, (event: any, state: any, member: any) => {
      console.log('Room member event:', {
        roomId: state.roomId,
        eventType: event.getType(),
        memberUserId: member?.userId,
      });

      // Ensure the room is in the client's store
      if (!this.client.getRoom(state.roomId)) {
        console.log('Attempting to fetch unknown room:', state.roomId);
        this.client.joinRoom(state.roomId).catch((error) => {
          console.warn('Could not join room:', error);
        });
      }

      this.loadContacts();
    });

    // Don't listen to sync events here - they're handled by connection service

    // Listen for presence events - Use correct Matrix JS SDK events
    this.client.on(sdk.ClientEvent.Event, (event: any) => {
      // Check if this is a presence event
      if (event.getType() === 'm.presence') {
        const userId = event.getSender();
        const content = event.getContent();
        if (userId && content.presence) {
          console.log('Presence event from timeline:', userId, content.presence);
          const presence = this.mapMatrixPresence(content.presence);
          this.presenceMap.set(userId, presence);
          // Run in Angular zone to ensure change detection works
          this.ngZone.run(() => {
            this.updateContacts();
          });
        }
      }
    });

    // Listen for user updates (including presence changes)
    this.client.on(sdk.UserEvent.Presence, (_event: any, user: any) => {
      console.log('User presence event:', user.userId, user.presence);
      const presence = this.mapMatrixPresence(user.presence);
      this.presenceMap.set(user.userId, presence);
      // Run in Angular zone to ensure change detection works
      this.ngZone.run(() => {
        this.updateContacts();
      });
    });

    // Set initial presence state
    this.client.setPresence({
      presence: 'online', 
      status_msg: 'Available'
    }).catch((err: Error) => {
      console.warn('Failed to set presence (presence may be disabled on server):', err);
    });

    // Enable presence tracking
    this.enablePresenceTracking();

    // Don't start client here - it's already started by connection service
    // Just load contacts after sync is complete
    console.log('Contact list service initialized, waiting for sync...');
  }

  private mapMatrixPresence(matrixPresence: string | undefined): Presence {
    if (!matrixPresence) {
      console.log('No presence data available, assuming online (presence may be disabled on server)');
      return Presence.present; // Default to online when no presence data
    }

    console.log('Mapping Matrix presence:', matrixPresence);
    switch (matrixPresence) {
      case 'online':
        return Presence.present;
      case 'unavailable':
      case 'idle':
        return Presence.away;
      case 'offline':
        return Presence.unavailable;
      case 'busy':
        return Presence.away; // Map busy to away since dnd is not available
      default:
        console.log('Unknown Matrix presence state:', matrixPresence, 'defaulting to online');
        return Presence.present; // Default to online for unknown states
    }
  }

  private updateContacts() {
    const contacts = this.contactsSubject.value;
    console.log('Updating contacts with current presence map:', 
      Array.from(this.presenceMap.entries()).map(([userId, presence]) => ({ userId, presence }))
    );
    
    // Update presence on existing contacts instead of creating new ones
    contacts.forEach((contact) => {
      const presence = this.presenceMap.get(contact.jid.toString()) || Presence.unavailable;
      console.log(`Updating contact ${contact.name} (${contact.jid.toString()}) presence to: ${presence}`);
      contact.updateResourcePresence(contact.jid.toString(), presence);
    });
    // Emit the updated contacts array to trigger UI updates
    this.contactsSubject.next([...contacts]);
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
          console.log('Loading DM contact:', {
            userId,
            rawPresence: user.presence,
            rawAvatarUrl: user.avatarUrl,
          });
          const presence = this.mapMatrixPresence(user.presence);
          this.presenceMap.set(userId, presence);

          // Generate avatar URL using improved method
          const avatarUrl = user.avatarUrl ? await this.generateAvatarUrl(user.avatarUrl, userId) : undefined;
          console.log('Generated avatar URL for DM contact:', { userId, avatarUrl });

          const newContact = new Contact(userId, user.displayName || userId, avatarUrl); // Renamed to newContact for clarity
          newContact.updateResourcePresence(userId, presence);
          contacts.push(newContact);
          processedUsers.add(userId);
        }
      }
    }

    // Only process DM rooms to avoid adding all room members as contacts
    // This ensures the contacts list only shows people you have direct conversations with
    const dmRoomIds = new Set();
    Object.values(dmRooms).forEach((roomIds: any) => {
      if (Array.isArray(roomIds)) {
        roomIds.forEach(roomId => dmRoomIds.add(roomId));
      }
    });

    // Check only DM rooms for additional contacts (in case some DM rooms aren't in account data)
    const rooms = this.matrixClient.getRooms();
    for (const room of rooms) {
      // Only process if this is a DM room or looks like one
      const isDmRoom = dmRoomIds.has(room.roomId);
      const members = room.getMembers();
      const looksLikeDm = members.length === 2 && 
        members.some(m => m.userId === this.matrixClient.getUserId());
      
      if (isDmRoom || looksLikeDm) {
        for (const member of members) {
          if (
            member.userId !== this.matrixClient.getUserId() &&
            !processedUsers.has(member.userId) &&
            (member.membership === 'join' || member.membership === 'invite')
          ) {
            const user = this.matrixClient.getUser(member.userId);
            console.log('Loading DM room member:', {
              userId: member.userId,
              roomId: room.roomId,
              rawPresence: user?.presence,
              rawAvatarUrl: member.getMxcAvatarUrl() || user?.avatarUrl,
            });

            const presence = user ? this.mapMatrixPresence(user.presence) : Presence.unavailable;
            this.presenceMap.set(member.userId, presence);

            // Get avatar URL from member or user and generate proper URL
            const avatarMxc = member.getMxcAvatarUrl() || user?.avatarUrl;
            const avatarUrl = avatarMxc ? await this.generateAvatarUrl(avatarMxc, member.userId) : undefined;
            console.log('Generated avatar URL for DM room member:', {
              userId: member.userId,
              avatarUrl,
            });

            const newContact = new Contact(member.userId, member.name || member.userId, avatarUrl);
            newContact.updateResourcePresence(member.userId, presence);
            contacts.push(newContact);
            processedUsers.add(member.userId);
          }
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
      const userProfile = await this.client.getProfileInfo(matrixUserId).catch((error) => {
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
      const newContact = new Contact( // Renamed to newContact for clarity
        matrixUserId,
        user?.displayName || matrixUserId,
        user?.avatarUrl,
        ContactSubscription.both
      );

      // Add to contacts if not already present
      const currentContacts = this.contactsSubject.getValue();
      // Use string comparison of bare JIDs as a diagnostic step
      if (
        !currentContacts.some((c) => c.jid.bare().toString() === newContact.jid.bare().toString())
      ) {
        this.contactsSubject.next([...currentContacts, newContact]);
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

  async getContactById(jidString: string): Promise<Contact | undefined> {
    const inputJid = parseJid(jidString);
    const contacts = this.contactsSubject.getValue();
    // Use string comparison of bare JIDs as a diagnostic step
    return contacts.find((contact) => contact.jid.bare().toString() === inputJid.bare().toString());
  }

  async getOrCreateContactById(jidString: string): Promise<Contact> {
    const inputJid = parseJid(jidString); // Normalize the input JID
    const currentContacts = this.contactsSubject.getValue();
    // Use string comparison of bare JIDs as a diagnostic step
    let contact = currentContacts.find(
      (c) => c.jid.bare().toString() === inputJid.bare().toString()
    );

    if (!contact) {
      this.logService.debug(
        `Contact not found in subject for ${inputJid.bare().toString()} using string comparison, creating new one.`
      );
      const user = await this.matrixClient.getUser(inputJid.toString()); // Use normalized inputJid for fetching

      let avatarUrl: string | undefined = undefined;
      if (user?.avatarUrl && user.avatarUrl.startsWith('mxc://')) {
        // Use Matrix client's built-in URL converter
        const baseUrl = this.matrixClient.mxcUrlToHttp(user.avatarUrl, 64, 64, 'crop');
        if (baseUrl) {
          // Append access token for browser authentication
          const accessToken = this.matrixClient.getAccessToken();
          if (accessToken) {
            avatarUrl = `${baseUrl}?access_token=${accessToken}`;
            console.log('Using authenticated Matrix contact avatar:', { userId: inputJid.toString(), originalUrl: user.avatarUrl, authenticatedUrl: baseUrl + '?access_token=***' });
          } else {
            avatarUrl = baseUrl;
            console.log('Using unauthenticated Matrix contact avatar (no access token):', { userId: inputJid.toString(), originalUrl: user.avatarUrl, convertedUrl: baseUrl });
          }
        }
      } else {
        avatarUrl = user?.avatarUrl;
      }

      contact = new Contact(
        inputJid.toString(),
        user?.displayName || inputJid.local || inputJid.bare().toString(),
        avatarUrl,
        ContactSubscription.both // Corrected casing
      );
      this.contactsSubject.next([...currentContacts, contact]);
      this.logService.debug(
        `New contact ${contact.jid.bare().toString()} added to contactsSubject.`
      );
    } else {
      this.logService.debug(`Found existing contact in subject for ${inputJid.bare().toString()}`);
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

  private enablePresenceTracking(): void {
    console.log('Enabling presence tracking for Matrix users');
    
    // Enable presence updates in the sync
    if (this.client && this.client.getSyncState() === 'PREPARED') {
      this.trackPresenceForKnownUsers();
    } else {
      // Wait for sync to be ready before tracking presence
      this.client.once(sdk.ClientEvent.Sync, (state: string) => {
        if (state === 'PREPARED') {
          this.trackPresenceForKnownUsers();
        }
      });
    }
  }

  private trackPresenceForKnownUsers(): void {
    console.log('Setting up presence tracking for all known users');
    
    // Get all rooms and track presence for all members
    const rooms = this.client.getRooms();
    const usersToTrack = new Set<string>();
    
    for (const room of rooms) {
      const members = room.getMembers();
      for (const member of members) {
        if (member.userId !== this.client.getUserId()) {
          usersToTrack.add(member.userId);
        }
      }
    }

    // Track presence for each user
    for (const userId of usersToTrack) {
      this.trackUserPresence(userId);
    }

    console.log(`Started tracking presence for ${usersToTrack.size} users`);
  }

  private trackUserPresence(userId: string): void {
    try {
      // Get or create user object and listen for presence changes
      const user = this.client.getUser(userId);
      if (user) {
        // Initial presence setup
        const initialPresence = this.mapMatrixPresence(user.presence || 'offline');
        this.presenceMap.set(userId, initialPresence);
        
        console.log(`Tracking presence for ${userId}: ${user.presence || 'offline'}`);
        
        // The user object will emit 'User.Presence' events when presence changes
        // These are already handled by our global event listener above
      } else {
        console.warn(`Could not get user object for ${userId}`);
      }
    } catch (error) {
      console.warn(`Failed to track presence for ${userId}:`, error);
    }
  }

  private async generateAvatarUrl(mxcUrl: string, userId: string): Promise<string | undefined> {
    if (!mxcUrl || !mxcUrl.startsWith('mxc://')) {
      return mxcUrl || undefined;
    }

    // Try multiple approaches for Matrix media authentication
    const accessToken = this.matrixClient.getAccessToken();
    const baseUrl = this.matrixClient.mxcUrlToHttp(mxcUrl, 64, 64, 'crop');
    
    if (!baseUrl) {
      console.warn('Failed to convert MXC URL:', mxcUrl);
      return undefined;
    }

    // Method 1: Try with access token parameter (should work for some servers)
    if (accessToken) {
      const authenticatedUrl = `${baseUrl}?access_token=${accessToken}`;
      console.log('Generated authenticated avatar URL:', { userId, original: mxcUrl, authenticated: baseUrl + '?access_token=***' });
      
      // Test if the authenticated URL works
      try {
        const response = await fetch(authenticatedUrl, { method: 'HEAD' });
        if (response.ok) {
          return authenticatedUrl;
        } else {
          console.warn('Authenticated avatar URL failed, trying unauthenticated:', response.status);
        }
      } catch (error) {
        console.warn('Error testing authenticated avatar URL:', error);
      }
    }

    // Method 2: Try without authentication (might work for public avatars)
    console.log('Generated unauthenticated avatar URL (no access token):', { userId, original: mxcUrl, converted: baseUrl });
    
    // Test if the unauthenticated URL works
    try {
      const response = await fetch(baseUrl, { method: 'HEAD' });
      if (response.ok) {
        return baseUrl;
      } else {
        console.warn('Unauthenticated avatar URL also failed:', response.status);
      }
    } catch (error) {
      console.warn('Error testing unauthenticated avatar URL:', error);
    }
    
    // If both methods fail, return undefined to trigger fallback
    console.error('Both authenticated and unauthenticated avatar URLs failed for:', { userId, mxcUrl });
    return undefined;
  }
}

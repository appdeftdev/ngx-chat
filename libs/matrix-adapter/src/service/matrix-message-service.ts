import { BehaviorSubject, Observable, Subject, firstValueFrom } from 'rxjs';
import { NgZone } from '@angular/core';
import {
  Direction,
  JidToNumber,
  Log,
  LogLevel,
  Message,
  MessageService,
  MessageState,
  MessageStore,
  parseJid,
  Recipient,
  Room,
  runInZone,
  ContactListService, // Added import
} from '@pazznetwork/ngx-chat-shared';
import * as sdk from 'matrix-js-sdk';
import {
  RoomEvent,
  Direction as MatrixDirection,
  ClientEvent,
  SyncState,
  MatrixEvent,
  IRoomTimelineData,
} from 'matrix-js-sdk';

export class MatrixMessageService implements MessageService {
  private readonly messageReceivedSubject = new Subject<Recipient>();
  private readonly messageSentSubject = new Subject<Recipient>();
  private readonly messageSubject = new Subject<Recipient>();
  private readonly jidToUnreadCountSubject = new BehaviorSubject<JidToNumber>(new Map());
  private readonly unreadMessageCountSumSubject = new BehaviorSubject<number>(0);
  private readonly roomStore = new Map<string, Room>();
  private readonly logService: Log;
  private client!: sdk.MatrixClient;
  private contactListService!: ContactListService; // Added field
  private encryptionSupported = false;

  readonly messageReceived$: Observable<Recipient>;
  readonly messageSent$: Observable<Recipient>;
  readonly message$: Observable<Recipient>;
  readonly jidToUnreadCount$: Observable<JidToNumber>;
  readonly unreadMessageCountSum$: Observable<number>;

  constructor(
    zone: NgZone,
    logService: Log,
    contactListService: ContactListService // Injected
  ) {
    this.logService = logService;
    this.contactListService = contactListService; // Assigned
    this.messageReceived$ = this.messageReceivedSubject.asObservable().pipe(runInZone(zone));
    this.messageSent$ = this.messageSentSubject.asObservable().pipe(runInZone(zone));
    this.message$ = this.messageSubject.asObservable().pipe(runInZone(zone));
    this.jidToUnreadCount$ = this.jidToUnreadCountSubject.asObservable().pipe(runInZone(zone));
    this.unreadMessageCountSum$ = this.unreadMessageCountSumSubject
      .asObservable()
      .pipe(runInZone(zone));
  }

  private getOrCreateMessageStore(recipient: Recipient): MessageStore {
    // Contact and Room classes (implementing Recipient) have messageStore initialized.
    // Casting to 'any' to access the property, assuming recipient is always one of these.
    if (!(recipient as any).messageStore) {
      this.logService.error('Recipient is missing messageStore property. This should not happen.', {
        jid: recipient.jid.toString(),
        type: recipient.recipientType,
      });
      // Potentially throw an error or return a new store as a fallback,
      // but the design implies messageStore should always exist on the recipient instance.
      // For now, we'll proceed assuming it exists, aligning with how Contact/Room are defined.
    }
    return (recipient as any).messageStore;
  }

  private async getOrCreateRoomForRecipient(recipient: Recipient): Promise<sdk.Room> {
    if (recipient.recipientType === 'room') {
      // Use the original Matrix room ID if available, fallback to JID string
      const roomId = (recipient as any).roomId || recipient.jid.toString();
      let room = this.client.getRoom(roomId);
      
      if (!room) {
        // Try to force sync the room if it's not found
        this.logService.debug('Room not found in client store, attempting to join/sync:', roomId);
        
        try {
          // Try to join the room (in case we're not already in it)
          await this.client.joinRoom(roomId);
          
          // Wait a bit for the room to be added to the client's store
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          room = this.client.getRoom(roomId);
          
          if (!room) {
            // If still not found, try getting room info to verify it exists
            const roomInfo = await this.client.getJoinedRooms();
            const isJoined = roomInfo.joined_rooms.includes(roomId);
            
            if (isJoined) {
              // Force a manual sync for this specific room
              this.logService.debug('Room exists but not in local store, forcing sync...');
              await this.client.roomInitialSync(roomId, 10);
              room = this.client.getRoom(roomId);
            }
          }
        } catch (error) {
          this.logService.warn('Failed to join/sync room:', error);
        }
        
        if (!room) {
          // Last resort: list all available rooms for debugging
          const allRooms = this.client.getRooms();
          this.logService.error('Room not found after sync attempts. Available rooms:', {
            targetRoomId: roomId,
            availableRooms: allRooms.map(r => ({ id: r.roomId, name: r.name }))
          });
          throw new Error(`Room not found: ${roomId}. You might not be a member of this room or it may not exist.`);
        }
      }
      
      return room;
    }

    // For contacts, create or find DM room
    const userId = recipient.jid.toString();
    // Ensure proper Matrix user ID format
    const matrixUserId = userId.startsWith('@') ? userId : `@${userId}`;

    const rooms = this.client.getRooms();
    const dmRoom = rooms.find((r) => {
      const isDirect = r.getDMInviter() !== null;
      const members = r.getJoinedMembers();
      return isDirect && members.length === 2 && members.some((m) => m.userId === matrixUserId);
    });

    if (dmRoom) {
      return dmRoom;
    }

    try {
      // Create new DM room
      const result = await this.client.createRoom({
        preset: sdk.Preset.PrivateChat,
        invite: [matrixUserId],
        is_direct: true,
      });

      const newRoom = this.client.getRoom(result.room_id);
      if (!newRoom) {
        throw new Error('Failed to create DM room');
      }

      return newRoom;
    } catch (error: any) {
      this.logService.error('Failed to create DM room:', error);
      throw new Error(`Failed to create DM room: ${error.message || 'Unknown error'}`);
    }
  }

  async sendMessage(originalRecipient: Recipient, messageBody: string): Promise<void> {
    if (!this.client) {
      throw new Error('Matrix client not initialized');
    }

    try {
      // Get the underlying Matrix SDK room to send the message
      const sdkRoom = await this.getOrCreateRoomForRecipient(originalRecipient);

      // Check if room is encrypted but encryption is not supported
      const isRoomEncrypted = sdkRoom.hasEncryptionStateEvent?.() || false;
      console.log('🔐 MESSAGE SERVICE: Room encrypted =', isRoomEncrypted, ', encryption supported =', this.encryptionSupported);
      
      // ENCRYPTION DISABLED: Skip encryption checks for now to make basic chat work
      if (isRoomEncrypted && !this.encryptionSupported) {
        console.warn('🔐 MESSAGE SERVICE: ⚠️ Room is encrypted but encryption is disabled - sending as plaintext');
        console.warn('🔐 MESSAGE SERVICE: This message may not be delivered if the room requires encryption');
        // Continue without throwing error - let the Matrix SDK handle it
      }

      // Send the message via Matrix SDK
      console.log('📨 MESSAGE SERVICE: Sending message to room:', sdkRoom.roomId, 'encrypted:', isRoomEncrypted);
      
      let sendResult;
      try {
        sendResult = await this.client.sendTextMessage(sdkRoom.roomId, messageBody);
        console.log('📨 MESSAGE SERVICE: Message sent successfully:', sendResult.event_id);
      } catch (sendError: any) {
        console.error('📨 MESSAGE SERVICE: Failed to send message:', sendError);
        
        // Check if this is an encryption-related error
        if (sendError.message?.includes('encryption') || sendError.message?.includes('encrypted')) {
          console.warn('📨 MESSAGE SERVICE: Encryption error encountered, but allowing message to be added to UI');
          
          // Create a failed message to show in the UI with encryption-specific error
          const encryptionFailedMessage: Message = {
            body: `❌ ${messageBody}\n\n⚠️ Message may not be delivered - room requires encryption`,
            datetime: new Date(),
            direction: Direction.out,
            id: 'encryption-failed-' + Date.now(),
            from: parseJid(this.client.getUserId() || ''),
            delayed: false,
            fromArchive: false,
            state: MessageState.SENDING, // Use SENDING to indicate potential failure
          };

          // Add the failed message to UI and continue without throwing
          try {
            let targetRecipient = originalRecipient;
            if (originalRecipient.recipientType === 'contact') {
              targetRecipient = await this.contactListService.getOrCreateContactById(originalRecipient.jid.toString());
            } else {
              const sdkRoom = await this.getOrCreateRoomForRecipient(originalRecipient);
              targetRecipient = this.getOrCreateRoom(sdkRoom.roomId, sdkRoom.name);
            }
            
            const messageStore = this.getOrCreateMessageStore(targetRecipient);
            messageStore.addMessage(encryptionFailedMessage);
            this.messageSubject.next(targetRecipient);
            console.log('📨 MESSAGE SERVICE: Added encryption warning message to UI');
          } catch (storeError) {
            console.error('📨 MESSAGE SERVICE: Could not add encryption warning to store:', storeError);
          }
          
          // Don't throw error - let the user see the warning message
          return;
        }
        
        // Re-throw other errors as-is
        throw sendError;
      }

      // Create the message object to add to store immediately
      const newMessage: Message = {
        body: messageBody,
        datetime: new Date(),
        direction: Direction.out,
        id: sendResult.event_id,
        from: parseJid(this.client.getUserId() || ''),
        delayed: false,
        fromArchive: false,
        state: MessageState.SENT,
      };

      let targetRecipientForEvents: Recipient;

      if (originalRecipient.recipientType === 'contact') {
        // For DMs, the event recipient is the Contact itself.
        // The contactListService should provide the canonical instance.
        targetRecipientForEvents = await this.contactListService.getOrCreateContactById(
          originalRecipient.jid.toString()
        );
        this.logService.debug('Outgoing message for Contact:', {
          contactId: targetRecipientForEvents.jid.toString(),
        });
      } else {
        // For MUCs, the event recipient is our Room object.
        targetRecipientForEvents = this.getOrCreateRoom(sdkRoom.roomId, sdkRoom.name);
        this.logService.debug('Outgoing message for Room:', {
          roomId: targetRecipientForEvents.jid.toString(),
        });
      }

      if (!targetRecipientForEvents) {
        this.logService.error('Could not determine target recipient for outgoing message events.', {
          originalRecipientJid: originalRecipient.jid.toString(),
        });
        // Fallback or error, though getOrCreateContactById/Room should always return an instance or throw.
        // As a fallback, we could use originalRecipient, but it might not be the canonical one.
        // For now, we assume targetRecipientForEvents is always populated if no error thrown before.
        // If an error was thrown by getOrCreateContactById, it would have been caught by the outer try-catch.
        // If it's null/undefined without an error, that's an unexpected state.
        // To be safe, let's use originalRecipient if targetRecipientForEvents is somehow not set.
        targetRecipientForEvents = originalRecipient;
        this.logService.warn('Fell back to originalRecipient for outgoing message events.', {
          originalRecipientJid: originalRecipient.jid.toString(),
        });
      }

      // Add the message immediately to ensure it appears in the UI
      // MessageStore has built-in duplicate prevention, so this is safe
      const messageStore = this.getOrCreateMessageStore(targetRecipientForEvents);
      messageStore.addMessage(newMessage);
      
      console.log('📨 MESSAGE SERVICE: Message added to store immediately:', {
        eventId: sendResult.event_id,
        recipientId: targetRecipientForEvents.jid.toString(),
        messageCount: messageStore.messages.length
      });

      this.messageSentSubject.next(targetRecipientForEvents);
      this.messageSubject.next(targetRecipientForEvents);

      this.logService.debug('Matrix message sent via SDK and processed internally:', {
        matrixRoomId: sdkRoom.roomId,
        eventId: sendResult.event_id,
        body: messageBody,
        internalRecipientId: targetRecipientForEvents.jid.toString(),
        internalRecipientStoreId: (targetRecipientForEvents as any).messageStore?.storeId, // Log storeId
      });
    } catch (error: any) {
      this.logService.error('Error sending Matrix message:', error);
      
      // Create a failed message to show in the UI
      const failedMessage: Message = {
        body: `❌ Failed to send: ${messageBody}`,
        datetime: new Date(),
        direction: Direction.out,
        id: 'failed-' + Date.now(),
        from: parseJid(this.client.getUserId() || ''),
        delayed: false,
        fromArchive: false,
        state: MessageState.SENDING, // Use SENDING to indicate failed/unsent state
      };

      // Show the failed message in the UI
      try {
        const messageStore = this.getOrCreateMessageStore(originalRecipient);
        messageStore.addMessage(failedMessage);
        this.messageSubject.next(originalRecipient);
        console.log('📨 MESSAGE SERVICE: Added failed message to UI');
      } catch (storeError) {
        console.error('📨 MESSAGE SERVICE: Could not add failed message to store:', storeError);
      }
      
      throw error;
    }
  }

  setClient(client: sdk.MatrixClient, encryptionSupported: boolean = false) {
    console.log('🔐 MESSAGE SERVICE: setClient called with encryptionSupported =', encryptionSupported);
    this.client = client;
    this.encryptionSupported = encryptionSupported;
    this.setupMessageHandlers();
    
    // With encryption disabled, we can process existing timelines immediately
    console.log('📨 MESSAGE SERVICE: Encryption disabled, processing existing room timelines...');
    // Don't process timelines immediately - wait for proper initialization
  }

  /**
   * Initialize message loading after contacts and rooms are loaded
   */
  async initializeAfterContactsLoaded(): Promise<void> {
    console.log('📨 MESSAGE SERVICE: Initializing message service after contacts loaded...');
    
    // Setup message handlers first
    this.setupMessageHandlers();
    
    // Give Matrix client a moment to fully sync before processing timelines
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('📨 MESSAGE SERVICE: Starting timeline processing...');
    await this.processExistingRoomTimelines();
    
    // Force load recent messages for all contacts that have corresponding Matrix rooms
    console.log('📨 MESSAGE SERVICE: Loading recent messages for existing contacts...');
    await this.loadMessagesForExistingContacts();
    
    console.log('📨 MESSAGE SERVICE: Initialization complete');
  }

  private async loadMessagesForExistingContacts(): Promise<void> {
    try {
      // Get contacts from the observable
      const contacts = await firstValueFrom(this.contactListService.contacts$);
      console.log(`📨 MESSAGE SERVICE: Found ${contacts.length} contacts to load messages for`);
      
      for (const contact of contacts) {
        try {
          // Find the DM room for this contact
          const userId = contact.jid.toString();
          const rooms = this.client.getRooms();
          const dmRoom = rooms.find(r => {
            const members = r.getMembers();
            return members.length === 2 && 
                   members.some(m => m.userId === this.client.getUserId()) &&
                   members.some(m => m.userId === userId);
          });
          
          if (dmRoom) {
            console.log(`📨 MESSAGE SERVICE: Loading messages for contact: ${contact.name} (${userId})`);
            await this.loadMostRecentMessages(contact);
            
            // Force emit the messages to ensure UI updates
            contact.messageStore.forceEmission();
          } else {
            console.log(`📨 MESSAGE SERVICE: No DM room found for contact: ${contact.name} (${userId})`);
          }
        } catch (error) {
          console.warn(`📨 MESSAGE SERVICE: Failed to load messages for contact ${contact.jid.toString()}:`, error);
        }
      }
      
      console.log('📨 MESSAGE SERVICE: Finished loading messages for all contacts');
    } catch (error) {
      console.error('📨 MESSAGE SERVICE: Error loading messages for contacts:', error);
    }
  }

  private get matrixClient(): sdk.MatrixClient {
    if (!this.client) throw new Error('Not logged in');
    return this.client;
  }

  private getOrCreateRoom(roomId: string, roomName: string): Room {
    let room = this.roomStore.get(roomId);
    if (!room) {
      room = new Room(this.logService, parseJid(roomId), roomName);
      // Store the original Matrix room ID for proper API calls
      room.roomId = roomId;
      this.roomStore.set(roomId, room);
    }
    return room;
  }

  private async determineTargetRecipient(matrixSdkRoom: sdk.Room, roomId: string): Promise<Recipient | undefined> {
    // Better logic to determine if it's a DM or a MUC
    const members = matrixSdkRoom.getMembers();
    const joinedMembers = matrixSdkRoom.getJoinedMembers();
    
    // Check if it's explicitly marked as direct
    const isDirect = matrixSdkRoom.getDMInviter() !== null;
    
    // Also check if it's a 2-person room with us and one other person
    const isTwoPersonRoom = joinedMembers.length === 2 && 
                           joinedMembers.some((m) => m.userId === this.client.getUserId());
    
    const isDmRoom = isDirect || isTwoPersonRoom;

    console.log('🔍 MESSAGE SERVICE: Room analysis:', {
      roomId,
      roomName: matrixSdkRoom.name,
      totalMembers: members.length,
      joinedMembers: joinedMembers.length,
      isDirect,
      isTwoPersonRoom,
      isDmRoom,
      memberIds: joinedMembers.map(m => m.userId)
    });

    if (isDmRoom) {
      const otherMember = joinedMembers.find((m) => m.userId !== this.client.getUserId());
      if (otherMember?.userId) {
        try {
          console.log('🔍 MESSAGE SERVICE: Creating contact for DM:', otherMember.userId);
          return await this.contactListService.getOrCreateContactById(otherMember.userId);
        } catch (e) {
          console.warn('🔍 MESSAGE SERVICE: Failed to create contact for DM:', e);
          return undefined; // Silent fail
        }
      } else {
        console.warn('🔍 MESSAGE SERVICE: No other member found in DM room');
        return undefined; // Silent fail
      }
    } else {
      // For MUCs or other room types
      console.log('🔍 MESSAGE SERVICE: Creating room object for MUC:', roomId, matrixSdkRoom.name);
      return this.getOrCreateRoom(roomId, matrixSdkRoom.name);
    }
  }

  private setupMessageHandlers() {
    // Set log level to debug temporarily
    this.logService.logLevel = LogLevel.Debug;

    // Handle sync state changes
    this.matrixClient.on(
      ClientEvent.Sync,
      (state: SyncState, prevState: SyncState | null, data: any) => {
        this.logService.debug('Sync state changed:', { state, prevState });

        if (state === 'SYNCING') {
          this.logService.debug('Matrix client syncing...', data);

          // Process new messages from sync response
          if (data?.join) {
            Object.entries(data.join).forEach(([roomId, roomData]: [string, any]) => {
              const room = this.client.getRoom(roomId);
              if (!room) return;

              if (roomData?.timeline?.events) {
                this.logService.debug(
                  `Processing ${roomData.timeline.events.length} events for room ${roomId}`
                );

                roomData.timeline.events.forEach((event: any) => {
                  if (event.type === 'm.room.message' || event.type === 'm.room.encrypted') {
                    this.handleMatrixMessage(event, roomId, false); // Fresh events from sync
                  }
                });
              }

              // Update unread counts
              if (roomData.unread_notifications) {
                const newMap = new Map(this.jidToUnreadCountSubject.getValue());
                newMap.set(roomId, roomData.unread_notifications.notification_count);
                this.jidToUnreadCountSubject.next(newMap);

                // Update total unread count
                const totalUnread = Array.from(newMap.values()).reduce(
                  (sum, count) => sum + count,
                  0
                );
                this.unreadMessageCountSumSubject.next(totalUnread);
              }
            });
          }
        }
      }
    );

    // Handle timeline events
    this.matrixClient.on(
      RoomEvent.Timeline,
      (
        event: MatrixEvent,
        room: sdk.Room | undefined,
        _toStartOfTimeline: boolean | undefined,
        removed: boolean,
        _data: IRoomTimelineData
      ) => {
        if (removed || !room || event.isRedacted()) {
          return;
        }

        this.logService.debug('Timeline event received:', {
          type: event.getType(),
          roomId: room.roomId,
          sender: event.getSender(),
          eventId: event.getId(),
          content: event.getContent(),
        });

        if (event.getType() === 'm.room.message' || event.getType() === 'm.room.encrypted') {
          this.handleMatrixMessage(event, room.roomId, false); // Fresh timeline events
        }
      }
    );

    // Handle room member events
    this.matrixClient.on(RoomEvent.Timeline, (event: MatrixEvent, room: sdk.Room | undefined) => {
      if (event.getType() === 'm.room.member' && room) {
        const recipient = this.getOrCreateRoom(room.roomId, room.name);
        this.messageSubject.next(recipient);
      }
    });

    // Handle connection errors
    this.matrixClient.on('Session.logged_out' as any, () => {
      this.logService.error('Matrix client logged out');
    });

    this.matrixClient.on('error' as any, (error: any) => {
      this.logService.error('Matrix client error:', error);
    });

    // Note: Client is already started in MatrixConnectionService
    this.logService.debug('Matrix message handlers set up successfully');
  }

  private async handleMatrixMessage(event: sdk.MatrixEvent, roomId: string, fromHistory: boolean = false): Promise<void> {
    const eventType = event.getType();
    const isEncrypted = eventType === 'm.room.encrypted';
    const eventSender = event.getSender();
    console.log('🔐 MESSAGE SERVICE: Handling message - type:', eventType, 'encrypted:', isEncrypted, 'sender:', eventSender);
    
    const matrixSdkRoom = this.client.getRoom(roomId);
    if (!matrixSdkRoom) {
      console.warn('🔐 MESSAGE SERVICE: Room not found for event:', roomId);
      return; // Silent fail
    }

    const sender = event.getSender();
    const content = event.getContent();
    const eventId = event.getId();
    const timestamp = event.getTs();

    if (!sender || !content || !eventId || !timestamp) {
      console.warn('🔐 MESSAGE SERVICE: Invalid message event data:', { sender, hasContent: !!content, eventId, timestamp });
      return; // Silent fail
    }

    // Handle encrypted events that failed to decrypt
    if (event.getType() === 'm.room.encrypted' && event.isDecryptionFailure()) {
      const decryptionError = event.decryptionFailureReason || event.getContent()?.['body'] || 'UNKNOWN_ERROR';
      console.warn('🔐 MESSAGE SERVICE: Skipping encrypted message (encryption disabled):', { 
        eventId, 
        roomId, 
        error: decryptionError
      });
      
      // Provide user-friendly error messages based on the error content
      let errorMessage = '[Unable to decrypt message]';
      let debugInfo = '';
      
      // Check error message content since types may vary
      const errorStr = String(decryptionError).toLowerCase();
      
      if (errorStr.includes('unknown_message_index') || errorStr.includes('message index')) {
        errorMessage = '🔐 Message sent before you joined this room';
        debugInfo = 'This message was sent before your device joined this encrypted room. Historical messages cannot be decrypted.';
      } else if (errorStr.includes('missing_session') || errorStr.includes('missing session')) {
        errorMessage = '🔐 Missing encryption keys for this device';
        debugInfo = 'Your device is missing the encryption session for this message. The sender may need to re-share keys.';
      } else if (errorStr.includes('unknown_sender_device') || errorStr.includes('unknown device')) {
        errorMessage = '🔐 Message from unknown device';
        debugInfo = 'This message was sent from a device that is not recognized in the encryption system.';
      } else if (errorStr.includes('unsigned_sender_device') || errorStr.includes('unverified device')) {
        errorMessage = '🔐 Message from unverified device';
        debugInfo = 'This message was sent from a device that has not been verified for end-to-end encryption.';
      } else {
        errorMessage = `🔐 Encrypted message (encryption disabled)`;
        debugInfo = `This message is encrypted but encryption is currently disabled. Enable encryption to view encrypted messages.`;
      }
      
      console.warn('🔐 MESSAGE SERVICE: Decryption failure details:', {
        errorMessage,
        debugInfo,
        originalError: decryptionError,
        eventContent: event.getContent()
      });
      
      // Create message with enhanced decryption failure info
      const failureMessage: Message = {
        body: errorMessage,
        direction: sender === this.client.getUserId() ? Direction.out : Direction.in,
        datetime: new Date(timestamp),
        state: MessageState.RECIPIENT_RECEIVED,
        id: eventId,
        delayed: false,
        fromArchive: false,
        from: parseJid(sender),
      };

      // Get target recipient for failure message
      const targetRecipient = await this.determineTargetRecipient(matrixSdkRoom, roomId);
      if (targetRecipient) {
        const messageStore = this.getOrCreateMessageStore(targetRecipient);
        messageStore.addMessage(failureMessage);
        this.messageReceivedSubject.next(targetRecipient);
        this.messageSubject.next(targetRecipient);
        
        console.log('🔐 MESSAGE SERVICE: Added decryption failure message to store for', targetRecipient.jid.toString());
      }
      return;
    }

    let messageBody =
      content.msgtype === 'm.text'
        ? content['body']
        : content.msgtype === 'm.image'
          ? '[Image]'
          : content.msgtype === 'm.file'
            ? '[File]'
            : content['body'] || '[Unsupported message type]';

    // Clean up message body - remove extra whitespace and normalize line breaks
    if (typeof messageBody === 'string') {
      messageBody = messageBody
        .replace(/\r\n/g, '\n')  // Normalize Windows line endings
        .replace(/\r/g, '\n')    // Normalize Mac line endings
        .trim();                 // Remove leading/trailing whitespace
    }

    if (!messageBody) {
      console.warn('🔐 MESSAGE SERVICE: No message body found in event:', eventId);
      return; // Silent fail
    }

    const message: Message = {
      body: messageBody,
      direction: sender === this.client.getUserId() ? Direction.out : Direction.in,
      datetime: new Date(timestamp),
      state: MessageState.RECIPIENT_RECEIVED,
      id: eventId,
      delayed: false,
      fromArchive: false,
      from: parseJid(sender),
    };

    const targetRecipient = await this.determineTargetRecipient(matrixSdkRoom, roomId);

    if (!targetRecipient) {
      console.warn('🔐 MESSAGE SERVICE: Could not determine target recipient for message:', { eventId, roomId, sender });
      return; // Silent fail
    }

    // Skip outgoing messages only if they're fresh events (not from history) to prevent duplicates
    // Historical outgoing messages should still be loaded
    if (message.direction === Direction.out && !fromHistory) {
      console.log('📨 MESSAGE SERVICE: Skipping fresh outgoing message from event handler to prevent duplicate:', eventId);
      return;
    }
    
    // Process incoming messages or historical outgoing messages
    const messageStore = this.getOrCreateMessageStore(targetRecipient);
    messageStore.addMessage(message);
    
    const messageType = fromHistory ? 'historical' : (message.direction === Direction.in ? 'incoming' : 'outgoing');
    console.log(`📨 MESSAGE SERVICE: ${messageType} message added. Store count:`, messageStore.messages.length);

    // Emit events appropriately
    if (message.direction === Direction.in) {
      this.messageReceivedSubject.next(targetRecipient);
    } else if (fromHistory) {
      // For historical outgoing messages, emit sent event
      this.messageSentSubject.next(targetRecipient);
    }
    this.messageSubject.next(targetRecipient);
    
    console.log(`📨 MESSAGE SERVICE: Events emitted for ${messageType} message:`, eventId);
  }

  async loadCompleteHistory(): Promise<void> {
    // Load complete history for all rooms
    const rooms = this.matrixClient.getRooms();
    for (const room of rooms) {
      try {
        // Load initial batch of messages
        await this.matrixClient.scrollback(room, 100);

        // Keep loading until we can't load more
        let canLoadMore = true;
        while (canLoadMore) {
          const timeline = room.getLiveTimeline();
          canLoadMore = timeline.getPaginationToken(MatrixDirection.Backward) !== null;
          if (canLoadMore) {
            await this.matrixClient.scrollback(room, 100);
          }
        }
        this.logService.debug('Loaded complete history for room:', room.roomId);
      } catch (error) {
        this.logService.error('Error loading complete history for room:', room.roomId, error);
      }
    }
  }

  async loadMessagesBeforeOldestMessage(recipient: Recipient): Promise<void> {
    let room: sdk.Room | null = null;
    
    if (recipient.recipientType === 'contact') {
      // For contacts, find the DM room
      const contactJid = recipient.jid.toString();
      const rooms = this.matrixClient.getRooms();
      room = rooms.find((r) => {
        const members = r.getMembers();
        return members.length === 2 && 
               members.some((m) => m.userId === this.matrixClient.getUserId()) &&
               members.some((m) => m.userId === contactJid);
      }) || null;
      
      if (!room) return;
    } else {
      // For rooms, use the JID directly as room ID
      room = this.matrixClient.getRoom(recipient.jid.toString());
      if (!room) return;
    }

    const timeline = room.getLiveTimeline();
    const events = timeline.getEvents();
    if (events.length === 0) return;

    // Check if we can load more messages
    const canLoadMore = timeline.getPaginationToken(MatrixDirection.Backward) !== null;
    if (!canLoadMore) {
      this.logService.debug('No more messages to load for room:', room.roomId);
      return;
    }

    try {
      // Load more messages with a larger batch size
      await this.matrixClient.scrollback(room, 100);
      this.logService.debug('Loaded more messages for room:', room.roomId);
    } catch (error) {
      this.logService.error('Error loading more messages:', error);
    }
  }

  async loadMostRecentMessages(recipient: Recipient): Promise<void> {
    let room: sdk.Room | null = null;
    
    if (recipient.recipientType === 'contact') {
      // For contacts, find the DM room
      const contactJid = recipient.jid.toString();
      const rooms = this.client.getRooms();
      room = rooms.find((r) => {
        const members = r.getMembers();
        return members.length === 2 && 
               members.some((m) => m.userId === this.client.getUserId()) &&
               members.some((m) => m.userId === contactJid);
      }) || null;
      
      if (!room) {
        console.warn('DM room not found for contact:', contactJid);
        return;
      }
    } else {
      // For rooms, use the JID directly as room ID
      // Use the original Matrix room ID if available, fallback to JID string
      const roomId = (recipient as any).roomId || recipient.jid.toString();
      room = this.client.getRoom(roomId);
      if (!room) {
        console.warn('Room not found for recipient:', roomId);
        return;
      }
    }

    try {
      // Get the current timeline
      const timeline = room.getLiveTimeline();
      let paginationToken = timeline.getPaginationToken(MatrixDirection.Backward);
      
      if (!paginationToken) {
        console.log('No more history available for room:', room.name || room.roomId);
        return;
      }

      // Load messages in smaller batches to prevent freezing
      const batchSize = 20;
      let totalLoaded = 0;
      const maxMessages = 100; // Maximum messages to load
      
      while (totalLoaded < maxMessages) {
        // Add timeout to prevent hanging
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 5000)
        );

        try {
          // Try to load more messages with timeout protection
          await Promise.race([
            this.client.scrollback(room, batchSize),
            timeoutPromise
          ]);

          // Get newly loaded events
          const events = timeline.getEvents();
          const messageEvents = events.filter(event => 
            event.getType() === 'm.room.message' && 
            !event.isRedacted()
          );
          
          // Process new messages
          for (const event of messageEvents) {
            await this.handleMatrixMessage(event, room.roomId, true); // Historical messages
          }

          totalLoaded += messageEvents.length;
          
          // Check if we can load more
          const newToken = timeline.getPaginationToken(MatrixDirection.Backward);
          if (!newToken || newToken === paginationToken) {
            console.log('No more messages available');
            break;
          }
          
          // Update token for next iteration
          paginationToken = newToken;
          
        } catch (error) {
          console.warn('Failed to load batch:', error);
          break;
        }
      }

      console.log(`Loaded ${totalLoaded} messages for ${room.name || room.roomId}`);
      
    } catch (error) {
      console.warn(`Failed to load messages for ${room.name || room.roomId}:`, error);
    }
  }

  getContactMessageState(message: Message, _recipientJid: string): MessageState {
    return message.state || MessageState.SENT;
  }

  private async processExistingRoomTimelines(): Promise<void> {
    try {
      const rooms = this.client.getRooms();
      console.log(`🔐 MESSAGE SERVICE: Processing existing timelines for ${rooms.length} rooms`);
      
      // Process ALL rooms, not just a subset
      for (const room of rooms) {
        try {
          console.log(`🔐 MESSAGE SERVICE: Processing room ${room.name || room.roomId}...`);
          const events = room.getLiveTimeline().getEvents();
          
          // Process ALL messages in the timeline, not just recent ones
          console.log(`🔐 MESSAGE SERVICE: Found ${events.length} events in timeline for ${room.name || room.roomId}`);
          
          let processedCount = 0;
          for (const event of events) {
            if (event.getType() === 'm.room.message') {
              // Process plain text messages
              console.log(`📨 MESSAGE SERVICE: Processing plain message ${event.getId()} in room ${room.roomId}`);
              await this.handleMatrixMessage(event, room.roomId, true); // Historical messages
              processedCount++;
            } else if (event.getType() === 'm.room.encrypted' && this.encryptionSupported) {
              // Only process encrypted messages if encryption is enabled
              console.log(`🔐 MESSAGE SERVICE: Processing encrypted event ${event.getId()} in room ${room.roomId}`);
              await this.handleMatrixMessage(event, room.roomId, true); // Historical messages
              processedCount++;
            } else if (event.getType() === 'm.room.encrypted') {
              // Skip encrypted messages when encryption is disabled
              console.log(`📨 MESSAGE SERVICE: Skipping encrypted message ${event.getId()} (encryption disabled)`);
            }
          }
          
          console.log(`🔐 MESSAGE SERVICE: Processed ${processedCount} messages from room ${room.name || room.roomId}`);
          
          // Force a refresh of the room data after processing
          const targetRecipient = await this.determineTargetRecipient(room, room.roomId);
          if (targetRecipient) {
            console.log(`🔐 MESSAGE SERVICE: Forcing UI update for ${targetRecipient.jid.toString()}`);
            this.messageSubject.next(targetRecipient);
          }
          
        } catch (error) {
          console.warn(`🔐 MESSAGE SERVICE: Failed to process timeline for room ${room.name || room.roomId}:`, error);
        }
      }
      
      console.log('🔐 MESSAGE SERVICE: Timeline processing complete');
    } catch (error) {
      console.error('🔐 MESSAGE SERVICE: Error processing room timelines:', error);
    }
  }
}

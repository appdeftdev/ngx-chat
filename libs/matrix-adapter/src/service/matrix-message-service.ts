import { BehaviorSubject, Observable, Subject } from 'rxjs';
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
  private readonly messageSubject = new BehaviorSubject<Recipient>(null as any);
  private readonly jidToUnreadCountSubject = new BehaviorSubject<JidToNumber>(new Map());
  private readonly unreadMessageCountSumSubject = new BehaviorSubject<number>(0);
  private readonly roomStore = new Map<string, Room>();
  private readonly logService: Log;
  private client!: sdk.MatrixClient;
  private contactListService!: ContactListService; // Added field

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
      const room = this.client.getRoom(recipient.jid.toString());
      if (!room) {
        throw new Error('Room not found');
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

      // Send the message via Matrix SDK
      const sendResult = await this.client.sendTextMessage(sdkRoom.roomId, messageBody);

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

      const messageStore = this.getOrCreateMessageStore(targetRecipientForEvents);
      messageStore.addMessage(newMessage);

      this.logService.debug('Outgoing message added to store:', {
        recipientId: targetRecipientForEvents.jid.toString(),
        recipientType: targetRecipientForEvents.recipientType,
        messageStoreId: (targetRecipientForEvents as any).messageStore?.storeId, // Log storeId
        messageId: newMessage.id,
        storeSize: messageStore.messages.length,
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
      // Potentially add message to store with 'failed' state here
      throw error;
    }
  }

  setClient(client: sdk.MatrixClient) {
    this.client = client;
    this.setupMessageHandlers();
  }

  private get matrixClient(): sdk.MatrixClient {
    if (!this.client) throw new Error('Not logged in');
    return this.client;
  }

  private getOrCreateRoom(roomId: string, roomName: string): Room {
    let room = this.roomStore.get(roomId);
    if (!room) {
      room = new Room(this.logService, parseJid(roomId), roomName);
      this.roomStore.set(roomId, room);
    }
    return room;
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
                  if (event.type === 'm.room.message') {
                    this.handleMatrixMessage(event, roomId);
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

        if (event.getType() === 'm.room.message') {
          this.handleMatrixMessage(event, room.roomId);
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

    // Start initial sync
    this.matrixClient.startClient().catch((error: any) => {
      this.logService.error('Error starting Matrix client:', error);
    });
  }

  private async handleMatrixMessage(event: sdk.MatrixEvent, roomId: string): Promise<void> {
    const matrixSdkRoom = this.client.getRoom(roomId);
    if (!matrixSdkRoom) {
      this.logService.warn(`Matrix SDK Room ${roomId} not found for message event`);
      return;
    }

    const sender = event.getSender();
    const content = event.getContent();
    const eventId = event.getId();
    const timestamp = event.getTs();

    if (!sender || !content || !eventId || !timestamp) {
      this.logService.warn('Invalid message event:', event);
      return;
    }

    this.logService.debug('Processing message:', {
      roomId,
      senderId: sender,
      content,
      eventId,
      timestamp,
    });

    const messageBody =
      content.msgtype === 'm.text'
        ? content['body']
        : content.msgtype === 'm.image'
          ? '[Image]'
          : content.msgtype === 'm.file'
            ? '[File]'
            : '[Unsupported message type]';

    if (!messageBody) {
      this.logService.warn('Empty message body, skipping:', content);
      return;
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

    this.logService.debug('Created message object:', message);

    let targetRecipient: Recipient | undefined;

    // Determine if it's a DM or a MUC
    const members = matrixSdkRoom.getMembers();
    // A DM room typically has 2 members, one of whom is the current user.
    // And it should be marked as a direct chat in account data,
    // but for incoming messages, checking member count and presence of self is a strong indicator.
    const isDmRoom =
      members.length === 2 && members.some((m) => m.userId === this.client.getUserId());

    if (isDmRoom) {
      const otherMember = members.find((m) => m.userId !== this.client.getUserId());
      if (otherMember?.userId) {
        try {
          targetRecipient = await this.contactListService.getOrCreateContactById(
            otherMember.userId
          );
          this.logService.debug('Identified DM recipient as Contact:', {
            contactId: targetRecipient.jid.toString(),
          });
        } catch (e) {
          this.logService.error(
            `Failed to get/create contact for DM user ${otherMember.userId}`,
            e
          );
          return;
        }
      } else {
        this.logService.warn('DM room detected, but could not identify other member.', {
          roomId,
          members,
        });
        return;
      }
    } else {
      // For MUCs or other room types
      targetRecipient = this.getOrCreateRoom(roomId, matrixSdkRoom.name);
      this.logService.debug('Identified MUC recipient as Room:', {
        roomId: targetRecipient.jid.toString(),
      });
    }

    if (!targetRecipient) {
      this.logService.error('Could not determine target recipient for message.', {
        roomId,
        sender,
      });
      return;
    }

    const messageStore = this.getOrCreateMessageStore(targetRecipient);
    messageStore.addMessage(message);

    this.logService.debug('Message added to store:', {
      recipientId: targetRecipient.jid.toString(),
      recipientType: targetRecipient.recipientType,
      messageStoreId: (targetRecipient as any).messageStore?.storeId, // Log storeId
      messageId: message.id,
      storeSize: messageStore.messages.length,
    });

    if (message.direction === Direction.in) {
      this.logService.debug(
        `Incoming message for ${targetRecipient.jid.toString()}, storeId: ${(targetRecipient as any).messageStore?.storeId}`
      ); // Log storeId
      this.messageReceivedSubject.next(targetRecipient);
    }
    this.messageSubject.next(targetRecipient); // This updates the general message stream
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
    const room = this.matrixClient.getRoom(recipient.jid.toString());
    if (!room) return;

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
    const room = this.matrixClient.getRoom(recipient.jid.toString());
    if (!room) return;

    const timeline = room.getLiveTimeline();
    const events = timeline.getEvents();
    if (events.length === 0) return;

    // Matrix loads recent messages automatically
  }

  getContactMessageState(message: Message, _recipientJid: string): MessageState {
    return message.state || MessageState.SENT;
  }
}

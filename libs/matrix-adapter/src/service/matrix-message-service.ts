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
  runInZone
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
  private readonly messageStores = new Map<string, MessageStore>();
  private readonly roomStore = new Map<string, Room>();
  private readonly logService: Log;
  private client!: sdk.MatrixClient;

  readonly messageReceived$: Observable<Recipient>;
  readonly messageSent$: Observable<Recipient>;
  readonly message$: Observable<Recipient>;
  readonly jidToUnreadCount$: Observable<JidToNumber>;
  readonly unreadMessageCountSum$: Observable<number>;

  constructor(zone: NgZone, logService: Log) {
    this.logService = logService;
    this.messageReceived$ = this.messageReceivedSubject.asObservable().pipe(runInZone(zone));
    this.messageSent$ = this.messageSentSubject.asObservable();
    this.message$ = this.messageSubject.asObservable();
    this.jidToUnreadCount$ = this.jidToUnreadCountSubject.asObservable();
    this.unreadMessageCountSum$ = this.unreadMessageCountSumSubject.asObservable();
  }

  private getOrCreateMessageStore(recipient: Recipient): MessageStore {
    const key = recipient.jid.bare().toString();
    let store = this.messageStores.get(key);
    if (!store) {
      store = new MessageStore();
      this.messageStores.set(key, store);
    }
    return store;
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
    const dmRoom = rooms.find(r => {
      const isDirect = r.getDMInviter() !== null;
      const members = r.getJoinedMembers();
      return isDirect && members.length === 2 && members.some(m => m.userId === matrixUserId);
    });

    if (dmRoom) {
      return dmRoom;
    }

    try {
      // Create new DM room
      const result = await this.client.createRoom({
        preset: sdk.Preset.PrivateChat,
        invite: [matrixUserId],
        is_direct: true
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

  async sendMessage(recipient: Recipient, messageBody: string): Promise<void> {
    if (!this.client) {
      throw new Error('Matrix client not initialized');
    }

    try {
      // Get or create the room for this recipient
      const room = await this.getOrCreateRoomForRecipient(recipient);
      
      // Send the message
      const sendResult = await this.client.sendTextMessage(room.roomId, messageBody);

      // Create a new message object
      const newMessage: Message = {
        body: messageBody,
        datetime: new Date(),
        direction: Direction.out,
        id: sendResult.event_id,
        from: parseJid(this.client.getUserId() || ''),
        delayed: false,
        fromArchive: false,
        state: MessageState.SENT
      };

      // Get the message store for this recipient
      const messageStore = this.getOrCreateMessageStore(recipient);
      messageStore.addMessage(newMessage);

      // Get or create room for recipient
      const roomObj = this.getOrCreateRoom(room.roomId, room.name);

      // Update subjects
      this.messageSentSubject.next(roomObj);
      this.messageSubject.next(roomObj);

      this.logService.debug('Message sent successfully:', {
        roomId: room.roomId,
        messageId: sendResult.event_id,
        body: messageBody
      });

    } catch (error: any) {
      this.logService.error('Error sending Matrix message:', error);
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
      room = new Room(
        this.logService,
        parseJid(roomId),
        roomName
      );
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

  private handleMatrixMessage(event: sdk.MatrixEvent, roomId: string): void {
    const room = this.client.getRoom(roomId);
    if (!room) {
      this.logService.warn(`Room ${roomId} not found for message event`);
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
      sender,
      content,
      eventId,
      timestamp,
    });

    // Get or create room for recipient
    const recipient = this.getOrCreateRoom(roomId, room.name);
    
    // Get message body based on content type
    const messageBody =
      content.msgtype === 'm.text'
        ? content['body']
        : content.msgtype === 'm.image'
          ? '[Image]'
          : content.msgtype === 'm.file'
            ? '[File]'
            : '[Unsupported message type]';

    // Skip if no message body
    if (!messageBody) {
      this.logService.warn('Empty message body:', content);
      return;
    }

    // Create message object
    const message: Message = {
      body: messageBody,
      direction: sender === this.client.getUserId() ? Direction.out : Direction.in,
      datetime: new Date(timestamp),
      state: MessageState.RECIPIENT_RECEIVED,
      id: eventId,
      delayed: false,
      fromArchive: false,
      from: parseJid(sender)
    };

    this.logService.debug('Created message object:', message);

    // Add message to store
    const messageStore = this.getOrCreateMessageStore(recipient);
    messageStore.addMessage(message);

    this.logService.debug('Message added to store:', {
      recipientId: recipient.jid.toString(),
      messageBody: message.body,
      messageId: message.id,
      storeSize: messageStore.messages.length
    });

    // Update subjects
    if (message.direction === Direction.in) {
      this.messageReceivedSubject.next(recipient);
    }
    this.messageSubject.next(recipient);
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

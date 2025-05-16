import { BehaviorSubject, Observable, Subject } from 'rxjs';
import {
  Direction,
  JidToNumber,
  Message,
  MessageService,
  MessageState,
  Recipient,
  Room,
  Log,
  LogLevel,
} from '@pazznetwork/ngx-chat-shared';
import * as sdk from 'matrix-js-sdk';
import { RoomEvent } from 'matrix-js-sdk';
import {  parseJid } from '@pazznetwork/ngx-chat-shared';

export class MatrixMessageService implements MessageService {
  private readonly messageReceivedSubject = new Subject<Recipient>();
  private readonly messageSentSubject = new Subject<Recipient>();
  private readonly messageSubject = new BehaviorSubject<Recipient>(null as any);
  private readonly jidToUnreadCountSubject = new BehaviorSubject<JidToNumber>(new Map());
  private readonly unreadMessageCountSumSubject = new BehaviorSubject<number>(0);
  private client!: sdk.MatrixClient;
  private logService: Log;

  readonly jidToUnreadCount$: Observable<JidToNumber>;
  readonly message$: Observable<Recipient>;
  readonly unreadMessageCountSum$: Observable<number>;
  readonly messageSent$: Observable<Recipient>;
  readonly messageReceived$: Observable<Recipient>;

  constructor() {
    this.messageSent$ = this.messageSentSubject.asObservable();
    this.messageReceived$ = this.messageReceivedSubject.asObservable();
    this.message$ = this.messageSubject.asObservable();
    this.jidToUnreadCount$ = this.jidToUnreadCountSubject.asObservable();
    this.unreadMessageCountSum$ = this.unreadMessageCountSumSubject.asObservable();

    // Create a basic log service
    this.logService = {
      logLevel: LogLevel.Info,
      writer: console,
      messagePrefix: () => 'MatrixMessageService:',
      error: (...messages: unknown[]) => {
        if (this.logService.logLevel >= LogLevel.Error) {
          this.logService.writer.error(this.logService.messagePrefix(), ...messages);
        }
      },
      warn: (...messages: unknown[]) => {
        if (this.logService.logLevel >= LogLevel.Warn) {
          this.logService.writer.warn(this.logService.messagePrefix(), ...messages);
        }
      },
      info: (...messages: unknown[]) => {
        if (this.logService.logLevel >= LogLevel.Info) {
          this.logService.writer.info(this.logService.messagePrefix(), ...messages);
        }
      },
      debug: (...messages: unknown[]) => {
        if (this.logService.logLevel >= LogLevel.Debug) {
          this.logService.writer.debug(this.logService.messagePrefix(), ...messages);
        }
      }
    };
  }

  setClient(client: sdk.MatrixClient) {
    this.client = client;
    this.setupMessageHandlers();
  }

  private get matrixClient(): sdk.MatrixClient {
    if (!this.client) throw new Error('Not logged in');
    return this.client;
  }

  private setupMessageHandlers() {
    this.matrixClient.on(RoomEvent.Timeline, (event: any, room: any) => {
      if (event.getType() === 'm.room.message') {
        const sender = event.getSender();
        const content = event.getContent();
        const roomId = room.roomId;

        // Create or get recipient
        const recipient = new Room(
          this.logService,
          parseJid(roomId),
          room.name
        );

        const message: Message = {
          body: content.body,
          direction: sender === this.matrixClient.getUserId() ? Direction.out : Direction.in,
          datetime: new Date(event.getTs()),
          state: MessageState.RECIPIENT_RECEIVED,
          id: event.getId(),
          delayed: false,
          fromArchive: false,
        };

        recipient.messageStore.addMessage(message);
        this.messageReceivedSubject.next(recipient);
        this.messageSubject.next(recipient);

        // Update unread count
        if (message.direction === Direction.in) {
          const currentCount = this.jidToUnreadCountSubject.getValue().get(roomId) || 0;
          const newCount = currentCount + 1;
          const newMap = new Map(this.jidToUnreadCountSubject.getValue());
          newMap.set(roomId, newCount);
          this.jidToUnreadCountSubject.next(newMap);
          this.unreadMessageCountSumSubject.next(
            Array.from(newMap.values()).reduce((sum, count) => sum + count, 0)
          );
        }
      }
    });
  }

  async sendMessage(recipient: Recipient, body: string): Promise<void> {
    const message: Message = {
      body,
      direction: Direction.out,
      datetime: new Date(),
      state: MessageState.SENT,
      id: Date.now().toString(), // Temporary ID
      delayed: false,
      fromArchive: false,
    };

    // Send message to Matrix
    const response = await this.matrixClient.sendTextMessage(recipient.jid.toString(), body);
    message.id = response.event_id;

    recipient.messageStore.addMessage(message);
    this.messageSentSubject.next(recipient);
    this.messageSubject.next(recipient);
  }

  async loadCompleteHistory(): Promise<void> {
    // Matrix handles message history automatically through the timeline
  }

  async loadMessagesBeforeOldestMessage(recipient: Recipient): Promise<void> {
    const room = this.matrixClient.getRoom(recipient.jid.toString());
    if (!room) return;

    const timeline = room.getLiveTimeline();
    const events = timeline.getEvents();
    if (events.length === 0) return;

    await this.matrixClient.scrollback(room, 50);
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

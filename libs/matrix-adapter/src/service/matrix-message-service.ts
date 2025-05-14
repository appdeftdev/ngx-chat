import { BehaviorSubject, Observable, Subject } from 'rxjs';
import {
  Direction,
  JidToNumber,
  Message,
  MessageService,
  MessageState,
  OpenChatsService,
  Recipient,
} from '@pazznetwork/ngx-chat-shared';
import { MatrixService } from '../matrix.service';

export class MatrixMessageService implements MessageService {
  private readonly messageReceivedSubject = new Subject<Recipient>();
  private readonly messageSentSubject = new Subject<Recipient>();
  readonly jidToUnreadCount$: Observable<JidToNumber>;
  readonly message$: Observable<Recipient>;
  readonly unreadMessageCountSum$: Observable<number>;

  readonly messageSent$: Observable<Recipient>;
  readonly messageReceived$: Observable<Recipient>;

  constructor(
    private readonly chatService: MatrixService,
    private readonly openChatsService: OpenChatsService
  ) {
    // Initialize observables
    this.messageSent$ = this.messageSentSubject.asObservable();
    this.messageReceived$ = this.messageReceivedSubject.asObservable();

    // Implement other logic for message handling
    this.message$ = new BehaviorSubject<Recipient>(null as any).asObservable();
    // Fix: Initialize with a Map instead of an object literal
    this.jidToUnreadCount$ = new BehaviorSubject<JidToNumber>(
      new Map<string, number>()
    ).asObservable();
    this.unreadMessageCountSum$ = new BehaviorSubject<number>(0).asObservable();
  }
  loadCompleteHistory(): Promise<void> {
    throw new Error('Method not implemented.');
  }
  loadMessagesBeforeOldestMessage(recipient: Recipient): Promise<void> {
    throw new Error('Method not implemented.');
  }
  loadMostRecentMessages(recipient: Recipient): Promise<void> {
    throw new Error('Method not implemented.');
  }

  async sendMessage(recipient: Recipient, body: string): Promise<void> {
    // Implement Matrix message sending logic
    const message: Message = {
      body,
      direction: Direction.out,
      datetime: new Date(),
      state: MessageState.SENT,
      id: '',
      delayed: false,
      fromArchive: false,
    };

    recipient.messageStore.addMessage(message);
    this.messageSentSubject.next(recipient);
  }

  getContactMessageState(message: Message, recipientJid: string): MessageState {
    return message.state || MessageState.SENT;
  }
}

// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  ChangeDetectionStrategy,
  Component,
  Inject,
  Input,
  OnDestroy,
  OnInit,
  NgZone, // Import NgZone
} from '@angular/core';
import { distinctUntilChanged, map, Observable } from 'rxjs';
import {
  ChatService,
  Contact,
  OpenChatsService,
  Recipient,
  Room,
  Log,
  LOG_SERVICE_TOKEN,
  runInZone, // Import runInZone
  Message, // Import Message for strong typing
} from '@pazznetwork/ngx-chat-shared';
import { CommonModule } from '@angular/common';
import { ChatMessageEmptyComponent } from '../chat-message-empty';
import { ChatMessageContactRequestComponent } from '../chat-message-contact-request';
import { CHAT_SERVICE_TOKEN, OPEN_CHAT_SERVICE_TOKEN } from '@pazznetwork/ngx-xmpp';
import { ChatHistoryAutoScrollComponent } from '../chat-history-auto-scroll';
import { ChatHistoryMessagesContactComponent } from '../chat-history-messages-contact';
import { ChatHistoryMessagesRoomComponent } from '../chat-history-messages-room';

@Component({
  imports: [
    CommonModule,
    ChatMessageEmptyComponent,
    ChatMessageContactRequestComponent,
    ChatHistoryAutoScrollComponent,
    ChatHistoryMessagesContactComponent,
    ChatHistoryMessagesRoomComponent,
  ],
  selector: 'ngx-chat-history',
  templateUrl: './chat-history.component.html',
  styleUrls: ['./chat-history.component.less'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatHistoryComponent implements OnDestroy, OnInit {
  currentRecipient?: Recipient;

  ngOnInit() {
    this.logService.debug('ChatHistoryComponent initialized');
  }

  @Input()
  set recipient(value: Recipient | undefined) {
    this.logService.debug('Setting recipient in ChatHistory:', {
      recipientId: value?.jid?.toString(),
      recipientType: value?.recipientType,
      hasMessageStore: !!value?.messageStore,
      messageStoreId: (value as any)?.messageStore?.storeId, // Log storeId
    });

    if (!value) {
      throw new Error('ChatHistoryComponent: recipient was null or undefined');
    }

    this.currentRecipient = value;

    // Ensure message store exists
    if (!value.messageStore) {
      this.logService.error('Recipient has no message store:', {
        recipientId: value.jid.toString(),
        recipientType: value.recipientType,
      });
      return;
    }

    // Subscribe to messages with enhanced debugging
    this.noMessages$ = value.messageStore.messages$.pipe(
      runInZone(this.ngZone), // Ensure emissions run in Angular's zone
      map((messages: Message[]) => {
        this.logService.debug('Messages updated in chat history (in zone):', {
          count: messages.length,
          recipientId: value.jid.toString(),
          messageIds: messages.map((m) => m.id),
          messages: messages.map((m) => ({
            id: m.id,
            body: m.body?.substring(0, 30),
            direction: m.direction,
            datetime: m.datetime?.toISOString(),
            from: m.from?.toString()
          }))
        });
        
        // Force change detection
        setTimeout(() => {
          this.logService.debug('Triggering change detection for messages:', messages.length);
        }, 0);
        
        return messages.length === 0;
      }),
      distinctUntilChanged()
    );

    // Also subscribe directly to the message store for logging
    value.messageStore.messages$.subscribe((messages) => {
      this.logService.debug('Direct message store subscription triggered:', {
        recipientId: value.jid.toString(),
        messageCount: messages.length,
        storeId: (value.messageStore as any).storeId,
      });
    });

    // Force initial load of messages
    this.loadMessagesOnScrollToTop();
    // the unread count plugin relies on this call
    this.openChatsService.viewedChatMessages(this.currentRecipient);
  }

  @Input()
  sender?: Contact;

  @Input()
  pendingRequestContact?: Contact;

  @Input()
  showAvatars = true;

  @Input()
  maxHeight = 'none';

  @Input()
  pendingRequest$!: Observable<boolean>;

  noMessages$!: Observable<boolean>;

  constructor(
    @Inject(CHAT_SERVICE_TOKEN) private readonly chatService: ChatService,
    @Inject(OPEN_CHAT_SERVICE_TOKEN) private readonly openChatsService: OpenChatsService,
    @Inject(LOG_SERVICE_TOKEN) private readonly logService: Log,
    private readonly ngZone: NgZone // Inject NgZone
  ) {
    this.logService.debug('ChatHistoryComponent created');
  }

  ngOnDestroy(): void {
    if (!this.currentRecipient) {
      throw new Error('ChatHistoryComponent: recipient was null or undefined');
    }
    this.logService.debug('ChatHistoryComponent destroyed');
  }

  isContact(recipient: Recipient | undefined): boolean {
    if (!recipient) {
      return false;
    }
    const isContact = recipient.recipientType === 'contact';
    this.logService.debug('Checking if recipient is contact:', {
      recipientId: recipient.jid.toString(),
      recipientType: recipient.recipientType,
      isContact,
    });
    return isContact;
  }

  scheduleLoadMessages(): void {
    if (this.currentRecipient) {
      this.logService.debug('Loading more messages for recipient:', {
        recipientId: this.currentRecipient.jid.toString(),
        recipientType: this.currentRecipient.recipientType,
      });
      void this.chatService.messageService.loadMessagesBeforeOldestMessage(this.currentRecipient);
    }
  }

  private loadMessagesOnScrollToTop(): void {
    if (this.currentRecipient) {
      this.logService.debug('Loading most recent messages for recipient:', {
        recipientId: this.currentRecipient.jid.toString(),
        recipientType: this.currentRecipient.recipientType,
      });
      void this.chatService.messageService.loadMostRecentMessages(this.currentRecipient);
    }
  }

  asContact(recipient: Recipient | undefined): Contact | undefined {
    const contact = recipient instanceof Contact ? recipient : undefined;
    this.logService.debug('Converting recipient to contact:', {
      recipientId: recipient?.jid.toString(),
      isContact: !!contact,
    });
    return contact;
  }

  asRoom(recipient: Recipient | undefined): Room {
    return recipient as Room;
  }
}

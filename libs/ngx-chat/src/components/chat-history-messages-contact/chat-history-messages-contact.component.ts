// SPDX-License-Identifier: AGPL-3.0-or-later
import { Component, Inject, Input, OnInit } from '@angular/core';
import { map, Observable } from 'rxjs';
import type { ChatService } from '@pazznetwork/ngx-chat-shared';
import { Contact, Direction, Message, Log, LOG_SERVICE_TOKEN } from '@pazznetwork/ngx-chat-shared';
import { ChatMessageInComponent } from '../chat-message-in';
import { CommonModule } from '@angular/common';
import { ChatMessageOutComponent } from '../chat-message-out';
import { CHAT_SERVICE_TOKEN } from '@pazznetwork/ngx-xmpp';

@Component({
    imports: [CommonModule, ChatMessageInComponent, ChatMessageOutComponent],
    selector: 'ngx-chat-history-messages-contact',
    templateUrl: './chat-history-messages-contact.component.html',
    styleUrls: ['./chat-history-messages-contact.component.less']
})
export class ChatHistoryMessagesContactComponent implements OnInit {
  @Input()
  contact?: Contact;

  @Input()
  set messages$(value$: Observable<Message[]> | undefined) {
    this.logService.debug('Setting messages$ in ChatHistoryMessagesContact:', {
      hasObservable: !!value$,
      contactId: this.contact?.jid.toString()
    });

    if (value$ == null) {
      throw new Error('ngx-chat-history-messages-contact: messages$ input is null or undefined');
    }

    // Subscribe to raw messages for debugging
    value$.subscribe(messages => {
      this.logService.debug('Raw messages received:', {
        count: messages.length,
        contactId: this.contact?.jid.toString(),
        messages: messages.map(m => ({
          id: m.id,
          body: m.body?.substring(0, 50),
          direction: m.direction,
          datetime: m.datetime,
          from: m.from?.toString()
        }))
      });
    });

    this.messagesGroupedByDate$ = value$.pipe(
      map((messages) => {
        this.logService.debug('Processing messages in contact component:', {
          count: messages.length,
          contactId: this.contact?.jid.toString(),
          messages: messages.map(m => ({
            id: m.id,
            body: m.body?.substring(0, 50),
            direction: m.direction,
            datetime: m.datetime,
            from: m.from?.toString()
          }))
        });

        if (messages.length === 0) {
          this.logService.debug('No messages to display');
          return [];
        }

        // Sort messages by date in ascending order (oldest to newest)
        const sortedMessages = [...messages].sort((a, b) => {
          const aTime = a?.datetime?.getTime() || 0;
          const bTime = b?.datetime?.getTime() || 0;
          return aTime - bTime;
        });

        this.logService.debug('Messages sorted by date:', {
          count: sortedMessages.length,
          firstMessage: sortedMessages[0]?.datetime,
          lastMessage: sortedMessages[sortedMessages.length - 1]?.datetime
        });

        // Group messages by date
        const messageMap = new Map<string, Message[]>();
        for (const message of sortedMessages) {
          if (!message.datetime) {
            this.logService.warn('Message has no datetime:', {
              messageId: message.id,
              body: message.body?.substring(0, 50)
            });
            continue;
          }
          if (!message.body) {
            this.logService.warn('Message has no body:', {
              messageId: message.id,
              datetime: message.datetime
            });
            continue;
          }
          if (!message.direction) {
            this.logService.warn('Message has no direction:', {
              messageId: message.id,
              body: message.body?.substring(0, 50),
              datetime: message.datetime
            });
            continue;
          }

          const key = message.datetime.toDateString();
          const existingMessages = messageMap.get(key) || [];
          existingMessages.push(message);
          messageMap.set(key, existingMessages);
        }

        // Convert map to array and sort dates in ascending order
        const returnArray = Array.from(messageMap.entries()).map(([key, mapMessages]) => ({
          date: new Date(key),
          messages: mapMessages
        }));

        // Sort date groups in ascending order
        returnArray.sort((a, b) => a.date.getTime() - b.date.getTime());

        this.logService.debug('Grouped messages by date:', {
          groupCount: returnArray.length,
          groups: returnArray.map(g => ({
            date: g.date,
            messageCount: g.messages.length,
            firstMessage: g.messages[0]?.datetime,
            lastMessage: g.messages[g.messages.length - 1]?.datetime
          }))
        });

        return returnArray;
      })
    );

    // Subscribe to debug message updates
    this.messagesGroupedByDate$?.subscribe(groups => {
      this.logService.debug('Messages grouped by date updated:', {
        groupCount: groups.length,
        totalMessages: groups.reduce((sum, g) => sum + g.messages.length, 0),
        groups: groups.map(g => ({
          date: g.date,
          messageCount: g.messages.length
        }))
      });
    });
  }

  @Input()
  showAvatars = true;

  messagesGroupedByDate$?: Observable<{ date: Date; messages: Message[] }[]>;
  Direction = Direction;

  constructor(
    @Inject(CHAT_SERVICE_TOKEN) public chatService: ChatService,
    @Inject(LOG_SERVICE_TOKEN) private readonly logService: Log
  ) {
    this.logService.debug('ChatHistoryMessagesContactComponent created');
  }

  ngOnInit() {
    this.logService.debug('ChatHistoryMessagesContactComponent initialized:', {
      hasContact: !!this.contact,
      contactId: this.contact?.jid.toString(),
      hasMessages$: !!this.messagesGroupedByDate$
    });
  }

  trackByIndex(index: number): number {
    return index;
  }

  trackByMessage(_index: number, message: Message): string {
    return message.id;
  }

  // Debug method to check message direction
  isIncomingMessage(message: Message): boolean {
    if (!message) {
      this.logService.warn('Attempted to check direction of undefined message');
      return false;
    }
    const isIncoming = message.direction === Direction.in;
    this.logService.debug('Checking message direction:', {
      messageId: message.id,
      body: message.body?.substring(0, 50),
      direction: message.direction,
      isIncoming,
      from: message.from?.toString()
    });
    return isIncoming;
  }

  // Debug method to check message direction
  isOutgoingMessage(message: Message): boolean {
    if (!message) {
      this.logService.warn('Attempted to check direction of undefined message');
      return false;
    }
    const isOutgoing = message.direction === Direction.out;
    this.logService.debug('Checking message direction:', {
      messageId: message.id,
      body: message.body?.substring(0, 50),
      direction: message.direction,
      isOutgoing,
      from: message.from?.toString()
    });
    return isOutgoing;
  }
}

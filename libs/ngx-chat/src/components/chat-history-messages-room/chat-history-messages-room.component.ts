// SPDX-License-Identifier: AGPL-3.0-or-later
import { ChangeDetectionStrategy, Component, Inject, Input, NgZone } from '@angular/core';
import { mergeMap, Observable, distinctUntilChanged, map } from 'rxjs';
import {
  ChatService,
  Contact,
  ContactSubscription,
  CustomContactFactory,
  Direction,
  Message,
  runInZone,
} from '@pazznetwork/ngx-chat-shared';
import { ChatMessageInComponent } from '../chat-message-in';
import { CommonModule } from '@angular/common';
import { ChatMessageOutComponent } from '../chat-message-out';
import { CHAT_SERVICE_TOKEN, CUSTOM_CONTACT_FACTORY_TOKEN } from '@pazznetwork/ngx-xmpp';

@Component({
    imports: [CommonModule, ChatMessageInComponent, ChatMessageOutComponent],
    selector: 'ngx-chat-history-messages-room',
    templateUrl: './chat-history-messages-room.component.html',
    styleUrls: ['./chat-history-messages-room.component.less'],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class ChatHistoryMessagesRoomComponent {
  @Input()
  set messages$(value$: Observable<Message[]> | undefined) {
    if (value$ == null) {
      throw new Error('ngx-chat-history-messages-room: messages$ input is null or undefined');
    }

    this.messagesGroupedByDate$ = value$.pipe(
      distinctUntilChanged((prev, curr) => {
        // Compare message arrays by their IDs and timestamps
        if (!prev || !curr || prev.length !== curr.length) return false;
        return prev.every((msg, idx) => {
          const currMsg = curr[idx];
          if (!msg || !currMsg) return false;
          if (!msg.datetime || !currMsg.datetime) return false;
          return msg.id === currMsg.id && 
                 msg.datetime.getTime() === currMsg.datetime.getTime();
        });
      }),
      mergeMap(async (messages) => {
        console.debug('Processing messages:', messages); // Debug log

        // Create a new array to ensure change detection
        const sortedMessages = [...messages].sort((a, b) => {
          if (!a?.datetime || !b?.datetime) return 0;
          return a.datetime.getTime() - b.datetime.getTime();
        });
        
        const messageMap = new Map<string, { message: Message; contact: Contact }[]>();
        
        // Pre-fetch contacts for all messages in parallel
        const contactPromises = sortedMessages.map(async (message) => {
          if (!message.from) {
            console.warn('Message missing from field:', message); // Debug log
            throw new Error('message.from is undefined');
          }
          const contact = await this.customContactFactory.create(
            message.from.toString(),
            message.from?.local?.toString() ?? '',
            undefined,
            ContactSubscription.none
          );
          console.debug('Created contact for message:', { messageId: message.id, contact }); // Debug log
          return { message, contact };
        });

        // Wait for all contacts to be fetched
        const messagesWithContacts = await Promise.all(contactPromises);

        // Group messages by date with their contacts
        messagesWithContacts.forEach(({ message, contact }) => {
          if (!message || !message.datetime) {
            console.warn('Invalid message:', message);
            return;
          }

          const key = message.datetime.toDateString();
          if (messageMap.has(key)) {
            messageMap.get(key)?.push({ message, contact });
          } else {
            messageMap.set(key, [{ message, contact }]);
          }
        });

        // Convert map to array and sort by date
        const returnArray = Array.from(messageMap.entries())
          .map(([key, messages]) => ({
            date: new Date(key),
            messagesWithContact: messages
          }))
          .sort((a, b) => a.date.getTime() - b.date.getTime());

        console.debug('Processed message groups:', returnArray); // Debug log
        return returnArray;
      }),
      map(groups => {
        // Force new reference for change detection
        return [...groups];
      }),
      runInZone(this.zone)
    );
  }

  @Input()
  showAvatars = true;

  messagesGroupedByDate$?: Observable<
    { date: Date; messagesWithContact: { message: Message; contact: Contact }[] }[]
  >;
  Direction = Direction;

  constructor(
    @Inject(CHAT_SERVICE_TOKEN) public chatService: ChatService,
    @Inject(CUSTOM_CONTACT_FACTORY_TOKEN)
    private readonly customContactFactory: CustomContactFactory,
    private zone: NgZone
  ) {}

  trackByIndex(index: number): number {
    return index;
  }

  getNickFromContact(contact: Contact): string | undefined {
    const nick = contact.name ?? contact.jid.resource;
    console.debug('Getting nick for contact:', { contact, nick }); // Debug log
    return nick;
  }
}

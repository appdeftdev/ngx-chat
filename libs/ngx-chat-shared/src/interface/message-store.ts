// SPDX-License-Identifier: AGPL-3.0-or-later
import { ReplaySubject, startWith } from 'rxjs';
import { Direction, type Message } from './message';
import { findLast } from '../utils-array';

export class MessageStore {
  readonly messages: Message[] = [];
  private readonly messagesSubject = new ReplaySubject<Message[]>(50);
  readonly messages$ = this.messagesSubject.pipe(startWith([]));
  readonly messageIdToMessage = new Map<string, Message>();

  constructor() {
    // Initial debug log
    console.debug('MessageStore created');
    this.messages$.subscribe(messages => {
      console.debug('MessageStore messages updated:', {
        count: messages.length,
        messages: messages
      });
    });
  }

  get oldestMessage(): Message | undefined {
    return this.messages[0];
  }

  get mostRecentMessage(): Message | undefined {
    return this.messages[this.messages.length - 1];
  }

  get mostRecentMessageReceived(): Message | undefined {
    return findLast(this.messages, (msg) => msg.direction === Direction.in);
  }

  get mostRecentMessageSent(): Message | undefined {
    return findLast(this.messages, (msg) => msg.direction === Direction.out);
  }

  addMessage(message: Message): void {
    if (!message || !message.id) {
      console.warn('Attempted to add invalid message:', message);
      return;
    }

    console.debug('Adding message to store:', {
      id: message.id,
      body: message.body,
      direction: message.direction,
      datetime: message.datetime
    });

    // Always create a new message object to ensure change detection
    const newMessage = { ...message };

    if (this.messageIdToMessage.has(newMessage.id)) {
      // Update existing message if newer
      const existingMessage = this.messageIdToMessage.get(newMessage.id);
      if (existingMessage && newMessage.datetime > existingMessage.datetime) {
        const index = this.messages.indexOf(existingMessage);
        if (index !== -1) {
          console.debug('Updating existing message:', {
            id: newMessage.id,
            oldDate: existingMessage.datetime,
            newDate: newMessage.datetime
          });
          this.messages[index] = newMessage;
          this.messageIdToMessage.set(newMessage.id, newMessage);
          this.emitMessages();
        }
      }
      return;
    }

    // Insert new message in correct chronological order
    let inserted = false;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const currentMessage = this.messages[i];
      if (!currentMessage) continue;
      
      const currentDateTime = currentMessage.datetime?.getTime();
      const newDateTime = newMessage.datetime?.getTime();
      
      if (currentDateTime && newDateTime && currentDateTime <= newDateTime) {
        console.debug('Inserting message at index:', {
          index: i + 1,
          id: newMessage.id,
          datetime: newMessage.datetime
        });
        this.messages.splice(i + 1, 0, newMessage);
        inserted = true;
        break;
      }
    }

    if (!inserted) {
      console.debug('Adding message at start:', {
        id: newMessage.id,
        datetime: newMessage.datetime
      });
      this.messages.unshift(newMessage);
    }

    this.messageIdToMessage.set(newMessage.id, newMessage);
    this.emitMessages();
  }

  private emitMessages(): void {
    // Create a new array reference to ensure change detection
    const messagesCopy = [...this.messages];
    console.debug('Emitting messages:', {
      count: messagesCopy.length,
      messages: messagesCopy.map(m => ({
        id: m.id,
        body: m.body,
        direction: m.direction,
        datetime: m.datetime
      }))
    });
    this.messagesSubject.next(messagesCopy);
  }
}

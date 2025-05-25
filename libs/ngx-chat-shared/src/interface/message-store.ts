// SPDX-License-Identifier: AGPL-3.0-or-later
import { ReplaySubject, startWith } from 'rxjs';
import { Direction, type Message } from './message';
import { findLast } from '../utils-array';

export class MessageStore {
  readonly messages: Message[] = [];
  private readonly messagesSubject = new ReplaySubject<Message[]>(50);
  readonly messages$ = this.messagesSubject.pipe(startWith([]));
  readonly messageIdToMessage = new Map<string, Message>();
  public readonly storeId: string; // Debug ID
  private readonly logService: {
    debug: (...args: any[]) => void;
    warn: (...args: any[]) => void;
    error: (...args: any[]) => void;
  };

  constructor(logService?: any) {
    // Optional logService
    this.storeId = Math.random().toString(36).substring(2, 15);
    if (logService && typeof logService.debug === 'function') {
      this.logService = logService;
    } else {
      this.logService = {
        debug: (...args) => console.debug(`[MessageStore ${this.storeId}]`, ...args),
        warn: (...args) => console.warn(`[MessageStore ${this.storeId}]`, ...args),
        error: (...args) => console.error(`[MessageStore ${this.storeId}]`, ...args),
      };
    }
    this.logService.debug(`MessageStore created`);
    this.messages$.subscribe((messages) => {
      this.logService.debug(`messages updated (subscribed):`, {
        count: messages.length,
        messageIds: messages.map((m) => m.id),
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

    this.logService.debug(`addMessage: Received message to add.`, {
      messageId: message.id,
      body: message.body?.substring(0, 30),
      direction: message.direction,
    });
    this.logService.debug(
      `addMessage: Current this.messages before add (IDs):`,
      this.messages.map((m) => m.id)
    );

    // Always create a new message object to ensure change detection
    const newMessage = { ...message };

    if (this.messageIdToMessage.has(newMessage.id)) {
      const existing = this.messageIdToMessage.get(newMessage.id);
      this.logService.warn(
        `addMessage: Message ID ${newMessage.id} already exists in messageIdToMessage.`,
        { existingMessage: existing, newMessage }
      );
      const existingMessageInArray = this.messages.find((m) => m.id === newMessage.id);
      if (existingMessageInArray && newMessage.datetime > existingMessageInArray.datetime) {
        const index = this.messages.indexOf(existingMessageInArray);
        if (index !== -1) {
          this.logService.debug(`Updating existing message in array due to newer datetime:`, {
            id: newMessage.id,
            oldDate: existingMessageInArray.datetime,
            newDate: newMessage.datetime,
          });
          this.messages[index] = newMessage;
          this.messageIdToMessage.set(newMessage.id, newMessage);
          this.emitMessages();
        }
      } else {
        this.logService.debug(
          `addMessage: Existing message ID ${newMessage.id} found, but not updating (e.g. not newer).`
        );
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
          datetime: newMessage.datetime,
        });
        this.messages.splice(i + 1, 0, newMessage);
        inserted = true;
        break;
      }
    }

    if (!inserted) {
      console.debug('Adding message at start:', {
        id: newMessage.id,
        datetime: newMessage.datetime,
      });
      this.messages.unshift(newMessage);
    }

    this.messageIdToMessage.set(newMessage.id, newMessage);
    this.logService.debug(
      `addMessage: Current this.messages after DIAGNOSTIC push (IDs):`,
      this.messages.map((m) => m.id)
    );
    this.emitMessages();
  }

  private emitMessages(): void {
    // Create a new array reference to ensure change detection
    const messagesCopy = [...this.messages];
    this.logService.debug(`Emitting messages:`, {
      count: messagesCopy.length,
      messageIds: messagesCopy.map((m) => m.id),
    });
    this.messagesSubject.next(messagesCopy);
  }
}

// SPDX-License-Identifier: AGPL-3.0-or-later
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Inject, Input, Optional } from '@angular/core';
import type { ChatService, Message, Recipient } from '@pazznetwork/ngx-chat-shared';
import { ChatContactClickHandler } from '@pazznetwork/ngx-chat-shared';
import { CommonModule } from '@angular/common';
import { ChatBubbleComponent } from '../chat-bubble';
import { ChatBubbleAvatarComponent } from '../chat-bubble-avatar';
import { ChatMessageTextAreaComponent } from '../chat-message-text-area';
import { ChatMessageImageComponent } from '../chat-message-image';
import { ChatBubbleFooterComponent } from '../chat-bubble-footer';
import { CHAT_SERVICE_TOKEN, CONTACT_CLICK_HANDLER_TOKEN } from '@pazznetwork/ngx-xmpp';
import { LOG_SERVICE_TOKEN, Log } from '@pazznetwork/ngx-chat-shared';

@Component({
    imports: [
        CommonModule,
        ChatBubbleComponent,
        ChatBubbleAvatarComponent,
        ChatMessageTextAreaComponent,
        ChatMessageImageComponent,
        ChatBubbleFooterComponent,
    ],
    selector: 'ngx-chat-message-in',
    templateUrl: './chat-message-in.component.html',
    styleUrls: ['./chat-message-in.component.less'],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class ChatMessageInComponent {
  private _message?: Message;
  private _contact?: Recipient;
  private _nick?: string;

  @Input()
  set message(value: Message | undefined) {
    if (this._message?.id !== value?.id || 
        this._message?.datetime?.getTime() !== value?.datetime?.getTime() ||
        this._message?.body !== value?.body) {
      this.logService.debug('Message updated in ChatMessageIn:', { 
        old: {
          id: this._message?.id,
          body: this._message?.body?.substring(0, 50),
          datetime: this._message?.datetime
        }, 
        new: {
          id: value?.id,
          body: value?.body?.substring(0, 50),
          datetime: value?.datetime
        }
      });
      this._message = value ? { ...value } : undefined;
      this.cdr.markForCheck();
    }
  }
  get message(): Message | undefined {
    return this._message;
  }

  @Input()
  set contact(value: Recipient | undefined) {
    if (this._contact?.jid?.toString() !== value?.jid?.toString()) {
      this.logService.debug('Contact updated in ChatMessageIn:', { 
        old: this._contact?.jid?.toString(), 
        new: value?.jid?.toString() 
      });
      this._contact = value;
      this.cdr.markForCheck();
    }
  }
  get contact(): Recipient | undefined {
    return this._contact;
  }

  @Input()
  showAvatar?: boolean;

  @Input()
  set nick(value: string | undefined) {
    if (this._nick !== value) {
      this.logService.debug('Nick updated in ChatMessageIn:', { 
        old: this._nick, 
        new: value 
      });
      this._nick = value;
      this.cdr.markForCheck();
    }
  }
  get nick(): string | undefined {
    return this._nick;
  }

  constructor(
    @Inject(CHAT_SERVICE_TOKEN) public chatService: ChatService,
    @Inject(CONTACT_CLICK_HANDLER_TOKEN)
    @Optional()
    public contactClickHandler: ChatContactClickHandler,
    @Inject(LOG_SERVICE_TOKEN) private readonly logService: Log,
    private readonly cdr: ChangeDetectorRef
  ) {
    this.logService.debug('ChatMessageInComponent created');
  }

  onContactClick(): void {
    if (!this.contact) {
      this.logService.warn('Contact click attempted but no contact available');
      return;
    }

    this.logService.debug('Contact clicked:', {
      contactId: this.contact.jid.toString()
    });
    this.contactClickHandler?.onClick(this.contact);
  }
}

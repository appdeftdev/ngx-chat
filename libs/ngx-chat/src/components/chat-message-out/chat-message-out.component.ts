// SPDX-License-Identifier: AGPL-3.0-or-later
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Inject, Input, OnInit } from '@angular/core';
import type { ChatService } from '@pazznetwork/ngx-chat-shared';
import { Contact, Message, MessageState, parseJid, Log, LOG_SERVICE_TOKEN } from '@pazznetwork/ngx-chat-shared';
import { CommonModule } from '@angular/common';
import { ChatBubbleComponent } from '../chat-bubble';
import { ChatBubbleAvatarComponent } from '../chat-bubble-avatar';
import { ChatMessageTextAreaComponent } from '../chat-message-text-area';
import { ChatMessageImageComponent } from '../chat-message-image';
import { ChatBubbleFooterComponent } from '../chat-bubble-footer';
import { ChatMessageStateIconComponent } from '../chat-message-state-icon';
import { CHAT_SERVICE_TOKEN } from '@pazznetwork/ngx-xmpp';
import { map, switchMap } from 'rxjs/operators';
import { Observable, of } from 'rxjs';

@Component({
    imports: [
        CommonModule,
        ChatBubbleComponent,
        ChatBubbleAvatarComponent,
        ChatMessageTextAreaComponent,
        ChatMessageImageComponent,
        ChatBubbleFooterComponent,
        ChatMessageStateIconComponent,
    ],
    selector: 'ngx-chat-message-out',
    templateUrl: './chat-message-out.component.html',
    styleUrls: ['./chat-message-out.component.less'],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class ChatMessageOutComponent implements OnInit {
  private _message?: Message;
  private _contact?: Contact;

  @Input()
  showAvatar = true;

  @Input()
  set message(value: Message | undefined) {
    if (this._message?.id !== value?.id || 
        this._message?.datetime?.getTime() !== value?.datetime?.getTime() ||
        this._message?.body !== value?.body) {
      this.logService.debug('Message updated in ChatMessageOut:', { 
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
  set contact(value: Contact | undefined) {
    if (this._contact?.jid?.toString() !== value?.jid?.toString()) {
      this.logService.debug('Contact updated in ChatMessageOut:', { 
        old: this._contact?.jid?.toString(), 
        new: value?.jid?.toString() 
      });
      this._contact = value;
      this.cdr.markForCheck();
    }
  }
  get contact(): Contact | undefined {
    return this._contact;
  }

  nick$?: Observable<string | undefined>;

  constructor(
    @Inject(CHAT_SERVICE_TOKEN) public chatService: ChatService,
    @Inject(LOG_SERVICE_TOKEN) private readonly logService: Log,
    private readonly cdr: ChangeDetectorRef
  ) {
    this.logService.debug('ChatMessageOutComponent created');
  }

  ngOnInit(): void {
    this.logService.debug('ChatMessageOutComponent initialized');
    this.nick$ = this.chatService.userName$.pipe(
      switchMap((userName) => {
        if (userName === '') {
          return this.chatService.userJid$.pipe(map((jid) => parseJid(jid).local));
        }
        return of(userName);
      })
    );

    // Log nick updates
    this.nick$.subscribe(nick => {
      this.logService.debug('Nick updated in ChatMessageOut:', { nick });
    });
  }

  // todo implement xmpp message state
  getMessageState(): MessageState {
    const state = MessageState.UNKNOWN;
    this.logService.debug('Message state:', {
      messageId: this._message?.id,
      state
    });
    return state;
  }
}

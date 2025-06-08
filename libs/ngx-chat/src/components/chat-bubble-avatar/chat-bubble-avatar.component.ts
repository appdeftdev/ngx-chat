// SPDX-License-Identifier: AGPL-3.0-or-later
import { Component, Input, Output } from '@angular/core';
import { ChatAvatarComponent } from '../chat-avatar';
import { CommonModule } from '@angular/common';
import { Subject } from 'rxjs';

@Component({
    imports: [CommonModule, ChatAvatarComponent],
    selector: 'ngx-chat-bubble-avatar',
    templateUrl: './chat-bubble-avatar.component.html',
    styleUrls: ['./chat-bubble-avatar.component.less']
})
export class ChatBubbleAvatarComponent {
  @Input()
  set avatar(value: string | undefined | null) {
    this._avatar = value;
    console.debug('ChatBubbleAvatar: avatar set to', value);
  }
  get avatar(): string | undefined | null {
    return this._avatar;
  }
  private _avatar: string | undefined | null;

  @Input()
  avatarClickable = false;

  @Input()
  set showAvatar(value: boolean | undefined) {
    this._showAvatar = value;
    console.debug('ChatBubbleAvatar: showAvatar set to', value);
  }
  get showAvatar(): boolean | undefined {
    return this._showAvatar;
  }
  private _showAvatar?: boolean;

  @Input() contactName?: string;
  @Input() contactId?: string;

  private clickedSubject = new Subject<void>();

  @Output()
  clicked$ = this.clickedSubject.asObservable();

  onContactClick(): void {
    if (!this.avatarClickable) {
      return;
    }

    this.clickedSubject.next();
  }
}

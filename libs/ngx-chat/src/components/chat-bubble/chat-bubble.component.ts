// SPDX-License-Identifier: AGPL-3.0-or-later
import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
    imports: [CommonModule],
    selector: 'ngx-chat-bubble',
    templateUrl: './chat-bubble.component.html',
    styleUrls: ['./chat-bubble.component.less']
})
export class ChatBubbleComponent implements OnInit {
  @Input()
  reverse = false;

  ngOnInit() {
    console.debug('ChatBubble initialized:', {
      reverse: this.reverse
    });
  }
}

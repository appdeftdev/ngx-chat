// SPDX-License-Identifier: AGPL-3.0-or-later
import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  standalone: true,
  imports: [CommonModule],
  selector: 'ngx-chat-bubble-footer',
  templateUrl: './chat-bubble-footer.component.html',
  styleUrls: ['./chat-bubble-footer.component.less'],
})
export class ChatBubbleFooterComponent {
  @Input()
  nick?: string;

  @Input()
  formattedDate?: string | null;
}

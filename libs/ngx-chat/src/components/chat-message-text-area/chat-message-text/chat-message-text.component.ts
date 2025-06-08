// SPDX-License-Identifier: AGPL-3.0-or-later
import { Component, Input } from '@angular/core';

@Component({
  standalone: true,
  selector: 'ngx-chat-message-text',
  template: `{{ normalizedText }}`,
  styles: [
    `
      :host {
        white-space: pre-line;
        word-wrap: break-word;
      }
    `,
  ],
})
export class ChatMessageTextComponent {
  @Input()
  set text(value: string | undefined) {
    this._text = value;
    this.normalizeText();
  }
  
  get text(): string | undefined {
    return this._text;
  }
  
  private _text?: string;
  normalizedText?: string;
  
  private normalizeText(): void {
    if (!this._text) {
      this.normalizedText = this._text;
      return;
    }
    
    // Normalize line breaks and remove excessive whitespace
    this.normalizedText = this._text
      .replace(/\r\n/g, '\n')     // Normalize Windows line endings
      .replace(/\r/g, '\n')       // Normalize Mac line endings
      .replace(/\n{3,}/g, '\n\n') // Replace 3+ consecutive newlines with 2
      .trim();                    // Remove leading/trailing whitespace
  }
}

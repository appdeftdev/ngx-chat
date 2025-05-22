// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Inject,
  Input,
  OnChanges,
  OnInit,
  SimpleChanges,
  ViewChild,
  ViewContainerRef,
} from '@angular/core';
import { extractUrls } from '@pazznetwork/ngx-chat-shared';
import { ChatMessageTextComponent } from './chat-message-text';
import { ChatMessageLinkComponent } from './chat-message-link';
import { CommonModule } from '@angular/common';
import { LOG_SERVICE_TOKEN, Log } from '@pazznetwork/ngx-chat-shared';

@Component({
    imports: [CommonModule],
    selector: 'ngx-chat-message-text-area',
    templateUrl: './chat-message-text-area.component.html',
    styleUrls: ['chat-message-text-area.component.less'],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class ChatMessageTextAreaComponent implements OnChanges, OnInit {
  private _textContent?: string;

  @Input()
  set textContent(value: string | undefined) {
    if (this._textContent !== value) {
      this.logService.debug('Text content changed:', {
        old: this._textContent?.substring(0, 50),
        new: value?.substring(0, 50),
        hasChanged: this._textContent !== value
      });
      this._textContent = value;
      this.transform();
      this.cdr.markForCheck();
    }
  }
  get textContent(): string | undefined {
    return this._textContent;
  }

  @ViewChild('textContainerRef', { read: ViewContainerRef, static: true })
  textContainerRef!: ViewContainerRef;

  constructor(
    @Inject(LOG_SERVICE_TOKEN) private readonly logService: Log,
    private readonly cdr: ChangeDetectorRef
  ) {
    this.logService.debug('ChatMessageTextArea created');
  }

  ngOnInit() {
    this.logService.debug('ChatMessageTextArea initialized:', {
      hasTextContent: !!this.textContent,
      textContent: this.textContent?.substring(0, 50)
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    this.logService.debug('ChatMessageTextArea changes:', {
      textContent: this.textContent?.substring(0, 50),
      hasTextContent: !!this.textContent,
      changes: Object.keys(changes).map(key => ({
        key,
        currentValue: changes[key]?.currentValue?.substring?.(0, 50),
        previousValue: changes[key]?.previousValue?.substring?.(0, 50),
        firstChange: changes[key]?.firstChange
      }))
    });
    
    if (changes['textContent']) {
      this.transform();
      this.cdr.markForCheck();
    }
  }

  private transform(): void {
    if (!this.textContent) {
      this.logService.debug('No text content to display');
      return;
    }

    this.logService.debug('Transforming message text:', {
      textContent: this.textContent.substring(0, 50),
      length: this.textContent.length
    });
    
    if (!this.textContainerRef) {
      this.logService.error('Text container reference is not available');
      return;
    }

    this.textContainerRef.clear();

    const message = this.textContent;
    const links = extractUrls(message);

    if (links.length === 0) {
      // If no links, just display the text directly
      const textComponent = this.textContainerRef.createComponent(ChatMessageTextComponent);
      textComponent.instance.text = message;
      this.logService.debug('Created text component:', {
        text: message.substring(0, 50),
        length: message.length
      });
      this.cdr.markForCheck();
      return;
    }

    let lastIndex = 0;
    for (const link of links) {
      const currentIndex = message.indexOf(link, lastIndex);

      const textBeforeLink = message.substring(lastIndex, currentIndex);
      if (textBeforeLink) {
        const textBeforeLinkComponent =
          this.textContainerRef.createComponent(ChatMessageTextComponent);
        textBeforeLinkComponent.instance.text = textBeforeLink;
        this.logService.debug('Created text component before link:', {
          text: textBeforeLink.substring(0, 50),
          length: textBeforeLink.length
        });
      }

      const linkRef = this.textContainerRef.createComponent(ChatMessageLinkComponent);
      linkRef.instance.link = link;
      linkRef.instance.text = this.shorten(link);
      this.logService.debug('Created link component:', {
        link,
        shortened: linkRef.instance.text
      });

      lastIndex = currentIndex + link.length;
    }

    const textAfterLastLink = message.substring(lastIndex);
    if (textAfterLastLink) {
      const textAfterLastLinkComponent =
        this.textContainerRef.createComponent(ChatMessageTextComponent);
      textAfterLastLinkComponent.instance.text = textAfterLastLink;
      this.logService.debug('Created text component after link:', {
        text: textAfterLastLink.substring(0, 50),
        length: textAfterLastLink.length
      });
    }
    
    this.cdr.markForCheck();
  }

  private shorten(url: string): string {
    const parser = document.createElement('a');
    parser.href = url;

    if (parser.href.length < 50) {
      return parser.href;
    }

    let shortenedPathname = parser.pathname;
    if (shortenedPathname.length > 17) {
      shortenedPathname =
        shortenedPathname.substring(0, 5) +
        '...' +
        shortenedPathname.substring(shortenedPathname.length - 10);
    }

    return parser.protocol + '//' + parser.host + shortenedPathname;
  }
}

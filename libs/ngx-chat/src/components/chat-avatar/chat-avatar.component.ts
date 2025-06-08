// SPDX-License-Identifier: AGPL-3.0-or-later
import { Component, Input, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
    imports: [CommonModule],
    selector: 'ngx-chat-avatar',
    templateUrl: './chat-avatar.component.html',
    styleUrls: ['./chat-avatar.component.less']
})
export class ChatAvatarComponent implements OnInit, OnDestroy {
  @Input()
  set imageUrl(value: string | undefined) {
    this._imageUrl = value;
    this.imageLoadError = false; // Reset error state when URL changes
    console.debug('ChatAvatar: imageUrl set to', value);
    
    // Validate URL if provided
    if (value && !this.isValidUrl(value)) {
      console.warn('ChatAvatar: Invalid URL provided:', value);
    }
    
    // Test if the image can be loaded
    if (value) {
      this.testImageLoad(value);
    }
    
    // Trigger change detection
    this.cdr.detectChanges();
  }
  get imageUrl(): string | undefined {
    return this._imageUrl;
  }
  private _imageUrl: string | undefined;

  @Input() contactName?: string; // Add contact name for generating initials
  @Input() contactId?: string; // Add contact ID for generating colors
  
  imageLoadError = false;
  
  // Default fallback avatar - a simple SVG user icon
  fallbackAvatar = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMzIiIGN5PSIzMiIgcj0iMzIiIGZpbGw9IiNlNWU2ZTgiLz4KPGNpcmNsZSBjeD0iMzIiIGN5PSIyNCIgcj0iMTAiIGZpbGw9IiNhZmI0YjgiLz4KPHBhdGggZD0iTTEyIDUyYzAtMTEuMDQ2IDguOTU0LTIwIDIwLTIwczIwIDguOTU0IDIwIDIwSDEyeiIgZmlsbD0iI2FmYjRiOCIvPgo8L3N2Zz4K';

  constructor(private cdr: ChangeDetectorRef) {}

  ngOnInit() {
    console.debug('ChatAvatar: component initialized with imageUrl', this.imageUrl);
  }

  ngOnDestroy() {
    // Clean up any pending image tests
  }

  get effectiveImageUrl(): string {
    if (this.imageLoadError || !this.imageUrl) {
      // Generate dynamic fallback based on contact info if available
      if (this.contactName || this.contactId) {
        return this.generateContactAvatar();
      }
      return this.fallbackAvatar;
    }
    return this.imageUrl;
  }

  private generateContactAvatar(): string {
    const name = this.contactName || this.contactId || 'User';
    const id = this.contactId || this.contactName || 'default';
    
    // Generate initials
    const initials = name
      .split(' ')
      .map(word => word.charAt(0).toUpperCase())
      .slice(0, 2)
      .join('');
    
    // Generate consistent color
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = id.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    const colors = [
      '0084ff', '44bec7', 'ffc733', 'fa5252', 'fd79a8', 
      '6c5ce7', 'a29bfe', '74b9ff', '0984e3', '00b894',
      '00cec9', 'e17055', 'fdcb6e', 'e84393', '2d3436'
    ];
    
    const backgroundColor = colors[Math.abs(hash) % colors.length];
    
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(initials)}&size=64&background=${backgroundColor}&color=fff&rounded=true&bold=true`;
  }

  private testImageLoad(url: string): void {
    const img = new Image();
    img.onload = () => {
      console.debug('ChatAvatar: Image loaded successfully:', url);
      this.imageLoadError = false;
    };
    img.onerror = (error) => {
      console.error('ChatAvatar: Failed to load image:', { url, error, contactName: this.contactName, contactId: this.contactId });
      this.imageLoadError = true;
      
      // Additional debugging info
      console.debug('ChatAvatar: Attempting to load fallback for:', {
        originalUrl: url,
        willUseFallback: this.contactName || this.contactId ? 'generated' : 'default',
        contactInfo: { name: this.contactName, id: this.contactId }
      });
      
      // Trigger change detection after error
      this.cdr.detectChanges();
    };
    img.src = url;
  }

  private isValidUrl(url: string): boolean {
    try {
      // Check if it's a data URL or a valid HTTP/HTTPS URL
      return url.startsWith('data:') || 
             url.startsWith('http://') || 
             url.startsWith('https://') ||
             url.startsWith('/'); // Relative URLs
    } catch {
      return false;
    }
  }
}

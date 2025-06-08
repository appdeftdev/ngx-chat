// SPDX-License-Identifier: AGPL-3.0-or-later
import { Component, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';

// Add WASM configuration for Matrix SDK
declare global {
  interface Window {
    mxMatrixClientPeg: any;
  }
}

@Component({
  selector: 'ngx-chat-root',
  template: `<router-outlet></router-outlet>`,
  styleUrls: ['./app.component.css'],
  imports: [RouterOutlet],
})
export class AppComponent implements OnInit {
  title = 'demo';

  ngOnInit() {
    this.setupMatrixWASM();
  }

  private setupMatrixWASM() {
    // Set up WASM path for Matrix SDK crypto
    if (typeof window !== 'undefined') {
      // Configure Matrix SDK to find WASM files in assets
      const wasmPath = 'assets/wasm/';
      
      // Store WASM configuration globally for Matrix SDK
      (window as any).wasmPath = wasmPath;
      
      console.log('Matrix WASM path configured:', wasmPath);
    }
  }
}

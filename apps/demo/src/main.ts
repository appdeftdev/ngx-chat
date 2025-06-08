// SPDX-License-Identifier: AGPL-3.0-or-later
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

// Configure WASM loading for Matrix SDK before bootstrapping
if (typeof window !== 'undefined') {
  // Override WebAssembly.instantiateStreaming to use custom path
  const originalInstantiateStreaming = WebAssembly.instantiateStreaming;
  WebAssembly.instantiateStreaming = function(source: Response | PromiseLike<Response>, importObject?: WebAssembly.Imports) {
    // Check if this is a Response object and handle WASM redirects
    if (source instanceof Response && source.url && source.url.includes('matrix_sdk_crypto_wasm_bg.wasm')) {
      // Redirect to our assets path
      console.log('Redirecting WASM request to assets path');
      source = fetch('/assets/wasm/matrix_sdk_crypto_wasm_bg.wasm');
    }
    return originalInstantiateStreaming.call(this, source, importObject);
  };
  
  console.log('Matrix WASM configuration set up');
}

bootstrapApplication(AppComponent, appConfig)
  // eslint-disable-next-line no-console
  .catch((err) => console.error(err));

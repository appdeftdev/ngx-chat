import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type AdapterType = 'xmpp' | 'matrix';

const STORAGE_KEY = 'ngx-chat-adapter-type';

@Injectable({
  providedIn: 'root',
})
export class AdapterSelectionService {
  private adapterTypeSubject = new BehaviorSubject<AdapterType>(
    (localStorage.getItem(STORAGE_KEY) as AdapterType) || 'xmpp'
  );
  adapterType$ = this.adapterTypeSubject.asObservable();

  setAdapterType(type: AdapterType): void {
    localStorage.setItem(STORAGE_KEY, type);
    this.adapterTypeSubject.next(type);
  }

  getCurrentAdapterType(): AdapterType {
    return this.adapterTypeSubject.getValue();
  }
}

import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type AdapterType = 'xmpp' | 'matrix';

@Injectable({
  providedIn: 'root',
})
export class AdapterSelectionService {
  private adapterTypeSubject = new BehaviorSubject<AdapterType>('xmpp');
  adapterType$ = this.adapterTypeSubject.asObservable();

  setAdapterType(type: AdapterType): void {
    this.adapterTypeSubject.next(type);
  }

  getCurrentAdapterType(): AdapterType {
    return this.adapterTypeSubject.getValue();
  }
}

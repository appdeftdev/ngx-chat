import { BehaviorSubject, Observable } from 'rxjs';
import { NgZone } from '@angular/core';
import { Contact, ContactListService, runInZone } from '@pazznetwork/ngx-chat-shared';

export class MatrixContactListService implements ContactListService {
  private readonly contactsSubject = new BehaviorSubject<Contact[]>([]);
  readonly contacts$: Observable<Contact[]>;
  readonly contactsSubscribed$: Observable<Contact[]>;
  readonly contactRequestsReceived$: Observable<Contact[]>;
  readonly contactRequestsSent$: Observable<Contact[]>;
  readonly contactsUnaffiliated$: Observable<Contact[]>;
  readonly contactsBlocked$: Observable<Contact[]>;
  readonly blockedContactJIDs$: Observable<Set<string>>;

  constructor(zone: NgZone) {
    this.contacts$ = this.contactsSubject.asObservable().pipe(runInZone(zone));
    this.contactsSubscribed$ = this.contacts$;
    this.contactRequestsReceived$ = new BehaviorSubject<Contact[]>([]).pipe(runInZone(zone));
    this.contactRequestsSent$ = new BehaviorSubject<Contact[]>([]).pipe(runInZone(zone));
    this.contactsUnaffiliated$ = new BehaviorSubject<Contact[]>([]).pipe(runInZone(zone));
    this.contactsBlocked$ = new BehaviorSubject<Contact[]>([]).pipe(runInZone(zone));
    this.blockedContactJIDs$ = new BehaviorSubject<Set<string>>(new Set()).pipe(runInZone(zone));
  }
  getOrCreateContactById(_id: string): Promise<Contact> {
    throw new Error('Method not implemented.');
  }
  blockJid(_bareJid: string): Promise<void> {
    throw new Error('Method not implemented.');
  }
  unblockJid(_bareJid: string): Promise<void> {
    throw new Error('Method not implemented.');
  }

  async getContactById(jid: string): Promise<Contact | undefined> {
    const contacts = this.contactsSubject.getValue();
    return contacts.find((contact) => contact.jid.toString() === jid);
  }

  async addContact(_jid: string): Promise<void> {
    // Implement Matrix contact adding logic
  }

  async removeContact(_jid: string): Promise<void> {
    // Implement Matrix contact removal logic
  }

  async blockContact(_jid: string): Promise<void> {
    // Implement Matrix contact blocking logic
  }

  async unblockContact(_jid: string): Promise<void> {
    // Implement Matrix contact unblocking logic
  }

  async acceptContactRequest(_jid: string): Promise<void> {
    // Implement Matrix contact request acceptance logic
  }

  async declineContactRequest(_jid: string): Promise<void> {
    // Implement Matrix contact request decline logic
  }
}

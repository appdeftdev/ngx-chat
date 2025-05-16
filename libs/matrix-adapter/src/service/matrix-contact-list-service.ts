import { BehaviorSubject, Observable } from 'rxjs';
import { NgZone } from '@angular/core';
import {
  Contact,
  ContactListService,
  runInZone,
  ContactSubscription,
} from '@pazznetwork/ngx-chat-shared';
import * as sdk from 'matrix-js-sdk';

export class MatrixContactListService implements ContactListService {
  private readonly contactsSubject = new BehaviorSubject<Contact[]>([]);
  private readonly blockedContactsSubject = new BehaviorSubject<Set<string>>(new Set());
  private readonly blockedContactsListSubject = new BehaviorSubject<Contact[]>([]);
  private client!: sdk.MatrixClient;

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
    this.contactsBlocked$ = this.blockedContactsListSubject.asObservable().pipe(runInZone(zone));
    this.blockedContactJIDs$ = this.blockedContactsSubject.asObservable().pipe(runInZone(zone));
  }

  setClient(client: sdk.MatrixClient) {
    this.client = client;
  }

  private get matrixClient(): sdk.MatrixClient {
    if (!this.client) throw new Error('Not logged in');
    return this.client;
  }

  async getContactById(jid: string): Promise<Contact | undefined> {
    const contacts = this.contactsSubject.getValue();
    return contacts.find((contact) => contact.jid.toString() === jid);
  }

  async getOrCreateContactById(jid: string): Promise<Contact> {
    let contact = await this.getContactById(jid);
    if (!contact) {
      // Create a new contact
      const user = await this.matrixClient.getUser(jid);
      contact = new Contact(
        jid,
        user?.displayName || jid,
        user?.avatarUrl,
        'both' as ContactSubscription
      );
      const contacts = this.contactsSubject.getValue();
      this.contactsSubject.next([...contacts, contact]);
    }
    return contact;
  }

  async addContact(jid: string): Promise<void> {
    await this.getOrCreateContactById(jid);
  }

  async removeContact(jid: string): Promise<void> {
    // 1. Remove from local contacts list
    const contacts = this.contactsSubject.getValue();
    const updatedContacts = contacts.filter((contact) => contact.jid.toString() !== jid);
    this.contactsSubject.next(updatedContacts);

    try {
      const roomId = this.getRoomIdForContact(jid);
      if (roomId) {
        await this.matrixClient.leave(roomId);
      }
      // Additional server cleanup if needed
    } catch (error) {
      console.error('Failed to remove contact from server:', error);
    }

    // 3. Clean up blocked contacts if needed
    await this.unblockJid(jid);
  }

  async blockJid(jid: string): Promise<void> {
    // Add Matrix SDK blocking call
    await this.matrixClient.setIgnoredUsers([...this.blockedContactsSubject.getValue(), jid]);

    // Update local state
    this.blockedContactsSubject.next(new Set([...this.blockedContactsSubject.getValue(), jid]));
    this.updateBlockedContactsList();
  }

  async unblockJid(jid: string): Promise<void> {
    // Remove from blocked users list
    const blockedUsers = this.blockedContactsSubject.getValue();
    blockedUsers.delete(jid);

    // Update Matrix server
    await this.matrixClient.setIgnoredUsers([...blockedUsers]);

    // Update local state
    this.blockedContactsSubject.next(blockedUsers);
    this.updateBlockedContactsList();
  }

  private updateBlockedContactsList(): void {
    const blockedJids = this.blockedContactsSubject.getValue();
    const blockedContacts = this.contactsSubject
      .getValue()
      .filter((contact) => blockedJids.has(contact.jid.toString()));
    this.blockedContactsListSubject.next(blockedContacts);
  }

  // async unblockJid(jid: string): Promise<void> {
  //   // Remove from blocked users list
  //   const blockedUsers = this.blockedContactsSubject.getValue();
  //   blockedUsers.delete(jid);
  //   this.blockedContactsSubject.next(blockedUsers);

  //   // Update blocked contacts list
  //   const blockedContacts = this.blockedContactsListSubject.getValue();
  //   const updatedBlockedContacts = blockedContacts.filter(
  //     (contact) => contact.jid.toString() !== jid
  //   );
  //   this.blockedContactsListSubject.next(updatedBlockedContacts);
  // }

  async blockContact(jid: string): Promise<void> {
    await this.blockJid(jid);
  }

  async unblockContact(jid: string): Promise<void> {
    await this.unblockJid(jid);
  }

  async acceptContactRequest(jid: string): Promise<void> {
    // Matrix doesn't have contact requests like XMPP
    // Just ensure they exist in our contacts list
    await this.getOrCreateContactById(jid);
  }

  async declineContactRequest(jid: string): Promise<void> {
    // Matrix doesn't have contact requests like XMPP
    // Just remove them from our contacts list
    await this.removeContact(jid);
  }

  private getRoomIdForContact(jid: string): string | undefined {
    // 1. Get all direct message rooms
    const directRooms = this.matrixClient.getRooms().filter((room) => {
      return room.getMembers().length === 2; // Only 2 members in a DM
    });

    // 2. Find the room that contains this contact
    for (const room of directRooms) {
      const members = room.getMembers();
      const otherUser = members.find((member) => member.userId !== this.matrixClient.getUserId());

      if (otherUser?.userId === jid) {
        return room.roomId;
      }
    }

    return undefined;
  }
}

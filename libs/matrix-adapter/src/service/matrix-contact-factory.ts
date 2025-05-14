import { CustomContactFactory, Contact, ContactSubscription } from '@pazznetwork/ngx-chat-shared';

export class MatrixContactFactory implements CustomContactFactory {
  async create(
    jid: string,
    name: string,
    avatar: string | undefined,
    subscription: ContactSubscription | undefined
  ): Promise<Contact> {
    // Implement Matrix-specific contact creation logic
    return new Contact(jid, name, avatar, subscription);
  }
}
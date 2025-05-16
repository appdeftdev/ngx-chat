import { Injectable, NgZone, Inject } from '@angular/core';
import {
  AuthRequest,
  ChatService,
  FileUploadHandler,
  Log,
  OpenChatsService,
  Translations,
  defaultTranslations,
  runInZone,
  LOG_SERVICE_TOKEN, // Import the token
} from '@pazznetwork/ngx-chat-shared';
import { HttpClient } from '@angular/common/http';
import { Observable, firstValueFrom } from 'rxjs';
import { MatrixMessageService } from './service/matrix-message-service';
import { MatrixRoomService } from './service/matrix-room-service';
import { MatrixContactListService } from './service/matrix-contact-list-service';
import { MatrixConnectionService } from './service/matrix-connection-service';
import { MatrixFileUploadHandler } from './service/matrix-file-upload-handler';
import { OPEN_CHAT_SERVICE_TOKEN } from '@pazznetwork/ngx-xmpp';

@Injectable()
export class MatrixService implements ChatService {
  static instance: MatrixService;

  readonly chatConnectionService: MatrixConnectionService;

  readonly onAuthenticating$: Observable<void>;
  readonly onOnline$: Observable<void>;
  readonly onOffline$: Observable<void>;
  readonly isOnline$: Observable<boolean>;
  readonly isOffline$: Observable<boolean>;

  readonly userJid$: Observable<string>;

  translations: Translations = defaultTranslations();

  readonly fileUploadHandler: FileUploadHandler;

  private lastLogInRequest?: AuthRequest;

  messageService: MatrixMessageService;
  roomService: MatrixRoomService;
  contactListService: MatrixContactListService;

  private constructor(
    readonly zone: NgZone,
    @Inject(LOG_SERVICE_TOKEN) readonly log: Log,
    readonly userAvatar$: Observable<string>,
    readonly userName$: Observable<string>,
    @Inject(OPEN_CHAT_SERVICE_TOKEN) readonly openChatsService: OpenChatsService
  ) {
    // Initialize services
    this.contactListService = new MatrixContactListService(zone);
    this.messageService = new MatrixMessageService();
    this.roomService = new MatrixRoomService(zone);
    this.chatConnectionService = new MatrixConnectionService(
      log,
      this.roomService,
      this.messageService,
      this.contactListService
    );

    this.onAuthenticating$ = this.chatConnectionService.onAuthenticating$.pipe(runInZone(zone));
    this.onOnline$ = this.chatConnectionService.onOnline$.pipe(runInZone(zone));
    this.onOffline$ = this.chatConnectionService.onOffline$.pipe(runInZone(zone));
    this.isOnline$ = this.chatConnectionService.isOnline$.pipe(runInZone(zone));
    this.isOffline$ = this.chatConnectionService.isOffline$.pipe(runInZone(zone));
    this.userJid$ = this.chatConnectionService.userJid$.pipe(runInZone(zone));

    this.fileUploadHandler = new MatrixFileUploadHandler();
  }
  unregister(_param: { service: string; domain: string }): Promise<void> {
    throw new Error('Method not implemented.');
  }

  static create(
    zone: NgZone,
    logService: Log,
    userAvatar$: Observable<string>,
    userName$: Observable<string>,
    @Inject(OPEN_CHAT_SERVICE_TOKEN) openChatsService: OpenChatsService,
    _httpClient: HttpClient,
    _customRoomFactory: any,
    _customContactFactory: any
  ): MatrixService {
    if (!MatrixService.instance) {
      MatrixService.instance = new MatrixService(
        zone,
        logService,
        userAvatar$,
        userName$,
        openChatsService
      );
    }
    return MatrixService.instance;
  }

  async logIn(logInRequest: AuthRequest): Promise<void> {
    this.lastLogInRequest = logInRequest;
    const homeserverUrl = logInRequest.service || 'https://matrix.org';
    if (!homeserverUrl || !/^https?:\/\//.test(homeserverUrl)) {
      throw new Error('Invalid Matrix homeserver URL');
    }
    await this.chatConnectionService.logIn(logInRequest);
  }

  // Add new method for token-based login
  async loginWithToken(authRequest: AuthRequest, token: string): Promise<void> {
    this.lastLogInRequest = authRequest;
    const homeserverUrl = authRequest.service || 'https://matrix.org';
    if (!homeserverUrl || !/^https?:\/\//.test(homeserverUrl)) {
      throw new Error('Invalid Matrix homeserver URL');
    }
    await this.chatConnectionService.loginWithToken(authRequest, token);
  }

  async logOut(): Promise<void> {
    await this.chatConnectionService.logOut();
  }

  async reconnect(): Promise<void> {
    if (this.lastLogInRequest) {
      await this.logIn(this.lastLogInRequest);
    } else {
      throw new Error('cannot reconnect without prior login');
    }
  }

  async register(authRequest: AuthRequest): Promise<void> {
    const onOnlinePromise = firstValueFrom(this.onOnline$);
    await this.chatConnectionService.register(authRequest);
    await onOnlinePromise;
  }
}

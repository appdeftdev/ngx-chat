import { BehaviorSubject, Subject } from 'rxjs';
import { map } from 'rxjs/operators';
import { AuthRequest, Log } from '@pazznetwork/ngx-chat-shared';
import * as sdk from 'matrix-js-sdk';
import { MatrixRoomService } from './matrix-room-service';

export class MatrixConnectionService {
  private readonly isOnlineSubject = new BehaviorSubject<boolean>(false);
  readonly isOnline$ = this.isOnlineSubject.asObservable();

  private readonly onAuthenticatingSubject = new Subject<void>();
  readonly onAuthenticating$ = this.onAuthenticatingSubject.asObservable();

  private readonly onOnlineSubject = new Subject<void>();
  readonly onOnline$ = this.onOnlineSubject.asObservable();

  private readonly onOfflineSubject = new Subject<void>();
  readonly onOffline$ = this.onOfflineSubject.asObservable();

  private readonly userJidSubject = new BehaviorSubject<string>('');
  readonly userJid$ = this.userJidSubject.asObservable();

  readonly isOffline$ = this.isOnline$.pipe(map((isOnline) => !isOnline));

  private matrixClient: any;

  constructor(
    private readonly logService: Log,
    private matrixRoomService: MatrixRoomService
  ) {}

  async logIn(authRequest: AuthRequest): Promise<void> {
    this.onAuthenticatingSubject.next();
    try {
      // Matrix login using username/password
      const homeserverUrl = authRequest.service || 'https://matrix.org';

      // Create client instance
      this.matrixClient = sdk.createClient({
        baseUrl: homeserverUrl,
      });

      // Login with username and password
      const loginResponse = await this.matrixClient.login('m.login.password', {
        user: authRequest.username,
        password: authRequest.password,
      });

      // Update client with access token from login
      this.matrixClient = sdk.createClient({
        baseUrl: homeserverUrl,
        accessToken: loginResponse.access_token,
        userId: loginResponse.user_id,
      });
      this.matrixRoomService.setClient(this.matrixClient);
      // Start client and sync
      await this.matrixClient.startClient();

      this.userJidSubject.next(loginResponse.user_id);
      this.isOnlineSubject.next(true);
      this.onOnlineSubject.next();
    } catch (error) {
      this.logService.error('Matrix login error', error);
      throw error;
    }
  }

  async loginWithToken(authRequest: AuthRequest, token: string): Promise<void> {
    this.onAuthenticatingSubject.next();
    try {
      const homeserverUrl = authRequest.service || 'https://matrix.org';
      const userId = `@${authRequest.username}:${authRequest.domain}`;

      // Create client with token
      this.matrixClient = sdk.createClient({
        baseUrl: homeserverUrl,
        accessToken: token,
        userId: userId,
      });

      // Start client and sync
      await this.matrixClient.startClient();

      this.userJidSubject.next(userId);
      this.isOnlineSubject.next(true);
      this.onOnlineSubject.next();
    } catch (error) {
      this.logService.error('Matrix token login error', error);
      throw error;
    }
  }

  async logOut(): Promise<void> {
    try {
      if (this.matrixClient) {
        await this.matrixClient.logout();
        this.matrixClient.stopClient();
        this.matrixClient = null;
      }
      this.isOnlineSubject.next(false);
      this.onOfflineSubject.next();
    } catch (error) {
      this.logService.error('Matrix logout error', error);
      throw error;
    }
  }

  async register(authRequest: AuthRequest): Promise<void> {
    try {
      const homeserverUrl = authRequest.service || 'https://matrix.org';

      // Create client for registration
      const tempClient = sdk.createClient({
        baseUrl: homeserverUrl,
      });

      // Register new user
      await tempClient.register(
        authRequest.username,
        authRequest.password,
        null, // sessionId
        {
          type: '',
        }, // auth object
        undefined, // bindThreepids
        undefined, // guestAccessToken
        false // inhibitLogin - set to false to allow automatic login
      );

      // After registration, log in
      await this.logIn(authRequest);
    } catch (error) {
      this.logService.error('Matrix registration error', error);
      throw error;
    }
  }
}

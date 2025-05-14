import { BehaviorSubject, Subject } from 'rxjs';
import { map } from 'rxjs/operators';
import { AuthRequest, Log } from '@pazznetwork/ngx-chat-shared';

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

  constructor(private readonly logService: Log) {}

  async logIn(authRequest: AuthRequest): Promise<void> {
    this.onAuthenticatingSubject.next();
    try {
      // Implement Matrix login logic here using matrix-js-sdk
      // For example:
      // const client = createClient({
      //   baseUrl: authRequest.service,
      //   userId: authRequest.username,
      //   accessToken: authRequest.password
      // });
      // await client.startClient();

      this.userJidSubject.next(authRequest.username);
      this.isOnlineSubject.next(true);
      this.onOnlineSubject.next();
    } catch (error) {
      this.logService.error('Matrix login error', error);
      throw error;
    }
  }

  async logOut(): Promise<void> {
    try {
      // Implement Matrix logout logic
      this.isOnlineSubject.next(false);
      this.onOfflineSubject.next();
    } catch (error) {
      this.logService.error('Matrix logout error', error);
      throw error;
    }
  }

  async register(authRequest: AuthRequest): Promise<void> {
    try {
      // Implement Matrix registration logic
      await this.logIn(authRequest);
    } catch (error) {
      this.logService.error('Matrix registration error', error);
      throw error;
    }
  }
}

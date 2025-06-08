import { BehaviorSubject, Subject } from 'rxjs';
import { map } from 'rxjs/operators';
import { AuthRequest, Log } from '@pazznetwork/ngx-chat-shared';
import * as sdk from 'matrix-js-sdk';
import { MatrixRoomService } from './matrix-room-service';
import { MatrixMessageService } from './matrix-message-service';
import { MatrixContactListService } from './matrix-contact-list-service';
import { MatrixFileUploadHandler } from './matrix-file-upload-handler';

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
  private encryptionSupported = false;

  get isEncryptionSupported(): boolean {
    return this.encryptionSupported;
  }

  constructor(
    private readonly logService: Log,
    private matrixRoomService: MatrixRoomService,
    private matrixMessageService: MatrixMessageService,
    private matrixContactListService: MatrixContactListService,
    private matrixFileUploadService: MatrixFileUploadHandler
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

      // Use consistent device ID strategy - store in localStorage for persistence
      let deviceId = loginResponse.device_id;
      if (!deviceId) {
        // Try to get stored device ID for this user
        const storageKey = `matrix_device_id_${loginResponse.user_id}`;
        deviceId = localStorage.getItem(storageKey);
        if (!deviceId) {
          // Generate new device ID and store it
          deviceId = 'ngx-chat-device-' + Date.now();
          localStorage.setItem(storageKey, deviceId);
          console.log('🔐 ENCRYPTION: Generated new device ID for session');
        } else {
          console.log('🔐 ENCRYPTION: Using stored device ID for consistency');
        }
      }

      // Update client with access token from login
      this.matrixClient = sdk.createClient({
        baseUrl: homeserverUrl,
        accessToken: loginResponse.access_token,
        userId: loginResponse.user_id,
        deviceId: deviceId,
        useAuthorizationHeader: true,
        timelineSupport: true,
      });

      // Initialize end-to-end encryption support
      // DISABLED: Encryption causing issues with chat history and room access
      const enableEncryption = false; // Disabled for now to make basic chat work
      this.encryptionSupported = false;
      
      if (enableEncryption) {
        // Configure crypto options - use persistent storage to fix decryption errors
        // This allows key backup and prevents "message sent before login" errors
        const cryptoOptions = {
          useIndexedDB: true, // Persistent storage - enables key backup and device continuity
        };
        
        try {
          console.log('🔐 ENCRYPTION: Starting initialization with device ID:', deviceId);
          
          // Test WASM file accessibility first
          try {
            const wasmResponse = await fetch('/assets/wasm/matrix_sdk_crypto_wasm_bg.wasm');
            if (!wasmResponse.ok) {
              throw new Error(`WASM file not accessible: ${wasmResponse.status} ${wasmResponse.statusText}`);
            }
            console.log('🔐 ENCRYPTION: ✅ WASM file is accessible');
          } catch (wasmError: any) {
            console.error('🔐 ENCRYPTION: ❌ WASM file test failed:', wasmError);
            throw new Error(`Cannot access WASM file: ${wasmError?.message || wasmError}`);
          }
          
          // Try setting WASM path globally for Matrix SDK
          if (typeof window !== 'undefined') {
            (window as any).__webpack_public_path__ = '/';
          }
          
          console.log('🔐 ENCRYPTION: About to call initRustCrypto with options:', cryptoOptions);
          
          await this.matrixClient.initRustCrypto(cryptoOptions);
          this.encryptionSupported = true;
          console.log('🔐 ENCRYPTION: ✅ SUCCESS - Matrix encryption initialized successfully');
        } catch (error: any) {
          console.error('🔐 ENCRYPTION: ❌ FAILED - Error:', error);
          console.error('🔐 ENCRYPTION: ❌ Error details:', {
            name: error?.name,
            message: error?.message,
            stack: error?.stack,
            cause: error?.cause
          });
          this.encryptionSupported = false;
          
          // Provide detailed error analysis
          if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
            this.logService.error('🔐 ENCRYPTION: WASM file loading failed');
            this.logService.error('Possible causes:');
            this.logService.error('1. Missing WASM files in the build output');
            this.logService.error('2. CORS issues with WASM file loading');
            this.logService.error('3. Unsupported browser environment');
          } else if (error.message.includes('IndexedDB')) {
            this.logService.error('🔐 ENCRYPTION: IndexedDB storage failed');
            this.logService.error('Try using incognito mode or clearing browser data');
          } else if (error.message.includes('WebAssembly')) {
            this.logService.error('🔐 ENCRYPTION: WebAssembly not supported or disabled');
            this.logService.error('Enable WebAssembly in browser settings');
          } else {
            this.logService.error('🔐 ENCRYPTION: Unknown encryption error');
            this.logService.error('Check Matrix server encryption support');
          }
          
          this.logService.warn('🔐 ENCRYPTION: Continuing without encryption - encrypted rooms will not work');
          
          // Continue without encryption if initialization fails
          // The client will still work for unencrypted messages
        }
      } else {
        this.logService.info('Matrix encryption disabled for testing');
        this.encryptionSupported = false;
      }

      // Initialize all services with the client
      console.log('🔐 CONNECTION SERVICE: Setting client on services with encryptionSupported =', this.encryptionSupported);
      this.matrixRoomService.setClient(this.matrixClient);
      this.matrixMessageService.setClient(this.matrixClient, this.encryptionSupported);
      this.matrixContactListService.setClient(this.matrixClient);
      this.matrixFileUploadService.setClient(this.matrixClient);

      // Final encryption status
      if (this.encryptionSupported) {
        console.log('🔐 ENCRYPTION: ✅ FINAL STATUS - Encryption is enabled and ready');
      } else {
        console.warn('🔐 ENCRYPTION: ⚠️ FINAL STATUS - Encryption is disabled - encrypted rooms will not work');
      }

      // Wait for initial sync before marking as online
      await new Promise<void>((resolve) => {
        const onSync = (state: string) => {
          if (state === 'PREPARED') {
            this.matrixClient.removeListener('sync', onSync);
            // Set presence after sync is prepared
            this.matrixClient
              .setPresence({
                presence: 'online',
                status_msg: 'Available',
              })
              .catch((err: Error) => this.logService.error('Error setting presence:', err));
            
            // Initialize all services after sync is prepared
            this.initializeServicesAfterSync();
            
            resolve();
          }
        };
        this.matrixClient.on('sync', onSync);
        // Enable presence syncing when starting the client
        this.matrixClient.startClient({
          initialSyncLimit: 50, // Reduced to prevent freezing
          disablePresence: false, // Explicitly enable presence
          lazyLoadMembers: true, // Enable lazy loading for better performance
          timelineSupport: true, // Enable timeline support for proper history
        });
      });

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

      // Generate a device ID for token-based login
      const deviceId = 'ngx-chat-device-' + Date.now();
      
      // Create client with token
      this.matrixClient = sdk.createClient({
        baseUrl: homeserverUrl,
        accessToken: token,
        userId: userId,
        deviceId: deviceId,
        useAuthorizationHeader: true,
        timelineSupport: true,
      });

      // Initialize end-to-end encryption support
      // DISABLED: Encryption causing issues with chat history and room access
      const enableEncryption = false; // Disabled for now to make basic chat work
      this.encryptionSupported = false;
      
      if (enableEncryption) {
        try {
          this.logService.debug('Initializing Matrix encryption with device ID:', deviceId);
          
          // Try setting WASM path globally for Matrix SDK
          if (typeof window !== 'undefined') {
            // Set the public path for WASM files
            (window as any).__webpack_public_path__ = '/';
          }
          
          // Configure crypto options for better compatibility
          const cryptoOptions = {
            // Use IndexedDB for persistent storage (enables key backup)
            useIndexedDB: true,
          };
          
          this.logService.debug('Crypto options:', cryptoOptions);
          this.logService.debug('WASM support check:', typeof WebAssembly !== 'undefined');
          
          await this.matrixClient.initRustCrypto(cryptoOptions);
          this.encryptionSupported = true;
          this.logService.info('Matrix encryption initialized successfully');
        } catch (error) {
          this.logService.error('Failed to initialize Matrix encryption:', error);
          this.encryptionSupported = false;
          
          // Check if this is a WASM loading issue
          if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
            this.logService.warn('WASM loading failed - this may be due to:');
            this.logService.warn('1. Missing WASM files in the build output');
            this.logService.warn('2. CORS issues with WASM file loading');
            this.logService.warn('3. Unsupported browser environment');
            this.logService.warn('Continuing without encryption support...');
          }
          
          // Continue without encryption if initialization fails
          // The client will still work for unencrypted messages
        }
      } else {
        this.logService.info('Matrix encryption disabled for testing');
        this.encryptionSupported = false;
      }

      // Initialize all services with the client
      this.matrixRoomService.setClient(this.matrixClient);
      this.matrixMessageService.setClient(this.matrixClient, this.encryptionSupported);
      this.matrixContactListService.setClient(this.matrixClient);
      this.matrixFileUploadService.setClient(this.matrixClient);

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
      
      // Clear all service state
      this.matrixRoomService.clearRooms();
      this.matrixContactListService.clearContacts();
      
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
      this.logService.info('Attempting registration with homeserver:', homeserverUrl);

      // Create client for registration
      const tempClient = sdk.createClient({
        baseUrl: homeserverUrl,
      });

      // First, try to register without any auth
      try {
                  const registerResponse = await tempClient.register(
            authRequest.username,
            authRequest.password,
            null, // sessionId
            { type: '' }, // auth object - empty for initial attempt
          undefined, // bindThreepids
          undefined, // guestAccessToken
          false // inhibitLogin - set to false to allow automatic login
        );
        
        this.logService.info('Registration successful:', registerResponse);
        
        // After successful registration, log in
        await this.logIn(authRequest);
        return;
        
      } catch (firstError: any) {
        this.logService.debug('Initial registration failed:', firstError);
        
        // Check if this is an interactive auth flow
        if (firstError.data && firstError.data.flows) {
          this.logService.info('Interactive auth required, flows:', firstError.data.flows);
          
          // Try with dummy auth for testing servers
          try {
            const registerResponse = await tempClient.register(
              authRequest.username,
              authRequest.password,
              null, // sessionId
              {
                type: 'm.login.dummy',
                session: firstError.data.session
              }, // auth object
              undefined, // bindThreepids
              undefined, // guestAccessToken
              false // inhibitLogin
            );
            
            this.logService.info('Registration with dummy auth successful:', registerResponse);
            
            // After successful registration, log in
            await this.logIn(authRequest);
            return;
            
          } catch (dummyAuthError: any) {
            this.logService.warn('Dummy auth failed:', dummyAuthError);
            
            // If dummy auth fails, check for other auth types
            const flows = firstError.data.flows;
            const supportedFlow = flows.find((flow: any) => 
              flow.stages && flow.stages.length === 1 && 
              (flow.stages[0] === 'm.login.dummy' || 
               flow.stages[0] === 'm.login.terms' ||
               flow.stages[0] === 'm.login.recaptcha')
            );
            
            if (supportedFlow) {
              throw new Error(`Registration requires additional authentication: ${supportedFlow.stages[0]}. This may not be supported in this client.`);
            } else {
              throw new Error(`Registration requires unsupported authentication flows: ${JSON.stringify(flows)}`);
            }
          }
        } else {
          // Re-throw the original error if it's not an auth flow issue
          throw firstError;
        }
      }
      
    } catch (error: any) {
      this.logService.error('Matrix registration error', error);
      
      // Provide user-friendly error messages
      if (error.errcode === 'M_USER_IN_USE') {
        throw new Error('Username is already taken. Please choose a different username.');
      } else if (error.errcode === 'M_INVALID_USERNAME') {
        throw new Error('Invalid username. Please use only lowercase letters, numbers, hyphens, underscores, and periods.');
      } else if (error.errcode === 'M_WEAK_PASSWORD') {
        throw new Error('Password is too weak. Please choose a stronger password.');
      } else if (error.errcode === 'M_FORBIDDEN') {
        throw new Error('Registration is not allowed on this homeserver.');
      } else if (error.message?.includes('authentication')) {
        throw new Error(`Registration failed: ${error.message}`);
      } else {
        throw new Error(`Registration failed: ${error.message || 'Unknown error'}`);
      }
    }
  }

  public getMatrixClient() {
    return this.matrixClient;
  }

  private async initializeServicesAfterSync(): Promise<void> {
    try {
      console.log('Initializing services after Matrix sync...');
      
      // Initialize contact service (loads contacts and DMs)
      await this.matrixContactListService.initializeAfterSync();
      
      // Load existing rooms in the room service
      await this.matrixRoomService.loadRoomsAfterSync();
      
      // Initialize message service (loads message history)
      await this.matrixMessageService.initializeAfterContactsLoaded();
      
      // Load additional message history for all rooms
      await this.loadInitialMessageHistory();
      
      // Force refresh all room data
      console.log('🔐 CONNECTION SERVICE: Forcing room data refresh...');
      const rooms = this.matrixClient.getRooms();
      for (const room of rooms) {
        const timeline = room.getLiveTimeline();
        const events = timeline.getEvents();
        console.log('🔐 CONNECTION SERVICE: Room', room.name || room.roomId, 'has', events.length, 'events');
        
        // Manually emit timeline events to ensure message processing
        for (const event of events.slice(-10)) { // Last 10 events
          if (event.getType() === 'm.room.message' || event.getType() === 'm.room.encrypted') {
            this.matrixClient.emit('Room.timeline', event, room, false, false, { timeline });
          }
        }
      }
      
      console.log('All services initialized successfully');
    } catch (error) {
      this.logService.error('Error initializing services after sync:', error);
    }
  }

  private async loadInitialMessageHistory(): Promise<void> {
    try {
      console.log('Loading initial message history...');
      
      // Get all rooms (including DM rooms)
      const rooms = this.matrixClient.getRooms();
      
      // Process rooms in smaller batches
      const maxRoomsToProcess = Math.min(rooms.length, 10); // Limit to 10 rooms
      const roomsToProcess = rooms.slice(0, maxRoomsToProcess);
      
      // Load history for each room with timeout protection
      const historyPromises = roomsToProcess.map(async (room: sdk.Room) => {
        try {
          // Add timeout to prevent hanging
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), 5000) // 5 second timeout per room
          );
          
          const timeline = room.getLiveTimeline();
          let paginationToken = timeline.getPaginationToken(sdk.Direction.Backward);
          
          if (!paginationToken) {
            console.log(`No history available for room ${room.name || room.roomId}`);
            return;
          }
          
          let totalLoaded = 0;
          const maxMessages = 50; // Maximum messages per room
          
          while (totalLoaded < maxMessages && paginationToken) {
            try {
              // Load messages in small batches
              await Promise.race([
                this.matrixClient.scrollback(room, 20), // Load 20 messages at a time
                timeoutPromise
              ]);
              
              const events = timeline.getEvents();
              const messageEvents = events.filter((event: sdk.MatrixEvent) => 
                event.getType() === 'm.room.message' && 
                !event.isRedacted()
              );
              
              totalLoaded += messageEvents.length;
              
              // Check if we can load more
              const newToken = timeline.getPaginationToken(sdk.Direction.Backward);
              if (!newToken || newToken === paginationToken) {
                break;
              }
              paginationToken = newToken;
              
            } catch (error) {
              console.warn(`Failed to load batch for room ${room.name || room.roomId}:`, error);
              break;
            }
          }
          
          if (totalLoaded > 0) {
            console.log(`Loaded ${totalLoaded} messages for room ${room.name || room.roomId}`);
          }
          
        } catch (error) {
          console.warn(`Failed to load history for room ${room.name || room.roomId}:`, error);
        }
      });
      
      // Wait for all with overall timeout
      const allHistoryPromise = Promise.allSettled(historyPromises);
      const overallTimeout = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Overall timeout')), 15000) // 15 second overall timeout
      );
      
      await Promise.race([allHistoryPromise, overallTimeout]);
      console.log('Initial message history loading completed');
      
    } catch (error) {
      console.error('Error loading initial message history:', error);
    }
  }

  /**
   * Development helper: Simulates registration by using existing credentials
   * Use this for development when registration is not available
   */
  async devRegister(authRequest: AuthRequest): Promise<void> {
    this.logService.warn('DEV MODE: Simulating registration by attempting login with existing account');
    this.logService.warn('In production, users should register through Element web client first');
    
    // For development, just try to login with the provided credentials
    // This assumes the account already exists (created via Element)
    try {
      await this.logIn(authRequest);
      this.logService.info('DEV: Login successful - user was already registered');
    } catch (error: any) {
      this.logService.error('DEV: Login failed - user needs to register via Element first');
      throw new Error(
        `Account not found. Please:\n` +
        `1. Go to app.element.io\n` +
        `2. Create account with username: ${authRequest.username}\n` +
        `3. Use the same credentials here\n` +
        `Original error: ${error.message}`
      );
    }
  }
}

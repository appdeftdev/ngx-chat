import { NgModule, NgZone } from '@angular/core';
import { HttpClientModule, HttpClient } from '@angular/common/http';

import {
  CHAT_SERVICE_TOKEN,
  CHAT_LIST_STATE_SERVICE_TOKEN,
  CHAT_BACKGROUND_NOTIFICATION_SERVICE_TOKEN,
  OPEN_CHAT_SERVICE_TOKEN,
  CUSTOM_CONTACT_FACTORY_TOKEN,
  CUSTOM_ROOM_FACTORY_TOKEN,
  USER_AVATAR_TOKEN,
  USER_NAME_TOKEN,
  FILE_UPLOAD_HANDLER_TOKEN,
} from '@pazznetwork/ngx-xmpp';
import { LOG_SERVICE_TOKEN } from '@pazznetwork/ngx-chat-shared'; // Updated import
import {
  ChatBackgroundNotificationService,
  ChatListStateService,
  ChatMessageListRegistryService,
  LogService,
} from '@pazznetwork/ngx-xmpp';
import { NEVER, Observable, of } from 'rxjs';
import {
  ChatService,
  CustomContactFactory,
  CustomRoomFactory,
  FileUploadHandler,
  OpenChatsService,
} from '@pazznetwork/ngx-chat-shared';
import { MatrixContactFactory } from '../service/matrix-contact-factory';
import { MatrixRoomFactory } from '../service/matrix-room-factory';
import { MatrixService } from '../matrix.service';

@NgModule({
  imports: [HttpClientModule],
  providers: [
    {
      provide: OPEN_CHAT_SERVICE_TOKEN,
      useClass: ChatMessageListRegistryService,
    },
    {
      provide: LOG_SERVICE_TOKEN,
      useClass: LogService,
    },
    { provide: CUSTOM_CONTACT_FACTORY_TOKEN, useClass: MatrixContactFactory },
    { provide: CUSTOM_ROOM_FACTORY_TOKEN, useClass: MatrixRoomFactory },
    { provide: USER_AVATAR_TOKEN, useValue: NEVER },
    { provide: USER_NAME_TOKEN, useValue: of('') },
    {
      provide: CHAT_SERVICE_TOKEN,
      deps: [
        NgZone,
        HttpClient,
        USER_AVATAR_TOKEN,
        USER_NAME_TOKEN,
        OPEN_CHAT_SERVICE_TOKEN,
        LOG_SERVICE_TOKEN,
        CUSTOM_ROOM_FACTORY_TOKEN,
        CUSTOM_CONTACT_FACTORY_TOKEN,
      ],
      useFactory: MatrixAdapterModule.matrixServiceFactory,
    },
    {
      provide: FILE_UPLOAD_HANDLER_TOKEN,
      deps: [CHAT_SERVICE_TOKEN],
      useFactory: MatrixAdapterModule.fileUploadHandlerFactory,
    },
    {
      provide: CHAT_BACKGROUND_NOTIFICATION_SERVICE_TOKEN,
      useClass: ChatBackgroundNotificationService,
      deps: [CHAT_SERVICE_TOKEN],
    },
    {
      provide: CHAT_LIST_STATE_SERVICE_TOKEN,
      useClass: ChatListStateService,
      deps: [CHAT_SERVICE_TOKEN],
    },
  ],
})
export class MatrixAdapterModule {
  private static fileUploadHandlerFactory(chatService: ChatService): FileUploadHandler {
    return chatService.fileUploadHandler;
  }

  private static matrixServiceFactory(
    zone: NgZone,
    httpClient: HttpClient,
    userAvatar$: Observable<string>,
    userName$: Observable<string>,
    openChatsService: OpenChatsService,
    logService: any, // Change the type to any or the concrete implementation type
    customRoomFactory: CustomRoomFactory,
    customContactFactory: CustomContactFactory
  ): MatrixService {
    return zone.runOutsideAngular(() =>
      MatrixService.create(
        zone,
        logService,
        userAvatar$,
        userName$,
        openChatsService,
        httpClient,
        customRoomFactory,
        customContactFactory
      )
    );
  }
}

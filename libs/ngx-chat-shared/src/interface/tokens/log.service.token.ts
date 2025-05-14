import { InjectionToken } from '@angular/core';
import { Log } from '../log';

export const LOG_SERVICE_TOKEN = new InjectionToken<Log>('ngxChatLogService');

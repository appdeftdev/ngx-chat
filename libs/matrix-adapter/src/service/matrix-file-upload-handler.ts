
import {of } from 'rxjs';
import { FileUploadHandler } from '@pazznetwork/ngx-chat-shared';

export class MatrixFileUploadHandler implements FileUploadHandler {
  isUploadSupported$ = of(true);

  constructor(
  ) {}

  async upload(_file: File): Promise<string> {
    throw new Error('Method not implemented');
  }
}

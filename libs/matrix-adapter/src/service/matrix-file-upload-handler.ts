import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { FileUploadHandler } from '@pazznetwork/ngx-chat-shared';
import { MatrixService } from '../matrix.service';

export class MatrixFileUploadHandler implements FileUploadHandler {
  isUploadSupported$ = of(true);

  constructor(
    private readonly httpClient: HttpClient,
    private readonly matrixService: MatrixService
  ) {}

  async upload(file: File): Promise<string> {
    throw new Error('Method not implemented');
  }
}

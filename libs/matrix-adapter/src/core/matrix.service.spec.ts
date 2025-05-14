import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { MatrixAdapterModule } from './matrix-adapter.module';
import { MatrixService } from '../matrix.service';

describe('MatrixService', () => {
  let service: MatrixService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule, MatrixAdapterModule],
    });
    service = TestBed.inject(MatrixService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  // Add more tests similar to XMPP adapter tests
});

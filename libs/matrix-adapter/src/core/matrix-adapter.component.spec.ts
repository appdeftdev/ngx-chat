import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatrixAdapterComponent } from './matrix-adapter.component';

describe('MatrixAdapterComponent', () => {
  let component: MatrixAdapterComponent;
  let fixture: ComponentFixture<MatrixAdapterComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MatrixAdapterComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(MatrixAdapterComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

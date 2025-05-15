import { Component, OnDestroy } from '@angular/core';
import { AdapterSelectionService, AdapterType } from '../../services/adapter-selection.service';
import { Subject, takeUntil } from 'rxjs';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'app-adapter-selector',
  template: `
    <div class="adapter-selector">
      <label>
        <input
          type="radio"
          name="adapter"
          value="xmpp"
          [checked]="currentAdapter === 'xmpp'"
          (change)="selectAdapter('xmpp')"
        />
        XMPP
      </label>
      <label>
        <input
          type="radio"
          name="adapter"
          value="matrix"
          [checked]="currentAdapter === 'matrix'"
          (change)="selectAdapter('matrix')"
        />
        Matrix
      </label>
    </div>
  `,
  styles: [
    `
      .adapter-selector {
        margin: 1rem 0;
      }
      label {
        margin-right: 1rem;
      }
    `,
  ],
})
export class AdapterSelectorComponent implements OnDestroy {
  currentAdapter: AdapterType;
  private readonly destroy$ = new Subject<void>();

  constructor(private adapterSelectionService: AdapterSelectionService) {
    this.currentAdapter = this.adapterSelectionService.getCurrentAdapterType();
    this.adapterSelectionService.adapterType$
      .pipe(takeUntil(this.destroy$))
      .subscribe(type => {
        this.currentAdapter = type;
      });
  }

  selectAdapter(type: AdapterType): void {
    console.log(type)
    this.currentAdapter = type;
    this.adapterSelectionService.setAdapterType(type);
    // Reload the page to apply the new adapter
    window.location.reload();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}

import { Component } from '@angular/core';
import { PremontajeTareasComponent } from './pages/premontaje/premontaje';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, PremontajeTareasComponent],
  templateUrl: './app.html',
})
export class AppComponent {}

import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /** Usado por el healthcheck de Docker. */
  @Get('health')
  health(): { status: string } {
    return { status: 'ok' };
  }
}

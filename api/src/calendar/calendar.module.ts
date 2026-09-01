import { Module } from '@nestjs/common';
import { CalendarService } from './calendar.service.js';

@Module({
  providers: [CalendarService],
  exports: [CalendarService],
})
export class CalendarModule {}

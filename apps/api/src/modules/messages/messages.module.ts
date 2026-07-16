/** B6 — Messages module wiring. Service is exported so future jobs
 *  can compose it without touching the HTTP layer. */
import { Module } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { MessagesController } from './messages.controller';

@Module({
  controllers: [MessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}

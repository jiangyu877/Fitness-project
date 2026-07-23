import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { applyMigrations, openDatabase } from '@lianban/database';
import type { PGlite } from '@electric-sql/pglite';
import type { Environment } from '../config/environment.js';
import { ENVIRONMENT } from '../readiness/readiness.controller.js';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  readonly database: PGlite;

  constructor(@Inject(ENVIRONMENT) environment: Environment) {
    this.database = openDatabase(environment.databasePath);
  }

  async onModuleInit(): Promise<void> {
    await applyMigrations(this.database);
  }

  async onModuleDestroy(): Promise<void> {
    await this.database.close();
  }
}

import {IMigration} from '../migrater';
import {ExtendedSequelize} from '../client';

export class ScoreMigration implements IMigration {
  name = '考核打分相关表结构';
  version = 9;

  async up(client: ExtendedSequelize): Promise<void> {
    // language=PostgreSQL
    await client.execute(`
      CREATE TABLE IF NOT EXISTS "mark-hospital"
      (
        "hospital"   UUID REFERENCES "hospital" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "S00"        INTEGER                  DEFAULT 0,
        "S23"        INTEGER                  DEFAULT 0,
        "S03"        INTEGER                  DEFAULT 0,
        PRIMARY KEY ("hospital")
      );
      COMMENT ON COLUMN "mark-hospital"."hospital" IS '机构';
      COMMENT ON COLUMN "mark-hospital"."S00" IS '健康档案总数';
      COMMENT ON COLUMN "mark-hospital"."S23" IS '健康档案规范数';
      COMMENT ON COLUMN "mark-hospital"."S03" IS '健康档案使用数';
    `);
  }

  async down(client: ExtendedSequelize, err?: Error): Promise<void> {
    // language=PostgreSQL
    await client.execute(`DROP TABLE IF EXISTS "mark_hospital"`);
  }
}

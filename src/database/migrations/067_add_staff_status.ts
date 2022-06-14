import {IMigration} from '../migrater';
import {ExtendedSequelize} from '../client';

export class AddStaffStatus implements IMigration {
  name = '员工表添加是否注销字段';
  version = 67;

  async up(client: ExtendedSequelize): Promise<void> {
    // language=PostgreSQL
    await client.execute(`
      ALTER table staff
        ADD COLUMN status boolean not null default false;
      COMMENT ON COLUMN staff.status IS '是否注销,默认false';
    `);
  }

  async down(client: ExtendedSequelize): Promise<void> {
    return;
  }
}

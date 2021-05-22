import {appDB, originalDB} from '../../app';
import {v4 as uuid} from 'uuid';
import * as dayjs from 'dayjs';
import {Context} from '../context';
import {KatoRuntimeError, should, validate} from 'kato-server';

export async function getHospital() {
  if (
    Context.current.user.hospitals &&
    Context.current.user.hospitals.length > 1
  )
    throw new KatoRuntimeError(`没有查询his员工权限`);

  return Context.current.user.hospitals[0]['id'];
}
export default class HisStaff {
  /**
   * 查询his员工
   */
  async listHisStaffs() {
    const hospital = await getHospital();

    return await originalDB.execute(
      `select id, name, hospital from his_staff where hospital = ?`,
      hospital
    );
  }

  /**
   * 添加员工
   *
   * @param staff
   * @param account
   * @param password
   * @param name
   */
  @validate(
    should
      .string()
      .allow(null)
      .description('绑定his员工id'),
    should
      .string()
      .required()
      .description('登录名'),
    should
      .string()
      .required()
      .description('密码'),
    should
      .string()
      .required()
      .description('名称')
  )
  async add(staff, account, password, name) {
    const hospital = await getHospital();
    if (staff) {
      // 查询his员工是否已经被绑定
      const accountOne = await appDB.execute(
        `select * from staff where staff = ?`,
        staff
      );
      if (accountOne.length > 0) throw new KatoRuntimeError(`his员工已经存在`);
    } else {
      staff = null;
    }
    return await appDB.execute(
      `insert into
            staff(
              id,
              hospital,
              staff,
              account,
              password,
              name,
              created_at,
              updated_at
              )
            values(?, ?, ?, ?, ?, ?, ?, ?)`,
      uuid(),
      hospital,
      staff,
      account,
      password,
      name,
      dayjs().toDate(),
      dayjs().toDate()
    );
  }

  @validate(
    should
      .string()
      .required()
      .description('主键'),
    should
      .string()
      .required()
      .description('名称'),
    should
      .string()
      .required()
      .description('密码')
  )
  /**
   * 修改员工信息
   */
  async update(id, name, password) {
    return await appDB.execute(
      `
        update staff set
          name = ?,
          password = ?,
          updated_at = ?
        where id = ?`,
      name,
      password,
      dayjs().toDate(),
      id
    );
  }

  /**
   * 删除员工信息
   */
  @validate(
    should
      .string()
      .required()
      .description('主键')
  )
  async delete(id) {
    // 先查询是否绑定过
    const itemMapping = await appDB.execute(
      `select * from his_staff_work_item_mapping where staff = ?`,
      id
    );
    if (itemMapping.length > 0) throw new KatoRuntimeError(`员工已绑定工分项`);

    const staffWorkSource = await appDB.execute(
      `select * from his_staff_work_source where staff = ? or ? = ANY(sources)`,
      id,
      id
    );
    if (staffWorkSource.length > 0) throw new KatoRuntimeError(`员工添加考核`);

    return await appDB.execute(
      `
        delete from staff where id = ?`,
      id
    );
  }

  /**
   * 员工列表
   */
  async list() {
    const hospital = await getHospital();
    return await appDB.execute(
      `
        select id, hospital, staff, account, name, created_at, updated_at
        from staff where hospital = ?`,
      hospital
    );
  }
}

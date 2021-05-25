import {appDB, originalDB} from '../../app';
import {v4 as uuid} from 'uuid';
import * as dayjs from 'dayjs';
import {Context} from '../context';
import {KatoRuntimeError, should, validate} from 'kato-server';
import {sql as sqlRender} from '../../database/template';

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
  @validate(
    should
      .string()
      .allow(null)
      .description('账号'),
    should
      .string()
      .allow(null)
      .description('用户名')
  )
  async list(account, name) {
    const hospital = await getHospital();
    // 用户名查询模糊查询
    if (account) account = `%${account}%`;
    if (name) name = `%${name}%`;

    const [sql, params] = sqlRender(
      `
        select id, hospital, staff, account, password, name, created_at, updated_at
        from staff
        where hospital = {{? hospital}}
        {{#if account}}
            AND account like {{? account}}
        {{/if}}
        {{#if name}}
            AND name like {{? name}}
        {{/if}}
      `,
      {
        hospital,
        account,
        name
      }
    );
    const staffList = await appDB.execute(sql, ...params);
    const hisStaffs = await originalDB.execute(
      `select id, name from his_staff where hospital = ?`,
      hospital
    );
    return staffList.map(it => {
      const index = hisStaffs.find(item => it.staff === item.id);
      if (index) {
        return {
          ...it,
          staffName: index.name
        };
      } else {
        return {
          ...it,
          staffName: ''
        };
      }
    });
  }

  /**
   * 员工绑定
   */
  @validate(
    should
      .string()
      .required()
      .description('考核员工id'),
    should
      .array()
      .items({
        source: should
          .array()
          .required()
          .description('关联员工id'),
        rate: should
          .number()
          .required()
          .description('权重系数')
      })
      .required()
      .description('关联员工[]')
  )
  async addHisStaffWorkSource(staff, sourceRate) {
    return appDB.transaction(async () => {
      // 添加员工关联
      for (const it of sourceRate) {
        await appDB.execute(
          ` insert into
              his_staff_work_source(id, staff, sources, rate, created_at, updated_at)
              values(?, ?, ?, ?, ?, ?)`,
          uuid(),
          staff,
          `{${it.source.map(item => `"${item}"`).join()}}`,
          it.rate,
          dayjs().toDate(),
          dayjs().toDate()
        );
      }
    });
  }

  /**
   * 删除员工绑定
   */
  async delHisStaffWorkSource(id) {
    return await appDB.execute(
      `
        delete from his_staff_work_source where id = ?`,
      id
    );
  }

  /**
   * 修改考核员工
   */
  @validate(
    should
      .string()
      .required()
      .description('考核员工id'),
    should
      .array()
      .required()
      .description('关联员工[]')
  )
  async updateHisStaffWorkSource(id, sources, rate) {
    return appDB.transaction(async () => {
      await appDB.execute(
        ` update his_staff_work_source
                set
                sources = ?,
                rate = ?,
                updated_at = ?
              where id = ?`,
        `{${sources.map(item => `"${item}"`).join()}}`,
        rate,
        dayjs().toDate(),
        id
      );
    });
  }

  /**
   * 查询员工绑定
   */
  async selHisStaffWorkSource() {
    const hospital = await getHospital();
    const list = await appDB.execute(
      `
        select
          source.id
          ,source.staff
          ,source.sources
          ,source.rate
          ,staff.name "staffName"
        from his_staff_work_source source
        left join staff on source.staff = staff.id
        where staff.hospital = ?
        order by source.created_at desc`,
      hospital
    );

    const staffList = await appDB.execute(
      `select id, name from staff where hospital = ?`,
      hospital
    );
    const staffListObj = {};

    for (const it of staffList) {
      staffListObj[it.id] = it.name;
    }

    return list.map(it => {
      const sourcesName = it.sources.map(item => {
        return staffListObj[item];
      });
      return {
        ...it,
        sourcesName: sourcesName
      };
    });
  }

  /**
   * 获取指定日期的质量系数
   *
   * @param id 员工id
   * @param day 日期
   */
  getRateByDay(id, day) {
    return null;
  }

  /**
   * 获取指定月份的质量系数(查询月份有记录最后一天的质量系数)
   *
   * @param id 员工id
   * @param month 月份
   */
  getRate(id, month) {
    return null;
  }

  /**
   * 获取指定月份的质量系数列表
   *
   * @param id 员工id
   * @param month 月份
   */
  getRateList(id, month) {
    //建议一波查出来, 再根据日期分组
    return [];
  }

  /**
   *
   * @param staff
   */
  @validate(
    should
      .string()
      .required()
      .description('考核员工id')
  )
  async staffCheck(staff) {
    const checks = await appDB.execute(
      `select "check" "checkId",  staff from his_staff_check_mapping where staff = ?`,
      staff
    );
    if (checks.length === 0) throw new KatoRuntimeError(`该员工没有考核方案`);
    const checkId = checks[0]?.checkId;

    const hisSystems = await appDB.execute(
      `select id, name
            from his_check_system
            where id = ?`,
      checkId
    );
    if (hisSystems.length === 0) throw new KatoRuntimeError(`方案不存在`);
    const hisRules = await appDB.execute(
      `select * from his_check_rule
              where "check" = ?
        `,
      checkId
    );
    const automations = hisRules
      .map(it => {
        if (it.auto === true) return it;
      })
      .filter(it => it);
    const manuals = hisRules
      .map(it => {
        if (it.auto === false) return it;
      })
      .filter(it => it);

    return {
      id: hisSystems[0]?.id,
      name: hisSystems[0]?.name,
      automations,
      manuals
    };
  }

  /**
   * 手动打分
   */
  @validate(
    should
      .string()
      .required()
      .description('细则id'),
    should
      .string()
      .required()
      .description('考核员工id'),
    should
      .number()
      .required()
      .description('分值')
  )
  async setScore(ruleId, staff, score) {
    return dayjs().startOf('d');
    const rules = await appDB.execute(
      `select id, "check", score
            from his_check_rule where id = ?`,
      ruleId
    );
    if (rules.length === 0) throw new KatoRuntimeError(`无此考核细则`);
    const staffSystem = await appDB.execute(
      `select staff, "check" from his_staff_check_mapping where staff = ?`,
      staff
    );
    if (staffSystem.length === 0) throw new KatoRuntimeError(`该员工无考核`);

    if (rules[0].check !== staffSystem[0].check)
      throw new KatoRuntimeError(`考核员工考核项目和细则考核项目不一致`);

    if (rules[0].score < score)
      throw new KatoRuntimeError(`分数不能高于细则的满分`);
    const now = new Date();

    // 查询今天是否有分值
    const todayScore = await appDB.execute(
      `select *
            from his_rule_staff_score
            where rule = ? and staff = ? and date = ?`,
      ruleId,
      staff,
      now
    );
    // 如果查找到,执行修改,没有查到到:添加
    if (todayScore.length === 0) {
      await appDB.execute(
        `insert into
              his_rule_staff_score(rule, staff, date, score, created_at, updated_at)
              values(?, ?, ?, ?, ?, ?)`,
        ...[ruleId, staff, new Date(), score, new Date(), new Date()]
      );
    }
    return await appDB.execute(
      `update his_rule_staff_score
            set score = ?, updated_at = ?
            where rule = ? and staff = ? and date = ?`,
      score,
      new Date(),
      ruleId,
      staff,
      new Date()
    );
  }
}

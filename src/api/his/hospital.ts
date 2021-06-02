import HisStaff from './staff';
import {appDB} from '../../app';
import * as dayjs from 'dayjs';
import {KatoRuntimeError, validate} from 'kato-server';
import {dateValid, getHospital, monthToRange} from './service';

/**
 * 机构模块
 */
export default class HisHospital {
  /**
   * 结算指定月份
   *
   * @param month 月份
   */
  @validate(dateValid)
  async settle(month) {
    const hospital = await getHospital();
    const {start} = monthToRange(month);
    await appDB.execute(
      //language=PostgreSQL
      `
        insert into his_hospital_settle(hospital, month, settle)
        values (?, ?, true)
        on conflict (hospital, month)
          do update set settle     = true,
                        updated_at = now()
      `,
      hospital,
      start
    );
  }

  /**
   * 考核结果概览
   *
   * @param month 月份
   * @return {
   *   id: 机构id
   *   name: 机构名称
   *   settle: 是否结算
   *   date: 考核时间
   *   originalScore: 校正前工分
   *   correctScore: 校正后工分
   * }
   */
  @validate(dateValid)
  async overview(month) {
    const hospital = await getHospital();
    //查询机构
    // language=PostgreSQL
    const hospitalModel: {id: string; name: string} = (
      await appDB.execute(
        `
          select code as id, name
          from area
          where code = ?
        `,
        hospital
      )
    )[0];
    if (!hospitalModel) throw new KatoRuntimeError(`该机构不存在`);
    const {start, end} = monthToRange(month);
    //查询是否结算
    // language=PostgreSQL
    let settle =
      (
        await appDB.execute(
          `
            select settle
            from his_hospital_settle
            where hospital = ?
              and month = ?
          `,
          hospitalModel.id,
          start
        )
      )[0]?.settle ?? false;
    //一个月前的结算状态, 默认已结算
    if (dayjs().diff(month, 'M') > 1) {
      settle = true;
    }

    //查询校正前总工分
    // language=PostgreSQL
    const originalScore = Number(
      (
        await appDB.execute(
          `
            select sum(his_staff_work_score_detail.score) as score
            from his_staff_work_score_detail
                   inner join staff on his_staff_work_score_detail.staff = staff.id
            where staff.hospital = ?
              and his_staff_work_score_detail.date >= ?
              and his_staff_work_score_detail.date < ?
          `,
          hospitalModel.id,
          start,
          end
        )
      )[0]?.score ?? 0
    );
    //TODO: 查询校正后工分

    return {
      id: hospitalModel.id,
      name: hospitalModel.name,
      settle: settle,
      date: month,
      originalScore,
      correctScore: null
    };
  }

  /**
   * 工分项目列表
   *
   * @param month 月份
   * @return {
   *   id: 工分项目id
   *   name: 工分项目名称
   *   score: 工分项目分数(校正前)
   * }
   */
  @validate(dateValid)
  async findWorkScoreList(month) {
    const hospital = await getHospital();
    const {start, end} = monthToRange(month);
    return await appDB.execute(
      // language=PostgreSQL
      `
        select d.item as id, max(wi.name) as name, sum(d.score) as score
        from his_staff_work_score_detail d
               inner join staff on d.staff = staff.id
               inner join his_work_item wi on d.item = wi.id
        where staff.hospital = ?
          and d.date >= ?
          and d.date < ?
        group by d.item
      `,
      hospital,
      start,
      end
    );
  }

  /**
   * 员工考核结果列表
   *
   * @param month 月份
   * @return [
   *   {
   *     id: 员工id
   *     name: 姓名
   *     score: 校正前工分值
   *     rate?: 质量系数
   *   }
   * ]
   */
  @validate(dateValid)
  async findStaffCheckList(month) {
    //TODO: 苟且一波
    const staffApi = new HisStaff();
    const hospital = await getHospital();
    return Promise.all(
      (
        await appDB.execute(
          // language=PostgreSQL
          `
            select id, name
            from staff
            where hospital = ?
          `,
          hospital
        )
      ).map(async it => {
        const result = await staffApi.findWorkScoreList(it.id, month);
        return {
          ...it,
          rate: result.rate,
          score: result.items.reduce(
            (result, current) => (result += current.score),
            0
          )
        };
      })
    );
  }
}

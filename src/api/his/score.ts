import {appDB, originalDB} from '../../app';
import {KatoRuntimeError, should, validate} from 'kato-server';
import {TagAlgorithmUsages} from '../../../common/rule-score';
import * as dayjs from 'dayjs';
import {
  HisStaffDeptType,
  HisStaffMethod,
  HisWorkMethod,
  MarkTagUsages
} from '../../../common/his';
import Decimal from 'decimal.js';
import {
  dateValid,
  dayToRange,
  getEndTime,
  getHospital,
  getSettle,
  monthToRange,
  StaffAssessModel,
  StaffWorkModel
} from './service';
import {createBackJob} from '../../utils/back-job';
import {HisWorkItemSources} from './work_item';
import {sql as sqlRender} from '../../database';

function log(...args) {
  console.log(dayjs().format('YYYY-MM-DD HH:mm:ss.SSS'), ...args);
}

/**
 * 工分流水
 */
type WorkItemDetail = {
  //工分项id
  id: string;
  //工分项名称
  name: string;
  //工分项得分
  score: number;
};

/**
 * 算出打分结果
 * @param ruleScores 要添加的数组
 */
async function staffScoreRate(ruleScores) {
  if (!ruleScores) return null;
  // 获取总分(分母)
  const scoreDenominator = ruleScores.reduce(
    (prev, curr) => Number(prev) + Number(curr?.total),
    0
  );

  // 获取得分(分子)
  const scoreNumerator = ruleScores.reduce(
    (prev, curr) => Number(prev) + Number(curr?.score),
    0
  );
  return Number(scoreDenominator) > 0 ? scoreNumerator / scoreDenominator : 0;
}

/**
 * 自动打分细则
 *
 * @param ruleModels 所有的细则
 * @param type 自动手动
 * @param assess, 打分表里的细则
 */
async function autoStaffAssess(ruleModels, type, assess: StaffAssessModel) {
  // 如果没有数据,说明是没有打过分,需要把细则都放到里面,然后打分
  if (!assess) {
    assess = {
      id: '',
      name: '',
      scores: ruleModels.map(ruleIt => {
        return {
          id: ruleIt.id,
          auto: ruleIt.auto,
          name: ruleIt.name,
          detail: ruleIt.detail,
          metric: ruleIt.metric,
          operator: ruleIt.operator,
          value: ruleIt.value,
          score: null,
          total: ruleIt.score
        };
      })
    };
  } else {
    // 如果有数据, 分为自动和手动两种情况
    if (type === 'automations') {
      // 自动的
      assess.scores = ruleModels.map(ruleIt => {
        //把手动的分放到数组中
        const index = assess.scores.find(
          scoreIt => ruleIt.id === scoreIt.id && scoreIt.auto === false
        );
        return {
          id: ruleIt.id,
          auto: ruleIt.auto,
          name: ruleIt.name,
          detail: ruleIt.detail,
          metric: ruleIt.metric,
          operator: ruleIt.operator,
          value: ruleIt.value,
          score: index
            ? index.score > index.total
              ? index.total
              : index.score
            : null,
          total: ruleIt.score
        };
      });
    }
    // 手动的情况,如果有数据, 只需要把可能存在的需要添加的细则加上, 不需要其他操作(不改变原分)
    if (type === 'manual') {
      assess.scores = ruleModels.map(ruleIt => {
        const index = assess.scores.find(scoreIt => ruleIt.id === scoreIt.id);
        return {
          id: ruleIt.id,
          auto: ruleIt.auto,
          name: ruleIt.name,
          detail: ruleIt.detail,
          metric: ruleIt.metric,
          operator: ruleIt.operator,
          value: ruleIt.value,
          score: index
            ? index.score > index.total
              ? index.total
              : index.score
            : null,
          total: ruleIt.score
        };
      });
    }
  }

  // 排查一波数字字段是否是纯数字和null
  assess.scores = assess.scores.map(it => {
    return {
      ...it,
      value: isNaN(Number(it.value)) ? null : it.value,
      total: isNaN(Number(it.total)) ? null : it.total,
      score: isNaN(Number(it.score)) ? null : it.score
    };
  });
  return {
    ruleScores: assess.scores
  };
}

async function getMark(hospital, year) {
  const list = await originalDB.execute(
    `select id, "HIS00"
         from mark_his_hospital
         where id = ? and year = ?
    `,
    hospital,
    year
  );
  return (
    list[0] ?? {
      id: null,
      HIS00: 0
    }
  );
}

export default class HisScore {
  // region 自动打分
  /**
   * 重新计算
   *
   * 工分和考核分, 全部重新计算
   * @param month 月份
   */
  async score(month) {
    const hospital = await getHospital();
    const day = getEndTime(month);
    const {start} = monthToRange(month);
    const settle = await getSettle(hospital, start);
    if (settle) throw new KatoRuntimeError('该月已结算, 不能打分');
    await createBackJob('HisSCore', '', {
      days: [day],
      hospital
    });
  }

  /**
   * 系统定时打分
   *
   * 此时都是计算前一天的分数
   * 只有定时任务才会调用
   */
  async autoScoreAll() {
    //打分的日期
    const day = dayjs()
      .startOf('d')
      //自动打分, 都是计算前一天的分数, 所以, 要减一天
      .subtract(1, 'd')
      .toDate();
    //查询结算状态
    const {start} = monthToRange(day);
    const hospitals = (
      await appDB.execute(
        // language=PostgreSQL
        `
          select a.code, a.name, hs.settle
          from area a
                 left join his_hospital_settle hs on a.code = hs.hospital and hs.month = ?
        `,
        start
      )
    ).filter(it => it.settle === false);
    for (const hospitalModel of hospitals) {
      //工分计算
      await this.workScoreHospital(day, hospitalModel.code);
      //考核打分
      await this.autoScoreHospital(day, hospitalModel.code);
    }
  }

  // endregion

  // region 打分代码
  /**
   * 机构自动打分
   * @param day 月份
   * @param id 机构id
   */
  async autoScoreHospital(day, id) {
    const hospital = await appDB.execute(
      `
          select id, name, hospital
          from staff
          where hospital = ?
        `,
      id
    );
    for (const staffIt of hospital) {
      try {
        log(`开始计算 ${staffIt.name} 打分`);
        await this.autoScoreStaff(day, staffIt?.id, id);
        log(`结束计算 ${staffIt.name} 打分`);
      } catch (e) {
        log(e);
      }
    }
  }

  /**
   * 员工自动打分
   * @param day 月份
   * @param staff 员工id
   * @param hospital 机构id
   */
  @validate(
    should.date().required(),
    should.string().required(),
    should.string().required()
  )
  async autoScoreStaff(day, staff, hospital) {
    const mark = await getMark(hospital, dayjs(day).year());
    return await appDB.joinTx(async () => {
      // 先根据员工查询考核
      const mapping = await appDB.execute(
        `select staff, "check" from his_staff_check_mapping
        where staff = ?`,
        staff
      );
      if (mapping.length === 0) {
        log(`员工${staff}无考核`);
        const resultOne = await appDB.execute(
          `
              select * from his_staff_result
              where id = ? and day = ?
          `,
          staff,
          day
        );
        if (resultOne.length > 0) {
          await appDB.execute(
            `
          update his_staff_result set assess = null
           where id = ? and day = ?
        `,
            staff,
            day
          );
        }
        return;
      }

      // 查询方案
      const checkSystemModels = await appDB.execute(
        `select  id, name, hospital from his_check_system where id = ?`,
        mapping[0].check
      );

      // 取出考核id
      const check = mapping[0]?.check;

      // 根据考核id查询考核细则
      const ruleModels = await appDB.execute(
        `select id, auto,  name, detail,
            metric, operator,
            value, score
          from his_check_rule
          where "check" = ?`,
        check
      );
      if (ruleModels.length === 0) {
        log(`考核${check}无细则`);
        return;
      }

      // 取出所有的自动打分的细则
      const autoRules = ruleModels.filter(it => it.auto);

      if (autoRules.length === 0) {
        log(`考核${check}无自动打分的细则`);
        return;
      }

      // 查询考核得分  只查询这个人这一天的细则得分, 过滤掉手动的
      let staffScores: {
        id: string;
        day: Date;
        assess: StaffAssessModel;
      } = (
        await appDB.execute(
          `
          select id, day, assess from his_staff_result
           where id = ? and day = ?
        `,
          staff,
          day
        )
      )[0];
      // 是添加还是修改
      let upsert = '';

      // 如果没有查到数据,或者查到数据了但是打分的字段为空,说明当天没有被打过分,需要先添加;
      if (!staffScores) {
        // 如果当天没有打过分, 先填充数据
        const assessModelObj = await autoStaffAssess(
          ruleModels,
          'automations',
          staffScores?.assess
        );

        staffScores = {
          // 员工id
          id: staff,
          day: day,
          assess: {
            id: checkSystemModels[0].id,
            name: checkSystemModels[0].name,
            scores: assessModelObj?.ruleScores,
            //质量系数
            rate: null
          }
        };
        // 是添加
        upsert = 'add';
      } else {
        upsert = 'update';
        // 如果查到数据,是重新打分,分为两种情况, 1: 打分字段有数据, 2: 打分字段无数据
        const assessModelObj = await autoStaffAssess(
          ruleModels,
          'automations',
          staffScores?.assess
        );

        staffScores = {
          // 员工id
          id: staff,
          day: day,
          assess: {
            id: checkSystemModels[0].id,
            name: checkSystemModels[0].name,
            scores: assessModelObj?.ruleScores,
            //质量系数
            rate: null
          }
        };
      }

      for (const ruleIt of autoRules) {
        // 如果查找到,是需要新增的数据
        const scoreIndex = staffScores?.assess?.scores.find(
          scoreIt => scoreIt.id === ruleIt.id
        );

        // 根据指标获取指标数据
        if (ruleIt.metric === MarkTagUsages.HIS00.code) {
          // 根据指标算法,计算得分 之 结果为"是"得满分
          if (ruleIt.operator === TagAlgorithmUsages.Y01.code && mark?.HIS00) {
            // 指标分数
            scoreIndex.score = ruleIt.score;
          }
          // 根据指标算法,计算得分 之 结果为"否"得满分
          if (ruleIt.operator === TagAlgorithmUsages.N01.code && !mark?.HIS00) {
            // 指标分数
            scoreIndex.score = ruleIt.score;
          }
          // “≥”时得满分，不足按比例得分
          if (ruleIt.operator === TagAlgorithmUsages.egt.code) {
            const rate = mark.HIS00 / ruleIt.value;
            // 指标分数
            scoreIndex.score = ruleIt.score * (rate > 1 ? 1 : rate);
          }
        }
      }

      // 算出占比
      staffScores.assess.rate = await staffScoreRate(
        staffScores?.assess?.scores
      );

      const nowDate = new Date();
      // 是添加
      if (upsert === 'add') {
        // 执行添加语句
        return await appDB.execute(
          `insert into
              his_staff_result(id, day, assess, created_at, updated_at)
              values(?, ?, ?, ?, ?)`,
          ...[
            staffScores.id,
            staffScores.day,
            JSON.stringify(staffScores.assess),
            nowDate,
            nowDate
          ]
        );
      } else {
        // 执行修改语句
        return await appDB.execute(
          `
            update his_staff_result
              set assess = ?,
                updated_at = ?
            where id = ? and day = ?`,
          JSON.stringify(staffScores.assess),
          nowDate,
          staffScores.id,
          staffScores.day
        );
      }
    });
  }

  /**
   * 自动手工打分 打前一天的手工分
   * @param day
   * @param staff
   * @constructor
   */
  @validate(
    should
      .date()
      .required()
      .description('时间'),
    should
      .string()
      .required()
      .description('考核员工id')
  )
  async autoManualScore(day, staff) {
    // 根据员工id查询出改员工是否有考核
    const staffSystem = await appDB.execute(
      `select staff, "check" from his_staff_check_mapping where staff = ?`,
      staff
    );
    if (staffSystem.length === 0) {
      log(`该员工无考核`);
      return;
    }

    // 根据员工id查询到的方案id查询方案
    const checkSystemModels = await appDB.execute(
      `select  id, name, hospital from his_check_system where id = ?`,
      staffSystem[0].check
    );

    if (checkSystemModels.length === 0) {
      log(`考核方案不存在`);
      return;
    }

    // 根据方案id查询考核细则
    const ruleModels = await appDB.execute(
      `select id, name, detail, auto, "check",
            metric, operator, value, score
           from his_check_rule
           where "check" = ?`,
      staffSystem[0].check
    );
    if (ruleModels.length === 0) {
      log(`考核方案没有细则`);
      return;
    }

    // 查询今天是否有分值
    let todayScore: {
      id: string;
      day: Date;
      assess: StaffAssessModel;
    } = (
      await appDB.execute(
        `select id, day, assess
           from his_staff_result
           where id = ? and day = ?`,
        staff,
        day
      )
    )[0];

    // 昨天的时间
    const yesterday = dayjs(day)
      .subtract(1, 'day')
      .toDate();
    // 查询昨天的分数
    const yesterdayScores: {
      id: string;
      day: Date;
      assess: StaffAssessModel;
    } = (
      await appDB.execute(
        `select id, day, assess
           from his_staff_result
           where id = ? and day = ?`,
        staff,
        yesterday
      )
    )[0];
    // 找出所有的昨天的手动打分
    const yesterdayAssess =
      yesterdayScores?.assess?.scores?.filter(
        yesterdayIt => yesterdayIt.auto === false
      ) ?? [];

    // 当前时间
    const nowDate = new Date();
    // 如果没有查询到, 说明还没有打过分,需要添加
    if (!todayScore) {
      const assessModelObj = await autoStaffAssess(
        ruleModels,
        'manual',
        todayScore?.assess
      );
      // 如果昨天的数据存在, 把昨天的手工分放到今天的手工分钟
      if (yesterdayAssess.length > 0) {
        for (const yesterdayIt of yesterdayAssess) {
          const index = assessModelObj?.ruleScores?.find(
            todayIt => todayIt.id === yesterdayIt.id
          );
          // 如果找到, 把昨天的分放到今天的数组中
          if (index) index.score = yesterdayIt.score;
        }
      }

      // 算出占比
      const rate = await staffScoreRate(assessModelObj?.ruleScores);

      todayScore = {
        // 员工id
        id: staff,
        day: day,
        assess: {
          id: checkSystemModels[0].id,
          name: checkSystemModels[0].name,
          scores: assessModelObj?.ruleScores,
          //质量系数
          rate: rate
        }
      };

      // 执行添加语句
      return await appDB.execute(
        `insert into
              his_staff_result(id, day, assess, created_at, updated_at)
              values(?, ?, ?, ?, ?)`,
        ...[
          todayScore.id,
          todayScore.day,
          JSON.stringify(todayScore.assess),
          nowDate,
          nowDate
        ]
      );
    } else {
      // 如果存在,有两种情况, 1: 考核方案的没有数据(工分有数据), 2: 考核方案有数据
      const assessModelObj = await autoStaffAssess(
        ruleModels,
        'manual',
        todayScore?.assess
      );

      // 算出占比
      const rate = await staffScoreRate(assessModelObj?.ruleScores);

      // 如果考核方案没有数据
      todayScore.assess = {
        id: checkSystemModels[0].id,
        name: checkSystemModels[0].name,
        scores: assessModelObj?.ruleScores,
        //质量系数
        rate: rate
      };
      // 执行修改语句
      return await appDB.execute(
        `
            update his_staff_result
              set assess = ?,
                updated_at = ?
            where id = ? and day = ?`,
        JSON.stringify(todayScore.assess),
        nowDate,
        staff,
        day
      );
    }
  }

  /**
   * 考核手动打分
   * 只要未结算,不管是新增,删除细则,都要按照细则表里的细则校验
   *
   * @param ruleId 细则id
   * @param staff 员工id
   * @param month 时间
   * @param score 分值
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
      .date()
      .required()
      .description('时间'),
    should
      .number()
      .required()
      .description('分值')
  )
  async setCheckScore(ruleId, staff, month, score) {
    // 获取机构id
    const hospital = await getHospital();
    // 是否结算
    const settle = await getSettle(hospital, month);
    if (settle) throw new KatoRuntimeError(`已结算,不能打分`);

    // 时间转换为本月的当前时间或者之前学的最后一天
    const scoreDate = getEndTime(month);

    // 根据员工id查询出改员工是否有考核
    const staffSystem = await appDB.execute(
      `select staff, "check" from his_staff_check_mapping where staff = ?`,
      staff
    );
    if (staffSystem.length === 0) throw new KatoRuntimeError(`该员工无考核`);

    // 查询方案
    const checkSystemModels = await appDB.execute(
      `select  id, name, hospital from his_check_system where id = ?`,
      staffSystem[0].check
    );

    if (checkSystemModels.length === 0)
      throw new KatoRuntimeError(`考核方案不存在`);

    // 查询考核细则
    const ruleModels = await appDB.execute(
      `select id, name, detail, auto, "check",
            metric, operator, value, score
           from his_check_rule
           where "check" = ?`,
      staffSystem[0].check
    );

    if (ruleModels.length === 0) throw new KatoRuntimeError(`考核方案没有细则`);

    const ruleOneModels = ruleModels.find(it => it.id === ruleId);

    if (!ruleOneModels) throw new KatoRuntimeError(`无此考核细则`);

    // 自动打分的不能手动打分
    if (ruleOneModels.auto === true)
      throw new KatoRuntimeError(`此考核细则不能手动打分`);

    if (ruleOneModels.score < score)
      throw new KatoRuntimeError(`分数不能高于细则的满分`);

    // 查询今天是否有分值
    let todayScore: {
      id: string;
      day: Date;
      assess: StaffAssessModel;
    } = (
      await appDB.execute(
        `select id, day, assess
           from his_staff_result
           where id = ? and day = ?`,
        staff,
        scoreDate
      )
    )[0];
    const nowDate = new Date();

    // 如果查到, 会过滤一遍分数表的细则, 如果没查到,会把细则表的细则添加进来
    const assessModelObj = await autoStaffAssess(
      ruleModels,
      'manual',
      todayScore?.assess
    );

    // 查找需要改分的细则, 因为上面补过,所以一定找的到
    const assessOneModel = assessModelObj?.ruleScores.find(
      scoreIt => scoreIt.id === ruleId
    );
    // 把分数赋值过去
    assessOneModel.score = score;
    // 算出占比
    const rate = await staffScoreRate(assessModelObj?.ruleScores);

    // 如果没有查询到, 说明还没有打过分,需要添加
    if (!todayScore) {
      todayScore = {
        // 员工id
        id: staff,
        day: scoreDate,
        assess: {
          id: checkSystemModels[0].id,
          name: checkSystemModels[0].name,
          scores: assessModelObj?.ruleScores,
          //质量系数
          rate: rate
        }
      };
      // 执行添加语句
      return await appDB.execute(
        `insert into
              his_staff_result(id, day, assess, created_at, updated_at)
              values(?, ?, ?, ?, ?)`,
        ...[
          todayScore.id,
          todayScore.day,
          JSON.stringify(todayScore.assess),
          nowDate,
          nowDate
        ]
      );
    } else {
      // 如果查询到,执行修改, 有两种情况, 1: 考核方案的没有数据(工分有数据), 2: 考核方案有数据
      todayScore.assess = {
        id: checkSystemModels[0].id,
        name: checkSystemModels[0].name,
        scores: assessModelObj?.ruleScores,
        //质量系数
        rate: rate
      };

      // 执行修改语句
      return await appDB.execute(
        `
            update his_staff_result
              set assess = ?,
                updated_at = ?
            where id = ? and day = ?`,
        JSON.stringify(todayScore.assess),
        nowDate,
        staff,
        scoreDate
      );
    }
  }

  // endregion

  //region 工分计算相关
  /**
   * 机构工分计算
   *
   * @param month 月份
   * @param hospital 机构id
   */
  async workScoreHospital(month, hospital) {
    log(`开始计算 ${hospital} 工分`);
    //查询员工
    // language=PostgreSQL
    const staffs: {id: string; name: string}[] = await appDB.execute(
      `
        select id, name
        from staff
        where hospital = ?
      `,
      hospital
    );
    //整理days
    const {start} = monthToRange(month);
    const end = getEndTime(month);
    const days = [];
    for (let i = 0; i <= dayjs(end).diff(start, 'd'); i++) {
      days.push(
        dayjs(start)
          .add(i, 'd')
          .toDate()
      );
    }
    //计算工分
    for (const staff of staffs) {
      log(`开始计算 ${staff.name} 工分`);
      await Promise.all(days.map(day => this.scoreStaff(staff.id, day)));
      log(`结束计算 ${staff.name} 工分`);
    }
    log(`结束计算 ${hospital} 工分`);
  }

  /**
   * 员工每日工分打分
   *
   * @param id 员工id
   * @param day 日期
   */
  async scoreStaff(id, day) {
    const {start, end} = dayToRange(day);
    //查询员工信息
    const staffModel: {
      id: string;
      name: string;
      department?: string;
      hospital: string;
      staff?: string;
    } = (
      await appDB.execute(
        `select id, name, staff, hospital, department from staff where id = ?`,
        id
      )
    )[0];
    //员工不存在, 直接返回
    if (!staffModel) return;
    //查询绑定关系
    //language=PostgreSQL
    const bindings: {
      //工分项自身
      id: string; //工分项id
      name: string; //工分项名称
      method: string; //得分方式
      score: number; //分值
      //关联项目
      source: string; //关联项目id
      //关联员工
      staff_type: string; //关联人员类型
      staff_id: string; //关联人员id
      staff_level: string; //关联人员层级
      //绑定关系
      rate: string; //权重
    }[] = await appDB.execute(
      `
        select wi.id,
               wi.name,
               wi.method,
               wi.score,
               wim.source,
               wi.type                   as staff_type,
               wism.source               as staff_id,
               coalesce(wism.type, '员工') as staff_level,
               swim.rate
        from his_staff_work_item_mapping swim
               inner join his_work_item wi on swim.item = wi.id
               inner join his_work_item_mapping wim on swim.item = wim.item
               left join his_work_item_staff_mapping wism on swim.item = wism.item
        where swim.staff = ?
      `,
      staffModel.id
    );
    //查询得分结果
    //language=PostgreSQL
    let resultModel: StaffWorkModel = (
      await appDB.execute(
        `
          select work
          from his_staff_result
          where id = ?
            and day = ? for update
        `,
        id,
        day
      )
    )[0]?.work;
    if (!resultModel) {
      resultModel = {
        self: [],
        staffs: []
      };
    }

    // //工分流水
    let workItems: WorkItemDetail[] = [];
    //计算工分
    //region 计算CHECK和DRUG工分来源
    for (const param of bindings.filter(
      it => it.source.startsWith('门诊') || it.source.startsWith('住院')
    )) {
      //region 处理人员条件条件
      let staffCondition = '1 = 0';
      let staffValue = id;
      //员工关联是 固定且员工
      if (
        param.staff_type === HisStaffMethod.STATIC &&
        param.staff_level === HisStaffDeptType.Staff
      ) {
        staffValue = param.staff_id;
        staffCondition = 'id = ?';
      }
      //员工关联是 固定且科室
      if (
        param.staff_type === HisStaffMethod.STATIC &&
        param.staff_level === HisStaffDeptType.DEPT
      ) {
        staffValue = param.staff_id;
        staffCondition = 'department = ?';
      }
      //员工关联是 固定且机构
      if (
        param.staff_type === HisStaffMethod.STATIC &&
        param.staff_level === HisStaffDeptType.HOSPITAL
      ) {
        staffValue = param.staff_id;
        staffCondition = 'hospital = ?';
      }
      //员工关联是 动态且员工
      if (
        staffModel.staff &&
        param.staff_type === HisStaffMethod.DYNAMIC &&
        param.staff_level === HisStaffDeptType.Staff
      ) {
        staffValue = staffModel.id;
        staffCondition = 'id = ?';
      }
      //员工关联是 动态且科室
      if (
        staffModel.department &&
        param.staff_type === HisStaffMethod.DYNAMIC &&
        param.staff_level === HisStaffDeptType.DEPT
      ) {
        staffValue = staffModel.department;
        staffCondition = 'department = ?';
      }
      //员工关联是 动态且机构
      if (
        param.staff_type === HisStaffMethod.DYNAMIC &&
        param.staff_level === HisStaffDeptType.HOSPITAL
      ) {
        staffValue = staffModel.hospital;
        staffCondition = 'hospital = ?';
      }
      const doctorValue = (
        await appDB.execute(
          `select staff from staff where staff is not null and ${staffCondition}`,
          staffValue
        )
      ).map(it => it.staff);
      let doctorCondition = '1 = 0';
      if (doctorValue.length > 0) {
        doctorCondition = `doctor in (${doctorValue.map(() => '?').join()})`;
      }
      //endregion
      //查询his的收费项目
      const rows: {
        value: string;
        date: Date;
      }[] = await originalDB.execute(
        // language=PostgreSQL
        `
          select total_price as value, operate_time as date
          from his_charge_detail
          where operate_time > ?
            and operate_time < ?
            and (item like ? or item = ?)
            and ${doctorCondition}
          order by operate_time
        `,
        start,
        end,
        `${param.source}.%`,
        param.source,
        ...doctorValue
      );
      //his收费项目流水转换成工分流水
      workItems = workItems.concat(
        rows.map<WorkItemDetail>(it => {
          let score = 0;
          //SUM得分方式
          if (param.method === HisWorkMethod.SUM) {
            score = new Decimal(it.value).mul(param.score).toNumber();
          }
          //AMOUNT得分方式
          if (param.method === HisWorkMethod.AMOUNT) {
            score = param.score;
          }
          //权重系数
          score = new Decimal(score).mul(param.rate).toNumber();
          return {
            id: param.id,
            name: param.name,
            score: score
          };
        })
      );
    }
    //endregion
    //region 计算MANUAL工分来源
    for (const param of bindings.filter(it =>
      it.source.startsWith('手工数据')
    )) {
      //region 处理人员条件条件
      let staffCondition = '1 = 0';
      let staffValue = id;
      //员工关联是 固定且员工
      if (
        param.staff_type === HisStaffMethod.STATIC &&
        param.staff_level === HisStaffDeptType.Staff
      ) {
        staffValue = param.staff_id;
        staffCondition = 's.id = ?';
      }
      //员工关联是 固定且科室
      if (
        param.staff_type === HisStaffMethod.STATIC &&
        param.staff_level === HisStaffDeptType.DEPT
      ) {
        staffValue = param.staff_id;
        staffCondition = 's.department = ?';
      }
      //员工关联是 固定且机构
      if (
        param.staff_type === HisStaffMethod.STATIC &&
        param.staff_level === HisStaffDeptType.HOSPITAL
      ) {
        staffValue = param.staff_id;
        staffCondition = 's.hospital = ?';
      }
      //员工关联是 动态且员工
      if (
        staffModel.staff &&
        param.staff_type === HisStaffMethod.DYNAMIC &&
        param.staff_level === HisStaffDeptType.Staff
      ) {
        staffValue = staffModel.id;
        staffCondition = 's.id = ?';
      }
      //员工关联是 动态且科室
      if (
        staffModel.department &&
        param.staff_type === HisStaffMethod.DYNAMIC &&
        param.staff_level === HisStaffDeptType.DEPT
      ) {
        staffValue = staffModel.department;
        staffCondition = 's.department = ?';
      }
      //员工关联是 动态且机构
      if (
        param.staff_type === HisStaffMethod.DYNAMIC &&
        param.staff_level === HisStaffDeptType.HOSPITAL
      ) {
        staffValue = staffModel.hospital;
        staffCondition = 's.hospital = ?';
      }
      //endregion
      //查询手工数据流水表
      const rows: {date: Date; value: number}[] = await appDB.execute(
        // language=PostgreSQL
        `
          select date, value
          from his_staff_manual_data_detail smdd
                 inner join staff s on s.id = smdd.staff
          where smdd.item = ?
            and smdd.date >= ?
            and smdd.date < ?
            and ${staffCondition}
        `,
        //手工数据的source转id, 默认是只能必须选id
        param.source.split('.')[1],
        start,
        end,
        staffValue
      );
      //手工数据流水转换成工分流水
      workItems = workItems.concat(
        rows.map<WorkItemDetail>(it => {
          let score = 0;
          //SUM得分方式
          if (param.method === HisWorkMethod.SUM) {
            score = new Decimal(it.value).mul(param.score).toNumber();
          }
          //AMOUNT得分方式
          if (param.method === HisWorkMethod.AMOUNT) {
            score = param.score;
          }
          //权重系数
          score = new Decimal(score).mul(param.rate).toNumber();
          return {
            id: param.id,
            name: param.name,
            score: score
          };
        })
      );
      //endregion
    }
    //endregion
    //region 计算公卫数据工分来源
    for (const param of bindings.filter(it =>
      it.source.startsWith('公卫数据')
    )) {
      //机构级别的数据, 直接用当前员工的机构id即可
      //查询hospital绑定关系
      // language=PostgreSQL
      const hisHospitals: string[] = (
        await appDB.execute(
          `
            select hishospid hospital
            from hospital_mapping
            where h_id = ?
          `,
          staffModel.hospital
        )
      ).map(it => it.hospital);
      //没有绑定关系, 直接跳过
      if (hisHospitals.length === 0) continue;
      const item = HisWorkItemSources.find(it => it.id === param.source);
      //未配置数据表, 直接跳过
      if (!item || !item?.datasource?.table) continue;
      //渲染sql
      const sqlRendResult = sqlRender(
        `
select 1 as value, {{dateCol}} as date
from {{table}}
where 1 = 1
  and {{dateCol}} >= {{? start}}
  and {{dateCol}} < {{? end}}
  and OperateOrganization in ({{#each hospitals}}{{? this}}{{#sep}},{{/sep}}{{/each}})
{{#each columns}} and {{this}} {{/each}}`,
        {
          dateCol: item.datasource.date,
          hospitals: hisHospitals,
          table: item.datasource.table,
          columns: item.datasource.columns,
          start,
          end
        }
      );
      const rows: {date: Date; value: number}[] = await originalDB.execute(
        sqlRendResult[0],
        ...sqlRendResult[1]
      );
      //公卫数据流水转换成工分流水
      workItems = workItems.concat(
        rows.map<WorkItemDetail>(it => {
          let score = 0;
          //SUM得分方式
          if (param.method === HisWorkMethod.SUM) {
            score = new Decimal(it.value).mul(param.score).toNumber();
          }
          //AMOUNT得分方式
          if (param.method === HisWorkMethod.AMOUNT) {
            score = param.score;
          }
          //权重系数
          score = new Decimal(score).mul(param.rate).toNumber();
          return {
            id: param.id,
            name: param.name,
            score: score
          };
        })
      );
    }
    //endregion
    //region 计算其他工分来源
    for (const param of bindings.filter(it => it.source.startsWith('其他'))) {
      let type = '';
      if (param.source === '其他.住院诊疗人次') type = '住院';
      if (param.source === '其他.门诊诊疗人次') type = '门诊';
      const rows: {date: Date; value: number}[] = (
        await originalDB.execute(
          // language=PostgreSQL
          `
            select distinct treat
            from his_charge_master
            where hospital = ?
              and operate_time > ?
              and operate_time < ?
              and charge_type = ?
          `,
          staffModel.hospital,
          start,
          end,
          type
        )
      ).map(() => ({
        value: 1,
        date: day
      }));
      //其他工分流水转换成工分流水
      workItems = workItems.concat(
        rows.map<WorkItemDetail>(it => {
          let score = 0;
          //SUM得分方式
          if (param.method === HisWorkMethod.SUM) {
            score = new Decimal(it.value).mul(param.score).toNumber();
          }
          //AMOUNT得分方式
          if (param.method === HisWorkMethod.AMOUNT) {
            score = param.score;
          }
          //权重系数
          score = new Decimal(score).mul(param.rate).toNumber();
          return {
            id: param.id,
            name: param.name,
            score: score
          };
        })
      );
    }
    //endregion
    //region 写入结果表
    //累加流水
    resultModel.self = workItems.reduce((result, current) => {
      const obj = result.find(it => it.id === current.id);
      if (obj) {
        obj.score = new Decimal(obj.score).add(current.score).toNumber();
      } else {
        result.push({
          id: current.id,
          name: current.name,
          score: current.score
        });
      }
      return result;
    }, []);
    //补充没有得分的工分项
    for (const param of bindings) {
      const obj = resultModel.self.find(it => it.id === param.id);
      if (!obj) {
        resultModel.self.push({
          id: param.id,
          name: param.name,
          score: 0
        });
      }
    }
    //TODO: 兼容老设计, 等待确认完删除
    resultModel.staffs = [];
    const resultValue = JSON.stringify(resultModel);
    await appDB.execute(
      //language=PostgreSQL
      `
        insert into his_staff_result(id, day, work)
        values (?, ?, ?)
        on conflict (id, day)
          do update set work       = ?,
                        updated_at = now()
      `,
      id,
      day,
      resultValue,
      resultValue
    );
    //endregion
  }

  /**
   * 设置员工附加分
   *
   * @param id 员工id
   * @param month 月份
   * @param score 附加分数
   */
  @validate(should.string().required(), dateValid, should.number().required())
  async setExtraScore(id, month, score) {
    const hospital = await getHospital();
    const {start} = monthToRange(month);
    const settle = await getSettle(hospital, start);
    if (settle) {
      throw new KatoRuntimeError(`机构已经结算, 不能修改附加分`);
    }
    //更新附加分
    // language=PostgreSQL
    await appDB.execute(
      `
        insert into his_staff_extra_score(staff, month, score)
        values (?, ?, ?)
        on conflict (staff, month)
          do update set score      = ?,
                        updated_at = now()
      `,
      id,
      start,
      score,
      score
    );
  }

  //endregion
}

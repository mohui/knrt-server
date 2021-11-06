// region 员工信息
import {appDB, originalDB} from '../../app';
import {
  DoctorType,
  Education,
  HighTitle,
  MajorHealthType,
  MajorType,
  Occupation
} from '../../../common/his';
import * as dayjs from 'dayjs';

export async function getStaffList(hospital) {
  // region 员工信息

  // 查询员工信息
  const staffModels = await appDB.execute(
    // language=PostgreSQL
    `
      select id,
             account,
             name,
             major,
             title,
             education,
             "isGP",
             created_at
      from staff
      where hospital = ?
    `,
    hospital
  );
  // 给员工标注
  const staffList = staffModels.map(it => {
    // 先查找 专业类别,找到此专业类别的类型
    const findIndex = Occupation.find(majorIt => majorIt.name === it.major);
    // 根据查找到的专业类别, 查找 职称名称 的职称类型
    let titleIndex;
    if (findIndex) {
      titleIndex = findIndex?.children?.find(
        titleIt => titleIt.name === it.title
      );
    }
    return {
      ...it,
      majorType: findIndex?.majorType ?? null,
      doctorType: findIndex?.doctorType ?? null,
      majorHealthType: findIndex?.majorHealthType ?? null,
      level: titleIndex?.level ?? null
    };
  });
  // endregion

  // region 得出机构下各种员工数

  // 获取本年的开始时间
  const yearStart = dayjs()
    .startOf('y')
    .toDate();

  // 基层医疗卫生机构全科医生数
  const GPList = staffList.filter(it => it.isGP);

  // 基层医疗卫生机构全科医生增长数
  const increasesGPList = staffList.filter(
    it => it.isGP && it.created_at >= yearStart
  );

  // 护士列表
  const nurseList = staffList.filter(it => it.majorType === MajorType.NURSE);

  // 医师列表
  const physicianList = staffList.filter(
    it => it.majorType === MajorType.PHYSICIAN
  );

  // 查询所有不是专科及以下的,就是本科及以上, 切学历不能为空,必须是卫生技术人员
  const bachelorList = staffList.filter(
    it =>
      it.education != Education.COLLEGE &&
      it.education &&
      it.majorHealthType === MajorHealthType.healthWorkers
  );
  // 同期卫生技术人员总数
  const healthWorkersList = staffList.filter(
    it => it.majorHealthType === MajorHealthType.healthWorkers
  );

  // 具有 高级职称 的卫生技术人员数
  const highTitleList = staffList.filter(
    it => it.level === HighTitle.highTitle
  );

  // 中医列表
  const TCMList = staffList.filter(it => it.doctorType === DoctorType.TCM);
  // endregion

  /**
   * GPCount: 基层医疗卫生机构全科医生数
   * increasesGPCount: 基层医疗卫生机构全科医生增长数
   * nurseCount: 护士数量
   * physicianCount: 医师数量
   * bachelorCount: 本科及以上卫生技术人员数
   * healthWorkersCount: 同期卫生技术人员总数
   * highTitleCount: 具有高级职称的卫生技术人员数
   * TCMCount: 中医数量
   */
  return {
    GPCount: GPList.length,
    increasesGPCount: increasesGPList.length,
    nurseCount: nurseList.length,
    physicianCount: physicianList.length,
    bachelorCount: bachelorList.length,
    healthWorkersCount: healthWorkersList.length,
    highTitleCount: highTitleList.length,
    TCMCount: TCMList.length
  };
}

// endregion

/**
 * 指标数量
 */
export async function getMarkMetric(
  hospital
): Promise<{
  'HIS.OutpatientVisits': number;
  'HIS.OutpatientIncomes': number;
  'HIS.DischargedVisits': number;
  'HIS.InpatientVisits': number;
  'HIS.InpatientIncomes': number;
}> {
  const year = dayjs().year();
  // 查询机构指标信息
  const staffModels = await originalDB.execute(
    // language=PostgreSQL
    `
      select id, year, name, value, created_at
      from mark_metric
      where id = ?
        and year = ?
    `,
    hospital,
    year
  );

  /**
   * HIS.OutpatientVisits: 门急诊人次数
   * HIS.OutpatientIncomes: 门急诊收入
   * HIS.DischargedVisits: 出院人次数
   * HIS.InpatientVisits: 住院人次数
   * HIS.InpatientIncomes: 住院收入
   */
  const obj = {
    'HIS.OutpatientVisits': 0,
    'HIS.OutpatientIncomes': 0,
    'HIS.DischargedVisits': 0,
    'HIS.InpatientVisits': 0,
    'HIS.InpatientIncomes': 0
  };

  for (const it of staffModels) {
    for (const key of Object.keys(obj)) {
      if (it.name === key) obj[key] = it?.value ?? 0;
    }
  }
  return obj;
}

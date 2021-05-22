import {KatoCommonError, KatoRuntimeError, should, validate} from 'kato-server';
import {appDB, originalDB} from '../../app';
import * as uuid from 'uuid';
import * as dayjs from 'dayjs';
import {getHospital} from './his_staff';
import {HisWorkMethod, HisWorkSource} from '../../../common/his';

/**
 * 接口
 * 新建公分项
 * 员工和工分项的绑定
 * 公分项列表
 */
export default class HisWorkItem {
  /**
   * 新建公分项
   *
   * @param name 工分项目名称
   * @param method 得分方式; 计数/总和
   * @param source 来源id[]
   * @param type 类型; 检查项目/药品/手工数据
   */
  @validate(
    should
      .string()
      .required()
      .description('工分项目名称'),
    should
      .string()
      .only(HisWorkMethod.AMOUNT, HisWorkMethod.SUM)
      .description('得分方式; 计数/总和'),
    should
      .array()
      .required()
      .description('来源id[]'),
    should
      .string()
      .only(HisWorkSource.CHECK, HisWorkSource.DRUG, HisWorkSource.MANUAL)
      .description('类型; 检查项目/药品/手工数据')
  )
  async add(name, method, source, type) {
    const hospital = await getHospital();

    return appDB.transaction(async () => {
      const hisWorkItemId = uuid.v4();
      // 添加工分项目
      await appDB.execute(
        ` insert into
              his_work_item(id, hospital, name, method, created_at, updated_at)
              values(?, ?, ?, ?, ?, ?)`,
        hisWorkItemId,
        hospital,
        name,
        method,
        dayjs().toDate(),
        dayjs().toDate()
      );

      // 添加工分项目与his收费项目关联表
      for (const sourceId of source) {
        await appDB.execute(
          `insert into
              his_work_item_mapping(item, source, type, created_at, updated_at)
              values(?, ?, ?, ?, ?)`,
          hisWorkItemId,
          sourceId,
          type,
          dayjs().toDate(),
          dayjs().toDate()
        );
      }
    });
  }

  /**
   * 员工和工分项绑定
   * @param item
   * @param staffs
   */
  @validate(
    should
      .string()
      .required()
      .description('工分项目id'),
    should
      .array()
      .items({
        staffs: should.array().required(),
        score: should.number().required()
      })
      .required()
      .description('员工和分值')
  )
  async addHisStaffWorkItemMapping(item, staffs) {
    return appDB.transaction(async () => {
      // 排查公分项是否存在
      const itemList = await appDB.execute(
        `select * from his_work_item where id = ?`,
        item
      );
      if (itemList.length === 0) throw new KatoRuntimeError(`工分项目不存在`);
      // 排查公分项是否存在
      const staffItemList = await appDB.execute(
        `select * from his_staff_work_item_mapping where item = ?`,
        item
      );
      // 如果已经存在,先删除
      if (staffItemList.length > 0)
        await appDB.execute(
          `delete from his_staff_work_item_mapping where item = ?`,
          item
        );
      // 绑定员工和工分项
      for (const it of staffs) {
        for (const staffIt of it.staffs) {
          await appDB.execute(
            ` insert into
              his_staff_work_item_mapping(item, staff, score, created_at, updated_at)
              values(?, ?, ?, ?, ?)`,
            item,
            staffIt,
            it.score,
            dayjs().toDate(),
            dayjs().toDate()
          );
        }
      }
    });
  }

  /**
   * 工分项列表
   */
  async list() {
    // 获取机构id
    const hospital = await getHospital();
    // 查询工分项目
    const workItemList = await appDB.execute(
      `select id, name, method from his_work_item where hospital = ?`,
      hospital
    );
    if (workItemList.length === 0) return [];
    // 数据来源
    let itemMappings = [];

    for (const it of workItemList) {
      // 工分项id
      const itemId = it?.id;
      // 查找工分项目来源
      const workItemMappingList = await appDB.execute(
        `select item, source, type from his_work_item_mapping where item = ?`,
        itemId
      );
      const checkIds = workItemMappingList
        .filter(it => it.type === HisWorkSource.CHECK)
        .map(it => it.source);

      const drugsIds = workItemMappingList
        .filter(it => it.type === HisWorkSource.DRUG)
        .map(it => it.source);

      const manualIds = workItemMappingList
        .filter(it => it.type === HisWorkSource.MANUAL)
        .map(it => it.source);
      // 检查项目列表
      let checks = [];
      // 药品
      let drugs = [];
      // 手工数据
      let manuals = [];
      if (checkIds.length > 0) {
        checks = await originalDB.execute(
          `select id, name
             from his_check where id in (${checkIds.map(() => '?')})`,
          ...checkIds
        );
      }
      // 药品
      if (drugsIds.length > 0) {
        drugs = await originalDB.execute(
          `select id, name
             from his_drug where id in (${drugsIds.map(() => '?')})`,
          ...drugsIds
        );
      }
      // 手工数据
      if (manualIds.length > 0) {
        manuals = await originalDB.execute(
          `select id, name
             from his_manual_data where id in (${manualIds.map(() => '?')})`,
          ...manualIds
        );
      }
      itemMappings = checks.concat(drugs, manuals);
      it['mappings'] = itemMappings;
    }

    return workItemList;
  }
}

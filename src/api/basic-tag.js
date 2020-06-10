import {BasicTagDataModel} from '../database/model';
import {appDB} from '../app';
import {should, validate} from 'kato-server';
import dayjs from 'dayjs';
import {BasicTags} from '../../common/rule-score';
import {Context} from './context';

export default class BasicTag {
  //设置基础数据
  @validate(
    should.object({
      id: should.string().description('基础数据id'),
      value: should.number().description('数据值'),
      hospitalId: should.string().description('机构id'),
      code: should.string().description('基础数据code')
    })
  )
  async upsert(params) {
    return appDB.transaction(async () => {
      const {id = '', value = 0} = params;
      //id不存在则插入新数据
      if (!id) {
        //自动设置当前的年份
        params.year = dayjs().year();
        //自动设置修改人姓名
        params.editor = Context.current.user.name;
        return await BasicTagDataModel.create(params);
      }
      //否则修改已有的数据
      const tag = await BasicTagDataModel.findOne({where: {id}, lock: true});
      tag.value = value;
      tag.editor = Context.current.user.name;
      return await tag.save();
    });
  }

  @validate(
    should
      .string()
      .required()
      .description('大类指标的code')
  )
  async list(tagCode) {
    //当前用户地区权限下所直属的机构
    const hospitals = Context.current.user.hospitals;
    //获取大类指标下的所有的小类
    const childrenTag = BasicTags.find(bt => bt.code === tagCode).children;

    //机构和指标对应数组
    let hospitalTags = [];
    for (let i = 0; i < childrenTag.length; i++) {
      for (let j = 0; j < hospitals.length; j++) {
        hospitalTags.push({
          name: hospitals[j].name,
          regionId: hospitals[j].regionId,
          parent: hospitals[j].parent,
          hospitalId: hospitals[j].id,
          code: childrenTag[i].code,
          value: 0,
          year: dayjs().year()
        });
      }
    }

    const queryResult = await Promise.all(
      hospitalTags.map(async it => {
        //查询某个机构下某个指标的数据
        const basicData = await BasicTagDataModel.findOne({
          where: {code: it.code, hospitalId: it.hospitalId}
        });
        //该数据存在则赋值相关字段
        return basicData ? {...it, ...basicData.toJSON()} : it;
      })
    );

    //组织返回结果
    return hospitals.map(h => {
      //该机构的所有相关指标数据
      const tags = queryResult.filter(q => q.hospitalId === h.id);
      //对更新时间进行排序,目的取出最新的更新时间和最后的修改人
      const sortTags =
        tags.sort((p, n) => dayjs(n?.updated_at).isAfter(p?.updated_at)) || [];
      h['updated_at'] = sortTags[0]?.updated_at || null;
      h['editor'] = sortTags[0]?.editor || null;
      //给该机构对象添加相应的指标字段
      tags.forEach(
        tag =>
          (h[tag.code] = {
            id: tag.id,
            code: tag.code,
            year: tag.year,
            value: tag.value
          })
      );
      return h;
    });
  }
}

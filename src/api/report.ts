import {unifs} from '../app';
import * as dayjs from 'dayjs';

/**
 * 语义化时间
 *
 * @param time 时间字符串, '202001'
 */

function displayTime(time) {
  const year = dayjs(time).year();
  const month = dayjs(time).month() + 1;
  let dateLabel = `${year}-${month}月报告`;
  if (month === 3) dateLabel = `${year}第一季度报告`;
  if (month === 6) dateLabel = `${year}上半年报告`;
  if (month === 9) dateLabel = `${year}第三季度报告`;
  if (month === 12) dateLabel = `${year}年度报告`;
  return dateLabel;
}

export default class Report {
  /**
   * 获取报告列表
   *
   * @param id 地区或机构id
   * @return {
   *   id: 文件id
   *   name: 文件名
   *   url: 文件下载地址
   * }
   */
  async list(id) {
    const urlList = await unifs.list('/report/appraisal/report');

    const urlList1 = await Promise.all(
      urlList
        .filter(it => it.isDirectory === false)
        .map(async it => {
          const areaTimeStr = it.name.split('/').pop();
          const strLength = areaTimeStr.length;
          const areaId = areaTimeStr.substr(0, strLength - 12);
          const time = areaTimeStr
            .split('.')[0]
            .split('-')
            .pop();
          return {
            id: it.name,
            name: `${areaId}_${displayTime(time)}`,
            url: await this.sign(it.name),
            area: areaId
          };
        })
    );
    return urlList1
      .filter(it => it.area === id)
      .map(it => {
        return {
          id: it.id,
          name: it.name,
          url: it.url
        };
      });
  }

  /**
   * unifs文件地址
   *
   * @param file 签名
   */
  async sign(file) {
    return await unifs.getExternalUrl(file);
  }
}

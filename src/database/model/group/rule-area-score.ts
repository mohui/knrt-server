import {
  AllowNull,
  Column,
  Comment,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table
} from 'sequelize-typescript';

@Table({tableName: 'rule_area_score'})
export class RuleAreaScore extends Model<RuleAreaScore> {
  @Comment('考核细则id')
  @AllowNull(false)
  @PrimaryKey
  @Column({field: 'rule'})
  ruleId: string;

  @Comment('地区code')
  @AllowNull(false)
  @PrimaryKey
  @Column({field: 'area'})
  areaCode: string;

  @Comment('得分')
  @AllowNull(false)
  @Column(DataType.FLOAT)
  score: number;

  @Comment('是否自动打分')
  @AllowNull(false)
  @Default(true)
  @Column
  auto: boolean;
}